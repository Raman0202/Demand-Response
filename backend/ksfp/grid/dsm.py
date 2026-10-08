"""CERC DSM rule engine (DSM Regulations 2024 structure: energy-based, per 15-min block).

The multiplier table is configuration. Defaults are ILLUSTRATIVE — load the notified table
(with amendments) through the configuration API before operational use.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class Prices:
    dam_acp: float = 5.4  # ₹/kWh, weighted avg ACP of integrated DAM
    rtm_acp: float = 7.2  # ₹/kWh, RTM
    asc: float = 8.1  # ₹/kWh, ancillary service charge
    off_peak: float = 3.2  # ₹/kWh, recharge / rebound energy


DEFAULT_DSM: dict = {
    "version": "illustrative-2024-structure",
    "buyer_category": "Drawee buyer (state control area)",
    "freq_low": 49.90,
    "freq_high": 50.05,
    "band_pct": 10.0,
    "band_cap_mw": 100.0,
    # multipliers of NR: [within band, beyond band]
    "overdrawal": {"LOW": [1.5, 2.0], "NORMAL": [1.0, 1.5], "HIGH": [0.5, 1.0]},
    "underdrawal": {"LOW": [1.0, 0.5], "NORMAL": [0.9, 0.0], "HIGH": [0.0, 0.0]},
}


@dataclass
class NormalRate:
    A: float
    B: float
    C: float
    nr: float
    binding: str


def normal_rate(p: Prices) -> NormalRate:
    A, B = p.dam_acp, p.rtm_acp
    C = (p.dam_acp + p.rtm_acp + p.asc) / 3
    nr = max(A, B, C)
    return NormalRate(A, B, C, nr, "A" if nr == A else "B" if nr == B else "C")


def freq_band(f: float, cfg: dict) -> str:
    return "LOW" if f < cfg["freq_low"] else "HIGH" if f >= cfg["freq_high"] else "NORMAL"


@dataclass
class DsmResult:
    deviation_mw: float
    deviation_pct: float
    energy_mwh: float
    freq_band: str
    band_mw: float
    within_mw: float
    beyond_mw: float
    mult_within: float
    mult_beyond: float
    amount_rs: float  # per block; + payable by the state, − receivable
    nr: NormalRate
    marginal_rate: float

    def to_dict(self) -> dict:
        return asdict(self)


def dsm_charge(deviation_mw: float, schedule_mw: float, frequency: float, prices: Prices, cfg: dict | None = None, block_h: float = 0.25) -> DsmResult:
    cfg = cfg or DEFAULT_DSM
    nr = normal_rate(prices)
    fb = freq_band(frequency, cfg)
    band = min(schedule_mw * cfg["band_pct"] / 100, cfg["band_cap_mw"])
    a = abs(deviation_mw)
    within, beyond = min(a, band), max(0.0, a - band)
    m1, m2 = cfg["overdrawal" if deviation_mw >= 0 else "underdrawal"][fb]
    amt = within * block_h * 1000 * m1 * nr.nr + beyond * block_h * 1000 * m2 * nr.nr
    return DsmResult(
        deviation_mw=deviation_mw,
        deviation_pct=deviation_mw / schedule_mw * 100 if schedule_mw else 0.0,
        energy_mwh=a * block_h,
        freq_band=fb,
        band_mw=band,
        within_mw=within,
        beyond_mw=beyond,
        mult_within=m1,
        mult_beyond=m2,
        amount_rs=amt if deviation_mw >= 0 else -amt,
        nr=nr,
        marginal_rate=(m2 if beyond > 0 else m1) * nr.nr,
    )
