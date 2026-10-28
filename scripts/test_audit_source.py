"""Check the extended audit against hand-calculated synthetic observations."""

import json
import tempfile
import unittest
from pathlib import Path

from audit_source import audit
from render_audit_report import render
from test_profile_source import ProfileTests


class AuditTests(unittest.TestCase):
    def test_money_and_whitespace_findings_and_human_report(self):
        fixture = ProfileTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)

        def set_row(table, values, append=False):
            columns = next(columns for _, name, columns in fixture.mapping if name == table)
            row = fixture.rows[table][0].copy()
            for key, value in values.items():
                row[columns.index(key)] = value
            if append:
                fixture.rows[table].append(row)
            else:
                fixture.rows[table][0] = row

        set_row("raw.order_items", {"price": "10.00", "freight_value": "2.00"})
        set_row("raw.order_items", {"order_item_id": "2", "price": "3.00", "freight_value": "1.00"}, append=True)
        set_row("raw.order_payments", {"payment_value": "10.99"})
        set_row("raw.order_payments", {"payment_sequential": "2", "payment_value": "5.00"}, append=True)
        set_row("raw.order_reviews", {"review_comment_message": " \t\n"})
        fixture.write_sources()
        with tempfile.TemporaryDirectory(prefix="audit-test-") as directory:
            output = Path(directory)
            audit(fixture.data, output)
            report = json.loads((output / "audit_summary.json").read_text(encoding="utf-8"))
            cases = {case["code"]: case for case in report["cases"]}
            difference = cases["money.difference_one_cent"]
            self.assertEqual(difference["count"], 1)
            self.assertEqual(difference["examples"][0]["goods_cents"], 1300)
            self.assertEqual(difference["examples"][0]["freight_cents"], 300)
            self.assertEqual(difference["examples"][0]["paid_cents"], 1599)
            self.assertEqual(difference["examples"][0]["difference_cents"], -1)
            self.assertEqual(cases["money.difference_above_one_cent"]["count"], 0)
            self.assertEqual(cases["blank.order_reviews.review_comment_message"]["count"], 1)
            self.assertEqual(cases["reviews.whitespace_only.review_comment_message"]["count"], 1)
            self.assertEqual(cases["reviews.whitespace.review_comment_message"]["count"], 0)
            render(output / "audit_summary.json", output / "audit_report.md")
            text = (output / "audit_report.md").read_text(encoding="utf-8")
            self.assertIn("Деньги и платежи", text)
            self.assertIn("0,01 BRL", text)
            self.assertIn("-0,01", text)
            self.assertIn("исходная запись не исправлена", text)


if __name__ == "__main__":
    unittest.main()
