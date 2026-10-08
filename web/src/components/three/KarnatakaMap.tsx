import { Suspense, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { Battery, Factory, Layers, Map as MapIcon, Mountain, RadioTower, Tag, Waves, X, Zap } from 'lucide-react'
import { ASSET_BY_ID, ASSET_TYPE_META, BUS_BY_ID, BUSES, GENERATORS, LINES, SLDC } from '@/data/karnataka'
import type { FlexAsset } from '@/engine/types'
import { busInjections } from '@/engine/grid'
import { lineLabel, solveDCPF } from '@/engine/network'
import { fmtMW, loadingColor, project, STATE_TOP } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { useGridStore } from '@/store/useGridStore'
import { useUIStore, type CameraPreset, type MapLayers, type Selection } from '@/store/useUIStore'
import type { DispatchPhase } from '@/store/useDecisionStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CameraRig, CommandWave, type WaveTarget } from './Effects'
import { GridLines } from './GridLines'
import { LabelLayer, LabelProjector, type MapLabel } from './Labels'
import { STATUS_COLOR, type Focus } from './focus'
import { FlexAssets, Generators, SldcBeacon, Substations, TieArrows } from './Nodes'
import { HeatLayer, StateShape } from './StateShape'

export interface MapOverlay {
  focus?: Focus
  loading?: Record<string, number>
  flows?: Record<string, number>
  highlightLines?: string[]
  wave?: { targets: WaveTarget[]; phase: DispatchPhase }
  caption?: string
}

export function KarnatakaMap({ overlay, className, compact }: { overlay?: MapOverlay; className?: string; compact?: boolean }) {
  const snapshot = useGridStore((s) => s.snapshot)
  const assets = useGridStore((s) => s.assets)
  const layers = useUIStore((s) => s.layers)

  const net = useMemo(() => solveDCPF(busInjections(snapshot), snapshot.outagedLines), [snapshot])
  const loading = overlay?.loading ?? net.loading
  const flows = overlay?.flows ?? net.flows

  const labelLayer = useRef<HTMLDivElement>(null)
  const labels = useMapLabels(layers, net.injections, overlay?.focus ?? {}, assets)

  const stress = useMemo(() => {
    const out: Record<string, number> = {}
    for (const l of LINES) {
      const v = loading[l.id] ?? 0
      out[l.from] = Math.max(out[l.from] ?? 0, v)
      out[l.to] = Math.max(out[l.to] ?? 0, v)
    }
    return out
  }, [loading])

  return (
    <div className={cn('relative h-full min-h-[320px] w-full overflow-hidden rounded-xl border bg-[#f1f5fb]', className)}>
      <Canvas flat camera={{ position: [0.4, 11.2, 8.8], fov: 42, near: 0.05, far: 200 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={['#f1f5fb']} />
        <fog attach="fog" args={['#f1f5fb', 16, 34]} />
        <ambientLight intensity={0.95} />
        <directionalLight position={[5, 10, 4]} intensity={1.1} />
        <directionalLight position={[-6, 4, -5]} intensity={0.35} color="#7dd3fc" />
        <Suspense fallback={null}>
          <Grid
            position={[0, -0.001, 0]}
            args={[40, 40]}
            cellSize={0.4}
            cellThickness={0.4}
            cellColor="#e1e8f2"
            sectionSize={2}
            sectionThickness={0.8}
            sectionColor="#cdd8e8"
            fadeDistance={26}
            infiniteGrid
          />
          <StateShape />
          {layers.heat && <HeatLayer busLoad={snapshot.busLoad} stress={stress} />}
          {layers.grid && <GridLines flows={flows} loading={loading} outaged={snapshot.outagedLines} showFlows={layers.flows} highlight={overlay?.highlightLines} />}
          {layers.grid && <Substations stress={stress} />}
          {layers.generation && <Generators output={snapshot.genOutput} focus={overlay?.focus ?? {}} />}
          <FlexAssets assets={assets} focus={overlay?.focus ?? {}} layers={layers} />
          {layers.ties && <TieArrows />}
          <SldcBeacon />
          {overlay?.wave && <CommandWave targets={overlay.wave.targets} phase={overlay.wave.phase} />}
          <CameraRig />
          <LabelProjector labels={labels} layer={labelLayer} />
        </Suspense>
      </Canvas>
      <LabelLayer labels={labels} layer={labelLayer} />
      <MapToolbar compact={compact} />
      <HoverCard flows={flows} loading={loading} />
      {!compact && <Legend />}
      {overlay?.caption && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-700 shadow-sm ring-1 ring-slate-900/10">
          {overlay.caption}
        </div>
      )}
      <Inspector flows={flows} loading={loading} />
    </div>
  )
}

const CAMS: { id: CameraPreset; label: string }[] = [
  { id: 'STATE', label: 'State' },
  { id: 'BENGALURU', label: 'Bengaluru' },
  { id: 'NORTH', label: 'North KA' },
  { id: 'COAST', label: 'Coast & Ghats' },
  { id: 'TILT', label: '3D tilt' },
]

const LAYER_DEFS: { k: keyof MapLayers; label: string; icon: typeof Zap }[] = [
  { k: 'grid', label: 'Transmission grid', icon: Zap },
  { k: 'flows', label: 'Animated power flow', icon: Waves },
  { k: 'generation', label: 'Generation', icon: Mountain },
  { k: 'dr', label: 'DR fleets', icon: Factory },
  { k: 'bess', label: 'BESS', icon: Battery },
  { k: 'ties', label: 'ISTS tie points', icon: RadioTower },
  { k: 'heat', label: 'Load heat', icon: Layers },
  { k: 'labels', label: 'Labels', icon: Tag },
]

function MapToolbar({ compact }: { compact?: boolean }) {
  const cam = useUIStore((s) => s.camera)
  const setCamera = useUIStore((s) => s.setCamera)
  const layers = useUIStore((s) => s.layers)
  const toggle = useUIStore((s) => s.toggleLayer)
  return (
    <div className="absolute top-3 left-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-white/90 p-1 ring-1 ring-slate-900/10 backdrop-blur">
        <MapIcon className="mx-1 size-4 self-center text-sky-600" />
        {CAMS.filter((c) => !compact || c.id !== 'COAST').map((c) => (
          <button
            key={c.id}
            onClick={() => setCamera(c.id)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-900/5',
              cam === c.id && 'bg-sky-100 text-sky-700 ring-1 ring-sky-300',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1 rounded-lg bg-white/90 p-1 ring-1 ring-slate-900/10 backdrop-blur">
        {LAYER_DEFS.map(({ k, label, icon: Icon }) => (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggle(k)}
                className={cn('rounded-md p-1.5 text-slate-500 transition hover:bg-slate-900/5', layers[k] && 'bg-sky-100 text-sky-700')}
                aria-label={label}
              >
                <Icon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/90 p-2 text-[10px] text-slate-700 ring-1 ring-slate-900/10 backdrop-blur">
      <div className="mb-1 font-semibold text-slate-800">Line loading</div>
      <div className="flex gap-2">
        {[
          ['<75%', 0.5],
          ['75–90%', 0.8],
          ['90–100%', 0.95],
          ['>100%', 1.1],
        ].map(([l, v]) => (
          <span key={l as string} className="flex items-center gap-1">
            <span className="h-1 w-4 rounded" style={{ background: loadingColor(v as number) }} />
            {l}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="h-1 w-4 rounded bg-violet-400" /> HVDC
        </span>
      </div>
      <div className="mt-1.5 mb-1 font-semibold text-slate-800">Flexibility</div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(ASSET_TYPE_META)
          .filter(([k]) => k !== 'generation')
          .map(([k, m]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="size-2 rounded-sm" style={{ background: m.color }} />
              {m.label}
            </span>
          ))}
      </div>
    </div>
  )
}

function describe(sel: NonNullable<Selection>, flows: Record<string, number>, loading: Record<string, number>) {
  const snap = useGridStore.getState().snapshot
  const assets = useGridStore.getState().assets
  if (sel.kind === 'bus') {
    const b = BUS_BY_ID[sel.id]
    const conn = LINES.filter((l) => l.from === b.id || l.to === b.id)
    const worst = conn.reduce((m, l) => Math.max(m, loading[l.id] ?? 0), 0)
    const dr = assets.filter((a) => a.bus === b.id && a.type !== 'generation').reduce((s, a) => s + a.reserve.state, 0)
    return {
      title: b.name,
      sub: `${b.discom ?? 'ISTS'} · ${b.kv} kV`,
      rows: [
        ['Load', fmtMW(snap.busLoad[b.id] ?? 0)],
        ['Worst connected line', `${(worst * 100).toFixed(0)}%`],
        ['State DR available', fmtMW(dr)],
        ['Connected lines', String(conn.length)],
      ],
    }
  }
  if (sel.kind === 'line') {
    const l = LINES.find((x) => x.id === sel.id)!
    const out = snap.outagedLines.includes(l.id)
    return {
      title: lineLabel(l.id),
      sub: `${l.kv} kV${l.hvdc ? ' HVDC' : ''} · limit ${fmtMW(l.limitMW)}`,
      rows: [
        ['Status', out ? 'OUTAGE' : 'In service'],
        ['Flow', `${fmtMW(Math.abs(flows[l.id] ?? 0))} ${(flows[l.id] ?? 0) >= 0 ? `→ ${BUS_BY_ID[l.to].name.split(' ')[0]}` : `→ ${BUS_BY_ID[l.from].name.split(' ')[0]}`}`],
        ['Loading', `${((loading[l.id] ?? 0) * 100).toFixed(0)}%`],
      ],
    }
  }
  if (sel.kind === 'gen') {
    const g = GENERATORS.find((x) => x.id === sel.id)!
    const mw = snap.genOutput[g.id] ?? 0
    return {
      title: g.name,
      sub: `${g.type.toUpperCase()} · ${g.owner}`,
      rows: [
        ['Output', fmtMW(mw)],
        ['Capacity', fmtMW(g.capacityMW)],
        ['Utilisation', `${((mw / g.capacityMW) * 100).toFixed(0)}%`],
      ],
    }
  }
  const a = assets.find((x) => x.id === sel.id) ?? ASSET_BY_ID[sel.id]
  const lost = snap.heartbeatLost.includes(a.id)
  return {
    title: a.name,
    sub: `${ASSET_TYPE_META[a.type].label} · ${a.discom} · ${a.protocol}`,
    rows: [
      [a.type === 'bess' ? 'Power / Energy' : 'Baseline load', a.type === 'bess' ? `${a.maxLoadMW} MW / ${a.bess!.energyMWh} MWh` : fmtMW(a.baselineMW)],
      ...(a.bess ? [['State of charge', `${(a.bess.soc * 100).toFixed(0)}%`]] : []),
      ['State DR share', fmtMW(a.reserve.state)],
      ['SRAS / TRAS locked', fmtMW(a.reserve.sras + a.reserve.tras)],
      ['Response / Max duration', `${a.responseMin} min / ${a.maxDurationMin} min`],
      ['Bid', `₹${a.bidRs.toFixed(2)}/kWh`],
      ['Reliability', `${(a.reliability * 100).toFixed(0)}%`],
      ['Heartbeat', lost ? 'LOST' : 'OK'],
    ],
  }
}

function HoverCard({ flows, loading }: { flows: Record<string, number>; loading: Record<string, number> }) {
  const hovered = useUIStore((s) => s.hovered)
  const selection = useUIStore((s) => s.selection)
  if (!hovered || (selection && selection.kind === hovered.kind && selection.id === hovered.id)) return null
  const d = describe(hovered, flows, loading)
  return (
    <div className="pointer-events-none absolute top-3 right-3 w-60 rounded-lg bg-white/90 p-2.5 text-xs ring-1 ring-slate-900/10 backdrop-blur">
      <div className="font-semibold text-slate-800">{d.title}</div>
      <div className="mb-1.5 text-[10px] text-slate-500">{d.sub}</div>
      {d.rows.slice(0, 4).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 py-0.5 text-slate-700">
          <span className="text-slate-500">{k}</span>
          <span className="font-medium tabular-nums">{v}</span>
        </div>
      ))}
      <div className="mt-1 text-[10px] text-sky-600">Click for details</div>
    </div>
  )
}

function Inspector({ flows, loading }: { flows: Record<string, number>; loading: Record<string, number> }) {
  const selection = useUIStore((s) => s.selection)
  const select = useUIStore((s) => s.select)
  if (!selection) return null
  const d = describe(selection, flows, loading)
  const lost = d.rows.some(([k, v]) => k === 'Heartbeat' && v === 'LOST') || d.rows.some(([k, v]) => k === 'Status' && v === 'OUTAGE')
  return (
    <div className="absolute top-3 right-3 w-72 rounded-xl bg-white/90 p-3 text-xs ring-1 ring-sky-400/30 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-slate-800">{d.title}</div>
          <div className="text-[11px] text-slate-500">{d.sub}</div>
        </div>
        <Button size="icon" variant="ghost" className="size-6" onClick={() => select(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
      {lost && (
        <Badge variant="destructive" className="mt-2">
          Attention required
        </Badge>
      )}
      <div className="mt-2 divide-y divide-slate-200">
        {d.rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 py-1 text-slate-700">
            <span className="text-slate-500">{k}</span>
            <span className={cn('font-medium tabular-nums', (v === 'LOST' || v === 'OUTAGE') && 'text-red-500')}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Screen-space labels: major substations, ISTS ties, SLDC and dispatch MW tags. */
function useMapLabels(layers: MapLayers, injections: Record<string, number>, focus: Focus, assets: FlexAsset[]): MapLabel[] {
  return useMemo(() => {
    const out: MapLabel[] = []
    const at = (lon: number, lat: number, y: number): [number, number, number] => {
      const [x, z] = project(lon, lat)
      return [x, y, z]
    }
    if (layers.labels && layers.grid)
      for (const b of BUSES)
        if (!b.external && b.kv === 400 && b.loadShare >= 0.04)
          out.push({
            id: `bus-${b.id}`,
            pos: at(b.lon, b.lat, STATE_TOP + 0.2),
            node: (
              <div className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-slate-700 shadow-sm ring-1 ring-slate-900/10">
                {b.name.split(' ')[0]}
              </div>
            ),
          })
    if (layers.ties)
      for (const b of BUSES)
        if (b.external) {
          const inj = injections[b.id] ?? 0
          out.push({
            id: `tie-${b.id}`,
            pos: at(b.lon, b.lat, 0.26),
            node: (
              <div className="rounded-full bg-violet-50/95 px-1.5 py-0.5 text-[10px] whitespace-nowrap text-violet-700 shadow-sm ring-1 ring-violet-300/60">
                {b.name.split(' ').slice(0, 3).join(' ')} · {inj > 0 ? 'import' : 'export'} {Math.abs(inj).toFixed(0)} MW
              </div>
            ),
          })
        }
    out.push({
      id: 'sldc',
      pos: at(SLDC.lon, SLDC.lat, STATE_TOP + 1.08),
      node: <div className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white shadow">SLDC</div>,
      priority: 5,
    })
    for (const [id, f] of Object.entries(focus)) {
      const a = assets.find((x) => x.id === id)
      if (!a || a.type === 'generation') continue
      const supply = a.type === 'bess'
      out.push({
        id: `tag-${id}`,
        pos: at(a.lon, a.lat, STATE_TOP + (a.type === 'bess' ? 0.36 : 0.12 + (a.baselineMW / 650) * 0.6 + 0.08)),
        priority: 10,
        node: (
          <div className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-slate-900 shadow-sm" style={{ background: STATUS_COLOR[f.status] }}>
            {f.status === 'excluded' ? '✕ removed' : f.status === 'failed' ? '✕ no ack' : `${supply ? '+' : '−'}${Math.abs(f.mw).toFixed(0)} MW`}
          </div>
        ),
      })
    }
    return out
  }, [layers, injections, focus, assets])
}
