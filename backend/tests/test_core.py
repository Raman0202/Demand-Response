"""Core engine tests: grid physics, DSM, LP, twin, policy, alarms, audit, KPTCL parsing, closed loop."""

from pathlib import Path

from ksfp.act.dispatch import CommandManager
from ksfp.audit.log import AuditLog
from ksfp.core.clock import Clock
from ksfp.decide.engine import DecisionEngine
from ksfp.decide.flexibility import evaluate
from ksfp.decide.optimizer import optimize
from ksfp.decide.policy import AutonomyPolicy
from ksfp.decide.twin import simulate
from ksfp.detect.alarms import AlarmManager, Condition
from ksfp.grid.dsm import Prices, dsm_charge, normal_rate
from ksfp.grid.network import solve
from ksfp.grid.state import assess
from ksfp.grid.topology import topology
from ksfp.ingest.estimator import estimate
from ksfp.ingest.field import Disturbance, SimulatedField
from ksfp.ingest.kptcl import KptclSource
from ksfp.ingest.quality import QualityLayer

FIX = Path(__file__).parent / "fixtures"


def base_injection(demand=17200.0):
    t = topology()
    share = sum(b["loadShare"] for b in t.internal)
    inj = {b["id"]: -demand * b["loadShare"] / share for b in t.internal}
    for g in t.generators:
        inj[g["bus"]] += g["baseMW"]
    return inj


def run_field(disturbances=(), seconds=180, start="15:00", step=5):
    c = Clock(1, start)
    f = SimulatedField(c, auto_disturbances=False)
    q = QualityLayer()
    t0 = c.now()
    for d in disturbances:
        d.start = t0 + d.start  # start is an offset (s) from the beginning of the run
        f.add(d)
    s = None
    for i in range(0, seconds, step):
        now = t0 + i
        f.step(now)
        s = estimate(q.process(f.read(now), now), now, q)
    return f, q, s


# ------------------------------------------------------------------ grid & DSM
def test_dsm_normal_rate_and_energy_basis():
    p = Prices(5.4, 7.2, 8.1)
    nr = normal_rate(p)
    assert nr.nr == 7.2 and nr.binding == "B"
    r = dsm_charge(22, 500, 49.95, Prices(5, 5, 5))
    assert abs(r.energy_mwh - 5.5) < 1e-9
    assert abs(r.amount_rs - 27500) < 1e-6  # 5.5 MWh × 1000 × ₹5 × 1.0


def test_power_flow_balanced_and_islanding_detected():
    r = solve(base_injection())
    assert abs(sum(v for k, v in r.injections.items() if k.startswith("X_")) - 5500) < 1  # ties carry net import
    r2 = solve(base_injection(), ("L4", "L40"))
    assert set(r2.islanded) == {"KOL", "X_TAL"}


def test_base_case_balanced_and_disturbance_alerts():
    _, _, s = run_field()
    a = assess(s)
    assert a.severity == "NORMAL" and abs(a.ace.ace) < 100
    _, _, s2 = run_field([Disturbance("re_drop", {"mw": 900}, 0, 3600, 30)], 300)
    a2 = assess(s2)
    assert a2.direction == "UP" and a2.requirement_mw > 500


def test_quality_layer_flags_stale_and_degrades_confidence():
    _, _, s = run_field([Disturbance("telemetry_loss", {"buses": ["NEL", "SOM"]}, 60, 3600, 0)], 300)
    assert s.quality.get("bus.NEL.load") == "STALE"
    assert s.confidence < 0.95


# ------------------------------------------------------------------ optimizer, twin, policy
def _assess_event():
    _, _, s = run_field([Disturbance("re_drop", {"mw": 800}, 0, 3600, 30), Disturbance("line_trip", {"line": "L4"}, 0, 3600, 0)], 120)
    a = assess(s)
    evals = [evaluate(x, a, 4, x["reliability"]) for x in topology().assets]
    return a, evals


def test_lp_covers_requirement_without_overcorrection():
    a, evals = _assess_event()
    p = optimize(a, evals, a.requirement_mw)
    assert p.solver["status"] == 0
    assert 95 <= p.coverage_pct <= 110
    assert p.costs["savings_rs"] > 0
    for al in p.allocations:  # respects availability
        e = next(x for x in evals if x.id == al.asset_id) if al.asset_id != "RTM" else None
        if e:
            assert max(al.mw_by_block) <= e.available_mw + 1e-6


def test_lp_does_not_worsen_lines_within_limits():
    a, evals = _assess_event()
    base = a.state.flow.loading
    p = optimize(a, evals, a.requirement_mw)
    for lid, v in p.loading_after.items():
        if base[lid] <= 1.0:
            assert v <= 1.0 + 1e-3, lid


