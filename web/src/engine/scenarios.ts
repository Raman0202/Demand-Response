import type { ScenarioParams } from './grid'

export interface ScenarioPreset {
  id: string
  title: string
  summary: string
  tag: 'Deficit' | 'Network' | 'Market' | 'Resilience' | 'Emergency' | 'Surplus'
  params: Partial<ScenarioParams>
}

export const PRESETS: ScenarioPreset[] = [
  {
    id: 'cloud',
    title: 'Cloud cover over Pavagada',
    summary: '900 MW solar drop in 10 min across Pavagada & Ballari clusters; frequency sags to 49.89 Hz.',
    tag: 'Deficit',
    params: { reDropMW: 900, demandShockMW: 150, shockRegion: 'STATEWIDE', frequency: 49.89 },
  },
  {
    id: 'heatwave',
    title: 'Bengaluru heatwave peak',
    summary: 'HVAC-driven +700 MW in BESCOM metro. Bengaluru 400 kV ring gets tight.',
    tag: 'Network',
    params: { demandShockMW: 700, shockRegion: 'BENGALURU', frequency: 49.9 },
  },
  {
    id: 'outage',
    title: 'Outage: Hoody–Kolar 400 kV',
    summary: 'Line trips during metro peak; Talcher–Kolar HVDC power re-routes through the Nelamangala ring. DR must be location-aware.',
    tag: 'Network',
    params: { outagedLines: ['L4'], demandShockMW: 300, shockRegion: 'BENGALURU', frequency: 49.93 },
  },
  {
    id: 'rtm',
    title: 'Wind lull + RTM price spike',
    summary: '600 MW RE shortfall while RTM clears at ₹11/kWh — the market is not the cheapest option.',
    tag: 'Market',
    params: { reDropMW: 600, frequency: 49.88, prices: { damAcp: 6.1, rtmAcp: 11, asc: 9.2, offPeak: 3.2 }, durationBlocks: 8 },
  },
  {
    id: 'comms',
    title: 'Comms failure during event',
    summary: 'Cauvery pumping and Toranagallu steel lose heartbeat; the Digital Twin must catch it and re-solve.',
    tag: 'Resilience',
    params: { demandShockMW: 450, shockRegion: 'STATEWIDE', frequency: 49.88, heartbeatLost: ['A_BWSSB', 'A_JSW'] },
  },
  {
    id: 'noncompliance',
    title: 'Industrial DR 50% non-compliance',
    summary: 'Industrial reliability halves; the optimizer re-ranks by expected (not contracted) MW.',
    tag: 'Resilience',
    params: { demandShockMW: 500, shockRegion: 'STATEWIDE', frequency: 49.9, industrialCompliance: 0.5 },
  },
  {
    id: 'trip',
    title: 'Severe: 1,500 MW generation loss',
    summary: 'Large unit + RE loss, 49.76 Hz. Emergency layer releases emergency DR; ADMS is last resort.',
    tag: 'Emergency',
    params: { demandShockMW: 900, reDropMW: 600, shockRegion: 'STATEWIDE', frequency: 49.76 },
  },
  {
    id: 'surplus',
    title: 'Surplus: solar noon + low demand',
    summary: 'Under-drawal at 50.08 Hz. Charge BESS, advance ag pumping, back down thermal.',
    tag: 'Surplus',
    params: { demandShockMW: -550, shockRegion: 'STATEWIDE', frequency: 50.08 },
  },
]
