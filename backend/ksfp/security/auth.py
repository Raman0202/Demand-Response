"""Authentication (PBKDF2 password hashes + short-lived JWT) and role-based access control.

Production: front this with the utility identity provider (OIDC / LDAP) and keep RBAC here.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from dataclasses import dataclass

import jwt

ROLES: dict[str, set[str]] = {
    "operator": {"view", "ack_alarm", "approve", "reject", "abort", "whatif"},
    "shift_in_charge": {"view", "ack_alarm", "shelve_alarm", "approve", "approve_dual", "reject", "abort", "autonomy", "whatif", "resources"},
    "analyst": {"view", "whatif", "reports"},
    "engineer": {"view", "ack_alarm", "whatif", "reports", "config", "simulator", "resources"},
    "admin": {"view", "ack_alarm", "shelve_alarm", "approve", "approve_dual", "reject", "abort", "autonomy", "whatif", "reports", "config", "simulator", "resources", "users"},
}

ROLE_LABEL = {
    "operator": "Shift Operator",
    "shift_in_charge": "Shift-in-Charge",
    "analyst": "Analyst",
    "engineer": "Engineer",
    "admin": "Administrator",
}

DEMO_USERS = [
    ("operator", "operator", "Shift Operator (demo)"),
    ("sic", "shift_in_charge", "Shift-in-Charge (demo)"),
    ("analyst", "analyst", "Analyst (demo)"),
    ("engineer", "engineer", "Engineer (demo)"),
    ("admin", "admin", "Administrator (demo)"),
]


def hash_password(password: str, salt: bytes | None = None, rounds: int = 200_000) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, rounds)
    return f"pbkdf2_sha256${rounds}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, dk = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(test.hex(), dk)
    except Exception:
        return False


@dataclass
class Principal:
    username: str
    role: str
    display: str

    @property
    def permissions(self) -> set[str]:
        return ROLES.get(self.role, set())

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    def to_dict(self) -> dict:
        return {"username": self.username, "role": self.role, "role_label": ROLE_LABEL.get(self.role, self.role), "display": self.display, "permissions": sorted(self.permissions)}


def issue_token(p: Principal, secret: str, ttl_min: int) -> str:
    now = int(time.time())
    return jwt.encode({"sub": p.username, "role": p.role, "name": p.display, "iat": now, "exp": now + ttl_min * 60}, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> Principal:
    data = jwt.decode(token, secret, algorithms=["HS256"])
    return Principal(data["sub"], data["role"], data.get("name", data["sub"]))
