-- Вопрос 3.
WITH per_order AS (
    SELECT o.order_id,
           SUM(i.price + i.freight_value) AS order_value,
           COUNT(DISTINCT (i.product_id, i.seller_id)) AS item_lines,
           COUNT(*) AS units
    FROM core.orders AS o
    INNER JOIN core.order_items AS i ON i.order_id = o.order_id
    WHERE o.order_status = 'delivered'
    GROUP BY o.order_id
)
SELECT ROUND(AVG(order_value), 2) AS average_order_value,
       ROUND(AVG(item_lines), 6) AS average_item_lines,
       ROUND(AVG(units), 6) AS average_units
FROM per_order;
