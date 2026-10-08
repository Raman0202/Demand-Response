// Core domain types for the Karnataka State Flexibility & DR platform.

export type Discom = 'BESCOM' | 'MESCOM' | 'HESCOM' | 'GESCOM' | 'CESC'

export type AssetType =
  | 'interruptible' // Type A — can be reduced immediately
  | 'shiftable' // Type B — energy moves in time (rebound)
  | 'bess' // Type C — MW + MWh
  | 'industrial' // Type D — process-aware industrial DR
  | 'der' // Type E — prosumer / DER / EV fleets
  | 'generation' // intra-state generation re-dispatch headroom

export type Direction = 'UP' | 'DOWN' // UP = state needs more supply / less load

export type Severity = 'NORMAL' | 'ALERT' | 'EMERGENCY'

export type OperatingMode = 'SHADOW' | 'ADVISORY' | 'CLOSED_LOOP'

export interface Bus {
  id: string
  name: string
  lon: number
  lat: number
  kv: 765 | 400 | 220
  discom?: Discom
  loadShare: number // share of state demand drawn at this bus
  external?: boolean // ISTS tie point outside Karnataka
  participation?: number // share of net import picked up at this tie (distributed slack)
  region?: 'BENGALURU' | 'SOUTH' | 'COASTAL' | 'CENTRAL' | 'NORTH'
}

export interface Line {
  id: string
  from: string
  to: string
  kv: 765 | 400 | 220
  limitMW: number
  hvdc?: boolean
  name?: string
}

export type GenType = 'coal' | 'hydro' | 'solar' | 'wind' | 'nuclear'

export interface Generator {
  id: string
  name: string
  bus: string
  type: GenType
  capacityMW: number
  baseMW: number // afternoon-peak dispatch
  owner: 'State' | 'Central' | 'IPP'
  lon: number
  lat: number
}

export interface Reservation {
  state: number // MW available to SLDC state DR (STATE_MODE)
  sras: number // committed to SRAS (ANCILLARY_MODE) — locked
  tras: number // committed to TRAS (ANCILLARY_MODE) — locked
  emergency: number // released only in EMERGENCY layer
}

export interface BessSpec {
  energyMWh: number
  soc: number // 0..1
  socMin: number
  socMax: number
  etaC: number
  etaD: number
  degRs: number // ₹/kWh degradation
}

export interface FlexAsset {
  id: string
  name: string
  short: string
  type: AssetType
  discom: Discom | 'KPCL' | 'IPP'
  bus: string
  lon: number
  lat: number
  baselineMW: number // current/expected consumption (or output for generation)
  minLoadMW: number // minimum technical load (or tech min for generation)
  maxLoadMW: number // max technical load (or capacity for generation)
  contractMW: number
  reserve: Reservation
  responseMin: number // time to start responding
  rampMWpm: number
  maxDurationMin: number
  recoveryMin: number
  reboundFrac: number // share of curtailed energy that comes back after release
  bidRs: number // incentive / variable cost ₹/kWh
  opportunityRs: number // production loss / opportunity ₹/kWh
  reliability: number // historical P(delivered ≥ contracted)
  telemetryOk: boolean
  protocol: 'IEC-104' | 'OpenADR 3' | 'Modbus TCP' | 'OPC UA' | 'ICCP'
  bess?: BessSpec
  description: string
}

export interface MarketPrices {
  damAcp: number // ₹/kWh weighted avg ACP (integrated DAM)
  rtmAcp: number // ₹/kWh weighted avg ACP (RTM)
  asc: number // ₹/kWh ancillary service charge
  offPeak: number // ₹/kWh recharge / rebound energy price
}

export interface GridSnapshot {
  time: string
  frequency: number
  demandMW: number
  scheduleMW: number // scheduled drawal from ISTS
  drawalMW: number // actual drawal from ISTS
  stateGenMW: number
  centralInStateMW: number
  reMW: number
  externalImportMW: number
  genByType: Record<GenType, number>
  genOutput: Record<string, number>
  busLoad: Record<string, number>
  prices: MarketPrices
  outagedLines: string[]
  heartbeatLost: string[]
  bessAvailability: number // 0..1
  industrialCompliance: number // 0..1 multiplier on reliability
  durationBlocks: number
}
