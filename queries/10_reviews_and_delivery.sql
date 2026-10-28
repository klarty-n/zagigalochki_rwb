-- Q10. One latest review per delivered order prevents multiplying deliveries.
-- All five scores remain visible, including scores without orders.
WITH latest_review AS (
    SELECT DISTINCT ON (r.order_id) r.order_id, r.review_score
    FROM core.order_reviews r
    ORDER BY r.order_id, r.review_answered_at DESC,
             r.review_created_at DESC, r.review_id DESC
), reviewed_deliveries AS (
    SELECT r.review_score,
           CASE WHEN o.delivered_customer_at >= o.order_purchase_at
                THEN EXTRACT(EPOCH FROM (o.delivered_customer_at-o.order_purchase_at))/86400.0
           END AS delivery_days,
           CASE WHEN o.delivered_customer_at >= o.order_purchase_at
                     AND o.estimated_delivery_date IS NOT NULL
                THEN o.delivered_customer_at::date > o.estimated_delivery_date
           END AS is_late
    FROM core.orders o
    JOIN latest_review r USING (order_id)
    WHERE o.order_status='delivered'
), stats AS (
    SELECT review_score,COUNT(*) AS orders,AVG(delivery_days) AS average_delivery_days,
           100.0*COUNT(*) FILTER (WHERE is_late)/NULLIF(COUNT(is_late),0) AS late_percent
    FROM reviewed_deliveries GROUP BY review_score
)
SELECT scores.score,COALESCE(s.orders,0) AS orders,
       ROUND(s.average_delivery_days,2) AS average_delivery_days,
       ROUND(s.late_percent,2) AS late_percent
FROM generate_series(1,5) AS scores(score)
LEFT JOIN stats s ON s.review_score=scores.score
ORDER BY scores.score;
