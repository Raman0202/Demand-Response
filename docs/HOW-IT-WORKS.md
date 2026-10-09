# How the Demand Response Platform works

This document explains what the platform does on every tick, which strategies it weighs, and exactly how each number on screen is calculated. Formulas are taken from the backend source (`backend/ksfp/…`); file references are given so each one can be checked.

> **Illustrative values.** DSM multipliers, prices, participant bids and reliabilities ship as demo data. Load the notified DSM table through Administration (`PUT /api/v1/admin/config/dsm`) before operational use.

---

## 1. The problem it solves

A state control area (here, Karnataka/KPTCL SLDC) must draw from the inter-state grid exactly what it scheduled. Any difference is a **deviation**, settled block by block (15 minutes) under the CERC **Deviation Settlement Mechanism (DSM)**:

- **Over-drawal** (drawing more than schedule) is charged, and charged harder outside a tolerance band and when frequency is low.
- **Under-drawal** earns little or nothing, so surplus power is wasted value.
- Large deviations also push frequency out of the IEGC band (49.90–50.05 Hz) and can overload transmission corridors.

Demand response (DR) closes the gap by paying flexible consumers, batteries and generators to move their output for a few blocks. The platform decides **who, how much, when and at what cost**. It then dispatches, proves delivery and settles payment, and uses rotational load shedding only as the last resort.

---

## 2. The loop (every second)

```
SCADA / SLDC feed ─► quality ─► state estimate ─► assess ─► detect/alarms ─► decide ─► dispatch ─► M&V ─► settle ─► audit
                                     ▲                                           │
                                     └──────────── forecast (every sim minute) ◄─┘
```

| Stage | What happens | Code |
| --- | --- | --- |
| Ingest | Simulated field, or the live SLDC website (all DISCOM 220 kV load pages + StateGen) in `hybrid` mode | `ingest/field.py`, `ingest/kptcl.py` |
| Quality | Every point validated and flagged GOOD / SUBSTITUTED / SUSPECT / STALE / MISSING | `ingest/quality.py` |
| Estimate | Consistent grid state; missing bus loads filled in by load share; DC power flow | `ingest/estimator.py`, `grid/network.py` |
| Assess | ACE, severity, direction, requirement, DSM exposure | `grid/state.py`, `grid/dsm.py` |
| Detect | Rule and anomaly alarms with on/off delays, correlated into incidents | `detect/detector.py`, `detect/alarms.py` |
| Decide | Open or revise a DR event: flexibility → LP optimiser → Digital Twin → autonomy policy | `decide/engine.py` |
| Shed | Roster manager proposes rotational shedding for the residual that flexibility can't cover | `decide/shedding.py` |
| Act | Signed setpoint commands, acks, timeouts, dead-band | `act/dispatch.py` |
| M&V / settle | Delivered vs expected energy, avoided DSM, payments, reliability learning | `act/settlement.py` |
| Audit | Every step appended to a SHA-256 hash chain | `audit/log.py` |

Write-behind persistence runs every 10 s, and a watchdog degrades autonomy if the loop slows.

---

## 3. Measuring the grid

### 3.1 Data quality and confidence (`ingest/quality.py`)

Each telemetry point has a range, a maximum plausible rate of change (spike check) and a time-to-live. Quality weights:

| Flag | Weight |
| --- | --- |
| GOOD | 1.00 |
| SUBSTITUTED (last good value, within TTL) | 0.85 |
| SUSPECT (failed range or spike check) | 0.50 |
| STALE (past TTL, estimated) | 0.30 |
| MISSING | 0.00 |

**Data confidence**

```
confidence = 0.25 · w(frequency)
           + 0.60 · Σ_bus w(bus load) · loadShare_bus / Σ loadShare
           + 0.15 · Σ_gen w(gen MW)   · capacity_gen  / Σ capacity
```

- Below **85%**, autonomy drops automatically to advisory (every command needs approval).
- Below 97% a P3 alarm is raised, and below 80% a P2 alarm.

### 3.2 State estimate (`ingest/estimator.py`)

