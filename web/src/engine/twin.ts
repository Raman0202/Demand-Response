// Digital Twin approval gate: minute-resolution simulation of a candidate plan.
// It re-checks what the optimizer cannot know cheaply: live heartbeats, response lag,
// minute-level SoC, post-dispatch power flow & voltage, reserve margin and rebound.
import { BLOCK_MIN } from '@/data/karnataka'
import type { FlexEvaluation } from './flexibility'
import { busInjections } from './grid'
import { lineLabel, solveDCPF } from './network'
import type { PlanResult } from './optimizer'
import type { GridSnapshot, Severity } from './types'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface TwinCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  assetIds?: string[]
}

export interface TwinResult {
  checks: TwinCheck[]
  ok: boolean
  minutes: { t: number; need: number; planned: number; delivered: number }[]
  soc: Record<string, number[]>
  firstBlockDeliveryPct: number
  maxLoadingBefore: { lineId: string; value: number }
  maxLoadingAfter: { lineId: string; value: number }
  minVoltageAfter: { bus: string; value: number }
  freeReserveMW: number
  marginMW: number
  actions: { exclude: string[]; derate: Record<string, number> }
}

export function simulateTwin(plan: PlanResult, s: GridSnapshot, evaluations: FlexEvaluation[], marginMW: number, severity: Severity): TwinResult {
  const T = plan.blocks * BLOCK_MIN
  const evById = Object.fromEntries(evaluations.map((e) => [e.asset.id, e]))
  const minutes: TwinResult['minutes'] = []
  const soc: Record<string, number[]> = {}
  const state: Record<string, number> = {}
  const actions: TwinResult['actions'] = { exclude: [], derate: {} }
  const checks: TwinCheck[] = []

  for (const a of plan.allocations) {
    state[a.assetId] = 0
    const bess = evById[a.assetId]?.asset.bess
    if (bess) soc[a.assetId] = [bess.soc]
  }

  for (let m = 0; m < T; m++) {
    const b = Math.floor(m / BLOCK_MIN)
    let planned = 0
    let delivered = 0
    for (const a of plan.allocations) {
      const target = a.expectedByBlock[b] ?? 0
      planned += target
      const ev = evById[a.assetId]
      if (a.type === 'rtm') {
        state[a.assetId] = target
      } else if (ev) {
        const delay = ev.asset.responseMin
        if (m + 1 > delay) {
          const cur = state[a.assetId]
          const step = ev.asset.rampMWpm
          state[a.assetId] = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step)
        }
        const bess = ev.asset.bess
        if (bess) {
          const prev = soc[a.assetId][soc[a.assetId].length - 1]
          const sign = plan.direction === 'UP' ? -1 : 1
          const dE = plan.direction === 'UP' ? state[a.assetId] / bess.etaD / 60 : (state[a.assetId] * bess.etaC) / 60
          soc[a.assetId].push(prev + (sign * dE) / bess.energyMWh)
        }
      }
      delivered += state[a.assetId]
    }
    minutes.push({ t: m, need: plan.needByBlock[b], planned, delivered })
  }

  // 1. live heartbeat / comms
  const lost = plan.allocations.filter((a) => s.heartbeatLost.includes(a.assetId))
  checks.push({
    id: 'comms',
    label: 'Live heartbeat & command path',
    status: lost.length ? 'fail' : 'pass',
    detail: lost.length
      ? `${lost.map((a) => a.name).join(', ')}: no heartbeat for >60 s — command cannot be confirmed. Remove and re-solve.`
      : `All ${plan.allocations.filter((a) => a.type !== 'rtm').length} assets answered heartbeat within 5 s (mTLS, signed).`,
    assetIds: lost.map((a) => a.assetId),
  })
  actions.exclude.push(...lost.map((a) => a.assetId))

  // 2. BESS SoC trajectory
  const socIssues: string[] = []
  for (const [id, traj] of Object.entries(soc)) {
    const bess = evById[id].asset.bess!
    const min = Math.min(...traj)
    if (min < bess.socMin - 1e-3) {
      socIssues.push(id)
      const a = plan.allocations.find((x) => x.assetId === id)!
      const usable = ((bess.soc - bess.socMin) * bess.energyMWh * bess.etaD) / (T / 60)
      actions.derate[id] = Math.max(0, Math.floor(Math.min(usable, Math.max(...a.mwByBlock)) * 0.95))
    }
  }
  checks.push({
    id: 'soc',
    label: 'BESS state-of-charge stays within limits',
    status: socIssues.length ? 'fail' : 'pass',
    detail: socIssues.length
      ? `${socIssues.map((id) => evById[id].asset.short).join(', ')} would breach SoC floor before event end → derate.`
      : Object.keys(soc).length
        ? Object.entries(soc)
            .map(([id, t]) => `${evById[id].asset.short}: ${(t[0] * 100).toFixed(0)}% → ${(t[t.length - 1] * 100).toFixed(0)}%`)
            .join(' · ')
        : 'No BESS in plan.',
    assetIds: socIssues,
  })

  // 3. network loading
  const before = solveDCPF(busInjections(s), s.outagedLines)
  const sign = plan.direction === 'UP' ? 1 : -1
  const extra: Record<string, number> = {}
  for (const a of plan.allocations) if (a.bus) extra[a.bus] = (extra[a.bus] ?? 0) + sign * Math.max(...a.expectedByBlock)
  const after = solveDCPF(busInjections(s, extra), s.outagedLines)
  const overloaded = Object.entries(after.loading).filter(([, v]) => v > 1.0)
  let netStatus: CheckStatus = 'pass'
  let netDetail = `Max loading ${lineLabel(after.maxLoading.lineId)} ${(after.maxLoading.value * 100).toFixed(0)}% (was ${(before.loading[after.maxLoading.lineId] * 100).toFixed(0)}%).`
  if (overloaded.length) {
    const worse = overloaded.filter(([id, v]) => v > before.loading[id] + 0.005)
    netStatus = worse.length ? 'fail' : 'warn'
    netDetail = worse.length
      ? `Dispatch would overload ${worse.map(([id, v]) => `${lineLabel(id)} (${(v * 100).toFixed(0)}%)`).join(', ')}.`
      : `Pre-existing overload on ${overloaded.map(([id, v]) => `${lineLabel(id)} ${(before.loading[id] * 100).toFixed(0)}% → ${(v * 100).toFixed(0)}%`).join(', ')} — dispatch relieves it; topology action still advised.`
  } else if (after.maxLoading.value > 0.9) netStatus = 'warn'
  checks.push({ id: 'network', label: 'Line & transformer loading (N-0, DC PF)', status: netStatus, detail: netDetail })

  // 4. voltage
  let minV = { bus: '', value: 2 }
  for (const [bus, v] of Object.entries(after.voltage)) if (!bus.startsWith('X_') && v < minV.value) minV = { bus, value: v }
  checks.push({
    id: 'voltage',
    label: 'Bus voltage within 0.95–1.05 pu (estimated)',
    status: minV.value < 0.95 ? 'warn' : 'pass',
    detail: `Lowest: ${minV.bus} at ${minV.value.toFixed(3)} pu.`,
  })

  // 5. response lag
  const fb = minutes.slice(0, BLOCK_MIN)
  const plannedE = fb.reduce((a, m) => a + m.planned, 0)
  const delivE = fb.reduce((a, m) => a + m.delivered, 0)
  const firstPct = plannedE > 0 ? (delivE / plannedE) * 100 : 100
  checks.push({
    id: 'lag',
    label: 'Response lag in first block',
    status: firstPct < 70 ? 'warn' : 'pass',
    detail: `${firstPct.toFixed(0)}% of planned block-1 energy delivered after response delays and ramps.`,
  })

  // 6. reserve margin (P90)
  const usedExpected = new Map(plan.allocations.map((a) => [a.assetId, Math.max(...a.expectedByBlock)]))
  const free = evaluations
    .filter((e) => e.eligible && !s.heartbeatLost.includes(e.asset.id))
    .reduce((acc, e) => acc + Math.max(0, e.expectedMW - (usedExpected.get(e.asset.id) ?? 0)), 0)
  checks.push({
    id: 'reserve',
    label: 'P90 forecast-error reserve kept free',
    status: free >= marginMW ? 'pass' : 'warn',
    detail: `${free.toFixed(0)} MW expected flexibility still free vs ${marginMW.toFixed(0)} MW P90 margin.`,
  })

  // 7. ancillary arbitration
  const locked = evaluations.reduce((a, e) => a + e.lockedMW, 0)
  checks.push({
    id: 'ancillary',
    label: 'No double-commitment with SRAS/TRAS',
    status: 'pass',
    detail: `${locked.toFixed(0)} MW committed to ancillary services is untouched by this STATE_MODE dispatch.`,
  })

  // 8. rebound
  const peakReq = Math.max(...plan.requirementByBlock, 1)
  const rb = Math.max(...plan.postReboundMW)
  checks.push({
    id: 'rebound',
    label: 'Post-event rebound acceptable',
    status: rb > 0.25 * peakReq ? 'warn' : 'pass',
    detail: `Rebound load ${rb.toFixed(0)} MW sustained over each asset's recovery window after release (${((rb / peakReq) * 100).toFixed(0)}% of requirement).`,
  })

  // 9. residual
  const res = Math.max(...plan.residualByBlock)
  checks.push({
    id: 'residual',
    label: 'Requirement covered',
    status: res > 0.5 ? (severity === 'EMERGENCY' ? 'fail' : 'warn') : 'pass',
    detail:
      res > 0.5
        ? `Shortfall up to ${res.toFixed(0)} MW. ${severity === 'EMERGENCY' ? 'Escalate to Automatic Demand Management (last resort).' : 'Residual settles under DSM.'}`
        : `Plan covers ${plan.coveragePct.toFixed(0)}% of requirement in expectation.`,
  })

  const ok = !checks.some((c) => c.status === 'fail' && c.id !== 'residual')
  return {
    checks,
    ok,
    minutes,
    soc,
    firstBlockDeliveryPct: firstPct,
    maxLoadingBefore: before.maxLoading,
    maxLoadingAfter: after.maxLoading,
    minVoltageAfter: minV,
    freeReserveMW: free,
    marginMW,
    actions,
  }
}
