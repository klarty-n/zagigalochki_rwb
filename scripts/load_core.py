"""Load an existing raw snapshot into core and write a Russian run report.

No raw writes, no core truncation, no automatic deletes, no commits to Git.
Requires PostgreSQL 16+ and psycopg2 (same driver as load_raw.py).
"""

import argparse
import hashlib
import json
import os
import sys
from contextlib import closing
from pathlib import Path
from uuid import uuid4

import psycopg2
from psycopg2.extras import Json, RealDictCursor

ROOT = Path(__file__).resolve().parent.parent
LOCK_ID = 74020261028
MARKER = "-- BEGIN PUBLICATION"


def explain(code):
    parts = code.split(":")
    messages = {
        "required": "Не заполнено обязательное поле",
        "invalid_type": "Значение нельзя преобразовать без потери данных",
        "foreign_key": "Родитель отсутствует среди принятых записей снимка",
        "duplicate_key": "Повтор ключа: отклонены все записи конфликтующей группы",
        "duplicate_customer_link": "Несколько заказов с одним customer_id, нарушен контракт UNIQUE",
    }
    return messages.get(parts[0], parts[0]) + (": " + ": ".join(parts[1:]) if len(parts) > 1 else "")


def write_report(conn, run_id, directory):
    directory.mkdir(parents=True, exist_ok=True)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM etl.load_runs WHERE run_id=%s", (run_id,))
        run = dict(cur.fetchone())
        cur.execute("SELECT * FROM etl.table_stats WHERE run_id=%s ORDER BY target_table", (run_id,))
        stats = [dict(row) for row in cur]
        cur.execute("SELECT target_table, reason, COUNT(*) AS records FROM etl.rejected_rows "
                    "CROSS JOIN LATERAL unnest(errors) AS reason WHERE run_id=%s "
                    "GROUP BY target_table, reason ORDER BY target_table, reason", (run_id,))
        reasons = [dict(row) for row in cur]
        cur.execute("SELECT COUNT(*) FROM etl.rejected_rows WHERE run_id=%s", (run_id,))
        rejected = cur.fetchone()["count"]
        cur.execute("SELECT target_table, source_key, source_record, errors FROM etl.rejected_rows "
                    "WHERE run_id=%s ORDER BY target_table, source_ref LIMIT 10", (run_id,))
        examples = [dict(row) for row in cur]
    status = {"running": "Выполняется", "succeeded": "Успешно", "failed": "Ошибка"}[run["status"]]
    lines = ["# Отчёт загрузки raw → core", "", f"Статус: **{status}**.", "",
             f"Идентификатор запуска: `{run_id}`.", "",
             f"Начало: {run['started_at']}; завершение: {run['finished_at']}.", "",
             "Исходные таблицы raw не изменялись. Новые и изменившиеся записи публикуются "
             "одной транзакцией; удаление отсутствующих записей не выполняется.", "",
             f"Отклонено записей: **{rejected:,}**. Одна запись может иметь несколько причин.", ""]
    if run["error_message"]:
        lines += ["## Причина остановки", "", "```text", run["error_message"], "```", "",
                  "Изменения бизнес-данных этого запуска не опубликованы. "
                  "Предыдущие успешно загруженные данные сохраняются.", ""]
    lines += ["## Результат по таблицам", "",
              "| Таблица | Прочитано | Принято | Отклонено | Добавлено | Обновлено | Без изменений |",
              "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for row in stats:
        lines.append("| " + " | ".join(str(row[key]) for key in ["target_table", "read_rows", "accepted_rows",
                     "rejected_rows", "inserted_rows", "updated_rows", "unchanged_rows"]) + " |")
    if not stats:
        lines += ["", "Публикация не выполнена; статистика вставок и обновлений отсутствует."]
    lines += ["", "Прочитано = принято + отклонено. Принято = добавлено + обновлено + без изменений. "
              "categories — производный справочник: число его записей не равно числу строк CSV переводов.", "",
              "## Причины отклонений", ""]
    if reasons:
        for row in reasons:
            lines.append(f"- {row['target_table']}: {explain(row['reason'])}; записей: {row['records']}.")
    else:
        lines.append("Отклонённых записей с ошибками типов, обязательных полей, ключей и ссылок нет.")
    if examples:
        lines += ["", "## Примеры отклонённых записей", ""]
        for row in examples:
            lines += [f"### {row['target_table']}", "",
                      "Ключ: `" + json.dumps(row["source_key"], ensure_ascii=False) + "`.", ""]
            lines += ["- " + explain(error) for error in row["errors"]]
            lines += ["", "```json", json.dumps(row["source_record"], ensure_ascii=False, indent=2), "```", ""]
    lines += ["", "## Ограничения и согласованные правила", "",
              "- NULL-категория товара допустима; категория без перевода сохраняется, перевод NULL.",
              "- Нулевые значения, пропуски необязательных полей, спорная хронология и "
              "расхождения сумм сами по себе не служат правилом отклонения. Решения по ним ещё согласуются; "
              "см. audit_report.md и docs/data_quality_decisions.md.",
              "- При отклонении новой версии строки предыдущая опубликованная версия не удаляется.",
              "- Это сравнение полного снимка, а не получение изменений через CDC. "
              "Нагрузочные испытания на больших объёмах ещё не проведены.",
              "- Безопасный повторный запуск подтверждается отдельной проверкой статистики.", "",
              f"SHA-256 SQL загрузки: `{run['sql_sha256']}`.", ""]
    path = directory / f"load_{run_id}.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def load(dsn, report_dir, fail_on_reject=False, application_name="marketplace-core-loader"):
    sql_text = (ROOT / "model/02_load.sql").read_text(encoding="utf-8")
    preparation, publication = sql_text.split(MARKER, 1)
    run_id = str(uuid4())
    with closing(psycopg2.connect(dsn, application_name=application_name, connect_timeout=10)) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT current_setting('server_version_num')::int")
            if cur.fetchone()[0] < 160000:
                raise RuntimeError("PostgreSQL 16 or newer is required")
            cur.execute("SELECT pg_try_advisory_lock(%s)", (LOCK_ID,))
            if not cur.fetchone()[0]:
                raise RuntimeError("Another core loader is already running")
            # Bootstrap is non-destructive and executes before the data snapshot.
            cur.execute("BEGIN")
            try:
                cur.execute((ROOT / "model/00_etl.sql").read_text(encoding="utf-8"))
                cur.execute((ROOT / "model/01_schema.sql").read_text(encoding="utf-8"))
                cur.execute("COMMIT")
            except Exception:
                cur.execute("ROLLBACK")
                raise
            cur.execute("INSERT INTO etl.load_runs(run_id,status,sql_sha256) VALUES (%s,'running',%s)",
                        (run_id, hashlib.sha256(sql_text.encode()).hexdigest()))
        conn.autocommit = False
        # SHARE locks in the SQL preparation freeze all raw tables. READ COMMITTED
        # avoids pinning a snapshot before those locks (important with TRUNCATE).
        conn.set_session(isolation_level="READ COMMITTED")
        prepared, failed, error_message = False, False, None
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT set_config('etl.run_id', %s, true)", (run_id,))
                cur.execute(preparation)
                cur.execute("SAVEPOINT publication")
                prepared = True
                cur.execute("SELECT COUNT(*) FROM etl.rejected_rows WHERE run_id=%s", (run_id,))
                if fail_on_reject and cur.fetchone()[0]:
                    raise RuntimeError("Rejected records found; publication disabled by --fail-on-reject")
                cur.execute(publication)
                cur.execute("UPDATE etl.load_runs SET status='succeeded',finished_at=clock_timestamp() WHERE run_id=%s", (run_id,))
            conn.commit()
        except Exception as exc:
            failed, error_message = True, str(exc)
            if prepared:
                with conn.cursor() as cur:
                    cur.execute("ROLLBACK TO SAVEPOINT publication")
                # Keep completed validation diagnostics, roll back all business writes.
            else:
                conn.rollback()
            with conn.cursor() as cur:
                cur.execute("UPDATE etl.load_runs SET status='failed',finished_at=clock_timestamp(),error_message=%s "
                            "WHERE run_id=%s", (error_message, run_id))
            conn.commit()
        path = write_report(conn, run_id, report_dir)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
        conn.commit()
        print(f"Run: {run_id}; status: {'failed' if failed else 'succeeded'}")
        print(f"Human-readable report: {path}")
        if failed:
            print(error_message, file=sys.stderr)
        if failed:
            return 1
        # A successful core publication is followed by an atomic mart publication.
        # Refresh failure is visible to the caller and the dashboard, while the
        # previous valid category aggregate stays available.
        from refresh_category_mart import refresh
        try:
            return refresh(dsn)
        except Exception as exc:
            print(f'Core load succeeded; mart refresh failed: {exc}', file=sys.stderr)
            return 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dsn", default=os.environ.get("DATABASE_URL", "postgresql://hack:hack@localhost:5432/marketplace"))
    parser.add_argument("--report-dir", type=Path, default=ROOT / "reports")
    parser.add_argument("--fail-on-reject", action="store_true")
    args = parser.parse_args()
    try:
        sys.exit(load(args.dsn, args.report_dir, args.fail_on_reject))
    except (psycopg2.Error, RuntimeError, OSError) as exc:
        sys.exit(f"Core load failed before report completion: {exc}")
