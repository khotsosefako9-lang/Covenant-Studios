# Covenant-Studios

## Public APIs catalog

`covenant_apis` turns the [public-apis](https://github.com/public-apis/public-apis) list
(2000+ free APIs across 50+ categories) into a searchable catalog. Pure Python 3.10+, no dependencies.

public-apis is a *directory*, not a gateway: each API has its own docs, terms and (often) key.
The catalog tells you what exists and whether it needs auth; you then call the API directly.

### CLI

```bash
python -m covenant_apis categories                    # categories with counts
python -m covenant_apis search weather --no-auth      # keyword + filters
python -m covenant_apis search -c Music --cors --json # browser-friendly, as JSON
python -m covenant_apis show "Cat Facts"              # one entry
python -m covenant_apis sync                          # refresh data/public-apis.json from upstream
```

Filters: `--no-auth` (no key needed), `--https`, `--cors` (callable from a browser), `-c/--category`.

### Python

```python
from covenant_apis import load_catalog, fetch_json

catalog = load_catalog()
for api in catalog.search("movies", no_auth=True):
    print(api.name, api.url)

fetch_json("https://catfact.ninja/fact")
fetch_json("https://api.example.com/v1/x", headers={"X-Api-Key": "..."})  # keyed APIs
```

### Tests

```bash
python -m unittest
```
