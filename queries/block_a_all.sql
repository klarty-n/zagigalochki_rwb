-- Вопрос 1. 
WITH calendar AS (
    SELECT generate_series(
        timestamp '2016-09-01', timestamp '2018-08-01', interval '1 month'
    )::date AS month
),
per_order AS (
    SELECT o.order_id,
           date_trunc('month', o.order_purchase_at)::date AS month,
           SUM(i.price) AS revenue
    FROM core.orders AS o
    INNER JOIN core.order_items AS i ON i.order_id = o.order_id
    WHERE o.order_status = 'delivered'
      AND o.order_purchase_at >= timestamp '2016-09-01'
      AND o.order_purchase_at <  timestamp '2018-09-01'
    GROUP BY o.order_id, date_trunc('month', o.order_purchase_at)::date
),
monthly AS (
    SELECT month, COUNT(*) AS orders, SUM(revenue) AS revenue
    FROM per_order
    GROUP BY month
)
SELECT c.month,
       COALESCE(m.orders, 0) AS orders,
       COALESCE(m.revenue, 0::numeric) AS revenue
FROM calendar AS c
LEFT JOIN monthly AS m ON m.month = c.month
ORDER BY c.month;

-- Вопрос 2.
SELECT i.seller_id AS seller,
       s.city,
       s.state,
       COUNT(DISTINCT i.order_id) AS orders,
       COUNT(*) AS units,
       SUM(i.price) AS revenue
FROM core.order_items AS i
INNER JOIN core.orders AS o ON o.order_id = i.order_id
INNER JOIN core.sellers AS s ON s.seller_id = i.seller_id
WHERE o.order_status = 'delivered'
GROUP BY i.seller_id, s.city, s.state
ORDER BY revenue DESC, i.seller_id
LIMIT 10;

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

-- Вопрос 4.
WITH per_person AS (
    SELECT c.customer_unique_id,
           COUNT(DISTINCT o.order_id) AS orders
    FROM core.orders AS o
    INNER JOIN core.customers AS c ON c.customer_id = o.customer_id
    GROUP BY c.customer_unique_id
)
SELECT COUNT(*) AS customers,
       COUNT(*) FILTER (WHERE orders >= 2) AS repeat_customers,
       ROUND(
           100.0 * COUNT(*) FILTER (WHERE orders >= 2)
           / NULLIF(COUNT(*), 0), 2
       ) AS repeat_percent
FROM per_person;

-- Вопрос 5.
WITH category_sales AS (
    SELECT p.category_name,
           SUM(i.price) AS revenue
    FROM core.order_items AS i
    INNER JOIN core.orders AS o ON o.order_id = i.order_id
    INNER JOIN core.products AS p ON p.product_id = i.product_id
    WHERE o.order_status = 'delivered'
    GROUP BY p.category_name
)
SELECT COALESCE(c.category_name_english, r.category_name, 'Не указана') AS category,
       r.revenue,
       ROUND(100.0 * r.revenue / NULLIF(SUM(r.revenue) OVER (), 0), 6) AS share_percent
FROM category_sales AS r
LEFT JOIN core.categories AS c ON c.category_name = r.category_name
ORDER BY r.revenue DESC, r.category_name NULLS LAST;
