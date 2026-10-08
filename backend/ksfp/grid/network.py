"""DC power flow with distributed slack at the ISTS tie points.

flows = H @ p, where p is the net injection (gen − load) at internal buses. Net import is
absorbed by the external tie buses in proportion to their participation factors; H is the
PTDF matrix for that slack distribution, cached per outage set.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np

from .topology import topology


def _km(a: dict, b: dict) -> float:
    dlat = (b["lat"] - a["lat"]) * 111
    dlon = (b["lon"] - a["lon"]) * 111 * math.cos(math.radians((a["lat"] + b["lat"]) / 2))
    return max(15.0, math.hypot(dlat, dlon))


def _reactance(line: dict) -> float:
    t = topology()
    per_km = 0.35 if line["kv"] == 765 else 1.0 if line["kv"] == 400 else 3.2
    return _km(t.bus(line["from"]), t.bus(line["to"])) * per_km * (0.6 if line.get("hvdc") else 1.0)


@dataclass(frozen=True)
class PtdfModel:
    line_ids: tuple[str, ...]
    internal_ids: tuple[str, ...]
    H: np.ndarray  # lines × internal buses
    limits: np.ndarray
    islanded: tuple[str, ...]  # buses cut off from the main network by the outage set


def _main_component(lines: list[dict], outaged: tuple[str, ...]) -> set[str]:
    t = topology()
    adj: dict[str, set[str]] = {b["id"]: set() for b in t.buses}
    for ln in lines:
        if ln["id"] not in outaged:
            adj[ln["from"]].add(ln["to"])
            adj[ln["to"]].add(ln["from"])
    seen: set[str] = set()
    best: set[str] = set()
    for start in adj:
        if start in seen:
            continue
        comp, stack = set(), [start]
        while stack:
            u = stack.pop()
            if u in comp:
                continue
            comp.add(u)
            stack.extend(adj[u] - comp)
        seen |= comp
        if len(comp) > len(best):
            best = comp
    return best


@lru_cache(maxsize=64)
def ptdf_model(outaged: tuple[str, ...] = ()) -> PtdfModel:
    t = topology()
    lines = list(t.lines)
    alive = _main_component(lines, outaged)
    ids = [b["id"] for b in t.buses if b["id"] in alive]
    idx = {b: i for i, b in enumerate(ids)}
    n = len(ids)
    internal = [b["id"] for b in t.internal]
    ext = [e for e in t.external if e["id"] in alive]
    part_sum = sum(e.get("participation", 0) for e in ext) or 1.0
    B = np.zeros((n, n))
    for ln in lines:
        if ln["id"] in outaged or ln["from"] not in idx or ln["to"] not in idx:
            continue
        y = 1 / _reactance(ln)
        i, j = idx[ln["from"]], idx[ln["to"]]
        B[i, i] += y
        B[j, j] += y
        B[i, j] -= y
        B[j, i] -= y
    # injection map: internal p → injection vector (connected ties absorb −Σp by participation).
    # Islanded internal buses get a zero column: their load/generation cannot reach the network.
    A = np.zeros((n, len(internal)))
    for k, bid in enumerate(internal):
        if bid not in idx:
            continue
        A[idx[bid], k] = 1.0
        for e in ext:
            A[idx[e["id"]], k] -= e.get("participation", 0) / part_sum
    keep = list(range(1, n))  # bus 0 is the angle reference
    Binv = np.zeros((n, n))
    Binv[np.ix_(keep, keep)] = np.linalg.inv(B[np.ix_(keep, keep)])
    Bf = np.zeros((len(lines), n))
    for li, ln in enumerate(lines):
        if ln["id"] in outaged or ln["from"] not in idx or ln["to"] not in idx:
            continue
        y = 1 / _reactance(ln)
        Bf[li, idx[ln["from"]]] = y
        Bf[li, idx[ln["to"]]] = -y
    H = Bf @ Binv @ A
    islanded = tuple(b["id"] for b in t.buses if b["id"] not in alive)
    return PtdfModel(tuple(ln["id"] for ln in lines), tuple(internal), H, np.array([ln["limitMW"] for ln in lines], float), islanded)


@dataclass
class FlowResult:
    flows: dict[str, float]
    loading: dict[str, float]
    voltage: dict[str, float]
    injections: dict[str, float]  # incl. ISTS tie injections (+ = import into Karnataka)
    max_line: str
    max_loading: float
    islanded: tuple[str, ...] = ()


def solve(injection: dict[str, float], outaged: tuple[str, ...] = ()) -> FlowResult:
    t = topology()
    out = tuple(sorted(outaged))
    m = ptdf_model(out)
    p = np.array([injection.get(b, 0.0) for b in m.internal_ids])
    f = m.H @ p
    flows, loading = {}, {}
    for i, lid in enumerate(m.line_ids):
        dead = lid in out
        flows[lid] = 0.0 if dead else float(f[i])
        loading[lid] = 0.0 if dead else abs(float(f[i])) / m.limits[i]
    connected = np.array([b not in m.islanded for b in m.internal_ids])
    total = float(p[connected].sum())
    ext = [e for e in t.external if e["id"] not in m.islanded]
    part_sum = sum(e.get("participation", 0) for e in ext) or 1.0
    inj = {b: float(v) for b, v in zip(m.internal_ids, p)}
    for e in t.external:
        inj[e["id"]] = -total * e.get("participation", 0) / part_sum if e in ext else 0.0
    voltage = {}
    for b in t.buses:
        conn = [ln["id"] for ln in t.lines if b["id"] in (ln["from"], ln["to"]) and ln["id"] not in out]
        worst = max((loading[c] for c in conn), default=0.0)
        voltage[b["id"]] = round(1.035 - 0.075 * worst * worst, 4)
    max_line = max(loading, key=loading.get)
    return FlowResult(flows, loading, voltage, inj, max_line, loading[max_line], m.islanded)


def ptdf_column(bus: str, outaged: tuple[str, ...] = ()) -> dict[str, float]:
    m = ptdf_model(tuple(sorted(outaged)))
    k = m.internal_ids.index(bus)
    return {lid: float(m.H[i, k]) for i, lid in enumerate(m.line_ids)}
