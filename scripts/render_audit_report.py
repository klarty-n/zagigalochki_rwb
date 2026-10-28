"""Render the machine-readable audit as a Russian Markdown report."""

import argparse
import json
from pathlib import Path

from profile_source import ROOT


FIELDS = {
    "order_approved_at": "дата подтверждения оплаты",
    "order_purchase_timestamp": "дата оформления",
    "order_delivered_carrier_date": "дата передачи перевозчику",
    "order_delivered_customer_date": "дата вручения",
    "order_estimated_delivery_date": "обещанная дата доставки",
    "review_creation_date": "дата создания записи отзыва",
    "review_answer_timestamp": "дата ответа на отзыв",
    "review_comment_title": "заголовок отзыва", "review_comment_message": "текст отзыва",
    "product_category_name": "категория", "product_name_lenght": "длина названия",
    "product_description_lenght": "длина описания", "product_photos_qty": "число фотографий",
    "product_weight_g": "вес, г", "product_length_cm": "длина, см",
    "product_height_cm": "высота, см", "product_width_cm": "ширина, см",
    "price": "цена товара", "freight_value": "стоимость доставки", "payment_value": "сумма оплаты",
    "order_id": "заказ", "order_item_id": "позиция", "review_id": "отзыв", "product_id": "товар",
    "order_status": "статус", "value": "исходное значение", "source_record": "номер записи CSV",
    "payment_sequential": "номер части оплаты", "payment_type": "способ оплаты",
    "payment_installments": "число частей рассрочки", "review_score": "оценка",
    "review_count": "число отзывов", "different_scores": "число разных оценок",
    "goods_cents": "стоимость товаров, BRL", "freight_cents": "доставка, BRL",
    "paid_cents": "платежи, BRL", "difference_cents": "платежи минус товары и доставка, BRL",
    "shipping_limit_date": "крайний срок отгрузки",
    "customer_zip_code_prefix": "префикс индекса покупателя",
    "seller_zip_code_prefix": "префикс индекса продавца",
    "customer_id": "профиль покупателя", "seller_id": "продавец",
    "customer_city": "город покупателя", "seller_city": "город продавца",
    "customer_state": "штат покупателя", "seller_state": "штат продавца",
    "state_count": "число штатов",
}
TABLES = {"orders": "Заказы", "order_reviews": "Отзывы", "products": "Товары"}


def describe(code):
    if code.startswith("blank."):
        _, table, field = code.split(".")
        return f"{TABLES.get(table, table)}: отсутствует {FIELDS.get(field, field)}"
    if code.startswith("delivered_missing."):
        return "Статус delivered, но отсутствует " + FIELDS.get(code.split(".")[1], code)
    if code.startswith("chronology."):
        later, earlier = code.removeprefix("chronology.").split("_before_")
        return FIELDS.get(later, later).capitalize() + " раньше, чем " + FIELDS.get(earlier, earlier)
    exact = {
        "status.delivery_present_not_delivered": "Дата вручения есть, но статус заказа не delivered",
        "delivery.late": "Доставка позже обещанного календарного дня",
        "status.unknown": "Статус не входит в список из описания источника",
        "coverage.without_order_items": "У заказа нет товарных позиций",
        "coverage.without_order_payments": "У заказа нет платежей",
        "coverage.without_order_reviews": "У заказа нет отзыва",
        "reviews.repeated_review_id": "Один review_id встречается в нескольких записях",
        "reviews.multiple_per_order": "На один заказ приходится несколько отзывов",
        "reviews.creation_calendar_before_purchase": "Запись отзыва создана до календарного дня покупки",
        "reviews.answer_before_creation": "Дата ответа на отзыв раньше даты создания записи",
        "reviews.creation_before_delivery_day": "Запись отзыва создана до календарного дня вручения",
        "zero.order_items.freight_value": "Нулевая стоимость доставки позиции",
        "zero.order_items.price": "Нулевая цена товара",
        "zero.order_payments.payment_value": "Нулевая сумма части оплаты",
        "payments.zero_installments": "Число частей рассрочки равно нулю",
        "payments.undefined_type": "Способ оплаты указан как not_defined",
        "items.sequence_gaps": "Пропуск номера позиции или нумерация начинается не с единицы",
        "items.shipping_deadline_before_purchase": "Срок отгрузки раньше оформления заказа",
        "items.shipping_deadline_before_approval": "Срок отгрузки раньше подтверждения оплаты",
        "money.difference_one_cent": "Сумма платежей отличается от товаров с доставкой на 0,01 BRL",
        "money.difference_above_one_cent": "Сумма платежей отличается от товаров с доставкой более чем на 0,01 BRL",
        "categories.no_translation": "Категория заполнена, но английского перевода нет",
    }
    if code in exact:
        return exact[code]
    if code.startswith("products.zero."):
        return "Нулевое значение: " + FIELDS.get(code.split(".")[2], code)
    if code.startswith("address."):
        field, table = code.split(".")[1:]
        labels = {"short_prefix": "Почтовый префикс короче пяти цифр",
                  "prefix_invalid": "Почтовый префикс нечисловой, пустой или длиннее пяти цифр",
                  "city_surrounding_spaces": "Пробелы по краям названия города",
                  "city_has_digits": "В названии города есть цифры",
                  "state_format": "Код штата не состоит из двух заглавных латинских букв",
                  "city_multiple_states": "Одно название города встречается в нескольких штатах"}
        return labels[field] + (" у покупателей" if table == "customers" else " у продавцов")
    if code.startswith("reviews.whitespace_only."):
        return FIELDS[code.split(".")[2]].capitalize() + " состоит только из пробельных символов"
    if code.startswith("reviews.whitespace."):
        return "Пробельные символы по краям: " + FIELDS[code.split(".")[2]]
    if code.startswith("id.format."):
        return "Идентификатор отличается от ожидаемого формата: " + code.removeprefix("id.format.")
    return code


