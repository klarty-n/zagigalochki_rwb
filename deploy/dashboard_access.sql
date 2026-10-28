\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='dashboard_reader') THEN
  CREATE ROLE dashboard_reader NOLOGIN;
 END IF;
END $$;
GRANT CONNECT ON DATABASE marketplace TO dashboard_reader;
GRANT USAGE ON SCHEMA mart TO dashboard_reader;
-- Expose aggregates only. Person IDs and raw order details stay private.
GRANT SELECT ON mart.monthly_sales,mart.seller_monthly_sales,
 mart.category_monthly_sales,mart.repeat_customers,mart.sales_kpis TO dashboard_reader;
COMMIT;
