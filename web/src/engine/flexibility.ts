// Flexibility engine: what each asset can *really* deliver right now.
//   F_up = min(baseline − P_min, contracted (state share), technical/energy limit)
//   expected = available × reliability
import { BLOCK_MIN } from '@/data/karnataka'
import type { Direction, FlexAsset, GridSnapshot, MarketPrices, Severity } from './types'

export interface FlexEvaluation {
  asset: FlexAsset
  technicalMW: number
  contractStateMW: number
  emergencyMW: number
  lockedMW: number // SRAS + TRAS — never dispatched in STATE_MODE
  availableMW: number
  reliability: number
  expectedMW: number
  earliestBlock: number
  maxBlocks: number
  bidRs: number
  opportunityRs: number
  reboundRs: number
  effectiveCost: number // ₹ per expected kWh
  eligible: boolean
  exclusions: string[]
  notes: string[]
}

export function evaluateAsset(a: FlexAsset, s: GridSnapshot, direction: Direction, severity: Severity, reliabilityOverride?: number): FlexEvaluation {
  const durationH = (s.durationBlocks * BLOCK_MIN) / 60
  const notes: string[] = []
  const exclusions: string[] = []
  let technical = 0
  let bid = a.bidRs
  let opp = a.opportunityRs

  if (a.type === 'bess' && a.bess) {
    const b = a.bess
    const power = a.maxLoadMW * s.bessAvailability
    if (direction === 'UP') {
      const energyMW = ((b.soc - b.socMin) * b.energyMWh * b.etaD) / durationH
      technical = Math.max(0, Math.min(power, energyMW))
      if (energyMW < power) notes.push(`SoC-limited: ${(b.soc * 100).toFixed(0)}% → ${energyMW.toFixed(0)} MW for ${durationH} h`)
      opp = recharge(s.prices, b.etaC, b.etaD)
    } else {
      const roomMW = ((b.socMax - b.soc) * b.energyMWh) / b.etaC / durationH
      technical = Math.max(0, Math.min(power, roomMW))
      opp = 0
      bid = b.degRs
    }
    if (s.bessAvailability < 1) notes.push(`Fleet availability ${(s.bessAvailability * 100).toFixed(0)}%`)
  } else if (a.type === 'generation') {
    technical = direction === 'UP' ? a.maxLoadMW - a.baselineMW : a.baselineMW - a.minLoadMW
    if (direction === 'DOWN') bid = -a.bidRs * 0.6 // fuel saved
  } else {
    technical = direction === 'UP' ? a.baselineMW - a.minLoadMW : a.maxLoadMW - a.baselineMW
  }

  const contractState = Math.min(a.reserve.state, a.contractMW)
  const emergency = severity === 'EMERGENCY' ? a.reserve.emergency : 0
  const locked = a.reserve.sras + a.reserve.tras
  let available = Math.max(0, Math.min(technical, contractState + emergency))
  if (emergency > 0) notes.push(`+${emergency} MW emergency share released`)
  if (locked > 0) notes.push(`${locked} MW locked to ancillary (SRAS/TRAS)`)

  let reliability = reliabilityOverride ?? a.reliability
  if (a.type === 'industrial') reliability *= s.industrialCompliance
  if (!a.telemetryOk) exclusions.push('Telemetry/SCADA link down in registry')
  if (available < 0.5) exclusions.push(direction === 'UP' ? 'No upward headroom' : 'No downward headroom')
  if (a.type === 'bess' && s.bessAvailability === 0) exclusions.push('BESS fleet unavailable')

  // rebound energy re-consumed later at off-peak prices
  const reboundRs = a.reboundFrac * s.prices.offPeak * 0.5
  const effectiveCost = (bid + opp + reboundRs) / Math.max(reliability, 0.05)

  const earliestBlock = a.responseMin <= BLOCK_MIN ? 0 : Math.ceil(a.responseMin / BLOCK_MIN) - 1
  const maxBlocks = Math.max(1, Math.floor(a.maxDurationMin / BLOCK_MIN))
  available = +available.toFixed(1)

  return {
    asset: a,
    technicalMW: Math.max(0, technical),
    contractStateMW: contractState,
    emergencyMW: emergency,
    lockedMW: locked,
    availableMW: available,
    reliability,
    expectedMW: available * reliability,
    earliestBlock,
    maxBlocks,
    bidRs: bid,
    opportunityRs: opp,
    reboundRs,
    effectiveCost,
    eligible: exclusions.length === 0,
    exclusions,
    notes,
  }
}

function recharge(p: MarketPrices, etaC: number, etaD: number) {
  return p.offPeak / (etaC * etaD)
}

export function evaluateFleet(assets: FlexAsset[], s: GridSnapshot, direction: Direction, severity: Severity, learned: Record<string, number> = {}) {
  return assets.map((a) => evaluateAsset(a, s, direction, severity, learned[a.id]))
}
