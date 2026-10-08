// Decision pipeline: Sense → Price → Flexibility → Options → Optimize → Twin (→ re-solve).
import { dsmCharge, type DsmResult } from './dsm'
import { evaluateFleet, type FlexEvaluation } from './flexibility'
import { classifySeverity, computeAce, uncertaintyMarginMW, type AceBreakdown } from './grid'
import { compareStrategies, optimize, type PlanResult, type StrategyId } from './optimizer'
import { simulateTwin, type TwinResult } from './twin'
import type { Direction, FlexAsset, GridSnapshot, Severity } from './types'

export interface Assessment {
  snapshot: GridSnapshot
  deviationMW: number
  ace: AceBreakdown
  severity: Severity
  direction: Direction
  requirementMW: number
  marginMW: number
  dsm: DsmResult
  doNothingRs: number
}

export function assess(s: GridSnapshot): Assessment {
  const deviationMW = s.drawalMW - s.scheduleMW
  const ace = computeAce(s)
  const severity = classifySeverity(s.frequency, ace.ace)
  const direction: Direction = ace.ace <= 0 ? 'UP' : 'DOWN'
  const requirementMW = Math.abs(ace.ace)
  const dsm = dsmCharge(deviationMW, s.scheduleMW, s.frequency, s.prices)
  return {
    snapshot: s,
    deviationMW,
    ace,
    severity,
    direction,
    requirementMW,
    marginMW: uncertaintyMarginMW(s.demandMW, s.reMW),
    dsm,
    doNothingRs: dsm.amountRs * s.durationBlocks,
  }
}

export function flexibility(a: Assessment, assets: FlexAsset[], learned: Record<string, number> = {}) {
  return evaluateFleet(assets, a.snapshot, a.direction, a.severity, learned)
}

export function options(a: Assessment, evaluations: FlexEvaluation[]) {
  return compareStrategies({
    snapshot: a.snapshot,
    evaluations,
    direction: a.direction,
    requirementMW: a.requirementMW,
    deviationMW: a.deviationMW,
    severity: a.severity,
  })
}

export interface Iteration {
  n: number
  plan: PlanResult
  twin: TwinResult
  note: string
}

/** Optimize, validate in the twin, and re-solve with twin feedback until safe (max 4 passes). */
export function optimizeWithTwin(a: Assessment, evaluations: FlexEvaluation[], strategy: StrategyId = 'OPTIMAL'): Iteration[] {
  const iterations: Iteration[] = []
  const exclude: string[] = []
  const derate: Record<string, number> = {}
  for (let n = 1; n <= 4; n++) {
    const plan = optimize({
      snapshot: a.snapshot,
      evaluations,
      direction: a.direction,
      requirementMW: a.requirementMW,
      deviationMW: a.deviationMW,
      severity: a.severity,
      strategy,
      exclude,
      derate,
    })
    const twin = simulateTwin(plan, a.snapshot, evaluations, a.marginMW, a.severity)
    const changes: string[] = []
    const name = (id: string) => evaluations.find((e) => e.asset.id === id)?.asset.short ?? id
    for (const id of twin.actions.exclude) {
      if (exclude.includes(id)) continue
      exclude.push(id)
      changes.push(`removed ${name(id)}`)
    }
    for (const [id, mw] of Object.entries(twin.actions.derate)) {
      if (derate[id] !== undefined && derate[id] <= mw) continue
      derate[id] = mw
      changes.push(`derated ${name(id)} to ${mw} MW`)
    }
    iterations.push({
      n,
      plan,
      twin,
      note: twin.ok ? 'Twin approved — safe to dispatch' : changes.length ? `Twin rejected → ${changes.join(', ')} → re-solve` : 'Twin rejected — no automatic fix',
    })
    if (twin.ok || !changes.length) break
  }
  return iterations
}
