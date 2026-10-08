"""Static grid model (single source of truth, also served to the UI via /api/v1/topology)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

DATA = Path(__file__).resolve().parent.parent / "data" / "karnataka.json"


@dataclass(frozen=True)
class Topology:
    raw: dict[str, Any]

    @property
    def buses(self) -> list[dict]:
        return self.raw["buses"]

    @property
    def internal(self) -> list[dict]:
        return [b for b in self.buses if not b.get("external")]

    @property
    def external(self) -> list[dict]:
        return [b for b in self.buses if b.get("external")]

    @property
    def lines(self) -> list[dict]:
        return self.raw["lines"]

    @property
    def generators(self) -> list[dict]:
        return self.raw["generators"]

    @property
    def assets(self) -> list[dict]:
        return self.raw["assets"]

    @property
    def meta(self) -> dict:
        return self.raw["meta"]

    def bus(self, bus_id: str) -> dict:
        return next(b for b in self.buses if b["id"] == bus_id)

    def line(self, line_id: str) -> dict:
        return next(ln for ln in self.lines if ln["id"] == line_id)

    def asset(self, asset_id: str) -> dict:
        return next(a for a in self.assets if a["id"] == asset_id)

    def line_label(self, line_id: str) -> str:
        ln = self.line(line_id)
        if ln.get("name"):
            return ln["name"]
        a = self.bus(ln["from"])["name"].split(" ")[0]
        b = self.bus(ln["to"])["name"].split(" ")[0]
        return f"{a}–{b} {ln['kv']} kV"


@lru_cache(maxsize=1)
def topology() -> Topology:
    return Topology(json.loads(DATA.read_text()))
