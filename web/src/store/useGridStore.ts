// Live state-grid telemetry (simulated SCADA/EMS feed) + scenario injection.
import { create } from 'zustand'
import { ASSETS, GENERATORS } from '@/data/karnataka'
import { assess, type Assessment } from '@/engine/decision'
import { BASELINE_SCENARIO, buildSnapshot, type ScenarioParams } from '@/engine/grid'
import { PRESETS } from '@/engine/scenarios'
import type { Direction, FlexAsset, GridSnapshot } from '@/engine/types'

export interface HistoryPoint {
  t: string
  frequency: number
  demand: number
  schedule: number
  drawal: number
  ace: number
}

export interface LiveDispatch {
  eventId: string
  direction: Direction
  mw: Record<string, number> // assetId → MW currently delivered
}

interface GridState {
  simMinutes: number
  running: boolean
  scenario: ScenarioParams
  activePresetId: string | null
  noise: { demand: number; freq: number }
  snapshot: GridSnapshot
  assessment: Assessment
  history: HistoryPoint[]
  assets: FlexAsset[]
  dispatch: LiveDispatch | null
  tick: () => void
  setRunning: (r: boolean) => void
  setScenario: (p: Partial<ScenarioParams>) => void
  applyPreset: (id: string) => void
  resetScenario: () => void
  setDispatch: (d: LiveDispatch | null) => void
  updateAsset: (id: string, patch: Partial<FlexAsset>) => void
}

export function fmtClock(min: number) {
  const m = ((min % 1440) + 1440) % 1440
  const h = Math.floor(m / 60)
  const mm = Math.floor(m % 60)
  const ss = Math.floor((m * 60) % 60)
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export function blockOf(min: number) {
  return Math.floor((((min % 1440) + 1440) % 1440) / 15) + 1
}

/** Apply delivered DR/BESS/generation to the raw snapshot so the live view reflects dispatch. */
export function withDispatch(s: GridSnapshot, d: LiveDispatch | null, assets: FlexAsset[]): GridSnapshot {
  if (!d) return s
  const sign = d.direction === 'UP' ? 1 : -1
  const busLoad = { ...s.busLoad }
  const genOutput = { ...s.genOutput }
  let demand = s.demandMW
  let stateGen = s.stateGenMW
  for (const [id, mw] of Object.entries(d.mw)) {
    const a = assets.find((x) => x.id === id)
    if (!a) continue
    if (a.type === 'generation') {
      const g = GENERATORS.find((x) => x.bus === a.bus && (x.type === 'coal' || x.type === 'hydro'))
      if (g) genOutput[g.id] = (genOutput[g.id] ?? 0) + sign * mw
      stateGen += sign * mw
    } else if (a.type === 'bess') {
      busLoad[a.bus] = (busLoad[a.bus] ?? 0) - sign * mw
      stateGen += sign * mw
    } else {
      busLoad[a.bus] = (busLoad[a.bus] ?? 0) - sign * mw
      demand -= sign * mw
    }
  }
  const external = demand - stateGen - s.centralInStateMW
  return { ...s, busLoad, genOutput, demandMW: demand, stateGenMW: stateGen, externalImportMW: external, drawalMW: external + s.centralInStateMW }
}

const START_MIN = 14 * 60 + 52

function compute(scenario: ScenarioParams, noise: GridState['noise'], min: number, d: LiveDispatch | null, assets: FlexAsset[]) {
  const raw = buildSnapshot(scenario, noise, fmtClock(min).slice(0, 5))
  const snapshot = withDispatch(raw, d, assets)
  return { snapshot, assessment: assess(snapshot) }
}

const init = compute(BASELINE_SCENARIO, { demand: 0, freq: 0 }, START_MIN, null, ASSETS)

export const useGridStore = create<GridState>((set, get) => ({
  simMinutes: START_MIN,
  running: true,
  scenario: BASELINE_SCENARIO,
  activePresetId: null,
  noise: { demand: 0, freq: 0 },
  snapshot: init.snapshot,
  assessment: init.assessment,
  history: Array.from({ length: 60 }, (_, i) => {
    const f = 50 + Math.sin(i / 5) * 0.012
    return {
      t: fmtClock(START_MIN - (60 - i) * 0.25).slice(0, 5),
      frequency: +f.toFixed(3),
      demand: init.snapshot.demandMW + Math.sin(i / 7) * 25,
      schedule: init.snapshot.scheduleMW,
      drawal: init.snapshot.drawalMW + Math.sin(i / 7) * 25,
      ace: -Math.sin(i / 7) * 25 + 1600 * (f - 50),
    }
  }),
  assets: ASSETS,
  dispatch: null,

  tick: () => {
    const st = get()
    if (!st.running) return
    const simMinutes = st.simMinutes + 0.25
    const noise = {
      demand: Math.max(-60, Math.min(60, st.noise.demand * 0.92 + (Math.random() - 0.5) * 18)),
      freq: Math.max(-0.02, Math.min(0.02, st.noise.freq * 0.85 + (Math.random() - 0.5) * 0.008)),
    }
    // frequency recovers as the state closes its ACE (simple droop feedback for the live view)
    const { snapshot, assessment } = compute(st.scenario, noise, simMinutes, st.dispatch, st.assets)
    if (st.dispatch && st.scenario.frequency < 50) {
      const devRaw = buildSnapshot(st.scenario, noise).drawalMW - snapshot.scheduleMW
      const closed = devRaw > 0 ? Math.min(1, (devRaw - assessment.deviationMW) / devRaw) : 0
      snapshot.frequency = +(snapshot.frequency + (50 - st.scenario.frequency) * closed * 0.6).toFixed(3)
    }
    const a2 = st.dispatch ? assess(snapshot) : assessment
    const point: HistoryPoint = {
      t: fmtClock(simMinutes).slice(0, 5),
      frequency: snapshot.frequency,
      demand: snapshot.demandMW,
      schedule: snapshot.scheduleMW,
      drawal: snapshot.drawalMW,
      ace: a2.ace.ace,
    }
    set({ simMinutes, noise, snapshot, assessment: a2, history: [...st.history.slice(-89), point] })
  },

  setRunning: (running) => set({ running }),

  setScenario: (p) => {
    const st = get()
    const scenario = { ...st.scenario, ...p }
    set({ scenario, activePresetId: null, ...compute(scenario, st.noise, st.simMinutes, st.dispatch, st.assets) })
  },

  applyPreset: (id) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    const st = get()
    const scenario = { ...BASELINE_SCENARIO, ...preset.params }
    set({ scenario, activePresetId: id, ...compute(scenario, st.noise, st.simMinutes, st.dispatch, st.assets) })
  },

  resetScenario: () => {
    const st = get()
    set({ scenario: BASELINE_SCENARIO, activePresetId: null, ...compute(BASELINE_SCENARIO, st.noise, st.simMinutes, st.dispatch, st.assets) })
  },

  setDispatch: (dispatch) => {
    const st = get()
    set({ dispatch, ...compute(st.scenario, st.noise, st.simMinutes, dispatch, st.assets) })
  },

  updateAsset: (id, patch) => set((st) => ({ assets: st.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
}))
