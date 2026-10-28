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
