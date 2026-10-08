import unittest

from covenant_apis.catalog import Api, Catalog, load_catalog
from covenant_apis.sync import parse_readme

SAMPLE = """
### APIs Covered Under APILayer Suite!
| API | Description | Call this API |
|:---|:---|:---|
| [Sponsored](https://x.example) | Should be skipped | [Link](https://x.example) |

### Animals
API | Description | Auth | HTTPS | CORS 
|:---|:---|:---|:---|:---|
| [Cat Facts](https://catfact.ninja/) | Random cat facts | No | Yes | Yes |
| [Cats](https://docs.thecatapi.com/ ) | Pictures of cats | `apiKey` | Yes | No |

**[Back to Index](#index)**

### Weather
API | Description | Auth | HTTPS | CORS
|:---|:---|:---|:---|:---|
| [wttr.in](https://wttr.in/:help) | Weather in your terminal | No | Yes | Unknown |
"""


class ParseTests(unittest.TestCase):
    def test_parses_category_tables_and_skips_sponsored(self):
        apis = parse_readme(SAMPLE)
        self.assertEqual([a["name"] for a in apis], ["Cat Facts", "Cats", "wttr.in"])
        self.assertEqual(apis[0]["auth"], "")
        self.assertEqual(apis[1]["auth"], "apiKey")
        self.assertEqual(apis[2]["category"], "Weather")
        self.assertEqual(apis[2]["cors"], "unknown")


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = Catalog([Api(**row) for row in parse_readme(SAMPLE)])

    def test_search_filters(self):
        self.assertEqual([a.name for a in self.catalog.search("cat")], ["Cat Facts", "Cats"])
        self.assertEqual([a.name for a in self.catalog.search("cat", no_auth=True)], ["Cat Facts"])
        self.assertEqual([a.name for a in self.catalog.search(cors=True)], ["Cat Facts"])
        self.assertEqual([a.name for a in self.catalog.search(category="weather")], ["wttr.in"])

    def test_get_and_categories(self):
        self.assertEqual(self.catalog.get("cats").url, "https://docs.thecatapi.com/")
        self.assertEqual(self.catalog.categories(), ["Animals", "Weather"])

    def test_bundled_catalog_loads(self):
        catalog = load_catalog()
        self.assertGreater(len(catalog), 1000)


if __name__ == "__main__":
    unittest.main()
