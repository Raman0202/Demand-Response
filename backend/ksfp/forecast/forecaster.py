"""Short-term probabilistic forecaster (P10/P50/P90) for the next 8 blocks.

Model: day-ahead profile × an intraday level correction that decays with lead time
(persistence of the current forecast error), with uncertainty growing ~√lead. Production
swaps in the ML ensemble (LightGBM / TFT) behind the same `forecast()` contract; the
accuracy tracker below scores whichever model is plugged in.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Callable

from ..core.clock import BLOCK_S, Clock
from ..grid.network import solve
from ..grid.state import GridState
from ..grid.topology import topology

Z90 = 1.2816


@dataclass
class Forecaster:
    profile: Callable[[float], dict]  # day-ahead view: ts → {"demand", "gen", "schedule"}
    horizon_blocks: int = 8
    level_d: float = 1.0
    level_re: float = 1.0
    last: dict | None = None
    pending: deque = field(default_factory=lambda: deque(maxlen=64))  # (target_ts, predicted_demand)
    errors: deque = field(default_factory=lambda: deque(maxlen=96))  # abs % errors, 1-block ahead

    def update(self, s: GridState) -> None:
        prof = self.profile(s.ts)
        t = topology()
        re_prof = sum(v for g, v in prof["gen"].items() if t.generators[[x["id"] for x in t.generators].index(g)]["type"] in ("solar", "wind"))
        self.level_d = 0.7 * self.level_d + 0.3 * (s.demand_mw / prof["demand"] if prof["demand"] else 1.0)
        self.level_re = 0.7 * self.level_re + 0.3 * (s.re_mw / re_prof if re_prof else 1.0)
        while self.pending and self.pending[0][0] <= s.ts:
            _, pred = self.pending.popleft()
            if s.demand_mw:
                self.errors.append(abs(pred - s.demand_mw) / s.demand_mw * 100)

    def forecast(self, s: GridState, held_mw: float = 0.0, direction_sign: float = 1.0) -> dict:
        """held_mw: flexibility currently delivered by active decisions, assumed held for 2 blocks then released."""
        t = topology()
        start = Clock.block_start(s.ts)
        out = []
        violations = []
        gens = {g["id"]: g for g in t.generators}
        for b in range(1, self.horizon_blocks + 1):
            ts = start + b * BLOCK_S
            prof = self.profile(ts)
            decay = 0.82**b
            dem = prof["demand"] * (1 + (self.level_d - 1) * decay)
            re_p = sum(v for g, v in prof["gen"].items() if gens[g]["type"] in ("solar", "wind"))
            re = re_p * (1 + (self.level_re - 1) * decay)
            other_state = sum(v for g, v in prof["gen"].items() if gens[g]["type"] not in ("solar", "wind") and gens[g]["owner"] != "Central")
            held = held_mw if b <= 2 else held_mw * max(0.0, 1 - (b - 2) * 0.5)
            dev = dem - (other_state + re) - prof["schedule"] - direction_sign * held
            sd_dem = 0.006 * dem * math.sqrt(b)
            sd_re = 0.08 * re * math.sqrt(b)
            sd = math.hypot(sd_dem, sd_re)
            ace = -dev
            row = {
                "ts": ts,
                "block": Clock.block_of(ts),
                "label": Clock.hhmmss(ts)[:5],
                "demand": {"p10": dem - Z90 * sd_dem, "p50": dem, "p90": dem + Z90 * sd_dem},
                "re": {"p10": max(0.0, re - Z90 * sd_re), "p50": re, "p90": re + Z90 * sd_re},
                "deviation": {"p10": dev - Z90 * sd, "p50": dev, "p90": dev + Z90 * sd},
                "ace": {"p10": ace - Z90 * sd, "p50": ace, "p90": ace + Z90 * sd},
            }
            if b in (1, 2, 4):
                # predicted line loading: scale today's bus loads by the demand ratio
                ratio = dem / s.demand_mw if s.demand_mw else 1.0
                inj = {k: -v * ratio for k, v in s.bus_load.items()}
                re_ratio = re / s.re_mw if s.re_mw else 1.0
                for g in t.generators:
                    v = s.gen_output.get(g["id"], 0.0)
                    inj[g["bus"]] += v * (re_ratio if g["type"] in ("solar", "wind") else 1.0)
                flow = solve(inj, s.outaged)
                for lid, v in flow.loading.items():
                    if v >= 0.95:
                        violations.append({"line": lid, "label": t.line_label(lid), "loading": v, "ts": ts, "lead_min": b * 15})
                row["max_line"] = {"line": flow.max_line, "label": t.line_label(flow.max_line), "loading": flow.max_loading}
            if abs(ace) >= 100 or row["ace"]["p10"] <= -300 or row["ace"]["p90"] >= 300:
                violations.append({"kind": "ACE", "label": f"ACE P50 {ace:+.0f} MW", "ace_p50": ace, "ts": ts, "lead_min": b * 15})
            out.append(row)
        self.pending.append((start + BLOCK_S, out[0]["demand"]["p50"]))
        # dedupe line violations: keep earliest per line
        seen: dict[str, dict] = {}
        for v in violations:
            key = v.get("line") or "ACE"
            if key not in seen:
                seen[key] = v
        self.last = {
            "generated_at": s.ts,
            "blocks": out,
            "violations": sorted(seen.values(), key=lambda v: v["lead_min"]),
            "accuracy": {"mape_1block_pct": round(sum(self.errors) / len(self.errors), 2) if self.errors else None, "samples": len(self.errors)},
            "model": "profile × decaying intraday level (P10/P50/P90)",
        }
        return self.last
