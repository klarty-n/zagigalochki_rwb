#!/usr/bin/env bash
# Restore a real archive into a disposable database and run the mart contract.
set -euo pipefail
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd -- "$base/.." && pwd)"
archive="${1:?Usage: bash deploy/test_restore.sh path/to/backup.dump}"
test_db="marketplace_restore_$(date -u +%Y%m%d%H%M%S)_$$"
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    "$base/db.sh" exec -T postgres dropdb -U hack "$test_db"
  fi
}
trap cleanup EXIT
"$base/db.sh" exec -T postgres pg_restore --list < "$archive" > /dev/null
"$base/db.sh" exec -T postgres createdb -U hack "$test_db"
created=1
"$base/db.sh" exec -T postgres pg_restore -U hack -d "$test_db" \
  --no-owner --exit-on-error --single-transaction < "$archive"
"$base/db.sh" exec -T postgres psql -U hack -d "$test_db" \
  -v ON_ERROR_STOP=1 < "$root/checks/mart.sql"
"$base/db.sh" exec -T postgres psql -U hack -d "$test_db" -Atc \
  "SELECT 'orders='||(SELECT count(*) FROM core.orders)||', items='||
   (SELECT count(*) FROM core.order_items)||', cached_category_rows='||
   (SELECT count(*) FROM mart.category_sales_cached)"
printf 'Restore check passed in temporary database %s\n' "$test_db"
