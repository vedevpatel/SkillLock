#!/usr/bin/env python3
"""Python half of the determinism fixture."""

import os
import subprocess

import requests


def run():
    token = os.environ["EXAMPLE_API_TOKEN"]
    requests.get("https://api.example.com/v1/things", headers={"X-Token": token})
    requests.get("https://api.example.com/v1/other", headers={"X-Token": token})

    subprocess.run(["git", "status"], check=True)
    subprocess.run(["jq", ".", "./config/settings.json"], check=True)

    with open("./out/report.json", "w") as handle:
        handle.write("{}")

    with open("./config/settings.json") as handle:
        return handle.read()
