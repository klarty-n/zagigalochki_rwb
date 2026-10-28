-- Q6. One product across all sellers; actual prices of delivered units.
-- Ties in distinct price counts are resolved deterministically by product_id.
WITH sales AS (
    SELECT i.product_id, o.order_purchase_at::date AS sale_date, i.price
    FROM core.order_items i
    JOIN core.orders o USING (order_id)
    WHERE o.order_status = 'delivered'
), chosen AS (
    SELECT product_id
    FROM sales
    GROUP BY product_id
    ORDER BY COUNT(DISTINCT price) DESC, product_id
    LIMIT 1
)
SELECT s.sale_date, s.price, COUNT(*) AS units
FROM sales s JOIN chosen c USING (product_id)
GROUP BY s.sale_date, s.price
ORDER BY s.sale_date, s.price;

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
    JOIN core.customers c USING (customer_id)
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

-- Q9a. Payment-record grain; period uses order purchase date, not payment date.
-- No status filter: even canceled orders can have payment records.
SELECT COALESCE(c.state,'Не указан') AS state,
       COUNT(*) AS payments,
       SUM(p.payment_value) AS payment_value,
       ROUND(AVG(p.payment_installments), 2) AS average_installments
FROM core.order_payments p
JOIN core.orders o USING (order_id)
JOIN core.customers c USING (customer_id)
WHERE o.order_purchase_at >= timestamp '2018-01-01'
  AND o.order_purchase_at < timestamp '2019-01-01'
GROUP BY c.state
ORDER BY payment_value DESC, state;

-- Q9b. All payment records over the entire dataset; no 2018/state filter.
SELECT p.payment_type,
       COUNT(*) AS payments,
       ROUND(AVG(p.payment_installments), 2) AS average_installments
FROM core.order_payments p
GROUP BY p.payment_type
ORDER BY payments DESC, p.payment_type;

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