def test_twin_removes_asset_with_lost_heartbeat():
    _, _, s = run_field([Disturbance("re_drop", {"mw": 800}, 0, 3600, 30), Disturbance("comms_loss", {"assets": ["A_HAG"]}, 0, 3600, 0)], 300)
    a = assess(s)
    evals = [evaluate(x, a, 4, x["reliability"]) for x in topology().assets]
    p = optimize(a, evals, a.requirement_mw)
    assert any(al.asset_id == "A_HAG" for al in p.allocations)
    tw = simulate(p, a, evals, {})
    assert "A_HAG" in tw.exclude and not tw.ok


def test_policy_envelope_and_degradation():
    pol = AutonomyPolicy(level=2)
    allocs = [{"id": "A_PBESS", "type": "bess", "mw": 90}, {"id": "A_HAG", "type": "shiftable", "mw": 100}]
    c = pol.classify(allocs, "ALERT", 0.99, True)
    assert c["auto"] == ["A_PBESS"] and c["approval"] == ["A_HAG"]
    c2 = pol.classify(allocs, "ALERT", 0.5, True)  # low data confidence → advisory
    assert c2["auto"] == [] and c2["level"] == 1
    pol.suspended = True
    assert pol.classify(allocs, "ALERT", 0.99, True)["auto"] == []


# ------------------------------------------------------------------ alarms & audit
def test_alarm_on_delay_and_incident_correlation():
    am = AlarmManager()
    c1 = Condition("ACE:STATE", "ACE", "BALANCE", 2, "ACE -400", "", on_delay=30)
    assert am.evaluate([c1], 0) == []
    raised = am.evaluate([c1], 31)
    assert len(raised) == 1
    c2 = Condition("FREQ:LOW", "FREQ_LOW", "BALANCE", 2, "f low", "", on_delay=0)
    am.evaluate([c1, c2], 40)
    incs = [i for i in am.incidents.values() if i.open]
    assert len(incs) == 1 and len(incs[0].alarm_ids) == 2
    am.evaluate([], 200)  # condition false → off-delay starts
    am.evaluate([], 261)
    assert all(a.state == "CLEARED" for a in am.alarms.values())


def test_audit_chain_detects_tampering():
    log = AuditLog()
    for i in range(5):
        log.append(float(i), "EVENT", "test", f"entry {i}")
    rows = [e.to_dict() for e in log.entries]
    assert AuditLog.verify(rows)["ok"]
    rows[2]["message"] = "tampered"
    v = AuditLog.verify(rows)
    assert not v["ok"] and v["broken_at"] == 3


# ------------------------------------------------------------------ KPTCL adapter
def test_kptcl_parser_maps_all_discoms_and_generation():
    k = KptclSource()
    for url, st in k.status.items():
        if st.kind == "load" and "bescom" in url:
            k.ingest_html(st, (FIX / "discom_sample.html").read_text(), 0)
        if st.kind == "gen":
            k.ingest_html(st, (FIX / "stategen_sample.html").read_text(), 0)
    v = k.values
    assert v["ch.load.LD_PEENYA"] == 312.5
    for ch in ("LD_KAVOOR__MANGALURU", "LD_BELAGAVI", "LD_KALABURAGI", "LD_KADAKOLA__MYSURU"):  # MESCOM/HESCOM/GESCOM/CESC tables
        assert f"ch.load.{ch}" in v
    assert v["ch.gen.GS_RAICHUR_TPS"] == 1240.0  # actual generation, not installed capacity
    assert k.system["sys.frequency"] == 49.97
    assert any(u["label"] == "New Station XYZ" for u in k.unmapped.values())
    assert "ch.load.TOTAL" not in v


# ------------------------------------------------------------------ closed loop
def test_closed_loop_supervised_autonomy_resolves_event():
    c = Clock(1, "14:58")
    f = SimulatedField(c, auto_disturbances=False)
    q = QualityLayer()
    cm = CommandManager("k")
    eng = DecisionEngine(cm, AutonomyPolicy(level=3), {a["id"]: a["reliability"] for a in topology().assets})
    t0 = c.now()
    f.add(Disturbance("re_drop", {"mw": 700}, t0 + 60, 45 * 60, 240))
    worst = 0.0
    for i in range(0, 110 * 60, 20):
        now = t0 + i
        f.step(now)
        s = estimate(q.process(f.read(now), now), now, q)
        a = assess(s)
        eng.step(a, now, None, None)
        cm.tick(now, f, s.asset_state)
        if 20 * 60 < i < 45 * 60:
            worst = max(worst, abs(a.ace.ace))
    d = list(eng.decisions.values())[0]
    assert worst < 400  # autonomy held ACE well below the ~700 MW disturbance
    assert d.state == "COMPLETED" and d.settlement and d.settlement["avoided_dsm_rs"] > 0
