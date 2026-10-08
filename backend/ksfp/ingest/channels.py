"""Channel registry: KPTCL 220 kV load channels (all DISCOMs) and generating stations."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data" / "channels.json"


@lru_cache(maxsize=1)
def channels() -> dict:
    return json.loads(DATA.read_text())


def norm(name: str) -> str:
    s = name.lower()
    s = re.sub(r"\b(220|110|66|400)\s*kv\b", " ", s)
    s = re.sub(r"\b(s/s|ss|sub[- ]?station|station|r/s|rs|kptcl|ltd)\b", " ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def match(name: str, kind: str) -> dict | None:
    """Match a page row label to a registry channel by normalised alias containment."""
    n = norm(name)
    if not n:
        return None
    items = channels()["load_channels" if kind == "load" else "gen_stations"]
    best, best_len = None, 0
    for it in items:
        for al in [it["name"], *it.get("aliases", [])]:
            a = norm(al)
            if a and (a == n or re.search(rf"\b{re.escape(a)}\b", n)) and len(a) > best_len:
                best, best_len = it, len(a)
    return best