- A missing or bad bus load is estimated as `(Σ good loads / Σ their load shares) × this bus's load share`, so one failed RTU lowers confidence rather than corrupting the state.
- Demand = Σ bus loads. Generation is split into in-state and central share.
- A DC power flow (`grid/network.py`) gives line flows: `flows = H · p`.
  - `p` is net injection at each internal bus.
  - `H` is the PTDF matrix with distributed slack at the inter-state tie buses.
  - `H` is cached per outage set.
- Voltage is a screening estimate: `V ≈ 1.035 − 0.075·(worst adjacent loading)²` pu.

### 3.3 Area Control Error and severity (`grid/state.py`)

IEGC definition:

```
ACE = (Ia − Is) − 10 · Bf · (Fa − Fs)

Ia = −actual drawal       Is = −scheduled drawal
Bf = frequency bias = −160 MW per 0.1 Hz (Karnataka)       Fs = 50.00 Hz
```

- **Negative ACE** means the state is short (over-drawing). Direction is **UP**: reduce load or add supply.
- **Positive ACE** means the state is long. Direction is **DOWN**: absorb surplus.
- **Requirement** = |ACE| MW.

Severity:

| Severity | Condition |
| --- | --- |
| EMERGENCY | f < 49.80 Hz, or \|ACE\| > 1,500 MW |
| ALERT | f < 49.90 or f > 50.05 Hz, or \|ACE\| ≥ 100 MW |
| NORMAL | otherwise |

**Forecast-error reserve (P90 margin)** is the flexibility kept free in case the forecast is wrong:

```
margin = 1.28 · √( (0.5% · demand)² + (6% · renewables)² )
```

### 3.4 DSM charge (`grid/dsm.py`)

**Normal Rate**

```
A  = DAM weighted ACP          (default ₹5.40/kWh)
B  = RTM ACP                   (default ₹7.20/kWh)
C  = (DAM + RTM + ancillary) / 3
NR = max(A, B, C)
```

**Deviation band** (the tolerance; this also sets the load-shedding trigger, §7):

```
band = min(10% of schedule, 100 MW)
```

**Per-block charge** (15 min = 0.25 h):

```
within = min(|dev|, band)        beyond = max(0, |dev| − band)
amount = within · 0.25 h · 1000 · m_within · NR  +  beyond · 0.25 h · 1000 · m_beyond · NR
```

The amount is positive (payable) for over-drawal and negative (receivable) for under-drawal.

**Multipliers** (illustrative 2024 structure):

| Frequency band | Over-drawal within / beyond | Under-drawal within / beyond |
| --- | --- | --- |
| LOW (f < 49.90) | 1.5 / 2.0 | 1.0 / 0.5 |
| NORMAL | 1.0 / 1.5 | 0.9 / 0.0 |
| HIGH (f ≥ 50.05) | 0.5 / 1.0 | 0.0 / 0.0 |

**Marginal DSM rate** is the multiplier of the outermost slice in use × NR. It is the ₹/kWh price that any paid flexibility has to beat.

---

## 4. Seeing ahead: the forecast (`forecast/forecaster.py`)

**Horizon:** 8 blocks (2 hours), each with P10, P50 and P90 values.

**1. Level correction.** Every update learns how far today is running from the day-ahead profile:

```
level_d  ← 0.7·level_d  + 0.3·(actual demand / profile demand)
level_re ← 0.7·level_re + 0.3·(actual RE / profile RE)
```

**2. Forecast for block b.** The correction fades with lead time:

```
decay   = 0.82^b
demand  = profile_demand · (1 + (level_d − 1)·decay)
RE      = profile_RE     · (1 + (level_re − 1)·decay)
dev     = demand − (in-state non-RE gen + RE) − schedule − held_flexibility
ACE_P50 = −dev
```

- `held_flexibility` assumes the DR now delivering stays for 2 blocks, then releases at 50% per block.

**3. Uncertainty** grows with √lead time:

```
σ_demand = 0.6% · demand · √b
σ_RE     = 8%   · RE     · √b
σ        = √(σ_demand² + σ_RE²)
P10/P90  = P50 ∓ 1.2816 · σ
```

