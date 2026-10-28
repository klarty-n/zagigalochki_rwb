-- Q7. Order-level cohort: delivered, at least 500 orders per buyer state.
-- Missing or negative delivery intervals are unknown, never zero.
WITH deliveries AS (
    SELECT c.state,
           CASE WHEN o.delivered_customer_at >= o.order_purchase_at
                THEN EXTRACT(EPOCH FROM (o.delivered_customer_at-o.order_purchase_at))/86400.0
           END AS delivery_days,
           CASE WHEN o.delivered_customer_at >= o.order_purchase_at
                     AND o.estimated_delivery_date IS NOT NULL
                THEN o.delivered_customer_at::date > o.estimated_delivery_date
           END AS is_late
    FROM core.orders o
    LEFT JOIN core.order_address_snapshot c USING (order_id)
    WHERE o.order_status = 'delivered'
)
SELECT COALESCE(state, 'Не указан') AS state,
       COUNT(*) AS orders,
       ROUND(AVG(delivery_days), 2) AS average_delivery_days,
       ROUND(100.0*COUNT(*) FILTER (WHERE is_late)
             /NULLIF(COUNT(is_late),0), 2) AS late_percent
FROM deliveries
GROUP BY state
HAVING COUNT(*) >= 500
ORDER BY average_delivery_days DESC NULLS LAST, state;
