-- Monthly report. Inclusive start, exclusive end; preserves empty months.
SELECT month,orders,revenue,ROUND(average_order_value,2) AS average_order_value
FROM mart.monthly_sales
WHERE month>=date '2016-09-01' AND month<date '2018-09-01'
ORDER BY month;

-- All-time top sellers. One order may count towards different sellers.
SELECT seller_id,seller_city,seller_state,SUM(orders) AS orders,
 SUM(units) AS units,SUM(revenue) AS revenue
FROM mart.seller_monthly_sales
GROUP BY seller_id,seller_city,seller_state
ORDER BY revenue DESC,seller_id LIMIT 10;

SELECT ROUND(average_order_value,2) AS average_order_value,
 ROUND(average_item_lines,6) AS average_item_lines,ROUND(average_units,6) AS average_units
FROM mart.sales_kpis;
SELECT customers,repeat_customers,ROUND(repeat_percent,2) AS repeat_percent
FROM mart.repeat_customers;

WITH sales AS (
 SELECT category_code,category,SUM(revenue) AS revenue
 FROM mart.category_monthly_sales GROUP BY category_code,category
)
SELECT category,revenue,ROUND(100.0*revenue/NULLIF(SUM(revenue) OVER(),0),6) AS share_percent
FROM sales ORDER BY revenue DESC,category_code NULLS LAST;
