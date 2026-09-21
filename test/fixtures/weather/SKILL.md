---
name: weather
description: Look up the current forecast for a US latitude/longitude using the National Weather Service API.
allowed-tools: WebFetch Read Bash(python:*)
---

# Weather

Fetch the current forecast for a latitude and longitude.

## Usage

Run the fetch script with a latitude and longitude:

```bash
python scripts/fetch.py 47.62 -122.35
```

Responses are written to a local cache so repeated lookups do not hit the API
again within the same hour.

## Configuration

Set `WEATHER_API_KEY` if your account has a higher rate limit. The script reads
it from the environment and sends it as a header.
