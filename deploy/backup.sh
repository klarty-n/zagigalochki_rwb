#!/usr/bin/env bash
set -euo pipefail
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
backup_dir="${1:-$base/backups}"
mkdir -p "$backup_dir"
umask 077
file="$backup_dir/marketplace-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
trap 'rm -f "$file.partial"' EXIT
"$base/db.sh" exec -T postgres pg_dump -U hack -d marketplace -Fc > "$file.partial"
# Check the archive catalogue before publishing the backup.
"$base/db.sh" exec -T postgres pg_restore --list < "$file.partial" > /dev/null
mv "$file.partial" "$file"
printf '%s\n' "$file"
