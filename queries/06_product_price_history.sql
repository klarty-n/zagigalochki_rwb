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
