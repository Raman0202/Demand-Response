"""State estimator: quality-checked telemetry → consistent GridState (+ DC power flow).

Missing bus loads are estimated from the remaining measurements scaled by load share, so a
single failed RTU degrades confidence instead of corrupting the state.
"""

from __future__ import annotations

from ..grid.dsm import Prices
from ..grid.network import solve
from ..grid.state import GridState
from ..grid.topology import topology
from .quality import QualityLayer


def estimate(values: dict[str, tuple[float | None, str]], now: float, quality: QualityLayer) -> GridState:
    t = topology()
    share_sum = sum(b["loadShare"] for b in t.internal)
    good_load, good_share = 0.0, 0.0
    for b in t.internal:
        v, q = values.get(f"bus.{b['id']}.load", (None, "MISSING"))
        if v is not None and q in ("GOOD", "SUBSTITUTED"):
            good_load += v
            good_share += b["loadShare"]
    per_share = good_load / good_share if good_share else 0.0
    bus_load: dict[str, float] = {}
    for b in t.internal:
        v, q = values.get(f"bus.{b['id']}.load", (None, "MISSING"))
        if v is None or q not in ("GOOD", "SUBSTITUTED"):
            v = per_share * b["loadShare"] if b["loadShare"] > 0 else (v or 0.0)
        bus_load[b["id"]] = float(v)
    gen_output = {g["id"]: float(values.get(f"gen.{g['id']}.mw", (g["baseMW"], "MISSING"))[0] or 0.0) for g in t.generators}
    gen_by_type: dict[str, float] = {}
    state_gen = central = 0.0
    for g in t.generators:
        gen_by_type[g["type"]] = gen_by_type.get(g["type"], 0.0) + gen_output[g["id"]]
        if g["owner"] == "Central":
            central += gen_output[g["id"]]
        else:
            state_gen += gen_output[g["id"]]
    demand = sum(bus_load.values())
    inj = {b: -v for b, v in bus_load.items()}
    for g in t.generators:
        inj[g["bus"]] += gen_output[g["id"]]
    outaged = tuple(ln["id"] for ln in t.lines if (values.get(f"line.{ln['id']}.status", (1.0, "GOOD"))[0] or 0) < 0.5)
    flow = solve(inj, outaged)
    freq = values.get("sys.frequency", (50.0, "MISSING"))[0] or 50.0
    schedule = values.get("sys.schedule", (None, "MISSING"))[0]
    if schedule is None:
        schedule = demand - state_gen
    prices = Prices(
        dam_acp=values.get("price.dam", (5.4, ""))[0] or 5.4,
        rtm_acp=values.get("price.rtm", (7.2, ""))[0] or 7.2,
        asc=values.get("price.asc", (8.1, ""))[0] or 8.1,
        off_peak=values.get("price.off_peak", (3.2, ""))[0] or 3.2,
    )
    confidence, issues = QualityLayer.confidence(values)
    asset_state = {}
    for a in t.assets:
        hb = values.get(f"asset.{a['id']}.hb", (None, "MISSING"))[0]
        soc = values.get(f"asset.{a['id']}.soc", (None, "MISSING"))[0]
        mw = values.get(f"asset.{a['id']}.mw", (0.0, "MISSING"))[0] or 0.0
        asset_state[a["id"]] = {
            "mw": float(mw),
            "soc": float(soc) if soc is not None else None,
            "heartbeat_age_s": float(now - hb) if hb is not None else 1e9,
        }
    return GridState(
        ts=now,
        frequency=float(freq),
        demand_mw=demand,
        schedule_mw=float(schedule),
        drawal_mw=demand - state_gen,
        state_gen_mw=state_gen,
        central_gen_mw=central,
        re_mw=gen_by_type.get("solar", 0.0) + gen_by_type.get("wind", 0.0),
        gen_by_type=gen_by_type,
        gen_output=gen_output,
        bus_load=bus_load,
        prices=prices,
        outaged=outaged,
        flow=flow,
        confidence=confidence,
        quality=issues,
        asset_state=asset_state,
    )
