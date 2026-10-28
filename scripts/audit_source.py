"""Extended observation audit. Records findings, applies no cleaning/rejection rules."""

import argparse
import json
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from profile_source import ROOT, profile_table, quote, source_mapping


def audit(data_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    report = {"created_at_utc": datetime.now(timezone.utc).isoformat(),
              "scope": "All records in eight CSV files; observations are not rejection decisions",
              "cases": [], "baseline": {}, "distributions": {}}
    with tempfile.TemporaryDirectory(prefix="marketplace-audit-") as directory:
        with closing(sqlite3.connect(str(Path(directory) / "audit.sqlite"))) as conn:
            conn.execute("PRAGMA cache_size = -16384")
            conn.execute("PRAGMA temp_store = FILE")
            conn.create_function("cents", 1, lambda value: int(Decimal(value) * 100) if value else None)
            conn.create_function("isblank", 1, lambda value: int(not value.strip()))
            conn.create_function("edge_spaces", 1, lambda value: int(value != value.strip()))
            mapping = source_mapping()
            for filename, raw_name, columns in mapping:
                table = raw_name.split(".")[1]
                report["baseline"][table] = profile_table(conn, data_dir / filename, table, columns, 5000)
                for column in columns:
                    if column.endswith("_id") or column == "product_category_name":
                        conn.execute(f"CREATE INDEX {quote('ix_' + table + '_' + column)} ON {quote(table)} ({quote(column)})")
            with (output_dir / "audit_observations.jsonl").open("w", encoding="utf-8") as observations:
                def case(code, description, sql, kind="needs_decision"):
                    cur = conn.execute(sql)
                    names = [c[0] for c in cur.description]
                    count, examples = 0, []
                    for row in cur:
                        record = dict(zip(names, row))
                        count += 1
                        if len(examples) < 3:
                            examples.append(record)
                        observations.write(json.dumps({"case": code, "evidence": record}, ensure_ascii=False) + "\n")
                    report["cases"].append({"code": code, "description": description,
                                            "kind": kind, "count": count, "examples": examples})

                # Missing fields are observations: optionality is a business decision.
                for _, raw_name, columns in mapping:
                    table = raw_name.split(".")[1]
                    keys = [c for c in columns if c.endswith("_id")]
                    key_select = ", ".join(map(quote, keys)) or "rowid AS source_record"
                    for column in columns:
                        if report["baseline"][table]["blank_by_column"][column]:
                            case(f"blank.{table}.{column}", f"Blank {table}.{column}",
                                 f"SELECT rowid AS source_record, {key_select}, {quote(column)} AS value "
                                 f"FROM {quote(table)} WHERE isblank({quote(column)})")

                for field in ("order_approved_at", "order_delivered_carrier_date", "order_delivered_customer_date"):
                    case(f"delivered_missing.{field}", f"Delivered order without {field}",
                         f"SELECT order_id, order_status, order_purchase_timestamp, {field} FROM orders "
                         f"WHERE order_status = 'delivered' AND TRIM({field}) = ''")
                for earlier, later in [
                    ("order_purchase_timestamp", "order_approved_at"),
                    ("order_purchase_timestamp", "order_delivered_carrier_date"),
                    ("order_purchase_timestamp", "order_delivered_customer_date"),
                    ("order_approved_at", "order_delivered_carrier_date"),
                    ("order_approved_at", "order_delivered_customer_date"),
                    ("order_delivered_carrier_date", "order_delivered_customer_date"),
                    ("order_purchase_timestamp", "order_estimated_delivery_date"),
                ]:
                    case(f"chronology.{later}_before_{earlier}", f"{later} precedes {earlier}",
                         f"SELECT order_id, order_status, {earlier}, {later} FROM orders "
                         f"WHERE {earlier} != '' AND {later} != '' AND {later} < {earlier}")
                case("status.delivery_present_not_delivered", "Delivery date exists on another status",
                     "SELECT order_id, order_status, order_delivered_customer_date FROM orders "
                     "WHERE order_status != 'delivered' AND order_delivered_customer_date != ''")
                case("delivery.late", "Delivered on a later calendar date than estimated (service metric)",
                     "SELECT order_id, order_status, order_estimated_delivery_date, order_delivered_customer_date "
                     "FROM orders WHERE order_delivered_customer_date != '' "
                     "AND substr(order_delivered_customer_date,1,10) > substr(order_estimated_delivery_date,1,10)",
                     "business_observation")
                case("status.unknown", "Status outside the source description",
                     "SELECT order_id, order_status FROM orders WHERE order_status NOT IN "
                     "('delivered','shipped','canceled','unavailable','invoiced','processing','created','approved')")

                for child in ("order_items", "order_payments", "order_reviews"):
                    case(f"coverage.without_{child}", f"Order without {child}",
                         f"SELECT o.order_id, o.order_status FROM orders o WHERE NOT EXISTS "
                         f"(SELECT 1 FROM {child} c WHERE c.order_id = o.order_id)")
                case("reviews.repeated_review_id", "All records whose review_id occurs more than once",
                     "SELECT review_id, order_id, review_score FROM order_reviews WHERE review_id IN "
                     "(SELECT review_id FROM order_reviews GROUP BY review_id HAVING COUNT(*) > 1)")
                case("reviews.multiple_per_order", "Orders with several review records",
                     "SELECT order_id, COUNT(*) AS review_count, COUNT(DISTINCT review_score) AS different_scores "
                     "FROM order_reviews GROUP BY order_id HAVING COUNT(*) > 1")
                case("reviews.creation_calendar_before_purchase", "Review creation day before purchase day",
                     "SELECT r.review_id, r.order_id, o.order_purchase_timestamp, r.review_creation_date "
                     "FROM order_reviews r JOIN orders o USING(order_id) "
                     "WHERE substr(r.review_creation_date,1,10) < substr(o.order_purchase_timestamp,1,10)")
                case("reviews.answer_before_creation", "Review answer before review creation",
                     "SELECT review_id, order_id, review_creation_date, review_answer_timestamp FROM order_reviews "
                     "WHERE review_answer_timestamp != '' AND review_creation_date != '' "
                     "AND review_answer_timestamp < review_creation_date")
                case("reviews.creation_before_delivery_day", "Review creation before delivery calendar day",
                     "SELECT r.review_id, r.order_id, r.review_creation_date, o.order_delivered_customer_date "
                     "FROM order_reviews r JOIN orders o USING(order_id) "
                     "WHERE o.order_delivered_customer_date != '' "
                     "AND substr(r.review_creation_date,1,10) < substr(o.order_delivered_customer_date,1,10)")

                for table, columns in [("order_items", ["price", "freight_value"]),
                                       ("order_payments", ["payment_value"])]:
                    for column in columns:
                        case(f"zero.{table}.{column}", f"Zero {column}",
                             f"SELECT * FROM {table} WHERE cents({column}) = 0")
                case("payments.zero_installments", "Zero payment_installments",
                     "SELECT * FROM order_payments WHERE CAST(payment_installments AS INTEGER) = 0")
                case("payments.undefined_type", "Payment type not_defined",
                     "SELECT * FROM order_payments WHERE payment_type = 'not_defined'")
                case("items.sequence_gaps", "Item sequence does not start at 1 or has gaps",
                     "SELECT order_id, MIN(CAST(order_item_id AS INTEGER)) AS minimum, "
                     "MAX(CAST(order_item_id AS INTEGER)) AS maximum, COUNT(*) AS rows "
                     "FROM order_items GROUP BY order_id HAVING minimum != 1 OR maximum != rows")
                case("items.shipping_deadline_before_purchase", "Shipping deadline before purchase",
                     "SELECT i.order_id, i.order_item_id, i.shipping_limit_date, o.order_purchase_timestamp, o.order_status "
                     "FROM order_items i JOIN orders o USING(order_id) WHERE i.shipping_limit_date < o.order_purchase_timestamp")
                case("items.shipping_deadline_before_approval", "Shipping deadline before payment approval",
                     "SELECT i.order_id, i.order_item_id, i.shipping_limit_date, o.order_approved_at, o.order_status "
                     "FROM order_items i JOIN orders o USING(order_id) WHERE o.order_approved_at != '' "
                     "AND i.shipping_limit_date < o.order_approved_at")

                conn.execute("CREATE TABLE item_totals AS SELECT order_id, SUM(cents(price)) AS goods_cents, "
                             "SUM(cents(freight_value)) AS freight_cents FROM order_items GROUP BY order_id")
                conn.execute("CREATE TABLE payment_totals AS SELECT order_id, SUM(cents(payment_value)) AS paid_cents "
                             "FROM order_payments GROUP BY order_id")
                conn.execute("CREATE UNIQUE INDEX item_total_key ON item_totals(order_id)")
                conn.execute("CREATE UNIQUE INDEX payment_total_key ON payment_totals(order_id)")
                base = ("SELECT o.order_id, o.order_status, i.goods_cents, i.freight_cents, p.paid_cents, "
                        "p.paid_cents - i.goods_cents - i.freight_cents AS difference_cents "
                        "FROM orders o JOIN item_totals i USING(order_id) JOIN payment_totals p USING(order_id) ")
                case("money.difference_one_cent", "Payment and item-plus-freight totals differ by one cent",
                     base + "WHERE ABS(p.paid_cents-i.goods_cents-i.freight_cents) = 1")
                case("money.difference_above_one_cent", "Payment and item-plus-freight totals differ by more than one cent",
                     base + "WHERE ABS(p.paid_cents-i.goods_cents-i.freight_cents) > 1")

                case("categories.no_translation", "Nonempty category absent from translation dictionary",
                     "SELECT p.product_id, p.product_category_name FROM products p "
                     "WHERE p.product_category_name != '' AND NOT EXISTS "
                     "(SELECT 1 FROM product_category_translation t WHERE t.product_category_name=p.product_category_name)")
                for column in ("product_weight_g", "product_length_cm", "product_height_cm", "product_width_cm", "product_photos_qty"):
                    case(f"products.zero.{column}", f"Zero {column}",
                         f"SELECT product_id, {column} FROM products WHERE {column} != '' AND CAST({column} AS INTEGER) = 0")
                for table, prefix in [("customers", "customer"), ("sellers", "seller")]:
                    column = prefix + "_zip_code_prefix"
                    case(f"address.short_prefix.{table}", "Numeric postal prefix shorter than five digits",
                         f"SELECT {prefix}_id, {column} FROM {table} WHERE LENGTH({column}) < 5")
                    case(f"address.prefix_invalid.{table}", "Postal prefix is nonnumeric or longer than five digits",
                         f"SELECT {prefix}_id, {column} FROM {table} WHERE {column} = '' "
                         f"OR {column} GLOB '*[^0-9]*' OR LENGTH({column}) > 5")
                    case(f"address.city_surrounding_spaces.{table}", "City has surrounding spaces",
                         f"SELECT {prefix}_id, {prefix}_city FROM {table} WHERE {prefix}_city != TRIM({prefix}_city)")
                    case(f"address.city_has_digits.{table}", "City name contains digits; requires source verification",
                         f"SELECT {prefix}_id, {prefix}_city, {prefix}_state FROM {table} WHERE {prefix}_city GLOB '*[0-9]*'")
                    case(f"address.state_format.{table}", "State does not contain exactly two uppercase Latin letters",
                         f"SELECT {prefix}_id, {prefix}_state FROM {table} "
                         f"WHERE LENGTH({prefix}_state) != 2 OR {prefix}_state GLOB '*[^A-Z]*'")
                    case(f"address.city_multiple_states.{table}", "City name appears in several states; not necessarily an error",
                         f"SELECT {prefix}_city, COUNT(DISTINCT {prefix}_state) AS state_count FROM {table} "
                         f"GROUP BY {prefix}_city HAVING state_count > 1", "business_observation")
                for _, raw_name, columns in mapping:
                    table = raw_name.split(".")[1]
                    for column in columns:
                        if column.endswith("_id") and column not in {"order_item_id"}:
                            case(f"id.format.{table}.{column}", "Identifier is not 32 lowercase hexadecimal characters",
                                 f"SELECT rowid AS source_record, {quote(column)} FROM {table} "
                                 f"WHERE LENGTH({quote(column)}) != 32 OR {quote(column)} GLOB '*[^0-9a-f]*'")
                for column in ("review_comment_title", "review_comment_message"):
                    case(f"reviews.whitespace.{column}", "Whitespace at edges of free-text review",
                         f"SELECT review_id, order_id, {column} AS value FROM order_reviews "
                         f"WHERE NOT isblank({column}) AND edge_spaces({column})")
                    case(f"reviews.whitespace_only.{column}", "Review field contains whitespace only",
                         f"SELECT review_id, order_id, {column} AS value FROM order_reviews "
                         f"WHERE {column} != '' AND isblank({column})")

                def distribution(name, sql):
                    cursor = conn.execute(sql)
                    columns = [c[0] for c in cursor.description]
                    report["distributions"][name] = [dict(zip(columns, r)) for r in cursor]
                distribution("statuses_missing_dates", "SELECT order_status, COUNT(*) AS rows, "
                             "SUM(order_approved_at='') AS missing_approval, "
                             "SUM(order_delivered_carrier_date='') AS missing_carrier, "
                             "SUM(order_delivered_customer_date='') AS missing_delivery FROM orders GROUP BY order_status")
                distribution("payment_types", "SELECT payment_type, COUNT(*) AS rows FROM order_payments GROUP BY payment_type")
                distribution("installments", "SELECT payment_installments, COUNT(*) AS rows FROM order_payments "
                             "GROUP BY payment_installments ORDER BY CAST(payment_installments AS INTEGER)")
                distribution("largest_order_differences", base + "ORDER BY ABS(difference_cents) DESC LIMIT 10")
                distribution("money_ranges", "SELECT 'price' AS field, MIN(cents(price)) AS min_cents, "
                             "MAX(cents(price)) AS max_cents FROM order_items UNION ALL "
                             "SELECT 'freight_value', MIN(cents(freight_value)), MAX(cents(freight_value)) FROM order_items "
                             "UNION ALL SELECT 'payment_value', MIN(cents(payment_value)), MAX(cents(payment_value)) FROM order_payments")
    report["total_source_rows"] = sum(t["rows"] for t in report["baseline"].values())
    report["nonempty_cases"] = sum(c["count"] > 0 for c in report["cases"])
    report["note"] = "Counts have different units (records or groups) and overlap. Do not sum them as rejected rows."
    (output_dir / "audit_summary.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Audited {report['total_source_rows']:,} records; {len(report['cases'])} checks; {report['nonempty_cases']} nonempty cases")
    for case in report["cases"]:
        if case["count"]:
            print(case["code"], case["count"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "reports")
    args = parser.parse_args()
    if args.output_dir.resolve().is_relative_to(args.data_dir.resolve()):
        parser.error("Output must be outside the source data directory")
    audit(args.data_dir, args.output_dir)
