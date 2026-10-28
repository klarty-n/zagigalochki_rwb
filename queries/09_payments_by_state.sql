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
