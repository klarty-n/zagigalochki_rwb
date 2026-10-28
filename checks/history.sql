\set ON_ERROR_STOP on
-- This scenario changes only the current transaction; ROLLBACK restores the DB.
BEGIN;
DO $$
DECLARE
    old_item record;
    new_category text;
    changed_at timestamp;
    old_snapshot text;
    old_state text;
    result_category text;
    result_state text;
BEGIN
    SELECT i.order_id,i.order_item_id,i.seller_id,i.product_id,
           snap.category_name,o.order_purchase_at
    INTO old_item
    FROM core.order_items i JOIN core.orders o USING(order_id)
    JOIN core.order_item_category_snapshot snap USING(order_id,order_item_id)
    ORDER BY o.order_purchase_at, i.order_id,i.order_item_id LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'No source item for history test'; END IF;
    old_snapshot := old_item.category_name;
    SELECT state INTO old_state FROM core.order_address_snapshot WHERE order_id=old_item.order_id;
    SELECT category_name INTO new_category FROM core.categories
    WHERE category_name IS DISTINCT FROM old_snapshot ORDER BY category_name LIMIT 1;
    SELECT greatest(max(o.order_purchase_at),current_timestamp::timestamp) + interval '1 day'
    INTO changed_at FROM core.orders o;

    PERFORM core.record_seller_product_category_change(
      old_item.seller_id,old_item.product_id,new_category,changed_at);
    INSERT INTO core.customers(customer_id,customer_unique_id,zip_code_prefix,city,state)
    VALUES ('__history_test_customer__','__history_test_person__','10000','Old city','SP');
    INSERT INTO core.orders(order_id,customer_id,order_status,order_purchase_at)
    VALUES ('__history_test_order__','__history_test_customer__','delivered',changed_at+interval '1 second');
    INSERT INTO core.order_items(order_id,order_item_id,product_id,seller_id,shipping_limit_at,price,freight_value)
    VALUES ('__history_test_order__',1,old_item.product_id,old_item.seller_id,
            changed_at+interval '1 day',10.00,1.00);
    UPDATE core.customers SET city='New city',state='RJ'
    WHERE customer_id='__history_test_customer__';
    UPDATE core.products SET category_name=new_category WHERE product_id=old_item.product_id;

    SELECT category_name INTO result_category FROM core.order_item_category_snapshot
    WHERE order_id=old_item.order_id AND order_item_id=old_item.order_item_id;
    IF result_category IS DISTINCT FROM old_snapshot THEN
      RAISE EXCEPTION 'Old sale category changed'; END IF;
    SELECT category_name INTO result_category FROM core.order_item_category_snapshot
    WHERE order_id='__history_test_order__' AND order_item_id=1;
    IF result_category IS DISTINCT FROM new_category THEN
      RAISE EXCEPTION 'New sale did not use new category'; END IF;
    SELECT state INTO result_state FROM core.order_address_snapshot
    WHERE order_id=old_item.order_id;
    IF result_state IS DISTINCT FROM old_state THEN
      RAISE EXCEPTION 'Old address changed'; END IF;
    SELECT state INTO result_state FROM core.order_address_snapshot
    WHERE order_id='__history_test_order__';
    IF result_state <> 'SP' THEN RAISE EXCEPTION 'New order address changed after move'; END IF;
    RAISE NOTICE 'History scenario passed: old sale/address fixed, new sale uses new category';
END $$;
ROLLBACK;