def group(code):
    if code.startswith(("delivered_missing.", "chronology.", "status.")):
        return "Даты и статусы заказов"
    if code.startswith("blank.orders") or code.startswith("delivery."):
        return "Пропуски дат и сроки доставки"
    if code.startswith("coverage."):
        return "Полнота связанных данных"
    if code.startswith("money.") or code.startswith("zero.") or code.startswith("payments."):
        return "Деньги и платежи"
    if code.startswith("items."):
        return "Отгрузка и позиции"
    if code.startswith("blank.products") or code.startswith(("products.", "categories.")):
        return "Товары и категории"
    if code.startswith("address."):
        return "Адреса"
    if code.startswith("reviews.") or code.startswith("blank.order_reviews"):
        return "Отзывы"
    return "Форматы идентификаторов"


def number(value):
    return f"{value:,}".replace(",", " ")


def render(source, destination):
    report = json.loads(source.read_text(encoding="utf-8"))
    cases = report["cases"]
    found = [c for c in cases if c["count"]]
    lines = ["# Аудит исходных данных маркетплейса", "",
             f"Дата проверки (UTC): {report['created_at_utc']}", "",
             f"Проверены **все {number(report['total_source_rows'])} записей в восьми CSV-файлах**. "
             f"Выполнено {len(cases)} проверок ситуаций; ненулевой результат у {len(found)}.", "",
             "Это каталог наблюдений, а не список автоматически отклонённых данных. "
             "Ни одна исходная запись не исправлена и не удалена. "
             "Проверки охватывают перечисленные ниже правила и не доказывают отсутствие любых возможных ошибок.", "",
             "Одна запись может попасть в несколько ситуаций. Числа по строкам и группам "
             "**нельзя складывать** для получения количества невалидных записей.", "",
             "## Уже согласовано", "",
             "- Категория отсутствует: сохраняем товар, категория NULL.",
             "- Перевод категории отсутствует: сохраняем исходную категорию, перевод NULL.", "",
             "Остальные ситуации ожидают решения пользователя. "
             "Обнаруженное несоответствие не означает автоматически ошибку или необходимость отклонения.", "",
             "## Сводка ситуаций", ""]
    for heading in dict.fromkeys(group(c["code"]) for c in found):
        lines += [f"### {heading}", "", "| Ситуация | Количество | Единица | Решение |",
                  "| --- | ---: | --- | --- |"]
        for c in found:
            if group(c["code"]) != heading:
                continue
            code = c["code"]
            units = "записей"
            if code.startswith(("chronology.", "delivered_missing.", "coverage.", "status.", "money.", "delivery.")):
                units = "заказов"
            if code == "reviews.multiple_per_order":
                units = "заказов"
            if "city_multiple_states" in code:
                units = "названий городов"
            decision = "Ожидает решения"
            if code == "blank.products.product_category_name":
                decision = "Сохранить; категория NULL"
            if code == "categories.no_translation":
                decision = "Сохранить; перевод NULL"
            lines.append(f"| {describe(code)} | {number(c['count'])} | {units} | {decision} |")
        lines.append("")
    lines += ["## Конкретные примеры", "",
              "Ниже один пример на ситуацию. В техническом журнале audit_observations.jsonl "
              "сохранены все совпадения с правилами, а не только эти примеры. "
              "Номер записи CSV считается без заголовка и не равен номеру текстовой строки "
              "при многострочных отзывах.", ""]
    for c in found:
        lines += [f"### {describe(c['code'])}", "", f"Количество: {number(c['count'])}.", ""]
        if c["code"] == "reviews.repeated_review_id":
            keys = report["baseline"]["order_reviews"]["candidate_keys"]
            review_key = next(k for k in keys if k["columns"] == ["review_id"])
            composite = next(k for k in keys if k["columns"] == ["review_id", "order_id"])
            lines += ["Здесь посчитаны все записи с повторяющимся review_id. "
                      f"В базовом профиле отдельно посчитаны {number(review_key['duplicate_groups'])} "
                      f"повторяющихся ключей и {number(review_key['duplicate_extra_rows'])} записей сверх первых. "
                      f"У пары review_id + order_id повторяющихся групп: {number(composite['duplicate_groups'])}.", ""]
        if c["code"].startswith("reviews.creation"):
            lines += ["Сравниваются календарные дни. Само название поля не доказывает, "
                      "что это момент написания текста покупателем; смысл даты требует согласования.", ""]
        if c["code"].startswith("money."):
            lines += ["Позиции и платежи сначала суммированы отдельно по заказу. "
                      "Сравниваются точные целые центы. Заказы без позиций или платежей "
                      "в это сравнение не входят и перечислены отдельно. Причина расхождения не установлена.", ""]
        for key, value in c["examples"][0].items():
            if key.endswith("_cents"):
                sign = "-" if value < 0 else ""
                amount = abs(value)
                formatted = f"{sign}{amount // 100},{amount % 100:02d}"
            else:
                formatted = json.dumps(value, ensure_ascii=False)
                if len(formatted) > 350:
                    formatted = formatted[:350] + "… (сокращено)"
            # JSON escaping keeps newlines and tabs visible in human examples.
            lines.append(f"- {FIELDS.get(key, key)}: `{formatted.replace('`', chr(39))}`")
        lines += ["", f"Код ситуации: `{c['code']}`.", ""]
    lines += ["## Проверки без найденных случаев", ""]
    lines += [f"- {describe(c['code'])}." for c in cases if not c["count"]]
    lines += ["", "## Проверенные файлы", "",
              "Контрольные суммы SHA-256 позволяют сопоставить отчёт с конкретными файлами.", "",
              "| Файл | Записей | SHA-256 |", "| --- | ---: | --- |"]
    for table in report["baseline"].values():
        lines.append(f"| {table['file']} | {number(table['rows'])} | `{table['sha256']}` |")
    lines += ["", "## Границы проверки", "",
              "- Прочитаны все записи, а не выборка.",
              "- Базовый профиль проверяет заголовки, заполненность, форматы чисел/дат, "
              "полные дубли и кандидаты ключей. Ошибок преобразования непустых чисел/дат "
              "и полных дублей на текущих файлах не найдено.",
              "- Числа невалидных записей и финансовые потери пока не рассчитаны: "
              "сначала нужно согласовать правила и объединить пересекающиеся множества.",
              "- Правила целевой схемы core, допустимые диапазоны и политика истории ещё согласуются.",
              "- Источник не содержит истории исправлений и объяснений денежных расхождений.",
              "- Отдельный JSON остаётся технической копией; основной отчёт для чтения — этот файл.", ""]
    destination.write_text("\n".join(lines), encoding="utf-8")
    print(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "reports/audit_summary.json")
    parser.add_argument("--output", type=Path, default=ROOT / "reports/audit_report.md")
    args = parser.parse_args()
    render(args.source, args.output)
