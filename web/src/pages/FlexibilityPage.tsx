import { useMemo, useState } from 'react'
import { Boxes, Wifi, WifiOff } from 'lucide-react'
import { Bar, FitPager, Kpi } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ASSET_TYPE_META, BUS_BY_ID, DISCOM_COLORS } from '@/data/karnataka'
import { fmtMW } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { useGridStore } from '@/store/useGridStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useUIStore } from '@/store/useUIStore'

export function FlexibilityPage() {
  const assets = useGridStore((s) => s.assets)
  const updateAsset = useGridStore((s) => s.updateAsset)
  const learned = useHistoryStore((s) => s.learned)
  const select = useUIStore((s) => s.select)
  const setPage = useUIStore((s) => s.setPage)
  const [filter, setFilter] = useState('all')

  const rows = useMemo(() => assets.filter((a) => filter === 'all' || a.type === filter), [assets, filter])
  const t = useMemo(() => {
    const sum = (f: (a: (typeof assets)[number]) => number) => assets.reduce((s, a) => s + f(a), 0)
    return {
      contract: sum((a) => a.contractMW),
      state: sum((a) => a.reserve.state),
      sras: sum((a) => a.reserve.sras),
      tras: sum((a) => a.reserve.tras),
      emergency: sum((a) => a.reserve.emergency),
      down: assets.filter((a) => !a.telemetryOk).length,
    }
  }, [assets])

  const byDiscom = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of assets) if (a.type !== 'generation') m[a.discom] = (m[a.discom] ?? 0) + a.reserve.state
    return m
  }, [assets])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="shrink-0">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="size-5 text-sky-600" /> Flexibility Registry
        </h1>
        <p className="text-xs text-muted-foreground">
          Every flexible resource has a digital ID, physical constraints, a contract, and a reservation split between state DR, ancillary services and emergency use.
        </p>
      </div>

      <div className="grid shrink-0 grid-cols-6 gap-2">
        <Kpi label="Resources" value={assets.length} sub={`${t.down} with comms down`} tone={t.down ? 'warn' : 'default'} />
        <Kpi label="Contracted" value={fmtMW(t.contract)} />
        <Kpi label="State DR (SLDC)" value={fmtMW(t.state)} tone="info" />
        <Kpi label="SRAS committed" value={fmtMW(t.sras)} hint="Secondary reserve: ≥1 MW, respond ≤30 s, full in 15 min, sustain 30 min" />
        <Kpi label="TRAS committed" value={fmtMW(t.tras)} hint="Tertiary reserve: within 15 min, sustain ≥60 min" />
        <Kpi label="Emergency only" value={fmtMW(t.emergency)} />
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-3">
        <Card className="gap-2 py-3">
          <CardHeader>
            <CardTitle className="text-sm">Reservation split — prevents double commitment</CardTitle>
            <CardDescription>DR_free = DR_total − DR_committed − DR_reserve</CardDescription>
          </CardHeader>
          <CardContent>
            <Bar
              height={14}
              segments={[
                { value: t.state, color: '#38bdf8', label: 'State DR' },
                { value: t.sras, color: '#a78bfa', label: 'SRAS' },
                { value: t.tras, color: '#c084fc', label: 'TRAS' },
                { value: t.emergency, color: '#f87171', label: 'Emergency' },
              ]}
            />
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span>■ STATE_MODE (SLDC/DISCOM)</span>
              <span>■ ANCILLARY_MODE (NLDC/RLDC)</span>
            </div>
          </CardContent>
        </Card>
        <Card className="gap-2 py-3">
          <CardHeader>
            <CardTitle className="text-sm">State DR by DISCOM</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(byDiscom)
              .sort((a, b) => b[1] - a[1])
              .map(([d, v]) => (
                <div key={d} className="flex items-center gap-2 text-xs">
                  <span className="w-16 font-medium" style={{ color: DISCOM_COLORS[d] }}>
                    {d}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${(v / Math.max(...Object.values(byDiscom))) * 100}%`, background: DISCOM_COLORS[d] }} />
                  </div>
                  <span className="w-16 text-right font-mono">{fmtMW(v)}</span>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      <Tabs value={filter} onValueChange={setFilter} className="shrink-0">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          {Object.entries(ASSET_TYPE_META).map(([k, m]) => (
            <TabsTrigger key={k} value={k}>
              {m.letter} · {m.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card className="min-h-0 flex-1 py-2">
        <CardContent className="h-full px-2">
          <FitPager
            items={rows}
            rowHeight={45}
            render={(slice) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Resource</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Baseline</TableHead>
                    <TableHead className="text-right">Contract</TableHead>
                    <TableHead>State · SRAS · TRAS · Emerg.</TableHead>
                    <TableHead className="text-right">Response</TableHead>
                    <TableHead className="text-right">Max dur.</TableHead>
                    <TableHead className="text-right">Rebound</TableHead>
                    <TableHead className="text-right">Bid ₹/kWh</TableHead>
                    <TableHead className="text-right">Reliability</TableHead>
                    <TableHead>Protocol</TableHead>
                    <TableHead>Telemetry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slice.map((a) => {
                    const meta = ASSET_TYPE_META[a.type]
                    const r = learned[a.id] ?? a.reliability
                    return (
                      <TableRow key={a.id} className={cn(!a.telemetryOk && 'bg-red-500/5')}>
                        <TableCell>
                          <button
                            className="flex items-center gap-2 text-left"
                            onClick={() => {
                              select({ kind: 'asset', id: a.id })
                              setPage('monitor')
                            }}
                          >
                            <span className="grid size-5 place-items-center rounded text-[10px] font-bold text-slate-950" style={{ background: meta.color }}>
                              {meta.letter}
                            </span>
                            <span className="leading-tight">
                              <span className="block text-xs font-medium hover:underline">{a.name}</span>
                              <span className="block max-w-[260px] truncate text-[10px] text-muted-foreground">{a.description}</span>
                            </span>
                          </button>
                        </TableCell>
                        <TableCell className="text-[11px]">
                          <span style={{ color: DISCOM_COLORS[a.discom] }}>{a.discom}</span>
                          <span className="block text-muted-foreground">{BUS_BY_ID[a.bus].name.split(' ')[0]}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {a.type === 'bess' ? `${a.bess!.energyMWh} MWh · ${(a.bess!.soc * 100).toFixed(0)}%` : a.baselineMW}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.contractMW}</TableCell>
                        <TableCell>
                          <div className="w-36">
                            <Bar
                              height={6}
                              segments={[
                                { value: a.reserve.state, color: '#38bdf8', label: 'State' },
                                { value: a.reserve.sras, color: '#a78bfa', label: 'SRAS' },
                                { value: a.reserve.tras, color: '#c084fc', label: 'TRAS' },
                                { value: a.reserve.emergency, color: '#f87171', label: 'Emergency' },
                              ]}
                            />
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                              {a.reserve.state}·{a.reserve.sras}·{a.reserve.tras}·{a.reserve.emergency}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.responseMin < 1 ? `${a.responseMin * 60}s` : `${a.responseMin}m`}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.maxDurationMin}m</TableCell>
                        <TableCell className="text-right font-mono text-xs">{(a.reboundFrac * 100).toFixed(0)}%</TableCell>
                        <TableCell className="text-right font-mono text-xs">{a.bidRs.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {(r * 100).toFixed(0)}%
                          {learned[a.id] !== undefined && (
                            <Badge variant="info" className="ml-1 text-[9px]">
                              learned
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">{a.protocol}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch checked={a.telemetryOk} onCheckedChange={(v) => updateAsset(a.id, { telemetryOk: v })} aria-label="Telemetry" />
                            {a.telemetryOk ? <Wifi className="size-3.5 text-emerald-600" /> : <WifiOff className="size-3.5 text-red-500" />}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}
