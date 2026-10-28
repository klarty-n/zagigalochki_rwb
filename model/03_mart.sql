\set ON_ERROR_STOP on
BEGIN;
CREATE SCHEMA IF NOT EXISTS mart;
COMMENT ON SCHEMA mart IS 'Dashboard contracts over core. Views show current core snapshot; no stored aggregates.';

-- One row per order, including orders without items. No payment/review fanout.
CREATE OR REPLACE VIEW mart.order_metrics AS
WITH items AS (
 SELECT order_id, SUM(price) AS product_value, SUM(freight_value) AS freight_value,
        COUNT(*) AS units, COUNT(DISTINCT (product_id,seller_id)) AS item_lines
 FROM core.order_items GROUP BY order_id
)
SELECT o.order_id, c.customer_unique_id, o.order_status, o.order_purchase_at,
 date_trunc('month',o.order_purchase_at)::date AS month,
 COALESCE(i.product_value,0::numeric) AS product_value,
 COALESCE(i.freight_value,0::numeric) AS freight_value,
 COALESCE(i.product_value+i.freight_value,0::numeric) AS order_value,
 COALESCE(i.units,0::bigint) AS units,
 COALESCE(i.item_lines,0::bigint) AS item_lines,
 i.order_id IS NOT NULL AS has_items, c.state AS buyer_state
FROM core.orders o JOIN core.customers c USING(customer_id)
LEFT JOIN items i USING(order_id);

-- Grain: one delivered unit. Do not join payments or reviews directly here.
CREATE OR REPLACE VIEW mart.delivered_items AS
SELECT i.order_id, i.order_item_id, i.product_id, i.seller_id,
 date_trunc('month',o.order_purchase_at)::date AS month,
 o.order_purchase_at, i.price, i.freight_value,
 s.city AS seller_city, s.state AS seller_state,
 p.category_name AS category_code,
 COALESCE(NULLIF(btrim(c.category_name_english),''),p.category_name,'Не указана') AS category, buyer.state AS buyer_state
FROM core.order_items i JOIN core.orders o USING(order_id)
JOIN core.customers buyer ON buyer.customer_id=o.customer_id
JOIN core.sellers s USING(seller_id)
JOIN core.products p USING(product_id)
LEFT JOIN core.categories c ON c.category_name=p.category_name
WHERE o.order_status='delivered';

-- Calendar keeps the original 24 months and extends when new orders arrive.
CREATE OR REPLACE VIEW mart.monthly_sales AS
WITH bounds AS (
 SELECT LEAST(date '2016-09-01',MIN(month)) AS lo,
 GREATEST(date '2018-08-01',MAX(month)) AS hi FROM mart.order_metrics
), calendar AS (
 SELECT generate_series(lo::timestamp,hi::timestamp,interval '1 month')::date AS month FROM bounds
), sales AS (
 SELECT month,COUNT(*) AS orders,SUM(product_value) AS revenue,
 SUM(freight_value) AS freight_value,SUM(order_value) AS order_value,
 SUM(units) AS units,SUM(item_lines) AS item_lines
 FROM mart.order_metrics WHERE order_status='delivered' AND has_items GROUP BY month
)
SELECT c.month,COALESCE(s.orders,0::bigint) AS orders,
 COALESCE(s.revenue,0::numeric) AS revenue,
 COALESCE(s.freight_value,0::numeric) AS freight_value,
 COALESCE(s.order_value,0::numeric) AS order_value,
 COALESCE(s.units,0::numeric) AS units,COALESCE(s.item_lines,0::numeric) AS item_lines,
 s.order_value/NULLIF(s.orders,0) AS average_order_value
FROM calendar c LEFT JOIN sales s USING(month);

CREATE OR REPLACE VIEW mart.seller_monthly_sales AS
SELECT month,seller_id,seller_city,seller_state,COUNT(DISTINCT order_id) AS orders,
 COUNT(*) AS units,SUM(price) AS revenue
FROM mart.delivered_items GROUP BY month,seller_id,seller_city,seller_state;

CREATE OR REPLACE VIEW mart.category_monthly_sales AS
SELECT month,category_code,category,COUNT(DISTINCT order_id) AS orders,
 COUNT(*) AS units,SUM(price) AS revenue
FROM mart.delivered_items GROUP BY month,category_code,category;

-- All statuses, stable person key, all time: matches question 4.
CREATE OR REPLACE VIEW mart.customer_purchases AS
SELECT customer_unique_id,COUNT(*) AS orders,MIN(order_purchase_at) AS first_order_at,
 MAX(order_purchase_at) AS last_order_at
FROM mart.order_metrics GROUP BY customer_unique_id;

CREATE OR REPLACE VIEW mart.repeat_customers AS
SELECT COUNT(*) AS customers,COUNT(*) FILTER(WHERE orders>=2) AS repeat_customers,
 100.0*COUNT(*) FILTER(WHERE orders>=2)/NULLIF(COUNT(*),0) AS repeat_percent
FROM mart.customer_purchases;

CREATE OR REPLACE VIEW mart.sales_kpis AS
SELECT COUNT(*) AS orders,SUM(product_value) AS revenue,SUM(order_value) AS order_value,
 AVG(order_value) AS average_order_value,AVG(item_lines) AS average_item_lines,
 AVG(units) AS average_units
FROM mart.order_metrics WHERE order_status='delivered' AND has_items;
COMMIT;
