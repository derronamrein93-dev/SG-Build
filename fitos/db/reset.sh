#!/usr/bin/env bash
# Rebuild the database from migrations and reseed. Roles are cluster-level and
# created once by bootstrap_roles.sql as a superuser.
set -euo pipefail
cd "$(dirname "$0")/.."
# Identity peppers and connection settings. The application has no fallback for
# the peppers — see src/lib/config.ts — so the seed cannot run without them.
# Anything already exported wins over these defaults.
. "$(pwd)/dev.env"
su postgres -c "psql -q -f $(pwd)/db/bootstrap_roles.sql"
su postgres -c "psql -q -c 'drop database if exists fitos' -c 'create database fitos owner fitos_owner'"
for f in db/migrations/*.sql; do
  echo "applying $f"
  psql -h 127.0.0.1 -U fitos_owner -d fitos -q -v ON_ERROR_STOP=1 -f "$f"
done
su postgres -c "psql -q -d fitos -c 'grant fitos_app, fitos_svc to fitos_owner'"
npx tsx db/seed.ts
