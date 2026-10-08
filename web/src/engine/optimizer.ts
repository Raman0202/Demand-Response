// Network-aware, multi-block merit-order dispatch.
// Each block: walk resources in effective-cost order and allocate MW subject to
// availability, ramp, BESS energy, duration, response time and line limits (PTDF headroom).
// It is an explainable greedy solution of the LP relaxation; the production design swaps in a
// Pyomo/HiGHS MILP with the same constraint set (see docs/ARCHITECTURE.md).
import { BLOCK_MIN, LINES } from '@/data/karnataka'
import { dsmCharge, type DsmRuleConfig, DEFAULT_DSM_CONFIG } from './dsm'
import type { FlexEvaluation } from './flexibility'
import { ptdf, lineLabel, solveDCPF } from './network'
import { busInjections } from './grid'
import type { AssetType, Direction, GridSnapshot, Severity } from './types'

export type StrategyId = 'NONE' | 'RTM' | 'GEN' | 'BESS' | 'DR' | 'OPTIMAL'

export const STRATEGIES: { id: StrategyId; label: string; description: string; types: (AssetType | 'rtm')[] }[] = [
  { id: 'NONE', label: 'Do nothing', description: 'Absorb the deviation; pay DSM charges.', types: [] },
  { id: 'RTM', label: 'Buy in RTM', description: 'Real-Time Market purchase (≈1 h gate-closure lead).', types: ['rtm'] },
  { id: 'GEN', label: 'Re-dispatch generation', description: 'Ramp intra-state thermal/hydro headroom.', types: ['generation'] },
  { id: 'BESS', label: 'BESS only', description: 'Discharge grid batteries.', types: ['bess'] },
  { id: 'DR', label: 'Demand response only', description: 'Curtail/shift flexible demand.', types: ['interruptible', 'shiftable', 'industrial', 'der'] },
  {
    id: 'OPTIMAL',
    label: 'Optimal mix',
    description: 'Co-optimise all resources under network constraints.',
    types: ['generation', 'bess', 'interruptible', 'shiftable', 'industrial', 'der', 'rtm'],
  },
]

export const RTM_LEAD_BLOCKS = 4
export const RTM_ID = 'RTM'

export interface Allocation {
  assetId: string
  name: string
  type: AssetType | 'rtm'
  bus?: string
  rank: number
  effectiveCost: number
  reliability: number
  mwByBlock: number[]
  expectedByBlock: number[]
  expectedMWh: number
  costRs: number
  reason: string
  caps: string[]
}

export interface Skip {
  assetId: string
  name: string
  reason: string
}

export interface Binding {
  lineId: string
  assetId: string
  block: number
  detail: string
}

export interface PlanResult {
  strategy: StrategyId
  direction: Direction
  blocks: number
  requirementByBlock: number[]
  needByBlock: number[]
  suppliedByBlock: number[]
  residualByBlock: number[]
  postReboundMW: number[]
  allocations: Allocation[]
  skipped: Skip[]
  bindings: Binding[]
  costs: {
    resourceRs: number
    rtmRs: number
    reboundRs: number
    residualDsmRs: number
    totalRs: number
    doNothingRs: number
    savingsRs: number
  }
  timeToEffectMin: number | null
  coveragePct: number
  flowsAfter: Record<string, number>
  loadingAfter: Record<string, number>
  maxLoadingAfter: { lineId: string; value: number }
  log: string[]
}

export interface OptimizeInput {
  snapshot: GridSnapshot
  evaluations: FlexEvaluation[]
  direction: Direction
  requirementMW: number
  deviationMW: number
  severity: Severity
  strategy: StrategyId
  exclude?: string[]
  derate?: Record<string, number> // assetId → max MW (from twin feedback)
  dsmCfg?: DsmRuleConfig
}

const H = BLOCK_MIN / 60