**4. Predicted violations.**
- **Lines:** at blocks 1, 2 and 4, bus loads are scaled by the forecast demand ratio and RE output by the RE ratio, the power flow is re-solved, and any line ≥ 95% is flagged.
- **ACE:** a block is flagged when |ACE P50| ≥ 100 MW, or P10 ≤ −300, or P90 ≥ 300.
- Only the earliest violation per line is kept.

**5. Accuracy.** The 1-block-ahead demand forecast is scored against what happened, giving the **MAPE** over the last 96 samples.

**Anomaly detection** (`detect/detector.py`):
- An EWMA z-score runs on the demand forecast residual: α = 0.02, learning only from normal behaviour (|z| < 4).
- |z| ≥ 4 raises a demand-anomaly alarm.

The production ML ensemble (LightGBM / TFT) plugs in behind the same `forecast()` contract, and the accuracy tracker scores whichever model is in use.

---

## 5. Deciding: the DR event engine (`decide/engine.py`)

### 5.1 When an event opens, revises and closes

| Step | Rule |
| --- | --- |
| **Open** | \|ACE\| ≥ **100 MW**, sustained **60 s** (immediately in EMERGENCY); not at autonomy L0; outside the post-event cool-down |
| **Revise** (MPC re-solve) | Every new 15-min block; on a material change in the requirement (> max(80 MW, 25%)); on a command failure; or on escalation to EMERGENCY |
| **Wind down** | Underlying requirement < **60 MW** for 3 consecutive ticks → release resources → close → settle |

**Underlying requirement** is what is actually needed, with our own actions backed out, so the event doesn't switch itself off while it is working:

```
underlying = (ACE in the event's direction) + MW our resources are delivering now + MW currently shed (UP only)
```

Shed MW is counted on purpose: paid flexibility stays sized to the full over-drawal, so load shedding is what gets released first.

Each revision runs these steps:

```
flexibility of every asset ─► LP optimiser (OPTIMAL) ─► Digital Twin ─┬─ pass ─► autonomy policy ─► commands
                                   ▲                                  │
                                   └── exclude / derate, re-solve ◄───┘ fail (up to 4 passes)
```

### 5.2 What each resource can really give (`decide/flexibility.py`)

**Technical headroom** in the event's direction:

| Type | UP (less load / more supply) | DOWN (absorb surplus) |
| --- | --- | --- |
| Demand (interruptible, shiftable, industrial, DER) | baseline − min load | max load − baseline |
| Generation | max − baseline | baseline − min |
| BESS | min(power, usable energy · η_d / duration), where usable = (SoC − SoC_min) · capacity | min(power, room to SoC_max / η_c / duration) |

**Available capacity:**

```
available = min(technical, state contract share + emergency share)
```

- The emergency share is released only in EMERGENCY.
- SRAS/TRAS (ancillary) commitments are **locked** and never dispatched for DR.

**Expected delivery and true cost:**

```
expected       = available · reliability
rebound        = reboundFrac · off-peak price · 0.5            (₹/kWh; load returning after release)
effective cost = (bid + opportunity + rebound) / reliability    (₹ per expected kWh)
```

For BESS discharging, opportunity = off-peak price / (η_c · η_d); for BESS charging, bid = degradation cost. Unreliable resources look more expensive, so they are ranked fairly against reliable ones.

**Timing.** The earliest usable block comes from response time: an asset already delivering, or responding within 15 min, can be used in block 1. The remaining duration budget = max duration − blocks already used.

**Economic DR only in NORMAL.** When severity is NORMAL, a resource whose effective cost ≥ the DSM marginal rate is skipped, because paying it would cost more than the deviation it removes.

### 5.3 The optimiser (`decide/optimizer.py`)

A network-constrained, multi-block linear program, solved with HiGHS. Horizon = 4 blocks (1 hour), re-solved every block (model-predictive control).

**Variables**
- `x[i,b]` — MW commanded from resource i in block b
- `s[b]` — unserved requirement
- `v[l,b]` — overload slack on line l

**Objective**

