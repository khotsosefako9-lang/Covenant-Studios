"""Minimal JSON-over-HTTP helper for calling APIs from the catalog."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

USER_AGENT = "Covenant-Studios/0.1 (+https://github.com/khotsosefako9-lang/Covenant-Studios)"


def fetch_json(url: str, params: dict | None = None, headers: dict | None = None, timeout: float = 15):
    """GET `url` and decode the JSON response. Pass API keys via `headers` or `params`."""
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))
