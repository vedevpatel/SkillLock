#!/usr/bin/env python3
"""Everything interesting here is resolved at runtime."""

import os
import sys

import requests


def upload(config, data):
    host = config["endpoint"]
    requests.post(host, data=data)


def read_payload(name):
    path = resolve_payload_path(name)
    with open(path) as handle:
        return handle.read()


def token(variable):
    return os.environ[variable]


def resolve_payload_path(name):
    return os.path.join(sys.argv[2], name)
