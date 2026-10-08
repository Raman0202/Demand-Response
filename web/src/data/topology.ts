// Live-bound topology registry, filled once from GET /api/v1/topology.
// ES-module `let` exports are live bindings, so 3D components read the loaded model directly.
import type { Asset, Bus, Generator, GenStation, Line, LoadChannel, Topology } from './types'

export let BUSES: Bus[] = []
export let LINES: Line[] = []
export let GENERATORS: Generator[] = []
export let ASSETS: Asset[] = []
export let LOAD_CHANNELS: LoadChannel[] = []
export let GEN_STATIONS: GenStation[] = []
export let KARNATAKA_BOUNDARY: [number, number][] = []
export let SLDC = { name: 'KPTCL SLDC', lon: 77.585, lat: 12.975 }
export let BUS_BY_ID: Record<string, Bus> = {}
export let ASSET_BY_ID: Record<string, Asset> = {}
export let LINE_BY_ID: Record<string, Line> = {}

export function setTopology(t: Topology) {
  BUSES = t.buses
  LINES = t.lines
  GENERATORS = t.generators
  ASSETS = t.assets
  LOAD_CHANNELS = t.channels.load_channels
  GEN_STATIONS = t.channels.gen_stations
  KARNATAKA_BOUNDARY = t.boundary
  SLDC = t.sldc
  BUS_BY_ID = Object.fromEntries(t.buses.map((b) => [b.id, b]))
  ASSET_BY_ID = Object.fromEntries(t.assets.map((a) => [a.id, a]))
  LINE_BY_ID = Object.fromEntries(t.lines.map((l) => [l.id, l]))
}

export function lineLabel(id: string) {
  const l = LINE_BY_ID[id]
  if (!l) return id
  if (l.name) return l.name
  return `${BUS_BY_ID[l.from]?.name.split(' ')[0]}–${BUS_BY_ID[l.to]?.name.split(' ')[0]} ${l.kv} kV`
}

export const DISCOM_COLORS: Record<string, string> = {
  BESCOM: '#38bdf8',
  MESCOM: '#2dd4bf',
  HESCOM: '#a78bfa',
  GESCOM: '#f59e0b',
  CESC: '#f472b6',
  KPCL: '#94a3b8',
  IPP: '#94a3b8',
}

export const ASSET_TYPE_META: Record<string, { label: string; color: string; letter: string }> = {
  interruptible: { label: 'Interruptible', color: '#22d3ee', letter: 'A' },
  shiftable: { label: 'Shiftable', color: '#84cc16', letter: 'B' },
  bess: { label: 'BESS', color: '#10b981', letter: 'C' },
  industrial: { label: 'Industrial', color: '#f59e0b', letter: 'D' },
  der: { label: 'DER / EV', color: '#a855f7', letter: 'E' },
  generation: { label: 'Generation', color: '#64748b', letter: 'G' },
  rtm: { label: 'Market', color: '#6366f1', letter: 'M' },
}
