"""Read-only CSV profiling before raw -> core loading (Python standard library).

Source files and the PostgreSQL database are never modified. SQLite stores
cross-row checks on disk; CSV records are inserted in bounded-size batches.
"""

from __future__ import annotations

import argparse
import ast
import csv
import hashlib
import json
import re
import sqlite3
import tempfile
from collections import Counter
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
KEYS = {
    "orders": [("order_id",)],
    "order_items": [("order_id", "order_item_id")],
    "order_payments": [("order_id", "payment_sequential")],
    "order_reviews": [("review_id",), ("review_id", "order_id")],
    "products": [("product_id",)],
    "sellers": [("seller_id",)],
    "customers": [("customer_id",)],
    "product_category_translation": [("product_category_name",)],
}
RELATIONS = [
    ("orders", "customer_id", "customers", "customer_id"),
    ("order_items", "order_id", "orders", "order_id"),
    ("order_items", "product_id", "products", "product_id"),
    ("order_items", "seller_id", "sellers", "seller_id"),
    ("order_payments", "order_id", "orders", "order_id"),
    ("order_reviews", "order_id", "orders", "order_id"),
    ("products", "product_category_name", "product_category_translation", "product_category_name"),
]
MONEY = {"price", "freight_value", "payment_value"}
INTEGER = {
    "order_item_id", "payment_sequential", "payment_installments", "review_score",
    "product_name_lenght", "product_description_lenght", "product_photos_qty",
    "product_weight_g", "product_length_cm", "product_height_cm", "product_width_cm",
}


def quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def source_mapping() -> list:
    """Read the existing CSV contract without importing/running load_raw.py."""
    tree = ast.parse((ROOT / "scripts/load_raw.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "MAPPING" for target in node.targets
        ):
            return ast.literal_eval(node.value)
    raise ValueError("MAPPING not found in scripts/load_raw.py")


def value_errors(column: str, value: str) -> list[str]:
    """Blank values are profiled separately; missing is not automatically invalid."""
    if not value.strip():
        return []
    errors = []
    if value != value.strip():
        errors.append("surrounding_whitespace")
    value = value.strip()
    if column in MONEY:
        try:
            number = Decimal(value)
        except InvalidOperation:
            return errors + ["invalid_money"]
        if not number.is_finite():
            return errors + ["non_finite_money"]
        if not re.fullmatch(r"[+-]?\d+(\.\d+)?", value):
            errors.append("noncanonical_money_format")
        if number < 0:
            errors.append("negative_money")
        if number.as_tuple().exponent < -2:
            errors.append("more_than_two_decimal_places")
    elif column in INTEGER:
        if not re.fullmatch(r"[+-]?\d+", value):
            return errors + ["invalid_integer"]
        number = int(value)
        if column in {"order_item_id", "payment_sequential"} and number < 1:
            errors.append("nonpositive_sequence")
        elif column == "review_score" and not 1 <= number <= 5:
            errors.append("score_out_of_range")
        elif number < 0:
            errors.append("negative_integer")
    elif column.endswith(("_date", "_timestamp", "_at")):
        try:
            datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            errors.append("invalid_timestamp")
    return errors


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def profile_table(conn, path: Path, table: str, columns: list[str], batch_size: int) -> dict:
    before = path.stat()
    checksum = fingerprint(path)
    names = ", ".join(map(quote, columns))
    conn.execute(f"CREATE TABLE {quote(table)} ({', '.join(quote(c) + ' TEXT' for c in columns)})")
    insert = f"INSERT INTO {quote(table)} VALUES ({', '.join('?' for _ in columns)})"
    blanks, issues = Counter(), Counter()
    examples, batch, total = {}, [], 0
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream, strict=True)
        if next(reader, None) != columns:
            raise ValueError(f"{path.name}: header does not match load_raw.py")
        for record_number, row in enumerate(reader, 1):
            if len(row) != len(columns):
                raise ValueError(f"{path.name}: record {record_number}: wrong column count")
            total += 1
            for column, value in zip(columns, row):
                if not value.strip():
                    blanks[column] += 1
                for reason in value_errors(column, value):
                    issue = f"{column}:{reason}"
                    issues[issue] += 1
                    samples = examples.setdefault(issue, [])
                    if len(samples) < 3:
                        samples.append({"record_number": record_number, "value": value[:100]})
            batch.append(row)
            if len(batch) >= batch_size:
                conn.executemany(insert, batch)
                batch.clear()
        if batch:
            conn.executemany(insert, batch)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f"{path.name}: source changed during profiling; rerun")
    conn.commit()
    exact_extra = conn.execute(
        f"SELECT COALESCE(SUM(n - 1), 0) FROM "
        f"(SELECT COUNT(*) AS n FROM {quote(table)} GROUP BY {names} HAVING COUNT(*) > 1)"
    ).fetchone()[0]
    result = {
        "file": path.name, "sha256": checksum, "bytes": after.st_size, "rows": total,
        "blank_by_column": {c: blanks[c] for c in columns},
        "value_issues": dict(sorted(issues.items())), "issue_examples": examples,
        "exact_duplicate_extra_rows": exact_extra, "candidate_keys": [],
    }
    for key in KEYS[table]:
        key_names = ", ".join(map(quote, key))
        present = " AND ".join(f"TRIM({quote(c)}) != ''" for c in key)
        missing = conn.execute(f"SELECT COUNT(*) FROM {quote(table)} WHERE NOT ({present})").fetchone()[0]
        groups, extras = conn.execute(
            f"SELECT COUNT(*), COALESCE(SUM(n - 1), 0) FROM "
            f"(SELECT COUNT(*) AS n FROM {quote(table)} WHERE {present} "
            f"GROUP BY {key_names} HAVING COUNT(*) > 1)"
        ).fetchone()
        samples = conn.execute(
            f"SELECT {key_names}, COUNT(*) FROM {quote(table)} WHERE {present} "
            f"GROUP BY {key_names} HAVING COUNT(*) > 1 ORDER BY {key_names} LIMIT 3"
        ).fetchall()
        result["candidate_keys"].append({
            "columns": list(key), "missing_rows": missing, "duplicate_groups": groups,
            "duplicate_extra_rows": extras, "duplicate_examples": samples,
        })
    return result


