-- Q8. Status distribution in a snapshot, not transitions between statuses.
SELECT o.order_status AS status,
       COUNT(*) AS orders,
       ROUND(100.0*COUNT(*)/NULLIF(SUM(COUNT(*)) OVER (),0), 6) AS share_percent,
       COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM core.order_items i WHERE i.order_id=o.order_id
       )) AS orders_without_items
FROM core.orders o
GROUP BY o.order_status
ORDER BY orders DESC, status;
