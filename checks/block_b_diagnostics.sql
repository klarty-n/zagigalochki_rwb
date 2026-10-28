-- These are observations, not instructions to delete source records.
SELECT COUNT(*) AS delivered,
 COUNT(*) FILTER(WHERE delivered_customer_at IS NULL) AS missing_delivery_date,
 COUNT(*) FILTER(WHERE delivered_customer_at<order_purchase_at) AS negative_delivery_interval,
 COUNT(*) FILTER(WHERE estimated_delivery_date IS NULL) AS missing_promise
FROM core.orders WHERE order_status='delivered';
SELECT COUNT(*) AS orders_with_multiple_reviews FROM (
 SELECT order_id FROM core.order_reviews GROUP BY order_id HAVING COUNT(*)>1
) q;
SELECT payment_type,COUNT(*) FILTER(WHERE payment_installments=0) AS zero_installments,
 COUNT(*) FILTER(WHERE payment_installments<0) AS negative_installments
FROM core.order_payments GROUP BY payment_type ORDER BY payment_type;
SELECT i.product_id,COUNT(DISTINCT i.price) AS distinct_prices,
 COUNT(DISTINCT i.seller_id) AS sellers,COUNT(*) AS delivered_units
FROM core.order_items i JOIN core.orders o USING(order_id)
WHERE o.order_status='delivered'
GROUP BY i.product_id ORDER BY distinct_prices DESC,i.product_id LIMIT 5;
