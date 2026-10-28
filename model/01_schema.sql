-- Executable DDL for docs/core_model.md (feature/core-model, 4bc3b28).
-- No DROP/TRUNCATE and no changes to raw. Existing incompatible schemas fail at load time.
CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.customers (
    customer_id text PRIMARY KEY,
    customer_unique_id text NOT NULL,
    zip_code_prefix text,
    city text,
    state text
);
CREATE INDEX IF NOT EXISTS customers_unique_person_idx ON core.customers(customer_unique_id);
CREATE TABLE IF NOT EXISTS core.sellers (
    seller_id text PRIMARY KEY, zip_code_prefix text, city text, state text
);
CREATE TABLE IF NOT EXISTS core.categories (
    category_name text PRIMARY KEY, category_name_english text
);
CREATE TABLE IF NOT EXISTS core.products (
    product_id text PRIMARY KEY,
    category_name text REFERENCES core.categories(category_name),
    name_length integer, description_length integer, photos_qty integer,
    weight_g numeric(12,2), length_cm numeric(12,2),
    height_cm numeric(12,2), width_cm numeric(12,2)
);
CREATE INDEX IF NOT EXISTS products_category_idx ON core.products(category_name);
CREATE TABLE IF NOT EXISTS core.orders (
    order_id text PRIMARY KEY,
    customer_id text NOT NULL UNIQUE REFERENCES core.customers(customer_id),
    order_status text NOT NULL,
    order_purchase_at timestamp without time zone NOT NULL,
    order_approved_at timestamp without time zone,
    delivered_carrier_at timestamp without time zone,
    delivered_customer_at timestamp without time zone,
    estimated_delivery_date date
);
CREATE INDEX IF NOT EXISTS orders_purchase_idx ON core.orders(order_purchase_at);
CREATE INDEX IF NOT EXISTS orders_status_idx ON core.orders(order_status);
CREATE TABLE IF NOT EXISTS core.order_items (
    order_id text NOT NULL REFERENCES core.orders(order_id),
    order_item_id integer NOT NULL,
    product_id text NOT NULL REFERENCES core.products(product_id),
    seller_id text NOT NULL REFERENCES core.sellers(seller_id),
    shipping_limit_at timestamp without time zone NOT NULL,
    price numeric(12,2) NOT NULL, freight_value numeric(12,2) NOT NULL,
    PRIMARY KEY(order_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS items_product_idx ON core.order_items(product_id);
CREATE INDEX IF NOT EXISTS items_seller_idx ON core.order_items(seller_id);
CREATE TABLE IF NOT EXISTS core.order_payments (
    order_id text NOT NULL REFERENCES core.orders(order_id),
    payment_sequential integer NOT NULL, payment_type text NOT NULL,
    payment_installments integer NOT NULL, payment_value numeric(12,2) NOT NULL,
    PRIMARY KEY(order_id, payment_sequential)
);
CREATE TABLE IF NOT EXISTS core.order_reviews (
    review_id text NOT NULL,
    order_id text NOT NULL REFERENCES core.orders(order_id),
    review_score smallint NOT NULL, comment_title text, comment_message text,
    review_created_at timestamp without time zone NOT NULL,
    review_answered_at timestamp without time zone NOT NULL,
    PRIMARY KEY(review_id, order_id)
);
CREATE INDEX IF NOT EXISTS reviews_order_idx ON core.order_reviews(order_id);