export function optimize(input: OptimizeInput): PlanResult {
  const { snapshot: s, direction, strategy, severity } = input
  const cfg = input.dsmCfg ?? DEFAULT_DSM_CONFIG
  const types = STRATEGIES.find((x) => x.id === strategy)!.types
  const blocks = s.durationBlocks
  const sign = direction === 'UP' ? 1 : -1
  const exclude = new Set(input.exclude ?? [])
  const log: string[] = []

  const req = Array.from({ length: blocks }, () => Math.max(0, input.requirementMW))
  const reboundAdd = new Array<number>(blocks + 2).fill(0)
  const supplied = new Array<number>(blocks).fill(0)
  const residual = new Array<number>(blocks).fill(0)
  const need = new Array<number>(blocks).fill(0)

  const baseFlows = solveDCPF(busInjections(s), s.outagedLines).flows
  const flows = Array.from({ length: blocks }, () => ({ ...baseFlows }))
  const activeLines = LINES.filter((l) => !s.outagedLines.includes(l.id))

  const dsmMarginal = dsmCharge(input.deviationMW, s.scheduleMW, s.frequency, s.prices, cfg).marginalRate

  type Cand = {
    id: string
    name: string
    type: AssetType | 'rtm'
    bus?: string
    eff: number
    R: number
    avail: number
    earliest: number
    maxBlocks: number
    ramp: number
    bidOpp: number
    reboundFrac: number
    recoveryMin: number
    energyLeft?: number
    etaD?: number
  }

  const cands: Cand[] = []
  const skipped: Skip[] = []
  for (const ev of input.evaluations) {
    const a = ev.asset
    if (!types.includes(a.type)) continue
    if (exclude.has(a.id)) {
      skipped.push({ assetId: a.id, name: a.name, reason: 'Removed by Digital Twin feedback' })
      continue
    }
    if (!ev.eligible) {
      skipped.push({ assetId: a.id, name: a.name, reason: ev.exclusions.join('; ') })
      continue
    }
    let avail = ev.availableMW
    if (input.derate?.[a.id] !== undefined) avail = Math.min(avail, input.derate[a.id])
    cands.push({
      id: a.id,
      name: a.name,
      type: a.type,
      bus: a.bus,
      eff: ev.effectiveCost,
      R: ev.reliability,
      avail,
      earliest: ev.earliestBlock,
      maxBlocks: ev.maxBlocks,
      ramp: a.rampMWpm,
      bidOpp: ev.bidRs + ev.opportunityRs,
      reboundFrac: a.reboundFrac,
      recoveryMin: a.recoveryMin,
      energyLeft: a.bess && direction === 'UP' ? (a.bess.soc - a.bess.socMin) * a.bess.energyMWh * s.bessAvailability : undefined,
      etaD: a.bess?.etaD,
    })
  }
  if (types.includes('rtm') && direction === 'UP') {
    cands.push({
      id: RTM_ID,
      name: 'RTM purchase (IEX/PXIL/HPX)',
      type: 'rtm',
      eff: s.prices.rtmAcp + 0.05,
      R: 1,
      avail: Infinity,
      earliest: RTM_LEAD_BLOCKS,
      maxBlocks: 96,
      ramp: Infinity,
      bidOpp: s.prices.rtmAcp + 0.05,
      reboundFrac: 0,
      recoveryMin: 0,
    })
  }
  cands.sort((a, b) => a.eff - b.eff)

  // energy curtailed comes back over the recovery window: P_rebound = frac × E_curtailed / T_recovery
  const reboundMWh = (c: Cand, m: number[]) => c.reboundFrac * m.reduce((acc, x) => acc + x * c.R * H, 0)
  const reboundMW = (c: Cand, m: number[]) => reboundMWh(c, m) / Math.max(H, c.recoveryMin / 60)

  const alloc = new Map<string, number[]>()
  const activeCount = new Map<string, number>()
  const capsByAsset = new Map<string, Set<string>>()
  const bindings: Binding[] = []
  const addCap = (id: string, c: string) => {
    if (!capsByAsset.has(id)) capsByAsset.set(id, new Set())
    capsByAsset.get(id)!.add(c)
  }

  for (let b = 0; b < blocks; b++) {
    // rebound from assets that hit their max duration
    for (const c of cands) {
      const m = alloc.get(c.id)
      if (!m || b === 0) continue
      if (m[b - 1] > 0 && (activeCount.get(c.id) ?? 0) >= c.maxBlocks && c.reboundFrac > 0) {
        const r = reboundMW(c, m)
        for (let k = b; k < blocks; k++) reboundAdd[k] += r
        log.push(`Block ${b + 1}: ${c.name} reached max duration (${c.maxBlocks * BLOCK_MIN} min) → rebound +${r.toFixed(0)} MW over ${c.recoveryMin} min`)
      }
    }
    need[b] = req[b] + reboundAdd[b]
    let remaining = need[b]

    for (const c of cands) {
      if (remaining <= 0.5) break
      if (b < c.earliest) {
        if (b === 0) addCap(c.id, c.type === 'rtm' ? `RTM delivers from block ${RTM_LEAD_BLOCKS + 1} (gate closure)` : `Response ${c.earliest * BLOCK_MIN}+ min — misses block 1`)
        continue
      }
      if ((activeCount.get(c.id) ?? 0) >= c.maxBlocks) {
        addCap(c.id, `Max duration ${c.maxBlocks * BLOCK_MIN} min reached`)
        continue
      }
      if (severity === 'NORMAL' && c.eff >= dsmMarginal && c.type !== 'rtm') {
        addCap(c.id, `Costlier (₹${c.eff.toFixed(2)}) than DSM marginal rate (₹${dsmMarginal.toFixed(2)}) — economic DR only in NORMAL`)
        continue
      }
      let x = Math.min(c.avail, remaining / c.R)
      if (c.ramp * BLOCK_MIN < x) {
        x = c.ramp * BLOCK_MIN
        addCap(c.id, `Ramp-limited (${c.ramp} MW/min)`)
      }
      if (c.energyLeft !== undefined) {
        const eMW = (c.energyLeft * (c.etaD ?? 1)) / H
        if (eMW < x) {
          x = Math.max(0, eMW)
          addCap(c.id, `Energy-limited (SoC floor)`)
        }
      }
      // network headroom via PTDF
      if (c.bus && x > 0) {
        const p = ptdf(c.bus, s.outagedLines)
        for (const l of activeLines) {
          const sens = p[l.id] * sign
          if (Math.abs(sens) < 1e-3) continue
          const f = flows[b][l.id]
          const next = f + sens * x
          if (Math.abs(next) <= l.limitMW || Math.abs(next) <= Math.abs(f)) continue
          const lim = sens > 0 ? (l.limitMW - f) / sens : (f + l.limitMW) / -sens
          const xMax = Math.max(0, lim)
          if (xMax < x) {
            x = xMax
            bindings.push({
              lineId: l.id,
              assetId: c.id,
              block: b,
              detail: `${lineLabel(l.id)} at limit — ${c.name} capped to ${xMax.toFixed(0)} MW`,
            })
            addCap(c.id, `Network: ${lineLabel(l.id)} at limit`)
          }
        }
      }
      if (x < 0.5) continue
      if (!alloc.has(c.id)) alloc.set(c.id, new Array<number>(blocks).fill(0))
      alloc.get(c.id)![b] = x
      activeCount.set(c.id, (activeCount.get(c.id) ?? 0) + 1)
      remaining -= x * c.R
      if (c.energyLeft !== undefined) c.energyLeft -= (x * H) / (c.etaD ?? 1)
      if (c.bus) {
        const p = ptdf(c.bus, s.outagedLines)
        for (const l of activeLines) flows[b][l.id] += p[l.id] * sign * x
      }
    }
    supplied[b] = need[b] - Math.max(0, remaining)
    residual[b] = Math.max(0, remaining)
  }

  // post-event rebound
  const postRebound = [0, 0]
  let reboundRs = 0
  for (const c of cands) {
    const m = alloc.get(c.id)
    if (!m || c.reboundFrac <= 0) continue
    if (m[blocks - 1] > 0) {
      const r = reboundMW(c, m)
      postRebound[0] += r
      postRebound[1] += r
    }
    reboundRs += reboundMWh(c, m) * 1000 * s.prices.offPeak
  }

  const allocations: Allocation[] = []
  let rank = 0
  let resourceRs = 0
  let rtmRs = 0
  for (const c of cands) {
    const m = alloc.get(c.id)
    if (!m) {
      const caps = [...(capsByAsset.get(c.id) ?? [])]
      if (c.id !== RTM_ID || caps.length) skipped.push({ assetId: c.id, name: c.name, reason: caps[0] ?? 'Not needed — requirement already covered by cheaper resources' })
      continue
    }
    rank++
    const expected = m.map((x) => x * c.R)
    const mwh = expected.reduce((s2, x) => s2 + x * H, 0)
    const cost = mwh * 1000 * c.bidOpp
    if (c.type === 'rtm') rtmRs += cost
    else resourceRs += cost
    const caps = [...(capsByAsset.get(c.id) ?? [])]
    allocations.push({
      assetId: c.id,
      name: c.name,
      type: c.type,
      bus: c.bus,
      rank,
      effectiveCost: c.eff,
      reliability: c.R,
      mwByBlock: m,
      expectedByBlock: expected,
      expectedMWh: mwh,
      costRs: cost,
      reason: `#${rank} in merit order at ₹${c.eff.toFixed(2)}/kWh effective` + (c.R < 1 ? ` (bid ₹${c.bidOpp.toFixed(2)} ÷ reliability ${(c.R * 100).toFixed(0)}%)` : ''),
      caps,
    })
  }

  let residualDsmRs = 0
  let doNothingRs = 0
  for (let b = 0; b < blocks; b++) {
    const devAfter = input.deviationMW + sign * (reboundAdd[b] - supplied[b])
    residualDsmRs += dsmCharge(devAfter, s.scheduleMW, s.frequency, s.prices, cfg).amountRs
    doNothingRs += dsmCharge(input.deviationMW, s.scheduleMW, s.frequency, s.prices, cfg).amountRs
  }
  const totalRs = resourceRs + rtmRs + reboundRs + residualDsmRs
  const totalNeed = need.reduce((a, b) => a + b, 0)
  const coveragePct = totalNeed > 0 ? (supplied.reduce((a, b) => a + b, 0) / totalNeed) * 100 : 100

  let tte: number | null = null
  for (const a of allocations) {
    const ev = input.evaluations.find((e) => e.asset.id === a.assetId)
    const t = a.type === 'rtm' ? RTM_LEAD_BLOCKS * BLOCK_MIN : (ev?.asset.responseMin ?? 0)
    tte = tte === null ? t : Math.min(tte, t)
  }

  // network state after block-1 dispatch (worst case is the first fully-loaded block)
  const extra: Record<string, number> = {}
  for (const a of allocations) if (a.bus) extra[a.bus] = (extra[a.bus] ?? 0) + sign * a.mwByBlock[0]
  const after = solveDCPF(busInjections(s, extra), s.outagedLines)

  if (allocations.length) log.unshift(`Merit order: ${allocations.map((a) => a.name.split(' (')[0]).join(' → ')}`)
  if (residual.some((r) => r > 0.5)) log.push(`Residual shortfall up to ${Math.max(...residual).toFixed(0)} MW remains → DSM exposure / escalate`)

  return {
    strategy,
    direction,
    blocks,
    requirementByBlock: req,
    needByBlock: need,
    suppliedByBlock: supplied,
    residualByBlock: residual,
    postReboundMW: postRebound,
    allocations,
    skipped,
    bindings,
    costs: {
      resourceRs,
      rtmRs,
      reboundRs,
      residualDsmRs,
      totalRs,
      doNothingRs,
      savingsRs: doNothingRs - totalRs,
    },
    timeToEffectMin: tte,
    coveragePct,
    flowsAfter: after.flows,
    loadingAfter: after.loading,
    maxLoadingAfter: after.maxLoading,
    log,
  }
}

export function compareStrategies(input: Omit<OptimizeInput, 'strategy'>) {
  return STRATEGIES.map((st) => ({ ...st, plan: optimize({ ...input, strategy: st.id }) }))
}
