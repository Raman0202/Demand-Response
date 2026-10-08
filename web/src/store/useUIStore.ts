import { create } from 'zustand'
import type { OperatingMode } from '@/engine/types'

export type Page = 'monitor' | 'decision' | 'scenario' | 'flexibility' | 'settlement' | 'audit'

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
}

export type Selection = { kind: 'bus' | 'asset' | 'gen' | 'line'; id: string } | null

interface UIState {
  page: Page
  mode: OperatingMode
  layers: MapLayers
  camera: CameraPreset
  cameraNonce: number
  selection: Selection
  hovered: Selection
  setPage: (p: Page) => void
  setMode: (m: OperatingMode) => void
  toggleLayer: (k: keyof MapLayers) => void
  setCamera: (c: CameraPreset) => void
  select: (s: Selection) => void
  hover: (s: Selection) => void
}

export const useUIStore = create<UIState>((set) => ({
  page: 'monitor',
  mode: 'ADVISORY',
  layers: { grid: true, flows: true, generation: true, dr: true, bess: true, labels: true, ties: true, heat: true },
  camera: 'STATE',
  cameraNonce: 0,
  selection: null,
  hovered: null,
  setPage: (page) => set({ page }),
  setMode: (mode) => set({ mode }),
  toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
  setCamera: (camera) => set((s) => ({ camera, cameraNonce: s.cameraNonce + 1 })),
  select: (selection) => set({ selection }),
  hover: (hovered) => set({ hovered }),
}))
