"""Searchable catalog of the free APIs listed in github.com/public-apis/public-apis."""

from .catalog import Api, Catalog, load_catalog
from .client import fetch_json

__all__ = ["Api", "Catalog", "load_catalog", "fetch_json"]
