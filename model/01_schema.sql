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

-- A buyer may move, but an order's destination is fixed when it is placed.
CREATE TABLE IF NOT EXISTS core.order_address_snapshot (
    order_id text PRIMARY KEY REFERENCES core.orders(order_id),
    zip_code_prefix text, city text, state text
);

-- Category belongs to a seller/product offer and can change over time.
-- The initial CSV gives only one observed category; baseline history is inferred.
CREATE TABLE IF NOT EXISTS core.seller_product_category_history (
    seller_id text NOT NULL REFERENCES core.sellers(seller_id),
    product_id text NOT NULL REFERENCES core.products(product_id),
    valid_from timestamp without time zone NOT NULL,
    valid_to timestamp without time zone,
    category_name text REFERENCES core.categories(category_name),
    baseline_inferred boolean NOT NULL DEFAULT false,
    PRIMARY KEY (seller_id, product_id, valid_from),
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_product_category_current_idx
    ON core.seller_product_category_history(seller_id, product_id) WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS core.order_item_category_snapshot (
    order_id text NOT NULL,
    order_item_id integer NOT NULL,
    category_name text REFERENCES core.categories(category_name),
    PRIMARY KEY (order_id, order_item_id),
    FOREIGN KEY (order_id, order_item_id) REFERENCES core.order_items(order_id, order_item_id)
);

-- Existing deployments: fill once. Later source changes never overwrite a sale.
INSERT INTO core.order_address_snapshot(order_id, zip_code_prefix, city, state)
SELECT o.order_id, c.zip_code_prefix, c.city, c.state
FROM core.orders o JOIN core.customers c USING(customer_id)
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO core.seller_product_category_history
    (seller_id, product_id, valid_from, category_name, baseline_inferred)
SELECT i.seller_id, i.product_id, min(o.order_purchase_at), p.category_name, true
FROM core.order_items i JOIN core.orders o USING(order_id)
JOIN core.products p USING(product_id)
WHERE NOT EXISTS (
    SELECT 1 FROM core.seller_product_category_history h
    WHERE h.seller_id=i.seller_id AND h.product_id=i.product_id)
GROUP BY i.seller_id, i.product_id, p.category_name
ON CONFLICT DO NOTHING;

INSERT INTO core.order_item_category_snapshot(order_id, order_item_id, category_name)
SELECT i.order_id, i.order_item_id, p.category_name
FROM core.order_items i JOIN core.products p USING(product_id)
ON CONFLICT (order_id, order_item_id) DO NOTHING;

-- Called for future category-change events; event time must be supplied by source.
CREATE OR REPLACE FUNCTION core.record_seller_product_category_change(
    p_seller_id text, p_product_id text, p_category_name text,
    p_effective_at timestamp without time zone
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE current_row core.seller_product_category_history%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id || ':' || p_product_id, 0));
    SELECT * INTO current_row FROM core.seller_product_category_history
    WHERE seller_id=p_seller_id AND product_id=p_product_id AND valid_to IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO core.seller_product_category_history
          (seller_id,product_id,valid_from,category_name)
        VALUES (p_seller_id,p_product_id,p_effective_at,p_category_name);
    ELSIF current_row.category_name IS DISTINCT FROM p_category_name THEN
        IF p_effective_at <= current_row.valid_from THEN
            RAISE EXCEPTION 'Category change time must follow current version';
        END IF;
        UPDATE core.seller_product_category_history SET valid_to=p_effective_at
        WHERE seller_id=p_seller_id AND product_id=p_product_id
          AND valid_from=current_row.valid_from;
        INSERT INTO core.seller_product_category_history
          (seller_id,product_id,valid_from,category_name)
        VALUES (p_seller_id,p_product_id,p_effective_at,p_category_name);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION core.capture_order_address() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO core.order_address_snapshot(order_id,zip_code_prefix,city,state)
    SELECT NEW.order_id, c.zip_code_prefix,c.city,c.state
    FROM core.customers c WHERE c.customer_id=NEW.customer_id
    ON CONFLICT (order_id) DO NOTHING;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capture_order_address ON core.orders;
CREATE TRIGGER capture_order_address AFTER INSERT ON core.orders
FOR EACH ROW EXECUTE FUNCTION core.capture_order_address();

CREATE OR REPLACE FUNCTION core.capture_order_item_category() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sale_at timestamp without time zone; chosen_category text; matched boolean;
BEGIN
    SELECT order_purchase_at INTO sale_at FROM core.orders WHERE order_id=NEW.order_id;
    SELECT h.category_name, true INTO chosen_category, matched
    FROM core.seller_product_category_history h
    WHERE h.seller_id=NEW.seller_id AND h.product_id=NEW.product_id
      AND h.valid_from<=sale_at AND (h.valid_to IS NULL OR sale_at<h.valid_to)
    ORDER BY h.valid_from DESC LIMIT 1;
    IF NOT coalesce(matched,false) THEN
        SELECT category_name INTO chosen_category FROM core.products WHERE product_id=NEW.product_id;
    END IF;
    INSERT INTO core.order_item_category_snapshot(order_id,order_item_id,category_name)
    VALUES (NEW.order_id,NEW.order_item_id,chosen_category)
    ON CONFLICT (order_id,order_item_id) DO NOTHING;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capture_order_item_category ON core.order_items;
CREATE TRIGGER capture_order_item_category AFTER INSERT ON core.order_items
FOR EACH ROW EXECUTE FUNCTION core.capture_order_item_category();
