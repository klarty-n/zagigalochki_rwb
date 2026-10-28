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
