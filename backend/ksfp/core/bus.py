"""In-process event bus (topic pub/sub over bounded asyncio queues).

This is the seam for horizontal scaling: an adapter with the same publish/subscribe
contract over Redis Streams or Kafka can replace it without touching modules.
"""
from __future__ import annotations

import asyncio
import fnmatch
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Subscription:
    pattern: str
    queue: asyncio.Queue
    dropped: int = 0


@dataclass
class EventBus:
    maxsize: int = 1000
    subs: list[Subscription] = field(default_factory=list)
    published: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def subscribe(self, pattern: str, maxsize: int | None = None) -> Subscription:
        sub = Subscription(pattern, asyncio.Queue(maxsize or self.maxsize))
        self.subs.append(sub)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        if sub in self.subs:
            self.subs.remove(sub)

    def publish(self, topic: str, payload: Any) -> None:
        self.published[topic.split(".")[0]] += 1
        for s in self.subs:
            if fnmatch.fnmatch(topic, s.pattern):
                if s.queue.full():  # backpressure: drop oldest, count it
                    try:
                        s.queue.get_nowait()
                        s.dropped += 1
                    except asyncio.QueueEmpty:
                        pass
                s.queue.put_nowait((topic, payload))

    @property
    def dropped(self) -> int:
        return sum(s.dropped for s in self.subs)
