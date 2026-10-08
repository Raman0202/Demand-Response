"""Append-only, SHA-256 hash-chained audit trail. Tampering with any entry breaks the chain."""

from __future__ import annotations

import hashlib
import json
from collections import deque
from dataclasses import asdict, dataclass, field

GENESIS = "0" * 64


@dataclass
class AuditEntry:
    seq: int
    ts: float  # sim/system clock
    kind: str  # EVENT | ANALYSIS | TWIN | APPROVAL | COMMAND | ACK | ALARM | OVERRIDE | CONFIG | SETTLEMENT | SECURITY | SYSTEM
    actor: str
    ref: str | None
    message: str
    prev: str
    hash: str

    def to_dict(self) -> dict:
        return asdict(self)


def digest(prev: str, seq: int, ts: float, kind: str, actor: str, ref: str | None, message: str) -> str:
    payload = json.dumps([prev, seq, round(ts, 3), kind, actor, ref, message], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


@dataclass
class AuditLog:
    entries: deque = field(default_factory=lambda: deque(maxlen=20000))
    seq: int = 0
    head: str = GENESIS
    outbox: list[AuditEntry] = field(default_factory=list)  # persisted by the store writer

    def restore(self, seq: int, head: str) -> None:
        self.seq, self.head = seq, head

    def append(self, ts: float, kind: str, actor: str, message: str, ref: str | None = None) -> AuditEntry:
        self.seq += 1
        h = digest(self.head, self.seq, ts, kind, actor, ref, message)
        e = AuditEntry(self.seq, ts, kind, actor, ref, message, self.head, h)
        self.head = h
        self.entries.append(e)
        self.outbox.append(e)
        return e

    @staticmethod
    def verify(entries: list[dict]) -> dict:
        """Verify an ordered (by seq) list of entries. Returns {ok, checked, broken_at}."""
        prev = None
        for e in entries:
            if prev is not None and e["prev"] != prev:
                return {"ok": False, "checked": e["seq"], "broken_at": e["seq"], "reason": "prev-hash mismatch"}
            if digest(e["prev"], e["seq"], e["ts"], e["kind"], e["actor"], e["ref"], e["message"]) != e["hash"]:
                return {"ok": False, "checked": e["seq"], "broken_at": e["seq"], "reason": "content hash mismatch"}
            prev = e["hash"]
        return {"ok": True, "checked": len(entries), "broken_at": None}
