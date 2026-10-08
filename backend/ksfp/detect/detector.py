"""Detection rules + statistical anomaly detection → alarm conditions (evaluated every tick)."""

from __future__ import annotations

from dataclasses import dataclass

from ..grid.state import Assessment
from ..grid.topology import topology
from .alarms import Condition


@dataclass
class AnomalyDetector:
    """EWMA z-score on the demand forecast residual (actual − 1-block forecast)."""

    mean: float = 0.0
    var: float = 2500.0
    alpha: float = 0.02
    warm: int = 0

    def update(self, residual: float) -> float:
        z = (residual - self.mean) / (self.var**0.5 or 1.0)
        if abs(z) < 4 or self.warm < 60:  # learn only from normal behaviour
            self.mean = (1 - self.alpha) * self.mean + self.alpha * residual
            self.var = (1 - self.alpha) * self.var + self.alpha * (residual - self.mean) ** 2
        self.warm += 1
        return z if self.warm > 60 else 0.0


def conditions(
    a: Assessment,
    forecast: dict | None,
    anomaly_z: float,
    autonomy: dict,
    asset_issues: list[tuple[str, str, int]],
    decision_assets: set[str],
) -> list[Condition]:
    t = topology()
    s = a.state
    out: list[Condition] = []
    f = s.frequency
    if f < 49.8:
        out.append(Condition("FREQ:LOW", "FREQ_LOW", "BALANCE", 1, "Frequency below 49.80 Hz", f"f = {f:.3f} Hz — emergency band", f, on_delay=10))
    elif f < 49.9:
        out.append(Condition("FREQ:LOW", "FREQ_LOW", "BALANCE", 2, "Frequency below IEGC band", f"f = {f:.3f} Hz (< 49.90)", f, on_delay=20))
    elif f > 50.05:
        out.append(Condition("FREQ:HIGH", "FREQ_HIGH", "BALANCE", 3, "Frequency above IEGC band", f"f = {f:.3f} Hz (> 50.05)", f, on_delay=30))
    ace = a.ace.ace
    if abs(ace) >= 1000:
        out.append(Condition("ACE:STATE", "ACE", "BALANCE", 1, f"ACE {ace:+.0f} MW", f"Control area {'short' if ace < 0 else 'long'} by {abs(ace):.0f} MW", ace, on_delay=20))
    elif abs(ace) >= 300:
        out.append(Condition("ACE:STATE", "ACE", "BALANCE", 2, f"ACE {ace:+.0f} MW", f"Control area {'short' if ace < 0 else 'long'} by {abs(ace):.0f} MW", ace, on_delay=30))
    elif abs(ace) >= 100:
        out.append(Condition("ACE:STATE", "ACE", "BALANCE", 3, f"ACE {ace:+.0f} MW", f"Control area {'short' if ace < 0 else 'long'} by {abs(ace):.0f} MW", ace, on_delay=60))
    for lid, v in s.flow.loading.items():
        if v >= 1.0:
            out.append(Condition(f"LINE:{lid}", "LINE_OVERLOAD", "NETWORK", 1, f"Overload {t.line_label(lid)}", f"{v * 100:.0f}% of {t.line(lid)['limitMW']} MW", v, on_delay=20))
        elif v >= 0.9:
            out.append(Condition(f"LINE:{lid}", "LINE_HIGH", "NETWORK", 3, f"High loading {t.line_label(lid)}", f"{v * 100:.0f}%", v, on_delay=60))
    for lid in s.outaged:
        out.append(Condition(f"OUTAGE:{lid}", "LINE_OUTAGE", "NETWORK", 2, f"Line out of service: {t.line_label(lid)}", "breaker open (SCADA)", None, on_delay=0))
    if s.flow.islanded:
        out.append(Condition("ISLAND", "ISLAND", "NETWORK", 1, "Network islanding detected", ", ".join(s.flow.islanded), None, on_delay=0))
    if s.confidence < 0.8:
        out.append(Condition("DATA:CONF", "DATA_CONFIDENCE", "DATA", 2, f"Data confidence {s.confidence * 100:.0f}%", "State estimate degraded — autonomy limited", s.confidence, on_delay=10))
    elif s.confidence < 0.97:
        out.append(Condition("DATA:CONF", "DATA_CONFIDENCE", "DATA", 3, f"Data confidence {s.confidence * 100:.0f}%", "Some telemetry substituted or stale", s.confidence, on_delay=30))
    for key, q in s.quality.items():
        if q in ("STALE", "MISSING"):
            out.append(Condition(f"POINT:{key}", "POINT_STALE", "DATA", 3, f"Telemetry {q.lower()}: {key}", "value estimated from remaining measurements", None, on_delay=30))
    for aid, kind, prio in asset_issues:
        name = t.asset(aid)["short"]
        if kind == "comms":
            p = 2 if aid in decision_assets else prio
            out.append(Condition(f"ASSET:{aid}:COMMS", "ASSET_COMMS", "ASSET", p, f"Heartbeat lost: {name}", "no gateway heartbeat for >60 s", None, on_delay=30))
        elif kind == "under":
            out.append(Condition(f"ASSET:{aid}:UNDER", "UNDER_DELIVERY", "ASSET", 2, f"Under-delivery: {name}", "< 70 % of expected response", None, on_delay=0))
    if abs(anomaly_z) >= 4:
        out.append(Condition("ANOMALY:DEMAND", "ANOMALY", "BALANCE", 3, "Demand anomaly", f"forecast residual z = {anomaly_z:+.1f}", anomaly_z, on_delay=30))
    if forecast:
        for v in forecast.get("violations", []):
            if v.get("line") and v["loading"] >= 1.0 and v["lead_min"] <= 30:
                out.append(Condition(f"PRED:{v['line']}", "PREDICTED_OVERLOAD", "FORECAST", 3, f"Predicted overload {v['label']}", f"{v['loading'] * 100:.0f}% in {v['lead_min']} min (P50)", v["loading"], on_delay=60))
    if autonomy.get("degraded"):
        out.append(Condition("AUTONOMY:DEGRADED", "AUTONOMY_DEGRADED", "AUTONOMY", 2, "Autonomy degraded to advisory", "; ".join(autonomy.get("reasons", [])), None, on_delay=0))
    if autonomy.get("suspended"):
        out.append(Condition("AUTONOMY:SUSPENDED", "AUTONOMY_SUSPENDED", "AUTONOMY", 3, "Autonomy suspended", autonomy.get("suspended_reason") or "", None, on_delay=0))
    if autonomy.get("loop_slow"):
        out.append(Condition("PLATFORM:LOOP", "LOOP_LATENCY", "AUTONOMY", 2, "Control loop latency high", f"{autonomy.get('loop_ms', 0):.0f} ms", None, on_delay=0))
    return out
