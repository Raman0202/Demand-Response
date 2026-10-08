import { create } from 'zustand'

export type Page = 'command' | 'operations' | 'decisions' | 'alarms' | 'analysis' | 'whatif' | 'resources' | 'reports' | 'admin'

export type CameraPreset = 'STATE' | 'BENGALURU' | 'NORTH' | 'COAST' | 'TILT'

export interface MapLayers {
  grid: boolean
  flows: boolean
  generation: boolean
  dr: boolean
  bess: boolean
  labels: boolean
  ties: boolean
  heat: boolean
  ch220: boolean
  genStations: boolean
}

export type Selection = { kind: 'bus' | 'asset' | 'gen' | 'line' | 'channel' | 'station'; id: string } | null

interface UIState {
  page: Page
  decisionId: string | null
  layers: MapLayers
  camera: CameraPreset
  cameraNonce: number
  selection: Selection
  hovered: Selection
  go: (p: Page, decisionId?: string | null) => void
  toggleLayer: (k: keyof MapLayers) => void
  setCamera: (c: CameraPreset) => void
  select: (s: Selection) => void
  hover: (s: Selection) => void
}

export const useUI = create<UIState>((set) => ({
  page: 'command',
  decisionId: null,
  layers: { grid: true, flows: true, generation: true, dr: true, bess: true, labels: true, ties: true, heat: true, ch220: true, genStations: true },
  camera: 'STATE',
  cameraNonce: 0,
  selection: null,
  hovered: null,
  go: (page, decisionId) => set((s) => ({ page, decisionId: decisionId === undefined ? s.decisionId : decisionId, selection: null })),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setCamera: (camera) => set((s) => ({ camera, cameraNonce: s.cameraNonce + 1 })),
  select: (selection) => set({ selection }),
  hover: (hovered) => set({ hovered }),
}))
