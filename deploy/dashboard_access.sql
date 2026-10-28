\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dashboard_reader') THEN
  CREATE ROLE dashboard_reader NOLOGIN;
 END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dashboard_api') THEN
  CREATE ROLE dashboard_api NOLOGIN;
 END IF;
END $$;
GRANT CONNECT ON DATABASE marketplace TO dashboard_reader;
GRANT USAGE ON SCHEMA mart TO dashboard_reader;
-- Expose aggregates only. Person IDs and raw order details stay private.
GRANT SELECT ON mart.monthly_sales,mart.seller_monthly_sales,
 mart.category_monthly_sales,mart.repeat_customers,mart.sales_kpis TO dashboard_reader;
-- Backend-only role: contains stable buyer IDs needed for filtered distinct counts.
GRANT dashboard_reader TO dashboard_api;
GRANT USAGE ON SCHEMA mart TO dashboard_api;
GRANT SELECT ON mart.order_metrics,mart.delivered_items TO dashboard_api;
COMMIT;
