// Measurement & verification + settlement.
import { BLOCK_MIN } from '@/data/karnataka'
import { dsmCharge } from './dsm'
import type { FlexEvaluation } from './flexibility'
import type { PlanResult } from './optimizer'
import type { GridSnapshot } from './types'

function hash(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function rng(seed: string) {
  let x = hash(seed) || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return ((x >>> 0) % 10000) / 10000
  }
}

export interface DeliveryRow {
  assetId: string
  name: string
  type: string
  acked: boolean
  allocatedMW: number // average commanded MW over active blocks
  expectedMW: number
  deliveredMW: number
  performance: number // delivered / allocated
}

export function simulateDelivery(plan: PlanResult, eventId: string, s: GridSnapshot): DeliveryRow[] {
  return plan.allocations.map((a) => {
    const r = rng(eventId + a.assetId)
    const active = a.mwByBlock.filter((x) => x > 0)
    const allocated = active.reduce((p, c) => p + c, 0) / Math.max(1, active.length)
    const lost = s.heartbeatLost.includes(a.assetId)
    const acked = a.type === 'rtm' ? true : !lost && r() > 0.02
    let perf: number
    if (!acked) perf = 0
    else if (a.type === 'rtm') perf = 1
    else if (r() > a.reliability + 0.03) perf = 0.5 + 0.35 * r()
    else perf = Math.min(1.04, 0.94 + 0.1 * r())
    return {
      assetId: a.assetId,
      name: a.name,
      type: a.type,
      acked,
      allocatedMW: allocated,
      expectedMW: allocated * a.reliability,
      deliveredMW: allocated * perf,
      performance: perf,
    }
  })
}

export interface SettlementRow extends DeliveryRow {
  energyMWh: number
  rateRs: number
  perfFactor: number
  paymentRs: number
  newReliability: number
}

export interface Settlement {
  rows: SettlementRow[]
  deliveredMW: number
  allocatedMW: number
  paymentsRs: number
  doNothingRs: number
  residualDsmRs: number
  avoidedDsmRs: number
  netBenefitRs: number
}

/** Performance factor: ≥90% → 1.0, 50–90% linear, <50% → 0. Ancillary settles per CERC/GRID-INDIA procedure instead. */
export function perfFactor(p: number) {
  if (p >= 0.9) return 1
  if (p <= 0.5) return 0
  return (p - 0.5) / 0.4
}

export function settle(plan: PlanResult, delivery: DeliveryRow[], evaluations: FlexEvaluation[], s: GridSnapshot, deviationMW: number): Settlement {
  const H = BLOCK_MIN / 60
  const rows: SettlementRow[] = delivery.map((d) => {
    const a = plan.allocations.find((x) => x.assetId === d.assetId)!
    const ev = evaluations.find((e) => e.asset.id === d.assetId)
    const activeBlocks = a.mwByBlock.filter((x) => x > 0).length
    const energy = d.deliveredMW * activeBlocks * H
    const rate = d.type === 'rtm' ? s.prices.rtmAcp : (ev?.bidRs ?? 0) + (ev?.asset.type === 'bess' || ev?.asset.type === 'generation' ? ev.opportunityRs : 0)
    const pf = d.type === 'rtm' || d.type === 'generation' ? 1 : perfFactor(d.performance)
    const prevR = ev?.reliability ?? 1
    return {
      ...d,
      energyMWh: energy,
      rateRs: rate,
      perfFactor: pf,
      paymentRs: energy * 1000 * rate * pf,
      newReliability: d.type === 'rtm' ? 1 : Math.min(0.995, 0.8 * prevR + 0.2 * Math.min(1, d.performance)),
    }
  })
  const deliveredMW = rows.reduce((a, r) => a + r.deliveredMW, 0)
  const allocatedMW = rows.reduce((a, r) => a + r.allocatedMW, 0)
  const sign = plan.direction === 'UP' ? 1 : -1
  let residualDsmRs = 0
  let doNothingRs = 0
  for (let b = 0; b < plan.blocks; b++) {
    const deliveredB = rows.reduce((acc, r) => {
      const a = plan.allocations.find((x) => x.assetId === r.assetId)!
      return acc + a.mwByBlock[b] * r.performance
    }, 0)
    residualDsmRs += dsmCharge(deviationMW - sign * deliveredB, s.scheduleMW, s.frequency, s.prices).amountRs
    doNothingRs += dsmCharge(deviationMW, s.scheduleMW, s.frequency, s.prices).amountRs
  }
  const paymentsRs = rows.reduce((a, r) => a + r.paymentRs, 0)
  const avoided = doNothingRs - residualDsmRs
  return {
    rows,
    deliveredMW,
    allocatedMW,
    paymentsRs,
    doNothingRs,
    residualDsmRs,
    avoidedDsmRs: avoided,
    netBenefitRs: avoided - paymentsRs,
  }
}
