#!/usr/bin/env bash
# Fail if deploy/schema-bundle.sql no longer matches db/migrations/.
#
# A generated file nobody regenerates is worse than no generated file: it looks
# authoritative and deploys last month's schema.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp deploy/schema-bundle.sql "$tmp/committed.sql"
bash deploy/build-bundle.sh > /dev/null
if ! diff -q "$tmp/committed.sql" deploy/schema-bundle.sql > /dev/null; then
  diff "$tmp/committed.sql" deploy/schema-bundle.sql | head -30
  cp "$tmp/committed.sql" deploy/schema-bundle.sql   # leave the tree as we found it
  echo
  echo "deploy/schema-bundle.sql is stale. Regenerate it:  npm run deploy:bundle"
  exit 1
fi
echo "deploy/schema-bundle.sql is current ($(ls db/migrations/*.sql | wc -l) migrations)"
