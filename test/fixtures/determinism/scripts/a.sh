#!/usr/bin/env bash
# Shell half of the determinism fixture: same authority, different order.
set -euo pipefail

: "${EXAMPLE_API_TOKEN:?set EXAMPLE_API_TOKEN}"

cat ./config/settings.json
curl -sS "https://api.example.com/v1/things" -H "X-Token: ${EXAMPLE_API_TOKEN}" > ./out/report.json
git status
jq . ./config/settings.json >> ./out/report.json
mkdir -p ./out
