#!/usr/bin/env bash
set -euo pipefail
base="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec docker compose --project-name marketplace-server -f "$base/compose.server.yml" "$@"
