---
name: determinism
description: Overlapping authority declared in several places and several orders, plus a few Unicode characters — ünïcödé, 日本語, emoji 🔒.
allowed-tools:
  - Bash(git:*)
  - Bash(jq:*)
  - Read
  - Read
---

# Determinism

This fixture exists so that scanning it twice produces identical bytes. Every
piece of authority below is mentioned more than once, in more than one order.

```bash
git status
jq . ./config/settings.json
curl https://api.example.com/v1/things
git log --oneline
curl https://API.EXAMPLE.COM/v1/other
```

Read `./config/settings.json` before running anything, then write the report to
`./out/report.json`.

Use the `Read` tool for local files and WebFetch for remote ones.
