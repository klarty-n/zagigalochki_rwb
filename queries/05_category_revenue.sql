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
