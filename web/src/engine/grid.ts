// Builds a consistent state-grid snapshot from scenario parameters.
import { BASE_DEMAND_MW, BASE_SCHEDULE_MW, BUSES, FREQ_BIAS_MW_PER_0_1HZ, GENERATORS } from '@/data/karnataka'
import type { GenType, GridSnapshot, MarketPrices, Severity } from './types'

export type ShockRegion = 'BENGALURU' | 'NORTH' | 'STATEWIDE'

export interface ScenarioParams {
  demandShockMW: number
  shockRegion: ShockRegion
  reDropMW: number
  frequency: number
  outagedLines: string[]
  bessAvailability: number
  industrialCompliance: number
  prices: MarketPrices
  heartbeatLost: string[]
  durationBlocks: number
}

export const DEFAULT_PRICES: MarketPrices = { damAcp: 5.4, rtmAcp: 7.2, asc: 8.1, offPeak: 3.2 }

export const BASELINE_SCENARIO: ScenarioParams = {
  demandShockMW: 0,
  shockRegion: 'BENGALURU',
  reDropMW: 0,
  frequency: 50.0,
  outagedLines: [],
  bessAvailability: 1,
  industrialCompliance: 1,
  prices: DEFAULT_PRICES,
  heartbeatLost: [],
  durationBlocks: 4,
}

const INTERNAL = BUSES.filter((b) => !b.external)
const SHARE_SUM = INTERNAL.reduce((s, b) => s + b.loadShare, 0)

export function buildSnapshot(p: ScenarioParams, noise = { demand: 0, freq: 0 }, time = '15:00'): GridSnapshot {
  const demandMW = BASE_DEMAND_MW + p.demandShockMW + noise.demand
  const shockBuses = INTERNAL.filter((b) => (p.shockRegion === 'STATEWIDE' ? true : p.shockRegion === 'BENGALURU' ? b.region === 'BENGALURU' : b.region === 'NORTH'))
  const shockShare = shockBuses.reduce((s, b) => s + b.loadShare, 0) || 1
  const busLoad: Record<string, number> = {}
  for (const b of INTERNAL) {
    const base = ((BASE_DEMAND_MW + noise.demand) * b.loadShare) / SHARE_SUM
    const shock = shockBuses.includes(b) ? (p.demandShockMW * b.loadShare) / shockShare : 0
    busLoad[b.id] = base + shock
  }

  // RE drop: cloud cover / wind lull distributed 70% solar, 30% wind, pro-rata to output
  const genOutput: Record<string, number> = {}
  const solar = GENERATORS.filter((g) => g.type === 'solar')
  const wind = GENERATORS.filter((g) => g.type === 'wind')
  const solarSum = solar.reduce((s, g) => s + g.baseMW, 0)
  const windSum = wind.reduce((s, g) => s + g.baseMW, 0)
  for (const g of GENERATORS) {
    let out = g.baseMW
    if (g.type === 'solar') out -= (p.reDropMW * 0.7 * g.baseMW) / solarSum
    if (g.type === 'wind') out -= (p.reDropMW * 0.3 * g.baseMW) / windSum
    genOutput[g.id] = Math.max(0, out)
  }
  const genByType = { coal: 0, hydro: 0, solar: 0, wind: 0, nuclear: 0 } as Record<GenType, number>
  let stateGen = 0
  let central = 0
  for (const g of GENERATORS) {
    genByType[g.type] += genOutput[g.id]
    if (g.owner === 'Central') central += genOutput[g.id]
    else stateGen += genOutput[g.id]
  }
  const reMW = genByType.solar + genByType.wind
  const externalImportMW = demandMW - stateGen - central
  const drawalMW = externalImportMW + central

  return {
    time,
    frequency: +(p.frequency + noise.freq).toFixed(3),
    demandMW,
    scheduleMW: BASE_SCHEDULE_MW,
    drawalMW,
    stateGenMW: stateGen,
    centralInStateMW: central,
    reMW,
    externalImportMW,
    genByType,
    genOutput,
    busLoad,
    prices: p.prices,
    outagedLines: p.outagedLines,
    heartbeatLost: p.heartbeatLost,
    bessAvailability: p.bessAvailability,
    industrialCompliance: p.industrialCompliance,
    durationBlocks: p.durationBlocks,
  }
}

export function busInjections(s: GridSnapshot, extra: Record<string, number> = {}) {
  const inj: Record<string, number> = {}
  for (const b of INTERNAL) inj[b.id] = -(s.busLoad[b.id] ?? 0) + (extra[b.id] ?? 0)
  for (const g of GENERATORS) inj[g.bus] += s.genOutput[g.id] ?? 0
  return inj
}

export interface AceBreakdown {
  Ia: number // actual net interchange (export +)
  Is: number // scheduled net interchange
  bf: number
  fa: number
  fs: number
  freqTerm: number
  offset: number
  ace: number
}

/** IEGC: ACE = (Ia − Is) − 10·Bf·(Fa − Fs) + Offset. Negative ACE ⇒ state is short (needs UP). */
export function computeAce(s: GridSnapshot, offset = 0): AceBreakdown {
  const Ia = -s.drawalMW
  const Is = -s.scheduleMW
  const bf = FREQ_BIAS_MW_PER_0_1HZ
  const fa = s.frequency
  const fs = 50
  const freqTerm = -10 * bf * (fa - fs)
  return { Ia, Is, bf, fa, fs, freqTerm, offset, ace: Ia - Is + freqTerm + offset }
}

export function classifySeverity(frequency: number, ace: number): Severity {
  if (frequency < 49.8 || Math.abs(ace) > 1500) return 'EMERGENCY'
  if (frequency < 49.9 || frequency > 50.05 || Math.abs(ace) >= 100) return 'ALERT'
  return 'NORMAL'
}

/** P90 forecast-error margin used as the reserve constraint. */
export function uncertaintyMarginMW(demandMW: number, reMW: number) {
  const sigma = Math.sqrt((0.005 * demandMW) ** 2 + (0.06 * reMW) ** 2)
  return 1.28 * sigma
}
