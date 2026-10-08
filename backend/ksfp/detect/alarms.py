"""Alarm management (ISA-18.2 style) + incident correlation.

Conditions are evaluated every tick. An alarm is raised only after its condition has held
for `on_delay`, and cleared after it has been false for `off_delay` (chatter suppression).
Acknowledgement and shelving are independent of the condition state. Alarms of the same
category raised close together are correlated into one incident.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field

CATEGORY_TITLES = {
    "BALANCE": "State balance",
    "NETWORK": "Network constraint",
    "DATA": "Data quality",
    "ASSET": "Resource / comms",
    "AUTONOMY": "Autonomy & platform",
    "FORECAST": "Predicted risk",
}


@dataclass
class Condition:
    key: str  # rule:subject — identity for de-duplication
    rule: str
    category: str
    priority: int  # 1 critical · 2 high · 3 medium · 4 low
    title: str
    detail: str
    value: float | None = None
    on_delay: float = 30.0  # sim seconds
    off_delay: float = 60.0


@dataclass
class Alarm:
    id: str
    key: str
    rule: str
    category: str
    priority: int
    title: str
    detail: str
    value: float | None
    raised_at: float
    last_seen: float
    state: str = "ACTIVE"  # ACTIVE | CLEARED
    acked: bool = False
    acked_by: str | None = None
    acked_at: float | None = None
    shelved_until: float | None = None
    cleared_at: float | None = None
    count: int = 1
    incident_id: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Incident:
    id: str
    category: str
    title: str
    opened_at: float
    priority: int
    alarm_ids: list[str] = field(default_factory=list)
    closed_at: float | None = None
    decision_id: str | None = None

    @property
    def open(self) -> bool:
        return self.closed_at is None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class AlarmManager:
    alarms: dict[str, Alarm] = field(default_factory=dict)  # id → alarm
    by_key: dict[str, str] = field(default_factory=dict)  # key → active alarm id
    incidents: dict[str, Incident] = field(default_factory=dict)
    pending_on: dict[str, float] = field(default_factory=dict)
    pending_off: dict[str, float] = field(default_factory=dict)
    changed: list[Alarm] = field(default_factory=list)

    def evaluate(self, conditions: list[Condition], now: float) -> list[Alarm]:
        """Feed the full set of currently-true conditions. Returns alarms raised/updated/cleared this tick."""
        self.changed = []
        true_keys = {c.key: c for c in conditions}
        for key, c in true_keys.items():
            self.pending_off.pop(key, None)
            aid = self.by_key.get(key)
            if aid:
                a = self.alarms[aid]
                a.last_seen, a.value, a.detail = now, c.value, c.detail
                if c.priority < a.priority:  # escalation
                    a.priority, a.title = c.priority, c.title
                    a.acked = False
                    self.changed.append(a)
                continue
            first = self.pending_on.setdefault(key, now)
            if now - first >= c.on_delay:
                self.pending_on.pop(key, None)
                self._raise(c, now)
        for key in list(self.pending_on):
            if key not in true_keys:
                self.pending_on.pop(key)
        for key, aid in list(self.by_key.items()):
            if key in true_keys:
                continue
            a = self.alarms[aid]
            first = self.pending_off.setdefault(key, now)
            off_delay = 60.0
            if now - first >= off_delay:
                self.pending_off.pop(key, None)
                a.state, a.cleared_at = "CLEARED", now
                del self.by_key[key]
                self.changed.append(a)
        self._close_incidents(now)
        return self.changed

    def event(self, c: Condition, now: float) -> Alarm:
        """One-shot alarm (e.g. command failure). Stays ACTIVE until acknowledged, then clears."""
        a = self._raise(c, now)
        a.rule = c.rule
        return a

    def _raise(self, c: Condition, now: float) -> Alarm:
        a = Alarm(
            id="AL-" + uuid.uuid4().hex[:8].upper(),
            key=c.key,
            rule=c.rule,
            category=c.category,
            priority=c.priority,
            title=c.title,
            detail=c.detail,
            value=c.value,
            raised_at=now,
            last_seen=now,
        )
        self.alarms[a.id] = a
        if not c.key.startswith("event:"):
            self.by_key[c.key] = a.id
        inc = next((i for i in self.incidents.values() if i.open and i.category == c.category and now - i.opened_at < 3600), None)
        if inc is None:
            inc = Incident(
                id="IN-" + uuid.uuid4().hex[:6].upper(),
                category=c.category,
                title=f"{CATEGORY_TITLES.get(c.category, c.category)}: {c.title}",
                opened_at=now,
                priority=c.priority,
            )
            self.incidents[inc.id] = inc
        inc.alarm_ids.append(a.id)
        inc.priority = min(inc.priority, c.priority)
        a.incident_id = inc.id
        self.changed.append(a)
        return a

    def _close_incidents(self, now: float) -> None:
        for inc in self.incidents.values():
            if inc.open and all(self.alarms[x].state == "CLEARED" for x in inc.alarm_ids):
                inc.closed_at = now

    def ack(self, alarm_id: str, user: str, now: float) -> Alarm:
        a = self.alarms[alarm_id]
        a.acked, a.acked_by, a.acked_at = True, user, now
        if a.key.startswith("event:") and a.state == "ACTIVE":
            a.state, a.cleared_at = "CLEARED", now
        self._close_incidents(now)
        return a

    def shelve(self, alarm_id: str, user: str, until: float) -> Alarm:
        a = self.alarms[alarm_id]
        a.shelved_until = until
        a.acked, a.acked_by = True, user
        return a

    def active(self, now: float, include_shelved: bool = False) -> list[Alarm]:
        out = [a for a in self.alarms.values() if a.state == "ACTIVE" or not a.acked]
        if not include_shelved:
            out = [a for a in out if not a.shelved_until or a.shelved_until < now]
        return sorted(out, key=lambda a: (a.priority, a.acked, -a.raised_at))

    def is_active(self, rule_prefix: str) -> bool:
        return any(k.startswith(rule_prefix) for k in self.by_key)

    def prune(self, keep: int = 2000) -> None:
        if len(self.alarms) <= keep:
            return
        done = sorted((a for a in self.alarms.values() if a.state == "CLEARED" and a.acked), key=lambda a: a.raised_at)
        for a in done[: len(self.alarms) - keep]:
            self.alarms.pop(a.id, None)
