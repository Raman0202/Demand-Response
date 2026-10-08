// DC power-flow screening model for the Karnataka network.
// Net import is picked up by ISTS tie points in proportion to their participation (distributed slack).
import { BUSES, LINES } from '@/data/karnataka'
import type { Line } from './types'

const INTERNAL = BUSES.filter((b) => !b.external)
const EXTERNAL = BUSES.filter((b) => b.external)
const PART_SUM = EXTERNAL.reduce((s, b) => s + (b.participation ?? 0), 0)

function km(a: string, b: string) {
  const A = BUSES.find((x) => x.id === a)!
  const B = BUSES.find((x) => x.id === b)!
  const dLat = (B.lat - A.lat) * 111
  const dLon = (B.lon - A.lon) * 111 * Math.cos(((A.lat + B.lat) / 2) * (Math.PI / 180))
  return Math.max(15, Math.hypot(dLat, dLon))
}

// series reactance (pu-ish, only ratios matter): longer + lower voltage = higher reactance
function reactance(l: Line) {
  const perKm = l.kv === 765 ? 0.35 : l.kv === 400 ? 1 : 3.2
  return km(l.from, l.to) * perKm * (l.hvdc ? 0.6 : 1)
}

export interface FlowResult {
  flows: Record<string, number> // MW, positive = from → to
  loading: Record<string, number> // |flow| / limit
  voltage: Record<string, number> // estimated pu
  injections: Record<string, number>
  maxLoading: { lineId: string; value: number }
  islanded: string[]
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-10) {
      M[c][c] = 1 // isolated bus — pin its angle
      continue
    }
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      if (f === 0) continue
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Bus net injection (gen − load) for internal buses; externals absorb the mismatch. */
export function solveDCPF(internalInjection: Record<string, number>, outaged: string[] = []): FlowResult {
  const lines = LINES.filter((l) => !outaged.includes(l.id))
  const inj: Record<string, number> = {}
  let sum = 0
  for (const b of INTERNAL) {
    inj[b.id] = internalInjection[b.id] ?? 0
    sum += inj[b.id]
  }
  for (const b of EXTERNAL) inj[b.id] = (-sum * (b.participation ?? 0)) / PART_SUM

  const ids = BUSES.map((b) => b.id)
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]))
  const n = ids.length
  const B = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const l of lines) {
    const y = 1 / reactance(l)
    const i = idx[l.from]
    const j = idx[l.to]
    B[i][i] += y
    B[j][j] += y
    B[i][j] -= y
    B[j][i] -= y
  }
  const ref = 0
  const keep = ids.map((_, i) => i).filter((i) => i !== ref)
  const Br = keep.map((i) => keep.map((j) => B[i][j]))
  const P = keep.map((i) => inj[ids[i]])
  const th = solveLinear(Br, P)
  const theta = new Array<number>(n).fill(0)
  keep.forEach((i, k) => (theta[i] = th[k]))

  const flows: Record<string, number> = {}
  const loading: Record<string, number> = {}
  let maxLoading = { lineId: '', value: 0 }
  for (const l of LINES) {
    if (outaged.includes(l.id)) {
      flows[l.id] = 0
      loading[l.id] = 0
      continue
    }
    const f = (theta[idx[l.from]] - theta[idx[l.to]]) / reactance(l)
    flows[l.id] = f
    loading[l.id] = Math.abs(f) / l.limitMW
    if (loading[l.id] > maxLoading.value) maxLoading = { lineId: l.id, value: loading[l.id] }
  }

  // voltage proxy: buses fed by heavily loaded lines sag; light buses float high
  const voltage: Record<string, number> = {}
  const islanded: string[] = []
  for (const b of BUSES) {
    const conn = lines.filter((l) => l.from === b.id || l.to === b.id)
    if (!conn.length) islanded.push(b.id)
    const worst = conn.reduce((m, l) => Math.max(m, loading[l.id]), 0)
    voltage[b.id] = +(1.035 - 0.075 * worst * worst).toFixed(4)
  }

  return { flows, loading, voltage, injections: inj, maxLoading, islanded }
}

/** Sensitivity of every line flow to +1 MW injection at `bus` (picked up by the ISTS ties). */
const ptdfCache = new Map<string, Record<string, number>>()
export function ptdf(bus: string, outaged: string[] = []): Record<string, number> {
  const key = bus + '|' + outaged.join(',')
  const hit = ptdfCache.get(key)
  if (hit) return hit
  const res = solveDCPF({ [bus]: 1 }, outaged).flows
  ptdfCache.set(key, res)
  return res
}

export const LINE_BY_ID = Object.fromEntries(LINES.map((l) => [l.id, l])) as Record<string, Line>

export function lineLabel(id: string) {
  const l = LINE_BY_ID[id]
  if (!l) return id
  if (l.name) return l.name
  const a = BUSES.find((b) => b.id === l.from)!.name.split(' ')[0]
  const b = BUSES.find((x) => x.id === l.to)!.name.split(' ')[0]
  return `${a}–${b} ${l.kv} kV`
}
