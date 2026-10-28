"""Regression checks for the profiler; uses only synthetic temporary CSV files."""

import csv
import tempfile
import unittest
from pathlib import Path

from profile_source import fingerprint, profile, source_mapping, value_errors


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="profile-test-")
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        self.mapping = source_mapping()
        self.rows = {}
        common = {
            "order_id": "o1", "customer_id": "c1", "customer_unique_id": "person1",
            "product_id": "p1", "seller_id": "s1", "review_id": "r1",
            "order_item_id": "1", "payment_sequential": "1", "review_score": "5",
            "product_category_name": "cat", "product_category_name_english": "category",
        }
        for _, raw_table, columns in self.mapping:
            self.rows[raw_table] = [[common.get(c, "") for c in columns]]
        self.write_sources()

    def write_sources(self):
        for name, table, columns in self.mapping:
            with (self.data / name).open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.writer(stream)
                writer.writerow(columns)
                writer.writerows(self.rows[table])

    def test_valid_snapshot_and_batch_sizes_do_not_change_findings(self):
        hashes = {p.name: fingerprint(p) for p in self.data.glob("*.csv")}
        first = profile(self.data, batch_size=1)
        second = profile(self.data, batch_size=10)
        first.pop("created_at_utc")
        second.pop("created_at_utc")
        self.assertEqual(first, second)
        self.assertEqual(first["total_rows"], 8)
        self.assertTrue(all(r["unmatched_nonblank_rows"] == 0 for r in first["relationships"]))
        self.assertTrue(all(n == 0 for n in first["order_coverage"].values()))
        self.assertEqual(hashes, {p.name: fingerprint(p) for p in self.data.glob("*.csv")})

    def test_duplicate_review_id_does_not_imply_duplicate_composite_key(self):
        review = self.rows["raw.order_reviews"][0].copy()
        review[1] = "o2"
        self.rows["raw.order_reviews"].append(review)
        self.write_sources()
        keys = profile(self.data)["tables"]["order_reviews"]["candidate_keys"]
        self.assertEqual(keys[0]["duplicate_extra_rows"], 1)
        self.assertEqual(keys[1]["duplicate_extra_rows"], 0)

    def test_exact_duplicates_missing_keys_and_broken_references(self):
        original = self.rows["raw.order_items"][0].copy()
        self.rows["raw.order_items"].append(original.copy())
        invalid = original.copy()
        invalid[0], invalid[1], invalid[2] = "missing-order", "", "missing-product"
        self.rows["raw.order_items"].append(invalid)
        self.write_sources()
        report = profile(self.data)
        items = report["tables"]["order_items"]
        self.assertEqual(items["exact_duplicate_extra_rows"], 1)
        self.assertEqual(items["candidate_keys"][0]["missing_rows"], 1)
        self.assertEqual(items["candidate_keys"][0]["duplicate_extra_rows"], 1)
        relation = next(r for r in report["relationships"] if r["child"] == "order_items.order_id")
        self.assertEqual(relation["unmatched_nonblank_rows"], 1)

    def test_optional_blank_is_not_reported_as_broken_reference(self):
        self.rows["raw.products"][0][1] = ""
        self.write_sources()
        report = profile(self.data)
        relation = next(r for r in report["relationships"] if r["child"] == "products.product_category_name")
        self.assertEqual(relation["blank_rows"], 1)
        self.assertEqual(relation["unmatched_nonblank_rows"], 0)

    def test_invalid_values_and_valid_leap_day(self):
        self.assertIn("invalid_timestamp", value_errors("order_approved_at", "2023-02-29 12:00:00"))
        self.assertEqual(value_errors("order_approved_at", "2024-02-29 12:00:00"), [])
        self.assertIn("non_finite_money", value_errors("price", "NaN"))
        self.assertIn("more_than_two_decimal_places", value_errors("price", "12.345"))
        self.assertIn("invalid_integer", value_errors("order_item_id", "1.5"))
        self.assertEqual(value_errors("order_approved_at", ""), [])

    def test_bad_header_and_missing_file_fail_explicitly(self):
        path = self.data / self.mapping[0][0]
        path.write_text("unexpected\nvalue\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "header"):
            profile(self.data)
        path.unlink()
        with self.assertRaisesRegex(ValueError, "Missing CSV"):
            profile(self.data)

    def test_order_without_children_is_retained_in_coverage(self):
        self.rows["raw.order_items"] = []
        self.write_sources()
        report = profile(self.data)
        self.assertEqual(report["tables"]["orders"]["rows"], 1)
        self.assertEqual(report["order_coverage"]["without_order_items"], 1)


if __name__ == "__main__":
    unittest.main()
