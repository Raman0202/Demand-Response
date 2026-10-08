"""Minimal Prometheus exposition (no external dependency)."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class Metrics:
    gauges: dict[str, float] = field(default_factory=dict)
    counters: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    help: dict[str, str] = field(default_factory=dict)

    def set(self, name: str, value: float, help_: str = "") -> None:
        self.gauges[name] = float(value)
        if help_:
            self.help[name.split("{")[0]] = help_

    def inc(self, name: str, by: float = 1.0, help_: str = "") -> None:
        self.counters[name] += by
        if help_:
            self.help[name.split("{")[0]] = help_

    def render(self) -> str:
        lines = []
        seen = set()
        for kind, store in (("gauge", self.gauges), ("counter", self.counters)):
            for name, v in sorted(store.items()):
                base = name.split("{")[0]
                if base not in seen:
                    if base in self.help:
                        lines.append(f"# HELP {base} {self.help[base]}")
                    lines.append(f"# TYPE {base} {kind}")
                    seen.add(base)
                lines.append(f"{name} {v}")
        return "\n".join(lines) + "\n"
