-- Stored category totals used by the dashboard. Run after 03_mart.sql.
CREATE SCHEMA IF NOT EXISTS mart;
CREATE MATERIALIZED VIEW IF NOT EXISTS mart.category_sales_cached AS
SELECT month, buyer_state, category_code, category,
       COUNT(*)::bigint AS units, SUM(price)::numeric(18,2) AS revenue
FROM mart.delivered_items
GROUP BY month, buyer_state, category_code, category
WITH NO DATA;

CREATE INDEX IF NOT EXISTS category_sales_cached_scope_idx
    ON mart.category_sales_cached (month, buyer_state, category_code);

CREATE TABLE IF NOT EXISTS mart.refresh_state (
    name text PRIMARY KEY,
    last_attempt_at timestamptz,
    last_success_at timestamptz,
    last_error text
);
INSERT INTO mart.refresh_state(name) VALUES ('category_sales_cached')
ON CONFLICT (name) DO NOTHING;
