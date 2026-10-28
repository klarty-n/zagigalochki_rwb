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
