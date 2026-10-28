-- Вопрос 5.
WITH category_sales AS (
    SELECT snap.category_name,
           SUM(i.price) AS revenue
    FROM core.order_items AS i
    INNER JOIN core.orders AS o ON o.order_id = i.order_id
    INNER JOIN core.order_item_category_snapshot AS snap
      ON snap.order_id = i.order_id AND snap.order_item_id = i.order_item_id
    WHERE o.order_status = 'delivered'
    GROUP BY snap.category_name
)
SELECT COALESCE(c.category_name_english, r.category_name, 'Не указана') AS category,
       r.revenue,
       ROUND(100.0 * r.revenue / NULLIF(SUM(r.revenue) OVER (), 0), 6) AS share_percent
FROM category_sales AS r
LEFT JOIN core.categories AS c ON c.category_name = r.category_name
ORDER BY r.revenue DESC, r.category_name NULLS LAST;
