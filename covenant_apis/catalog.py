"""Load and query the public-apis catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from .sync import DEFAULT_OUTPUT


@dataclass(frozen=True)
class Api:
    name: str
    url: str
    description: str
    category: str
    auth: str  # "" (none), "apiKey", "OAuth", "X-Mashape-Key", "User-Agent", ...
    https: bool
    cors: str  # "yes", "no" or "unknown"

    @property
    def needs_auth(self) -> bool:
        return bool(self.auth)


class Catalog:
    def __init__(self, apis: list[Api]):
        self.apis = apis

    def __len__(self) -> int:
        return len(self.apis)

    def __iter__(self):
        return iter(self.apis)

    def categories(self) -> list[str]:
        return sorted({a.category for a in self.apis})

    def search(
        self,
        query: str = "",
        *,
        category: str | None = None,
        no_auth: bool = False,
        https_only: bool = False,
        cors: bool = False,
    ) -> list[Api]:
        """Case-insensitive match of every word in `query` against name, description and category."""
        words = query.lower().split()
        results = []
        for api in self.apis:
            if category and api.category.lower() != category.lower():
                continue
            if no_auth and api.needs_auth:
                continue
            if https_only and not api.https:
                continue
            if cors and api.cors != "yes":
                continue
            haystack = f"{api.name} {api.description} {api.category}".lower()
            if all(w in haystack for w in words):
                results.append(api)
        return results

    def get(self, name: str) -> Api | None:
        for api in self.apis:
            if api.name.lower() == name.lower():
                return api
        return None


def load_catalog(path: Path = DEFAULT_OUTPUT) -> Catalog:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; run `python -m covenant_apis sync` first")
    data = json.loads(path.read_text(encoding="utf-8"))
    return Catalog([Api(**row) for row in data["apis"]])
