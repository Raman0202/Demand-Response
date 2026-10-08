import { describe, expect, it } from 'vitest'
import { ASSETS, LINES } from '@/data/karnataka'
import { assess, flexibility, optimizeWithTwin } from '@/engine/decision'
import { dsmCharge, normalRate } from '@/engine/dsm'
import { BASELINE_SCENARIO, buildSnapshot, computeAce } from '@/engine/grid'
import { optimize } from '@/engine/optimizer'

const prices = { damAcp: 5.4, rtmAcp: 7.2, asc: 8.1, offPeak: 3.2 }

describe('DSM rule engine', () => {
  it('NR = max(A, B, C) with C = ⅓DAM + ⅓RTM + ⅓ASC', () => {
    const nr = normalRate(prices)
    expect(nr.C).toBeCloseTo((5.4 + 7.2 + 8.1) / 3)
    expect(nr.nr).toBe(7.2)
    expect(nr.binding).toBe('B')
  })
  it('is energy based: 22 MW for one block = 5.5 MWh', () => {
    const r = dsmCharge(22, 500, 49.95, { ...prices, damAcp: 5, rtmAcp: 5, asc: 5 })
    expect(r.energyMWh).toBeCloseTo(5.5)
    expect(r.amountRs).toBeCloseTo(27500) // 5.5 MWh × 1000 × ₹5 × 1.0
  })
  it('applies the volume band and low-frequency multiplier', () => {
    const r = dsmCharge(300, 8100, 49.85, prices)
    expect(r.bandMW).toBe(100)
    expect(r.beyondMW).toBe(200)
    expect(r.freqBand).toBe('LOW')
    expect(r.amountRs).toBeCloseTo(100 * 250 * 7.2 * 1.5 + 200 * 250 * 7.2 * 2.0)
  })
})

describe('Grid state', () => {
  it('base case is balanced on schedule', () => {
    const s = buildSnapshot(BASELINE_SCENARIO)
    expect(s.drawalMW).toBeCloseTo(s.scheduleMW)
    expect(computeAce(s).ace).toBeCloseTo(0)
  })
  it('overdrawal + low frequency gives negative ACE (needs UP)', () => {
    const s = buildSnapshot({ ...BASELINE_SCENARIO, demandShockMW: 300, frequency: 49.9 })
    const ace = computeAce(s)
    expect(ace.ace).toBeLessThan(-300)
  })
})

describe('Optimizer + twin', () => {
  it('never pushes a line beyond its limit when it was within limit', () => {
    const s = buildSnapshot({ ...BASELINE_SCENARIO, demandShockMW: 900, frequency: 49.86 })
    const a = assess(s)
    const plan = optimize({
      snapshot: s,
      evaluations: flexibility(a, ASSETS),
      direction: a.direction,
      requirementMW: a.requirementMW,
      deviationMW: a.deviationMW,
      severity: a.severity,
      strategy: 'OPTIMAL',
    })
    for (const l of LINES) expect(plan.loadingAfter[l.id]).toBeLessThanOrEqual(1.0001)
    expect(plan.costs.totalRs).toBeLessThan(plan.costs.doNothingRs)
  })
  it('removes an asset whose heartbeat is lost and re-solves', () => {
    const s = buildSnapshot({ ...BASELINE_SCENARIO, demandShockMW: 400, frequency: 49.88, heartbeatLost: ['A_BWSSB'] })
    const a = assess(s)
    const its = optimizeWithTwin(a, flexibility(a, ASSETS))
    expect(its.length).toBeGreaterThan(1)
    expect(its.at(-1)!.plan.allocations.find((x) => x.assetId === 'A_BWSSB')).toBeUndefined()
    expect(its.at(-1)!.twin.ok).toBe(true)
  })
  it('RTM cannot serve blocks before gate-closure lead', () => {
    const s = buildSnapshot({ ...BASELINE_SCENARIO, demandShockMW: 400, frequency: 49.92, durationBlocks: 8 })
    const a = assess(s)
    const plan = optimize({
      snapshot: s,
      evaluations: flexibility(a, ASSETS),
      direction: a.direction,
      requirementMW: a.requirementMW,
      deviationMW: a.deviationMW,
      severity: a.severity,
      strategy: 'RTM',
    })
    expect(plan.suppliedByBlock.slice(0, 4).every((x) => x === 0)).toBe(true)
    expect(plan.suppliedByBlock[4]).toBeGreaterThan(0)
  })
})
