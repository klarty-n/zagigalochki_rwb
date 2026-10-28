\set ON_ERROR_STOP on
-- Compare live marts against independent core aggregations, not fixed future totals.
DO $$
DECLARE expected numeric; actual numeric;
BEGIN
 IF (SELECT COUNT(*) FROM mart.order_metrics) <> (SELECT COUNT(*) FROM core.orders) THEN
  RAISE EXCEPTION 'order_metrics loses or duplicates orders';
 END IF;
 SELECT SUM(i.price) INTO expected FROM core.order_items i JOIN core.orders o USING(order_id)
 WHERE o.order_status='delivered';
 SELECT SUM(revenue) INTO actual FROM mart.monthly_sales;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Monthly revenue mismatch'; END IF;
 IF (SELECT SUM(revenue) FROM mart.category_monthly_sales) IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Category revenue mismatch'; END IF;
 IF (SELECT SUM(revenue) FROM mart.seller_monthly_sales) IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Seller revenue mismatch'; END IF;
 IF (SELECT COUNT(*) FROM mart.monthly_sales WHERE month>=date '2016-09-01' AND month<date '2018-09-01')<>24 THEN
  RAISE EXCEPTION 'Missing reporting months'; END IF;
 IF (SELECT customers FROM mart.repeat_customers)<>(
  SELECT COUNT(DISTINCT c.customer_unique_id) FROM core.orders o JOIN core.customers c USING(customer_id)
 ) THEN RAISE EXCEPTION 'Customer count mismatch'; END IF;
 SELECT AVG(v) INTO expected FROM (
  SELECT SUM(i.price+i.freight_value) v FROM core.order_items i JOIN core.orders o USING(order_id)
  WHERE o.order_status='delivered' GROUP BY o.order_id
 ) q;
 IF (SELECT average_order_value FROM mart.sales_kpis) IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Average check mismatch'; END IF;
END $$;
SELECT 'mart checks passed' AS result;
DO $$ BEGIN
 IF NOT has_table_privilege('dashboard_reader','mart.monthly_sales','SELECT')
 OR has_table_privilege('dashboard_reader','core.orders','SELECT')
 OR has_table_privilege('dashboard_reader','mart.monthly_sales','INSERT') THEN
  RAISE EXCEPTION 'Dashboard role privileges differ from contract';
 END IF;
END $$;
