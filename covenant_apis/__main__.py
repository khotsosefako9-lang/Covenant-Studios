"""Command line: python -m covenant_apis {sync,search,categories,show}"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict

from .catalog import load_catalog
from .sync import sync


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="covenant_apis", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("sync", help="re-download the catalog from public-apis")
    sub.add_parser("categories", help="list categories with API counts")

    s = sub.add_parser("search", help="search APIs by keyword and filters")
    s.add_argument("query", nargs="*", default=[])
    s.add_argument("-c", "--category")
    s.add_argument("--no-auth", action="store_true", help="only APIs that need no key")
    s.add_argument("--https", action="store_true", help="only HTTPS APIs")
    s.add_argument("--cors", action="store_true", help="only APIs with CORS enabled (usable from a browser)")
    s.add_argument("--json", action="store_true", help="output JSON")

    show = sub.add_parser("show", help="show one API by exact name")
    show.add_argument("name", nargs="+")

    args = parser.parse_args(argv)

    if args.cmd == "sync":
        print(f"Synced {sync()} APIs")
        return 0

    catalog = load_catalog()
    if args.cmd == "categories":
        for cat in catalog.categories():
            print(f"{len(catalog.search(category=cat)):4d}  {cat}")
    elif args.cmd == "search":
        results = catalog.search(
            " ".join(args.query), category=args.category, no_auth=args.no_auth, https_only=args.https, cors=args.cors
        )
        if args.json:
            print(json.dumps([asdict(a) for a in results], indent=2, ensure_ascii=False))
        else:
            for a in results:
                print(f"{a.name} [{a.category}] auth={a.auth or 'none'} cors={a.cors}\n    {a.description}\n    {a.url}")
            print(f"\n{len(results)} result(s)", file=sys.stderr)
    elif args.cmd == "show":
        api = catalog.get(" ".join(args.name))
        if api is None:
            print("Not found", file=sys.stderr)
            return 1
        print(json.dumps(asdict(api), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
