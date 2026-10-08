import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowRight, Battery, Cable, Factory, FlaskConical, Gauge, Network, Siren, Zap } from 'lucide-react'
import { Bar, Kpi } from '@/components/common'
import { KarnatakaMap } from '@/components/three/KarnatakaMap'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LINES } from '@/data/karnataka'
import { busInjections } from '@/engine/grid'
import { lineLabel, solveDCPF } from '@/engine/network'
import { fmtMW, fmtRs, loadingColor } from '@/lib/geo'
import { chartTooltip, SEVERITY_STYLE, signed } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { STEPS, useDecisionStore } from '@/store/useDecisionStore'
import { useGridStore } from '@/store/useGridStore'
import { useUIStore } from '@/store/useUIStore'

export function MonitorPage() {
  const a = useGridStore((s) => s.assessment)
  const snap = a.snapshot
  const assets = useGridStore((s) => s.assets)
  const history = useGridStore((s) => s.history)
  const openEvent = useDecisionStore((s) => s.openEvent)
  const status = useDecisionStore((s) => s.status)
  const eventId = useDecisionStore((s) => s.eventId)
  const step = useDecisionStore((s) => s.step)
  const setPage = useUIStore((s) => s.setPage)

  const net = useMemo(() => solveDCPF(busInjections(snap), snap.outagedLines), [snap])
  const topLines = useMemo(
    () =>
      LINES.map((l) => ({ l, v: net.loading[l.id] ?? 0, out: snap.outagedLines.includes(l.id) }))
        .sort((x, y) => Number(y.out) - Number(x.out) || y.v - x.v)
        .slice(0, 9),
    [net, snap.outagedLines],
  )

  const stack = useMemo(() => {
    const flex = assets.filter((x) => x.type !== 'generation')
    const sum = (f: (x: (typeof flex)[number]) => number) => flex.reduce((s, x) => s + f(x), 0)
    return {
      state: sum((x) => x.reserve.state),
      sras: sum((x) => x.reserve.sras),
      tras: sum((x) => x.reserve.tras),
      emergency: sum((x) => x.reserve.emergency),
      bess: assets.filter((x) => x.type === 'bess').reduce((s, x) => s + x.reserve.state, 0),
    }
  }, [assets])
  const active = useGridStore((s) => s.dispatch)
  const activeMW = active ? Object.values(active.mw).reduce((x, y) => x + y, 0) : 0

  const sevText = {
    NORMAL: 'Grid within IEGC band. The engine watches ACE, frequency, deviation and line loading every second.',
    ALERT: `State is ${a.direction === 'UP' ? 'short' : 'long'} by ${a.requirementMW.toFixed(0)} MW (ACE). DSM exposure ≈ ${fmtRs(a.doNothingRs)} over ${snap.durationBlocks} blocks if nothing is done.`,
    EMERGENCY: `Severe deficit of ${a.requirementMW.toFixed(0)} MW at ${snap.frequency.toFixed(2)} Hz. Emergency DR released; load shedding (ADMS) only after DR is exhausted.`,
  }[a.severity]

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* KPI strip */}
      <div className="grid shrink-0 grid-cols-4 gap-2 xl:grid-cols-8">
        <Kpi label="State demand" icon={<Zap className="size-3" />} value={fmtMW(snap.demandMW)} sub="met incl. ISTS" />
        <Kpi label="In-state generation" icon={<Factory className="size-3" />} value={fmtMW(snap.stateGenMW + snap.centralInStateMW)} sub={`RE ${fmtMW(snap.reMW)}`} />
        <Kpi
          label="ISTS drawal"
          icon={<Cable className="size-3" />}
          value={fmtMW(snap.drawalMW)}
          sub={`schedule ${fmtMW(snap.scheduleMW)}`}
          tone={Math.abs(a.deviationMW) > 100 ? 'warn' : 'default'}
        />
        <Kpi
          label="Deviation"
          value={`${signed(a.deviationMW)} MW`}
          sub={a.deviationMW > 0 ? 'over-drawal' : 'under-drawal'}
          tone={Math.abs(a.deviationMW) > 100 ? 'warn' : 'good'}
          hint="D = Actual drawal − Scheduled drawal (CERC DSM), settled per 15-min block in energy terms."
        />
        <Kpi
          label="ACE"
          icon={<Gauge className="size-3" />}
          value={`${signed(a.ace.ace)} MW`}
          sub={a.ace.ace < -50 ? 'needs UP flexibility' : a.ace.ace > 50 ? 'needs DOWN flexibility' : 'balanced'}
          tone={Math.abs(a.ace.ace) >= 100 ? 'warn' : 'good'}
          hint="IEGC: ACE = (Ia − Is) − 10·Bf·(Fa − Fs) + Offset. SLDC must keep ACE close to zero."
        />
        <Kpi label="Frequency" value={`${snap.frequency.toFixed(3)} Hz`} tone={snap.frequency < 49.9 || snap.frequency > 50.05 ? 'warn' : 'good'} sub="band 49.90–50.05" />
        <Kpi label="State DR free" icon={<Network className="size-3" />} value={fmtMW(stack.state - activeMW)} sub={`${fmtMW(stack.sras + stack.tras)} locked to AS`} tone="info" />
        <Kpi label="BESS available" icon={<Battery className="size-3" />} value={fmtMW(stack.bess * snap.bessAvailability)} sub="3 grid BESS" tone="info" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        {/* 3D map */}
        <div className="col-span-8 min-h-0">
          <KarnatakaMap />
        </div>

        {/* side panel */}
        <div className="col-span-4 flex min-h-0 flex-col gap-3">
          {/* status / event card — the bridge from Observe to Decide */}
          <div
            className={cn(
              'shrink-0 rounded-2xl border p-3 shadow-xs transition-colors',
              status === 'open'
                ? 'border-sky-200 bg-sky-50'
                : a.severity === 'EMERGENCY'
                  ? 'border-rose-200 bg-rose-50'
                  : a.severity === 'ALERT'
                    ? 'border-amber-200 bg-amber-50'
                    : 'bg-card',
            )}
          >
            <div className="flex items-center gap-2">
              {a.severity !== 'NORMAL' && status !== 'open' ? (
                <span className="relative flex size-2.5">
                  <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', a.severity === 'EMERGENCY' ? 'bg-rose-400' : 'bg-amber-400')} />
                  <span className={cn('relative inline-flex size-2.5 rounded-full', a.severity === 'EMERGENCY' ? 'bg-rose-500' : 'bg-amber-500')} />
                </span>
              ) : status === 'open' ? (
                <Activity className="size-4 text-sky-600" />
              ) : null}
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold ring-1', SEVERITY_STYLE[a.severity])}>{a.severity}</span>
              <span className="text-sm font-semibold">{status === 'open' ? 'Decision in progress' : a.severity === 'NORMAL' ? 'System status' : 'Event detected'}</span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600">
              {status === 'open' ? (
                <>
                  <span className="font-mono">{eventId}</span> is at <b>{STEPS[step].title}</b>. The map reflects live dispatch.
                </>
              ) : (
                sevText
              )}
            </p>
            <div className="mt-2 flex gap-2">
              {status === 'open' ? (
                <Button size="sm" className="rounded-full" onClick={() => setPage('decision')}>
                  Resume decision <ArrowRight className="size-3.5" />
                </Button>
              ) : a.severity !== 'NORMAL' ? (
                <Button size="sm" className="rounded-full" onClick={openEvent} variant={a.severity === 'EMERGENCY' ? 'destructive' : 'default'}>
                  <Siren className="size-3.5" /> Start guided decision
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" className="rounded-full" onClick={() => setPage('scenario')}>
                    <FlaskConical className="size-3.5" /> Inject a scenario
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-full" onClick={openEvent}>
                    Routine review
                  </Button>
                </>
              )}
            </div>
          </div>

          <Card className="min-h-0 flex-1 gap-0 py-3">
            <CardContent className="flex h-full min-h-0 flex-col">
              <Tabs defaultValue="trends" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="w-full shrink-0">
                  <TabsTrigger value="trends" className="text-xs">
                    Trends
                  </TabsTrigger>
                  <TabsTrigger value="network" className="text-xs">
                    Network
                  </TabsTrigger>
                  <TabsTrigger value="flex" className="text-xs">
                    Flexibility
                  </TabsTrigger>
                  <TabsTrigger value="mix" className="text-xs">
                    Supply
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="trends" className="mt-2 flex min-h-0 flex-col gap-1 overflow-hidden">
                  <MiniChart title="Frequency (Hz)">
                    <LineChart data={history}>
                      <CartesianGrid stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="t" hide />
                      <YAxis domain={[49.7, 50.15]} tick={{ fontSize: 9, fill: '#94a3b8' }} width={38} />
                      <ReferenceLine y={49.9} stroke="#fbbf24" strokeDasharray="4 4" />
                      <ReferenceLine y={50.05} stroke="#fbbf24" strokeDasharray="4 4" />
                      <RTooltip {...chartTooltip} />
                      <Line type="monotone" dataKey="frequency" stroke="#38bdf8" dot={false} strokeWidth={2} isAnimationActive={false} />
                    </LineChart>
                  </MiniChart>
                  <MiniChart title="ISTS drawal vs schedule (MW)">
                    <AreaChart data={history}>
                      <CartesianGrid stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="t" hide />
                      <YAxis
                        domain={['dataMin - 150', 'dataMax + 150']}
                        tick={{ fontSize: 9, fill: '#94a3b8' }}
                        width={38}
                        tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
                      />
                      <RTooltip {...chartTooltip} formatter={(v) => `${Number(v).toFixed(0)} MW`} />
                      <Area type="monotone" dataKey="drawal" stroke="#f59e0b" fill="#fde68a66" strokeWidth={2} isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="schedule" stroke="#94a3b8" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </MiniChart>
                  <MiniChart title="Area Control Error (MW)">
                    <AreaChart data={history}>
                      <CartesianGrid stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={29} />
                      <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} width={38} />
                      <ReferenceLine y={0} stroke="#cbd5e1" />
                      <RTooltip {...chartTooltip} formatter={(v) => `${Number(v).toFixed(0)} MW`} />
                      <Area type="monotone" dataKey="ace" stroke="#a78bfa" fill="#ddd6fe66" strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </MiniChart>
                </TabsContent>

                <TabsContent value="network" className="mt-3 space-y-2 overflow-hidden">
                  <div className="text-[11px] text-muted-foreground">Most loaded corridors · DC power flow, refreshed every second</div>
                  {topLines.map(({ l, v, out }) => (
                    <div key={l.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">{lineLabel(l.id)}</span>
                      {out ? (
                        <Badge variant="destructive">OUTAGE</Badge>
                      ) : (
                        <>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, v * 100)}%`, background: loadingColor(v) }} />
                          </div>
                          <span className="w-10 text-right font-mono tabular-nums" style={{ color: loadingColor(v) }}>
                            {(v * 100).toFixed(0)}%
                          </span>
                        </>
                      )}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="flex" className="mt-3 space-y-3 overflow-hidden">
                  <div className="text-xs font-medium">DR stack (contracted flexibility)</div>
                  <Bar
                    segments={[
                      { value: activeMW, color: '#4cbf8b', label: 'Activated now' },
                      { value: stack.state - activeMW, color: '#7dd3fc', label: 'State DR free' },
                      { value: stack.sras, color: '#c4b5fd', label: 'SRAS (locked)' },
                      { value: stack.tras, color: '#d8b4fe', label: 'TRAS (locked)' },
                      { value: stack.emergency, color: '#fda4af', label: 'Emergency only' },
                    ]}
                  />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <Legend c="#4cbf8b" l="Activated" v={activeMW} />
                    <Legend c="#7dd3fc" l="State DR free" v={stack.state - activeMW} />
                    <Legend c="#c4b5fd" l="SRAS locked" v={stack.sras} />
                    <Legend c="#d8b4fe" l="TRAS locked" v={stack.tras} />
                    <Legend c="#fda4af" l="Emergency only" v={stack.emergency} />
                  </div>
                  <div className="space-y-1.5 border-t pt-3">
                    <div className="text-xs font-medium">Operating hierarchy (IEGC)</div>
                    {[
                      { s: 'NORMAL', t: 'Procurement · demand shift · BESS · economic & ancillary DR' },
                      { s: 'ALERT', t: 'Rapid DR · emergency DR · reserve deployment' },
                      { s: 'EMERGENCY', t: 'Emergency DR → ADMS / load shedding (last resort)' },
                    ].map((r) => (
                      <div
                        key={r.s}
                        className={cn('flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[11px]', a.severity === r.s ? 'border-sky-200 bg-sky-50' : 'opacity-55')}
                      >
                        <span className={cn('rounded-full px-1.5 text-[9px] font-bold ring-1', SEVERITY_STYLE[r.s as 'NORMAL'])}>{r.s}</span>
                        <span>{r.t}</span>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="mix" className="mt-3 space-y-3 overflow-hidden">
                  <div className="text-xs font-medium">Supply mix · ISTS import via ties {fmtMW(snap.externalImportMW)}</div>
                  <Bar
                    height={14}
                    segments={[
                      { value: snap.genByType.coal, color: '#94a3b8', label: 'Coal' },
                      { value: snap.genByType.hydro, color: '#7dd3fc', label: 'Hydro' },
                      { value: snap.genByType.nuclear, color: '#c4b5fd', label: 'Nuclear' },
                      { value: snap.genByType.solar, color: '#fcd34d', label: 'Solar' },
                      { value: snap.genByType.wind, color: '#bef264', label: 'Wind' },
                      { value: snap.externalImportMW, color: '#e9d5ff', label: 'ISTS import' },
                    ]}
                  />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                    {(
                      [
                        ['Coal', '#94a3b8', snap.genByType.coal],
                        ['Hydro', '#7dd3fc', snap.genByType.hydro],
                        ['Nuclear', '#c4b5fd', snap.genByType.nuclear],
                        ['Solar', '#fcd34d', snap.genByType.solar],
                        ['Wind', '#bef264', snap.genByType.wind],
                        ['ISTS import', '#e9d5ff', snap.externalImportMW],
                      ] as const
                    ).map(([l, c, v]) => (
                      <Legend key={l} c={c} l={l} v={v} />
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Legend({ c, l, v }: { c: string; l: string; v: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-sm" style={{ background: c }} />
      <span className="text-muted-foreground">{l}</span>
      <span className="ml-auto font-mono tabular-nums">{fmtMW(v)}</span>
    </span>
  )
}

function MiniChart({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="text-[11px] font-medium text-slate-600">{title}</div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  )
}