```
min  Σ (bid + opp + rebound)_i · R_i · x[i,b] · 0.25 h · 1000      ← paid cost of expected energy
   + λ · Σ s[b]                                                     ← unserved, λ = max(3·NR, ₹25/kWh) per MWh
   + μ · Σ v[l,b]                                                   ← overload, μ = 10⁷ (≫ λ)
```

**Constraints**

```
Σ_i R_i·x[i,b] + s[b] ≥ req                            balance (in expected MW)
Σ_i R_i·x[i,b] ≤ 1.05·req + 20                         no over-correction
|f0_l + Σ_i PTDF[l,bus_i]·dir·x[i,b]| − v[l,b] ≤ limit_l   thermal limit, both directions
0 ≤ x[i,b] ≤ available_i ;  x = 0 before earliest block   capacity, response time
x[i,b] − x[i,b−1] ≤ ramp_i · 15 min                     ramp (x[i,−1] = current MW)
Σ_b x[i,b]·0.25/η_d ≤ usable energy                    BESS energy
Σ_b x[i,b] ≤ maxBlocks_i · available_i                 duration budget
```

- `f0` is the base flow with our own current delivery backed out, so each re-solve starts from a "what if we weren't acting" baseline.
- A tiny index tie-break keeps the merit order stable between re-solves.
- **RTM** is offered only for UP, at RTM ACP + ₹0.05/kWh. Because of gate closure it can't deliver before block 5, so in a 4-block horizon it usually shows "beyond this horizon".

**Outputs**
- Allocations by block, ranked by effective cost, with caps explained (energy-limited, max duration, ramp-limited).
- Skipped resources, each with the reason.
- **Binding lines** with their **shadow prices** (₹/MW). These are LP duals: how much one more MW of line capacity would save.
- Coverage, post-dispatch line loading and rebound MW.

**Costs of a plan**

```
resource_rs   = Σ expected MWh · 1000 · unit cost           (paid to DR / BESS / generation)
rtm_rs        = same, for the RTM purchase
rebound_rs    = Σ reboundFrac · expected MWh · 1000 · off-peak price
residual_dsm  = Σ_blocks DSM(deviation − dir · supplied_b)  (DSM still owed; negative = credit)
total_rs      = resource_rs + rtm_rs + rebound_rs + residual_dsm
do_nothing_rs = Σ_blocks DSM(deviation)                      (the counterfactual)
savings_rs    = do_nothing_rs − total_rs
```

### 5.4 Strategies compared (the **Options** tab)

Each strategy is the same LP restricted to a set of resource types:

| Strategy | Resources allowed | When it wins |
| --- | --- | --- |
| **Do nothing** | none | Baseline: absorb the deviation and pay DSM |
| **Buy in RTM** | Real-Time Market | Long events where a ~1 h lead is acceptable |
| **Re-dispatch generation** | Intra-state thermal/hydro headroom | When cheap headroom sits on unconstrained buses |
| **BESS only** | Grid batteries | Fast and short; limited by SoC |
| **Demand response only** | Interruptible, shiftable, industrial, DER | Peaks where consumer flexibility is cheapest |
| **Optimal mix** | All of the above, co-optimised under network limits | Normally chosen; dispatched |

