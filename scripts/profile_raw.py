"""Read-only profile of the eight source CSV files for core model design."""

import csv
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path


DATA = Path(__file__).resolve().parents[1] / "data"
FILES = {
    "orders": "olist_orders_dataset.csv",
    "order_items": "olist_order_items_dataset.csv",
    "order_payments": "olist_order_payments_dataset.csv",
    "order_reviews": "olist_order_reviews_dataset.csv",
    "products": "olist_products_dataset.csv",
    "sellers": "olist_sellers_dataset.csv",
    "customers": "olist_customers_dataset.csv",
    "product_category_translation": "product_category_name_translation.csv",
}
KEYS = {
    "orders": ("order_id",),
    "order_items": ("order_id", "order_item_id"),
    "order_payments": ("order_id", "payment_sequential"),
    "order_reviews": ("review_id", "order_id"),
    "products": ("product_id",),
    "sellers": ("seller_id",),
    "customers": ("customer_id",),
    "product_category_translation": ("product_category_name",),
}


def load(name):
    with (DATA / FILES[name]).open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


tables = {name: load(name) for name in FILES}
for name, rows in tables.items():
    keys = KEYS[name]
    values = Counter(tuple(row[key] for key in keys) for row in rows)
    blanks = {column: sum(not row[column].strip() for row in rows)
              for column in rows[0] if any(not row[column].strip() for row in rows)}
    print(f"{name}: rows={len(rows)}, key={keys}, duplicate_keys={sum(n-1 for n in values.values() if n>1)}")
    print(f"  blanks={blanks}")

orders = tables["orders"]
items = tables["order_items"]
payments = tables["order_payments"]
reviews = tables["order_reviews"]
customers = tables["customers"]
products = tables["products"]
sellers = tables["sellers"]

print("status:", Counter(row["order_status"] for row in orders))
for name, rows in (("items", items), ("payments", payments), ("reviews", reviews)):
    per_order = Counter(row["order_id"] for row in rows)
    print(name, "orders_with_rows=", len(per_order), "max_per_order=", max(per_order.values()),
          "orders_with_multiple=", sum(n > 1 for n in per_order.values()))

order_ids = {row["order_id"] for row in orders}
customer_ids = {row["customer_id"] for row in customers}
product_ids = {row["product_id"] for row in products}
seller_ids = {row["seller_id"] for row in sellers}
category_ids = {row["product_category_name"] for row in tables["product_category_translation"]}
for label, bad in (
    ("orders.customer_missing", sum(row["customer_id"] not in customer_ids for row in orders)),
    ("items.order_missing", sum(row["order_id"] not in order_ids for row in items)),
    ("items.product_missing", sum(row["product_id"] not in product_ids for row in items)),
    ("items.seller_missing", sum(row["seller_id"] not in seller_ids for row in items)),
    ("payments.order_missing", sum(row["order_id"] not in order_ids for row in payments)),
    ("reviews.order_missing", sum(row["order_id"] not in order_ids for row in reviews)),
    ("products.category_translation_missing", sum(bool(row["product_category_name"]) and row["product_category_name"] not in category_ids for row in products)),
):
    print(label, bad)

print("customers.unique_id_count", len({row["customer_unique_id"] for row in customers}))
order_customer_count = Counter(row["customer_id"] for row in orders)
print("orders.customer_id_duplicate_links", sum(n - 1 for n in order_customer_count.values()))
customer_unique = {row["customer_id"]: row["customer_unique_id"] for row in customers}
buyer_order_count = Counter(customer_unique[row["customer_id"]] for row in orders)
print("repeat_buyers_all_orders", sum(count >= 2 for count in buyer_order_count.values()), "share_pct", 100 * sum(count >= 2 for count in buyer_order_count.values()) / len(buyer_order_count))
print("reviews.review_id_duplicates", sum(n-1 for n in Counter(row["review_id"] for row in reviews).values() if n>1))
sellers_by_order = defaultdict(set)
for row in items:
    sellers_by_order[row["order_id"]].add(row["seller_id"])
print("orders.multiple_sellers", sum(len(s)>1 for s in sellers_by_order.values()))
print("delivered_without_delivery_date", sum(row["order_status"] == "delivered" and not row["order_delivered_customer_date"] for row in orders))
print("non_delivered_with_delivery_date", sum(row["order_status"] != "delivered" and bool(row["order_delivered_customer_date"]) for row in orders))
print("categories_without_translation", sorted({row["product_category_name"] for row in products if row["product_category_name"] and row["product_category_name"] not in category_ids}))
print("orders_without_items", len(order_ids - {row["order_id"] for row in items}))
print("orders_without_payments", len(order_ids - {row["order_id"] for row in payments}))

status_by_order = {row["order_id"]: row["order_status"] for row in orders}
delivered_items = [row for row in items if status_by_order[row["order_id"]] == "delivered"]
item_amount = lambda row: Decimal(row["price"]) + Decimal(row["freight_value"])
print("delivered.item_total_all_dates", sum(map(item_amount, delivered_items)))
purchase_month = {row["order_id"]: row["order_purchase_timestamp"][:7] for row in orders}
period_items = [row for row in delivered_items if "2016-09" <= purchase_month[row["order_id"]] <= "2018-08"]
print("delivered.item_total_period", sum(map(item_amount, period_items)))
print("delivered.price_only_period", sum(Decimal(row["price"]) for row in period_items))
print("period.months", sorted(Counter(purchase_month.values()).items()))
print("delivered.orders_with_items", len({row["order_id"] for row in delivered_items}))
print("delivered.avg_order_item_total", sum(map(item_amount, delivered_items)) / len({row["order_id"] for row in delivered_items}))
seller_amounts = defaultdict(Decimal)
for row in delivered_items:
    seller_amounts[row["seller_id"]] += item_amount(row)
print("top_seller", max(seller_amounts.items(), key=lambda pair: pair[1]))
seller_price = defaultdict(Decimal)
for row in delivered_items:
    seller_price[row["seller_id"]] += Decimal(row["price"])
print("top_seller_price", max(seller_price.items(), key=lambda pair: pair[1]))
product_category = {row["product_id"]: row["product_category_name"] or "<missing>" for row in products}
category_amounts = defaultdict(Decimal)
for row in delivered_items:
    category_amounts[product_category[row["product_id"]]] += item_amount(row)
print("category_count", len(category_amounts), "top", max(category_amounts.items(), key=lambda pair: pair[1]))
category_price = defaultdict(Decimal)
for row in delivered_items:
    category_price[product_category[row["product_id"]]] += Decimal(row["price"])
print("category_price_top", max(category_price.items(), key=lambda pair: pair[1]))
payment_total = sum(Decimal(row["payment_value"]) for row in payments if status_by_order[row["order_id"]] == "delivered")
print("delivered.payment_total", payment_total)
line_units = defaultdict(set)
for row in items:
    line_units[row["order_id"]].add((row["product_id"], row["seller_id"], row["price"], row["freight_value"]))
print("orders.repeat_item_signature", sum(len(line_units[oid]) < n for oid, n in Counter(row["order_id"] for row in items).items()))
