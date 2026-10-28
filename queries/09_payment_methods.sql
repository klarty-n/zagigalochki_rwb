-- Q9b. All payment records over the entire dataset; no 2018/state filter.
SELECT p.payment_type,
       COUNT(*) AS payments,
       ROUND(AVG(p.payment_installments), 2) AS average_installments
FROM core.order_payments p
GROUP BY p.payment_type
ORDER BY payments DESC, p.payment_type;