The Options tab pins the chosen plan first and ranks the rest by **total cost**. For each option it shows:
- paid cost vs DSM still owed;
- savings vs doing nothing;
- coverage %;
- time to effect (fastest resource's response; RTM = 60 min);
- the network effect on the worst line, compared with doing nothing.

If a cheaper option exists (by more than max(₹1,000, 0.5%)), the banner says what it gives up: lower coverage, a worse line loading, or slower action. Under-drawal settles at up to 0.9×NR, so over-covering can show up as a **DSM credit**.

### 5.5 Digital Twin safety gate (`decide/twin.py`)

Before any command, the plan is simulated minute by minute against live state:

| Check | Fails / warns when | Automatic fix |
| --- | --- | --- |
| Heartbeat and command path | No gateway heartbeat for > 60 s | **Exclude** asset, re-solve |
| BESS state of charge | Trajectory would breach SoC_min | **Derate** to 95% of usable MW, re-solve |
| Line loading after dispatch | Dispatch makes any line worse than 100% (fail); pre-existing overload only relieved (warn) | Not dispatched if worse |
| Bus voltage | Estimated < 0.95 pu | warn |
| Response lag | < 70% of planned block-1 energy after response delay and ramp | warn |
| P90 reserve kept free | Free expected flexibility < P90 margin | warn |
| Ancillary double-commitment | — | SRAS/TRAS always untouched |
| Rebound | Post-event rebound > 25% of requirement | warn |
| Requirement covered | Shortfall > 0.5 MW: fail in EMERGENCY (escalate to load management), warn otherwise | — |

Up to 4 optimise → twin passes. If the twin still fails, a human must decide.

### 5.6 Autonomy policy and approvals (`decide/policy.py`)

| Level | Behaviour |
| --- | --- |
| L0 Monitor | Detect, forecast, alarm; no decisions |
| L1 Advisory | Plans generated; every command needs approval |
| L2 Supervised (default) | BESS and generation inside the envelope (≤ 250 MW total, twin passed) execute automatically; the rest await approval |
| L3 Autonomous | Every resource except RTM executes automatically once the twin passes |

**Automatic degradation to L1:**
- data confidence < 85%;
- control-loop latency high;
- kill switch (suspend) pressed.

**Dual authorisation:**
- Needed when the MW awaiting approval exceeds **200 MW**.
- The second approver must be a different user with dual authority.
- If a re-solve grows the plan beyond 1.1 × approved + 20 MW, a new approval round starts.

### 5.7 Dispatch (`act/dispatch.py`)

Command lifecycle:

```
AWAITING_APPROVAL → READY → SENT → ACKED → EXECUTING → COMPLETED
                                 └ no ack in 90 s → FAILED → asset excluded, alarm, re-solve
```

Any non-terminal command can end as CANCELLED (rejected or aborted) or SUPERSEDED (a newer setpoint for that asset).

- Commands are idempotent (command id) and signed (SHA-256), and there is **no blind resend**.
- **Dead-band:** a new setpoint is sent only if it differs from the current one by more than max(5 MW, 8%). Small re-solves don't churn participants.
- **Under-delivery:** delivered < 70% of expected raises an alarm, and the next re-solve compensates.

---

## 6. Proving it and paying for it (`act/settlement.py`)

**Measurement & verification** runs every tick while an event executes:

```
delivered MWh_i += telemetry MW_i · dt
expected  MWh_i += plan expected MW_i · dt
avoided DSM     += DSM(deviation + dir·Σ delivered) − DSM(deviation)     (counterfactual − actual)
```

**Performance and payment:**

```
performance p = delivered / expected
performance factor PF = 1.0                if p ≥ 90%
                      = (p − 0.5) / 0.4    if 50% < p < 90%
                      = 0                  if p ≤ 50%
payment = delivered MWh · 1000 · rate · PF
```

- `rate` = bid, plus opportunity cost for BESS and generation.
- Generation is always paid at PF = 1.
- RTM is paid at the RTM price.

**Net benefit** = avoided DSM − payments.

**Reliability learning** (used in the next event's expected MW and effective cost):

```
reliability_new = min(0.995, 0.8 · reliability_old + 0.2 · min(1, p))
```

---

## 7. Last resort: load shedding and rostering (`decide/shedding.py`)

**Order of resort for over-drawal:** paid flexibility first (DR, BESS, generation, RTM). Only the **residual** (the optimiser's unserved MW in block 1, with MW already shed counted in) can become a shedding order. Under-drawal is never handled by shedding.

### Trigger

```
residual ≥ 50 MW  AND  ( frequency < 49.90 Hz   OR   residual > DSM band = min(10% of schedule, 100 MW) )
sustained 120 s — or immediately when frequency < 49.80 Hz
```

The band follows the DSM rule table live. An engineer can override it with a fixed MW.

### Approval

- An order proposes MW = residual, rounded to 10 MW (minimum 50 MW). It **never acts on its own**: shift-in-charge approval is required, plus dual authorisation above **200 MW**.
- An automatic proposal lapses if flexibility catches up first (residual < 25 MW).

### Roster groups

- Each DISCOM's 220 kV stations are split north to south into groups (A, B, C …) of about **4 stations**.
- A group's sheddable MW = Σ (its share of each parent bus's load) × **30%**. The 30% is the non-essential 11 kV feeder share.
- **Never shed:** hospitals, water works, railway traction, defence.

### Fair selection

1. Split the MW across DISCOMs in proportion to their load.
2. Repeatedly take the DISCOM furthest below its quota.
3. Within that DISCOM, take the eligible group with the fewest minutes shed today, then the one restored longest ago.

A group is eligible only if it is not already shed, has at least 10 min of its daily allowance left, and has rested at least one full spell since it was restored.

### Limits and rotation

| Rule | Value |
| --- | --- |
| Spell length | ≤ 45 min (a group at the end of its spell is swapped for the next fair group: **rotation**) |
| Daily limit | ≤ 120 min per group |
| Rest after a spell | One full spell (45 min) |
| Top-up | If the residual grows by > 50 MW beyond what is shed, more groups are added under the same order |
| Trim | If more than needed is shed (surplus > smallest group + 40 MW), give back the **largest group that still leaves enough off** |
| Restore | When the over-drawal is gone, restore in stages: one group every **120 s**, longest-out first, to avoid a rebound spike |

**Energy not served** = ∫ shed MW dt (MWh).

**Fairness** = most minus least minutes shed today, across groups.

---

## 8. Alarms (`detect/alarms.py`, ISA-18.2 style)

| Alarm | Priority | Condition | On-delay |
| --- | --- | --- | --- |
| Frequency low | P1 / P2 | < 49.80 / < 49.90 Hz | 10 s / 20 s |
| Frequency high | P3 | > 50.05 Hz | 30 s |
| ACE | P1 / P2 / P3 | \|ACE\| ≥ 1,000 / 300 / 100 MW | 20 / 30 / 60 s |
| Line overload / high loading | P1 / P3 | ≥ 100% / ≥ 90% | 20 / 60 s |
| Line out of service, islanding | P2, P1 | breaker open / island detected | immediate |
| Data confidence | P2 / P3 | < 80% / < 97% | 10 / 30 s |
| Telemetry stale or missing | P3 | point STALE or MISSING | 30 s |
| Asset heartbeat lost | P2 if in the active event | > 60 s without heartbeat | 30 s |
| Under-delivery | P2 | < 70% of expected | immediate |
| Demand anomaly | P3 | forecast residual \|z\| ≥ 4 | 30 s |
| Predicted overload | P3 | forecast line ≥ 100% within 30 min | 60 s |
| Autonomy degraded / suspended, loop latency | P2 / P3 / P2 | from policy and watchdog | immediate |

Alarm lifecycle:
- An alarm clears after its condition has been false for its **off-delay** (60 s), which suppresses chatter.
- An alarm stays on the active list until it is acknowledged, even after it clears.
- Alarms can be shelved, with a reason and an expiry.
- Related alarms are correlated into **incidents**, and an incident can open a DR event.

---

## 9. Trust and audit

- **RBAC:** operator, shift-in-charge, analyst, engineer, admin. JWT sessions.
- **Audit trail:** every event, analysis, twin result, approval, command, ack, alarm, override, config change and settlement is appended as:

  ```
  hash_n = SHA-256( [hash_{n−1}, seq, ts, kind, actor, ref, message] )      hash_0 = 0…0
  ```

  Changing any entry breaks every hash after it. **Verify** in Settlement & Audit re-computes the chain.

---

## 10. What the screen numbers mean

| Where | Number | Calculation |
| --- | --- | --- |
| Top bar | Frequency, Δsch | Live frequency (coloured by IEGC band); drawal − schedule (+ = over-drawing) |
| Top bar | Block clock | Time block n of 96 (15-min DSM blocks); the bar shows progress through the day |
| Overview → **Grid need** | Need | Event requirement, or the live requirement when no event is open. Coverage bar = delivering (green) + shed (red) vs the need; gap = the rest |
| Overview → Grid need | ACE, DSM/block | §3.3 and §3.4, for the current block |
| DR Events → **Options** | Total, saves, coverage, acts in | §5.3 and §5.4 |
| DR Events → Safety | Checks | §5.5 |
| DR Events → Settlement | Payment, PF, net benefit | §6 |
| Grid | Demand Δ/blk | Demand change over the last 15 min of grid time |
| Grid | Most loaded corridor | max(\|flow\| / limit) from the DC power flow |
| Load Shedding | Uncovered OD vs limit | §7 trigger: residual vs DSM band |
| Load Shedding | Fairness, max x/120 | §7 |
| Forecast | ACE / Demand / RE next block | P50 for block 1 (§4); sparkline = P50 over the 8-block horizon |
| Forecast | Peak line loading (2 h) | Highest forecast loading across blocks 1, 2 and 4 |
| Forecast | MAPE | Mean absolute % error of the 1-block demand forecast |
| Alarms | Priority mix, oldest unacked | Over the active set (active, or cleared but not yet acknowledged) |

---

## 11. Worked example

Situation:

- Schedule 5,300 MW, actual drawal 5,650 MW, so **over-drawal = 350 MW**.
- Frequency 49.95 Hz.
- Prices: DAM ₹5.40, RTM ₹7.20, ancillary ₹8.10.

**1. ACE**

```
Ia − Is    = −5,650 − (−5,300)                = −350 MW
freq term  = −10 · (−160) · (49.95 − 50.00)   = −80 MW
ACE        = −350 − 80                        = −430 MW
```

ACE is short, so direction = **UP** and requirement = **430 MW**. |ACE| ≥ 100, so severity = **ALERT**.

**2. DSM exposure**

```
NR   = max(5.40, 7.20, (5.40 + 7.20 + 8.10)/3 = 6.90) = ₹7.20/kWh  (RTM binding)
band = min(10% · 5,300, 100) = 100 MW
f = 49.95 is in the NORMAL band → over-drawal multipliers 1.0 within, 1.5 beyond
DSM  = 100 · 0.25 · 1000 · 1.0 · 7.20  +  250 · 0.25 · 1000 · 1.5 · 7.20
     = ₹1,80,000 + ₹6,75,000 = ₹8,55,000 per block
marginal rate = 1.5 · 7.20 = ₹10.80/kWh
```

So any flexibility cheaper than ₹10.80 per expected kWh saves money.

**3. A participant's effective cost**

The participant bids ₹4.50, with opportunity cost ₹0.50, rebound fraction 0.3 and reliability 0.90:

```
rebound   = 0.3 · 3.20 · 0.5             = ₹0.48/kWh
effective = (4.50 + 0.50 + 0.48) / 0.90  = ₹6.09/kWh   → well below ₹10.80, so it is dispatched
```

**4. Event.** The condition holds for 60 s, so an event opens.
- The LP fills the 430 MW (in expected MW) cheapest-first, within line limits, ramps and SoC.
- The twin checks the plan.
- At L2, BESS and generation up to 250 MW go automatically; the DR participants wait for approval.
- If the MW awaiting approval exceeds 200, two approvers are needed.

**5. Settlement.** The participant was expected to deliver 10 MWh and delivered 7.6 MWh:

```
p  = 0.76  → PF = (0.76 − 0.5)/0.4 = 0.65
payment         = 7.6 · 1000 · ₹4.50 · 0.65 = ₹22,230      (demand-side rate = bid)
new reliability = 0.8 · 0.90 + 0.2 · 0.76   = 0.872
```

The next event will expect 87.2% of their available MW and price them at ÷ 0.872.

**6. If flexibility runs out.** Suppose 180 MW stays uncovered for 2 minutes. 180 > 100 MW band, so a **180 MW** shedding order is proposed and waits for shift-in-charge approval. On approval, roster groups are picked across DISCOMs by load share, least-shed first, and rotated every ≤ 45 minutes until the over-drawal is covered. Load is then restored one group every 2 minutes.
