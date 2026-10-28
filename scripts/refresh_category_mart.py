"""Atomically publish the stored category mart; keep the previous copy on failure."""
import argparse
import os
from pathlib import Path
from contextlib import closing

import psycopg2

ROOT = Path(__file__).resolve().parents[1]


def refresh(dsn, simulate_failure=False):
    with closing(psycopg2.connect(dsn, application_name='marketplace-mart-refresh')) as conn:
        try:
            with conn.cursor() as cur:
                # The views are idempotent and can be installed on the first core load.
                view_sql = (ROOT / 'model/03_mart.sql').read_text(encoding='utf-8')
                cur.execute('\n'.join(line for line in view_sql.splitlines()
                                      if not line.startswith('\\set ')))
                cur.execute((ROOT / 'model/04_cached_mart.sql').read_text(encoding='utf-8'))
            conn.commit()
            with conn.cursor() as cur:
                cur.execute('REFRESH MATERIALIZED VIEW mart.category_sales_cached')
                if simulate_failure:
                    raise RuntimeError('Simulated refresh failure for restore/freshness check')
                cur.execute("""UPDATE mart.refresh_state SET last_attempt_at=clock_timestamp(),
                    last_success_at=clock_timestamp(), last_error=NULL
                    WHERE name='category_sales_cached'""")
            conn.commit()
            print('Category mart refreshed successfully')
            return 0
        except Exception as exc:
            conn.rollback()
            try:
                with conn.cursor() as cur:
                    cur.execute("""UPDATE mart.refresh_state SET last_attempt_at=clock_timestamp(),
                        last_error=%s WHERE name='category_sales_cached'""", (str(exc),))
                conn.commit()
            except psycopg2.Error:
                # On first installation the status table may not exist yet.
                conn.rollback()
            print(f'Category mart refresh failed; any previous result was kept: {exc}')
            return 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsn', default=os.environ.get('DATABASE_URL',
                        'postgresql://hack:hack@localhost:5432/marketplace'))
    parser.add_argument('--simulate-failure', action='store_true',
                        help='Test only: roll back a refresh and show a warning')
    args = parser.parse_args()
    raise SystemExit(refresh(args.dsn, args.simulate_failure))
