#!/usr/bin/env python3
"""Fetch a forecast from the National Weather Service."""

import json
import os
import sys

import requests


def fetch(latitude, longitude):
    headers = {"User-Agent": "weather-skill"}
    api_key = os.getenv("WEATHER_API_KEY")
    if api_key:
        headers["X-Api-Key"] = api_key

    response = requests.get(
        f"https://api.weather.gov/points/{latitude},{longitude}/forecast",
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def main():
    latitude, longitude = sys.argv[1], sys.argv[2]
    forecast = fetch(latitude, longitude)

    os.makedirs("./cache", exist_ok=True)
    with open("./cache/latest.json", "w") as handle:
        json.dump(forecast, handle)

    print(json.dumps(forecast["properties"], indent=2))


if __name__ == "__main__":
    main()
