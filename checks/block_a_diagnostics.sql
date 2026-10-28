-- Диагностика после наполнения core, обычный SQL для DBeaver.
-- Ничего не изменяет. Нулевые delivered_without_items и orphan_* обязательны.
SELECT COUNT(*) AS delivered_without_items
FROM core.orders AS o
WHERE o.order_status='delivered'
  AND NOT EXISTS (SELECT 1 FROM core.order_items AS i WHERE i.order_id=o.order_id);

SELECT 'orders' AS entity, COUNT(*)-COUNT(DISTINCT order_id) AS duplicate_keys
FROM core.orders
UNION ALL SELECT 'order_items',COUNT(*)-COUNT(DISTINCT(order_id,order_item_id)) FROM core.order_items
UNION ALL SELECT 'customers',COUNT(*)-COUNT(DISTINCT customer_id) FROM core.customers
UNION ALL SELECT 'products',COUNT(*)-COUNT(DISTINCT product_id) FROM core.products
UNION ALL SELECT 'sellers',COUNT(*)-COUNT(DISTINCT seller_id) FROM core.sellers
UNION ALL SELECT 'categories',COUNT(*)-COUNT(DISTINCT category_name) FROM core.categories;

WITH per_order AS (
 SELECT o.order_id,COUNT(*) AS stored_rows,
        COUNT(DISTINCT(i.product_id,i.seller_id)) AS product_lines
 FROM core.orders AS o JOIN core.order_items AS i ON i.order_id=o.order_id
 WHERE o.order_status='delivered' GROUP BY o.order_id
)
SELECT ROUND(AVG(stored_rows),6) AS average_storage_rows_and_units,
       ROUND(AVG(product_lines),6) AS average_product_seller_lines
FROM per_order;

SELECT order_status,COUNT(*) AS orders
FROM core.orders GROUP BY order_status ORDER BY orders DESC;
