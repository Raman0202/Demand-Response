// Spatial model shared by the map workspace: where things are, what a selection touches, and how alarms map to places.
import { ASSETS, BUS_BY_ID, GEN_STATIONS, GENERATORS, LINES, LOAD_CHANNELS, lineLabel } from '@/data/topology'
import type { Alarm } from '@/data/types'
import { project } from '@/lib/geo'
import type { Selection } from '@/store/useUI'

export type Sel = NonNullable<Selection>

/** World-space anchor (x, z) and a sensible camera distance for a selection. */
export function worldOf(sel: Sel, eventAssets: string[] = []): { x: number; z: number; dist: number } | null {
  const at = (lon: number, lat: number, dist: number) => {
    const [x, z] = project(lon, lat)
    return { x, z, dist }
  }
  switch (sel.kind) {
    case 'bus': {
      const b = BUS_BY_ID[sel.id]
      return b ? at(b.lon, b.lat, 3.8) : null
    }
    case 'asset': {
      const a = ASSETS.find((x) => x.id === sel.id)
      return a ? at(a.lon, a.lat, 3.6) : null
    }
    case 'gen': {
      const g = GENERATORS.find((x) => x.id === sel.id)
      return g ? at(g.lon, g.lat, 3) : null
    }
    case 'channel': {
      const c = LOAD_CHANNELS.find((x) => x.id === sel.id)
      return c ? at(c.lon, c.lat, 3.2) : null
    }
    case 'station': {
      const g = GEN_STATIONS.find((x) => x.id === sel.id)
      return g ? at(g.lon, g.lat, 2.8) : null
    }
    case 'line': {
      const l = LINES.find((x) => x.id === sel.id)
      const a = l && BUS_BY_ID[l.from]
      const b = l && BUS_BY_ID[l.to]
      if (!a || !b) return null
      const [ax, az] = project(a.lon, a.lat)
      const [bx, bz] = project(b.lon, b.lat)
      return { x: (ax + bx) / 2, z: (az + bz) / 2, dist: Math.min(9, 2.4 + Math.hypot(ax - bx, az - bz) * 1.1) }
    }
    case 'event': {
      // centroid of the event's participants; spread decides how far back the camera sits
      const pts = eventAssets.map((id) => ASSETS.find((x) => x.id === id)).filter((a): a is NonNullable<typeof a> => !!a && a.type !== 'generation')
      const use = pts.length ? pts : ASSETS.filter((a) => a.type !== 'generation')
      const xy = use.map((a) => project(a.lon, a.lat))
      const x = xy.reduce((s, p) => s + p[0], 0) / xy.length
      const z = xy.reduce((s, p) => s + p[1], 0) / xy.length
      const spread = Math.max(...xy.map((p) => Math.hypot(p[0] - x, p[1] - z)), 0.5)
      return { x, z, dist: Math.min(13, 3 + spread * 2.4) }
    }
  }
  return null
}

/** Lines and participants a selection affects — they light up on the map. */
export function affected(sel: Sel, eventAssets: string[] = [], eventLines: string[] = []): { lines: string[]; assets: string[] } {
  const atBuses = (buses: string[]) => ASSETS.filter((a) => buses.includes(a.bus)).map((a) => a.id)
  const linesAt = (bus: string) => LINES.filter((l) => l.from === bus || l.to === bus).map((l) => l.id)
  switch (sel.kind) {
    case 'line': {
      const l = LINES.find((x) => x.id === sel.id)
      return l ? { lines: [l.id], assets: atBuses([l.from, l.to]) } : { lines: [], assets: [] }
    }
    case 'bus':
      return { lines: linesAt(sel.id), assets: atBuses([sel.id]) }
    case 'asset': {
      const a = ASSETS.find((x) => x.id === sel.id)
      return a ? { lines: linesAt(a.bus), assets: [a.id] } : { lines: [], assets: [] }
    }
    case 'channel': {
      const c = LOAD_CHANNELS.find((x) => x.id === sel.id)
      return c ? { lines: linesAt(c.parent_bus), assets: atBuses([c.parent_bus]) } : { lines: [], assets: [] }
    }
    case 'gen':
    case 'station': {
      const g = sel.kind === 'gen' ? GENERATORS.find((x) => x.id === sel.id) : GENERATORS.find((x) => x.id === GEN_STATIONS.find((s) => s.id === sel.id)?.model_gen)
      return g ? { lines: linesAt(g.bus), assets: [] } : { lines: [], assets: [] }
    }
    case 'event':
      return { lines: eventLines, assets: eventAssets }
  }
  return { lines: [], assets: [] }
}

/** Where an alarm lives on the map (null for system-wide alarms such as ACE or data confidence). */
export function alarmSelection(a: Pick<Alarm, 'key'>): Sel | null {
  const [kind, id] = a.key.split(':')
  if ((kind === 'LINE' || kind === 'OUTAGE' || kind === 'PRED') && LINES.some((l) => l.id === id)) return { kind: 'line', id }
  if (kind === 'ASSET' && ASSETS.some((x) => x.id === id)) return { kind: 'asset', id }
  if (kind === 'POINT') {
    // POINT:bus.HOO.load · POINT:gen.G_BSOL.mw · POINT:asset.A_X.mw
    const [, p1, p2] = a.key.split(/[:.]/)
    if (p1 === 'bus' && BUS_BY_ID[p2]) return { kind: 'bus', id: p2 }
    if (p1 === 'gen' && GENERATORS.some((g) => g.id === p2)) return { kind: 'gen', id: p2 }
    if (p1 === 'asset' && ASSETS.some((x) => x.id === p2)) return { kind: 'asset', id: p2 }
  }
  return null
}

export function selectionLabel(sel: Sel): string {
  switch (sel.kind) {
    case 'line':
      return lineLabel(sel.id)
    case 'bus':
      return BUS_BY_ID[sel.id]?.name ?? sel.id
    case 'asset':
      return ASSETS.find((x) => x.id === sel.id)?.short ?? sel.id
    case 'gen':
      return GENERATORS.find((x) => x.id === sel.id)?.name ?? sel.id
    case 'channel':
      return LOAD_CHANNELS.find((x) => x.id === sel.id)?.name ?? sel.id
    case 'station':
      return GEN_STATIONS.find((x) => x.id === sel.id)?.name ?? sel.id
    case 'event':
      return `DR event ${sel.id}`
  }
}

/** Camera framing for a group of participants (centroid, pulled back by their spread). */
export function frameAssets(ids: string[]): { x: number; z: number; dist: number } | null {
  return ids.length ? worldOf({ kind: 'event', id: '' }, ids) : null
}
