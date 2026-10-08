"""Download the public-apis README and convert its tables into data/public-apis.json."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = "https://raw.githubusercontent.com/public-apis/public-apis/master/README.md"
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "data" / "public-apis.json"

_HEADING = re.compile(r"^###\s+(.+?)\s*$")
_LINK = re.compile(r"^\[(?P<name>.+?)\]\(\s*(?P<url>[^)\s]+)\s*\)$")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_readme(markdown: str) -> list[dict]:
    """Return one dict per API row found in the README's category tables.

    Only tables whose header has Auth/HTTPS/CORS columns are read, which skips
    the sponsored section at the top of the README.
    """
    apis: list[dict] = []
    category = None
    in_table = False
    for line in markdown.splitlines():
        heading = _HEADING.match(line)
        if heading:
            category, in_table = heading.group(1), False
            continue
        if category is None or "|" not in line:
            in_table = False
            continue
        cells = _cells(line)
        if [c.lower() for c in cells[2:5]] == ["auth", "https", "cors"]:
            in_table = True
            continue
        if not in_table or set(cells[0]) <= set(":-"):
            continue
        if len(cells) < 5:
            continue
        link = _LINK.match(cells[0])
        if not link:
            continue
        auth = cells[2].strip("`")
        apis.append(
            {
                "name": link.group("name"),
                "url": link.group("url"),
                "description": cells[1],
                "category": category,
                "auth": "" if auth.lower() == "no" else auth,
                "https": cells[3].lower() == "yes",
                "cors": cells[4].lower(),
            }
        )
    return apis


def sync(output: Path = DEFAULT_OUTPUT, source_url: str = SOURCE_URL) -> int:
    with urllib.request.urlopen(source_url, timeout=30) as resp:
        markdown = resp.read().decode("utf-8")
    apis = parse_readme(markdown)
    if not apis:
        raise RuntimeError("Parsed 0 APIs; the upstream README format may have changed")
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": source_url,
        "synced_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "count": len(apis),
        "apis": apis,
    }
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return len(apis)
