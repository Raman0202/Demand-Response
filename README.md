# KSFP — Karnataka State Flexibility & Demand Response Platform

An operator-facing prototype of a **state-level Demand Response + VPP + Digital Twin** platform for the Karnataka control area (KPTCL SLDC / SRLDC). The app walks an operator through one connected journey, **Observe → Simulate → Decide → Act → Learn**, over a live 3D model of the Karnataka grid.

The app is in `web/`. It uses React 19, TypeScript, Vite, Tailwind v4, **shadcn/ui** (Radix), **zustand**, react-three-fiber / drei and Recharts.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (vitest)
npm run build
npm run scenarios  # run every scenario preset through the engine (CLI summary)
```

## Experience

- **Lifecycle rail** (on every screen): Observe · Simulate · Decide · Act · Learn, with one context-aware **Next best action** button.
- **Fixed-viewport layout with no page scrolling.** Detail is split into section tabs, and long tables paginate to fit the space available.
- **Grid Monitor**: live KPIs, 3D Karnataka twin, event detection banner, and tabs for trends, network, flexibility and supply.
- **Decision Center**: an 8-step guided flow. A "decision chain" rail carries each step's conclusion forward:
  1. **Detect** shows deviation and ACE (IEGC formula, with the numbers substituted) and the severity rules.
  2. **Exposure** applies the CERC DSM rule engine: NR = max(A, B, C), energy-based, with a volume band and frequency multipliers.
  3. **Flexibility** shows available vs expected MW (× reliability), with SRAS/TRAS portions locked (no double commitment).
  4. **Options** compares Do-nothing, RTM, Generation, BESS, DR and Optimal mix like-for-like.
  5. **Plan** is a network-aware merit order block by block. PTDF line headroom, ramp, duration, SoC and rebound constrain it.
  6. **Digital Twin** simulates minute by minute (heartbeat, SoC, power flow, voltage, P90 reserve, rebound) and automatically re-solves when a check fails.
  7. **Dispatch** handles signed commands, single or dual authorisation, and the Shadow / Advisory / Closed-loop modes. An animated command wave runs on the map.
  8. **Verify & Settle** covers M&V, shortfall re-dispatch, performance-factor settlement and reliability learning.
- **Scenario Lab**: 8 presets (cloud cover, heatwave, line outage, RTM spike, comms failure, non-compliance, 1.5 GW loss, surplus) plus custom sliders, with an instant strategy comparison.
- **Flexibility Registry**, **Settlement & M&V**, and a hash-chained **Audit Log**.

## Code map (`web/src`)

| Path | What |
| --- | --- |
| `data/karnataka.ts` | 24 substations, 6 ISTS tie points, 39 lines, 13 generators, 25 flexible assets |
| `engine/network.ts` | DC power flow (distributed slack at ISTS ties) and PTDFs |
| `engine/dsm.ts` | DSM rule engine (configurable multiplier table) |
| `engine/grid.ts` | snapshot builder, ACE, severity, P90 margin |
| `engine/flexibility.ts` · `optimizer.ts` · `twin.ts` · `settlement.ts` · `decision.ts` | the decision pipeline |
| `store/` | zustand stores: live grid, decision workflow, UI, persisted history/audit |
| `components/three/` | 3D Karnataka scene (state mesh, lines + flow particles, assets, command wave, label layer) |
| `components/decision/` | the 8 step screens |

## Important caveats

- **DSM multipliers are illustrative.** The structure follows the CERC DSM Regulations 2024 (energy-based, NR = max(A, B, C), volume band). Load the notified table, with amendments, into the config before any real use.
- **The network is a screening model.** It is a simplified 24-bus DC power flow with planning-level limits, not KPTCL's actual topology or ratings. The real grid has many more parallel paths, so the model is not N-1 secure everywhere.
- **The optimizer is an explainable greedy solution** of the constrained dispatch problem. The production design replaces it with a Pyomo/HiGHS MILP + MPC that uses the same constraint set.
- All asset names, capacities, bids and reliabilities are representative demo data. The Karnataka boundary comes from the MIT-licensed `datamaps` India topology.
