// DSM rule engine (CERC DSM Regulations 2024 structure: energy-based, per 15-min block).
// The multiplier table below is ILLUSTRATIVE and lives in config so the notified CERC values
// (as amended) can be loaded without code changes. Never hard-code ₹/MW penalties.
import type { MarketPrices } from './types'

export interface NormalRate {
  A: number // weighted avg ACP of integrated DAM (₹/kWh)
  B: number // weighted avg ACP of RTM
  C: number // ⅓ DAM + ⅓ RTM + ⅓ ancillary service charge
  nr: number
  binding: 'A' | 'B' | 'C'
}

export function normalRate(p: MarketPrices): NormalRate {
  const A = p.damAcp
  const B = p.rtmAcp
  const C = (p.damAcp + p.rtmAcp + p.asc) / 3
  const nr = Math.max(A, B, C)
  const binding = nr === A ? 'A' : nr === B ? 'B' : 'C'
  return { A, B, C, nr, binding }
}

export type FreqBand = 'LOW' | 'NORMAL' | 'HIGH'

export interface DsmRuleConfig {
  version: string
  buyerCategory: string
  stateCategory: string
  freqLow: number // below → LOW band
  freqHigh: number // at/above → HIGH band
  bandPct: number // volume band as % of schedule …
  bandCapMW: number // … capped at this MW
  overdrawal: Record<FreqBand, { within: number; beyond: number }> // multiplier of NR, payable
  underdrawal: Record<FreqBand, { within: number; beyond: number }> // multiplier of NR, receivable
}

export const DEFAULT_DSM_CONFIG: DsmRuleConfig = {
  version: 'Illustrative · DSM Regs 2024 (as amended) structure',
  buyerCategory: 'Drawee buyer (state control area)',
  stateCategory: 'General',
  freqLow: 49.9,
  freqHigh: 50.05,
  bandPct: 10,
  bandCapMW: 100,
  overdrawal: {
    LOW: { within: 1.5, beyond: 2.0 },
    NORMAL: { within: 1.0, beyond: 1.5 },
    HIGH: { within: 0.5, beyond: 1.0 },
  },
  underdrawal: {
    LOW: { within: 1.0, beyond: 0.5 },
    NORMAL: { within: 0.9, beyond: 0.0 },
    HIGH: { within: 0.0, beyond: 0.0 },
  },
}

export interface DsmResult {
  deviationMW: number // + overdrawal, − underdrawal
  deviationPct: number
  energyMWh: number // per block
  freqBand: FreqBand
  bandMW: number
  withinMW: number
  beyondMW: number
  multWithin: number
  multBeyond: number
  rateWithin: number // ₹/kWh
  rateBeyond: number
  amountRs: number // per block; + payable by state, − receivable
  nr: NormalRate
  marginalRate: number // ₹/kWh of the next MW of deviation
}

export function freqBand(f: number, cfg = DEFAULT_DSM_CONFIG): FreqBand {
  return f < cfg.freqLow ? 'LOW' : f >= cfg.freqHigh ? 'HIGH' : 'NORMAL'
}

export function dsmCharge(deviationMW: number, scheduleMW: number, frequency: number, prices: MarketPrices, cfg: DsmRuleConfig = DEFAULT_DSM_CONFIG, blockH = 0.25): DsmResult {
  const nr = normalRate(prices)
  const fb = freqBand(frequency, cfg)
  const bandMW = Math.min((scheduleMW * cfg.bandPct) / 100, cfg.bandCapMW)
  const abs = Math.abs(deviationMW)
  const withinMW = Math.min(abs, bandMW)
  const beyondMW = Math.max(0, abs - bandMW)
  const table = deviationMW >= 0 ? cfg.overdrawal[fb] : cfg.underdrawal[fb]
  const rateWithin = table.within * nr.nr
  const rateBeyond = table.beyond * nr.nr
  const kWh = (mw: number) => mw * blockH * 1000
  const amount = kWh(withinMW) * rateWithin + kWh(beyondMW) * rateBeyond
  return {
    deviationMW,
    deviationPct: scheduleMW ? (deviationMW / scheduleMW) * 100 : 0,
    energyMWh: abs * blockH,
    freqBand: fb,
    bandMW,
    withinMW,
    beyondMW,
    multWithin: table.within,
    multBeyond: table.beyond,
    rateWithin,
    rateBeyond,
    amountRs: deviationMW >= 0 ? amount : -amount,
    nr,
    marginalRate: beyondMW > 0 ? rateBeyond : rateWithin,
  }
}