def profile(data_dir: Path, batch_size: int = 5000) -> dict:
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    mapping = source_mapping()
    missing = [filename for filename, _, _ in mapping if not (data_dir / filename).is_file()]
    if missing:
        raise ValueError("Missing CSV files: " + ", ".join(missing))
    report = {"report_version": 1, "created_at_utc": datetime.now(timezone.utc).isoformat(),
              "source_mode": "full_snapshot_csv", "tables": {}, "relationships": []}
    with tempfile.TemporaryDirectory(prefix="marketplace-profile-") as temp:
        with closing(sqlite3.connect(str(Path(temp) / "profile.sqlite"))) as conn:
            conn.execute("PRAGMA cache_size = -16384")
            conn.execute("PRAGMA temp_store = FILE")
            for filename, raw_table, columns in mapping:
                table = raw_table.split(".")[1]
                report["tables"][table] = profile_table(conn, data_dir / filename, table, columns, batch_size)
            for parent, column in sorted({(r[2], r[3]) for r in RELATIONS}):
                conn.execute(f"CREATE INDEX {quote('idx_' + parent + '_' + column)} ON {quote(parent)} ({quote(column)})")
            for child, column, parent, parent_column in RELATIONS:
                blank = f"TRIM(c.{quote(column)}) = ''"
                unmatched = (f"NOT ({blank}) AND NOT EXISTS (SELECT 1 FROM {quote(parent)} p "
                             f"WHERE p.{quote(parent_column)} = c.{quote(column)})")
                base = f"FROM {quote(child)} c"
                count = lambda condition: conn.execute(f"SELECT COUNT(*) {base} WHERE {condition}").fetchone()[0]
                report["relationships"].append({
                    "child": f"{child}.{column}", "parent": f"{parent}.{parent_column}",
                    "blank_rows": count(blank), "unmatched_nonblank_rows": count(unmatched),
                    "unmatched_examples": [r[0] for r in conn.execute(
                        f"SELECT DISTINCT c.{quote(column)} {base} WHERE {unmatched} "
                        f"ORDER BY c.{quote(column)} LIMIT 3")],
                })
            report["order_statuses"] = dict(conn.execute(
                "SELECT order_status, COUNT(*) FROM orders GROUP BY order_status ORDER BY order_status"))
            report["distinct_customer_unique_ids"] = conn.execute(
                "SELECT COUNT(DISTINCT customer_unique_id) FROM customers WHERE TRIM(customer_unique_id) != ''"
            ).fetchone()[0]
            report["orders_with_multiple_sellers"] = conn.execute(
                "SELECT COUNT(*) FROM (SELECT order_id FROM order_items GROUP BY order_id HAVING COUNT(DISTINCT seller_id) > 1)"
            ).fetchone()[0]
            report["order_coverage"] = {}
            for child in ("order_items", "order_payments", "order_reviews"):
                conn.execute(f"CREATE INDEX {quote('coverage_' + child)} ON {quote(child)} (order_id)")
                report["order_coverage"][f"without_{child}"] = conn.execute(
                    f"SELECT COUNT(*) FROM orders o WHERE NOT EXISTS "
                    f"(SELECT 1 FROM {quote(child)} c WHERE c.order_id = o.order_id)"
                ).fetchone()[0]
            report["missing_order_dates_by_status"] = [
                {"status": row[0], "rows": row[1], "missing_approved": row[2],
                 "missing_carrier": row[3], "missing_delivery": row[4]}
                for row in conn.execute(
                    "SELECT order_status, COUNT(*), SUM(TRIM(order_approved_at) = ''), "
                    "SUM(TRIM(order_delivered_carrier_date) = ''), "
                    "SUM(TRIM(order_delivered_customer_date) = '') "
                    "FROM orders GROUP BY order_status ORDER BY order_status"
                )
            ]
    report["total_rows"] = sum(t["rows"] for t in report["tables"].values())
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "data")
    parser.add_argument("--output", type=Path, default=ROOT / "reports/raw_profile.json")
    parser.add_argument("--batch-size", type=int, default=5000)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(args.data_dir.resolve()):
        parser.error("Output must be outside the source data directory")
    try:
        report = profile(args.data_dir, args.batch_size)
    except (ValueError, OSError, csv.Error, sqlite3.Error) as exc:
        parser.exit(1, f"Profiling failed: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Profiled {len(report['tables'])} files, {report['total_rows']:,} records")
    print(args.output)


if __name__ == "__main__":
    main()
