// Operations — the live grid: 3D map, network constraints, resources in action, 220 kV channels, generation.
import { useMemo, useState } from 'react'
import { Bar, FitPager } from '@/components/common'
import { Panel, Stat, StatStrip } from '@/components/page'
import { TerritoryMap } from '@/components/three/TerritoryMap'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ASSET_BY_ID, DISCOM_COLORS, GEN_STATIONS, LINES, LOAD_CHANNELS, lineLabel } from '@/data/topology'
import { fmtMW, loadingColor } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { useLive } from '@/store/useLive'
import { useUI } from '@/store/useUI'

export function OperationsPage() {
  const f = useLive((s) => s.frame)!
  const kptcl = f.source.kptcl
  return (
    <div className="flex h-full flex-col gap-3">
      <StatStrip>
        <Stat label="System demand" value={fmtMW(f.demand)} sub={kptcl ? `SLDC feed ${kptcl.ok}/${kptcl.total} pages · ${kptcl.live} live` : 'source: simulated field'} />
        <Stat label="In-state generation" value={fmtMW(f.state_gen)} sub={`central share ${fmtMW(f.central_gen)}`} />
        <Stat label="Renewables" value={fmtMW(f.re)} sub={`${((f.re / Math.max(1, f.demand)) * 100).toFixed(0)}% of demand`} />
        <Stat label="ISTS drawal / schedule" value={`${fmtMW(f.drawal)} / ${fmtMW(f.schedule)}`} tone={Math.abs(f.drawal - f.schedule) > 150 ? 'warn' : undefined} />
        <Stat
          label="Most loaded corridor"
          value={`${(f.max_line.loading * 100).toFixed(0)}%`}
          sub={lineLabel(f.max_line.line)}
          tone={f.max_line.loading > 1 ? 'bad' : f.max_line.loading > 0.9 ? 'warn' : 'good'}
        />
        <Stat
          label="Lines out of service"
          value={String(f.outaged.length)}
          tone={f.outaged.length ? 'bad' : 'good'}
          sub={f.islanded.length ? `${f.islanded.length} bus(es) islanded` : 'network intact'}
        />
        <Stat
          label="Resources dispatched"
          value={String(Object.entries(f.live_setpoints).filter(([id, v]) => v > 0.5 && id !== 'RTM').length)}
          sub={`${fmtMW(Object.values(f.live_setpoints).reduce((a, b) => a + b, 0))} setpoint`}
        />
      </StatStrip>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3">
        <TerritoryMap />
        <Panel bodyClass="flex flex-col">
          <Tabs defaultValue="network" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="w-full shrink-0">
              <TabsTrigger value="network" className="text-xs">
                Network
              </TabsTrigger>
              <TabsTrigger value="resources" className="text-xs">
                In action
              </TabsTrigger>
              <TabsTrigger value="channels" className="text-xs">
                220 kV channels
              </TabsTrigger>
              <TabsTrigger value="gen" className="text-xs">
                Generation
              </TabsTrigger>
            </TabsList>
            <TabsContent value="network" className="mt-2 min-h-0 overflow-hidden">
              <NetworkTab />
            </TabsContent>
            <TabsContent value="resources" className="mt-2 min-h-0 overflow-hidden">
              <InActionTab />
            </TabsContent>
            <TabsContent value="channels" className="mt-2 min-h-0 overflow-hidden">
              <ChannelsTab />
            </TabsContent>
            <TabsContent value="gen" className="mt-2 min-h-0 overflow-hidden">
              <GenTab />
            </TabsContent>
          </Tabs>
        </Panel>
      </div>
    </div>
  )
}

function NetworkTab() {
  const f = useLive((s) => s.frame)!
  const select = useUI((s) => s.select)
  const rows = useMemo(
    () => LINES.map((l) => ({ l, v: f.loading[l.id] ?? 0, flow: f.flows[l.id] ?? 0, out: f.outaged.includes(l.id) })).sort((a, b) => Number(b.out) - Number(a.out) || b.v - a.v),
    [f],
  )
  return (
    <FitPager
      items={rows}
      rowHeight={31}
      reserve={60}
      render={(slice) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Corridor</TableHead>
              <TableHead className="text-right">Flow</TableHead>
              <TableHead className="text-right">Limit</TableHead>
              <TableHead>Loading</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map(({ l, v, flow, out }) => (
              <TableRow key={l.id} className="cursor-pointer" onClick={() => select({ kind: 'line', id: l.id })}>
                <TableCell className="max-w-[200px] truncate text-xs">{lineLabel(l.id)}</TableCell>
                <TableCell className="text-right font-mono text-[11px]">{out ? '—' : Math.abs(flow).toFixed(0)}</TableCell>
                <TableCell className="text-right font-mono text-[11px]">{l.limitMW}</TableCell>
                <TableCell>
                  {out ? (
                    <Badge variant="destructive">OUTAGE</Badge>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, v * 100)}%`, background: loadingColor(v) }} />
                      </div>
                      <span className="font-mono text-[11px]" style={{ color: loadingColor(v) }}>
                        {(v * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    />
  )
}

function InActionTab() {
  const f = useLive((s) => s.frame)!
  const select = useUI((s) => s.select)
  const rows = Object.entries(f.live_setpoints)
    .filter(([id, sp]) => sp > 0.5 && id !== 'RTM')
    .map(([id, sp]) => ({ id, sp, a: ASSET_BY_ID[id], live: f.assets[id] }))
  if (!rows.length) return <div className="grid h-full place-items-center text-xs text-slate-500">No resources currently dispatched.</div>
  return (
    <FitPager
      items={rows}
      rowHeight={44}
      reserve={60}
      render={(slice) => (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Resource</TableHead>
              <TableHead className="text-right">Setpoint</TableHead>
              <TableHead className="text-right">Delivering</TableHead>
              <TableHead>Response</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((r) => {
              const pct = r.sp > 0 ? (r.live?.mw ?? 0) / r.sp : 0
              return (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => select({ kind: 'asset', id: r.id })}>
                  <TableCell className="text-xs">
                    <div className="font-medium">{r.a?.short}</div>
                    <div className="text-[10px] text-slate-500">
                      {r.a?.discom} · {r.a?.protocol}
                      {(r.live?.hb_age ?? 0) > 60 && <span className="text-rose-600"> · heartbeat lost</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px]">{r.sp.toFixed(0)} MW</TableCell>
                  <TableCell className="text-right font-mono text-[11px]">{(r.live?.mw ?? 0).toFixed(0)} MW</TableCell>
                  <TableCell>
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn('h-full rounded-full', pct >= 0.85 ? 'bg-emerald-400' : pct >= 0.5 ? 'bg-amber-400' : 'bg-sky-300')}
                        style={{ width: `${Math.min(100, pct * 100)}%` }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    />
  )
}

function ChannelsTab() {
  const f = useLive((s) => s.frame)!
  const select = useUI((s) => s.select)
  const [discom, setDiscom] = useState('ALL')
  const totals = useMemo(() => {
    const t: Record<string, { mw: number; n: number; live: number }> = {}
    for (const c of LOAD_CHANNELS) {
      const v = f.channels[c.id]
      t[c.discom] ??= { mw: 0, n: 0, live: 0 }
      t[c.discom].mw += v?.mw ?? 0
      t[c.discom].n += 1
      if (v?.src === 'KPTCL') t[c.discom].live += 1
    }
    return t
  }, [f.channels])
  const rows = LOAD_CHANNELS.filter((c) => discom === 'ALL' || c.discom === discom)
    .map((c) => ({ c, v: f.channels[c.id] }))
    .sort((a, b) => (b.v?.mw ?? 0) - (a.v?.mw ?? 0))
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid shrink-0 grid-cols-6 gap-1">
        {['ALL', ...Object.keys(totals)].map((d) => (
          <button
            key={d}
            onClick={() => setDiscom(d)}
            className={cn('rounded-lg border px-1.5 py-1 text-left transition hover:bg-slate-50', discom === d && 'border-sky-300 bg-sky-50')}
          >
            <div className="flex items-center gap-1 text-[10px] font-semibold">
              {d !== 'ALL' && <span className="size-2 rounded-sm" style={{ background: DISCOM_COLORS[d] }} />}
              {d}
            </div>
            <div className="font-mono text-[11px]">{d === 'ALL' ? LOAD_CHANNELS.length : `${totals[d].mw.toFixed(0)} MW`}</div>
            <div className="text-[9px] text-slate-500">{d === 'ALL' ? 'channels' : `${totals[d].n} ch · ${totals[d].live} live`}</div>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <FitPager
          items={rows}
          rowHeight={29}
          reserve={60}
          render={(slice) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>220 kV station</TableHead>
                  <TableHead>DISCOM</TableHead>
                  <TableHead className="text-right">Load</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map(({ c, v }) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => select({ kind: 'channel', id: c.id })}>
                    <TableCell className="text-xs">{c.name}</TableCell>
                    <TableCell className="text-[11px]" style={{ color: DISCOM_COLORS[c.discom] }}>
                      {c.discom}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px]">{v ? v.mw.toFixed(1) : '—'}</TableCell>
                    <TableCell>{v?.src === 'KPTCL' ? <Badge variant="success">KPTCL live</Badge> : <Badge variant="outline">simulated</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </div>
    </div>
  )
}

function GenTab() {
  const f = useLive((s) => s.frame)!
  const select = useUI((s) => s.select)
  const rows = GEN_STATIONS.filter((g) => g.capacityMW > 0)
    .map((g) => ({ g, v: f.channels[g.id] }))
    .sort((a, b) => (b.v?.mw ?? 0) - (a.v?.mw ?? 0))
  const mix = f.gen_by_type
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="shrink-0 space-y-1">
        <Bar
          height={12}
          segments={[
            { value: mix.coal ?? 0, color: '#96a1ae', label: 'Coal' },
            { value: mix.hydro ?? 0, color: '#8bb0da', label: 'Hydro' },
            { value: mix.nuclear ?? 0, color: '#cbc5ec', label: 'Nuclear' },
            { value: mix.solar ?? 0, color: '#e6b45a', label: 'Solar' },
            { value: mix.wind ?? 0, color: '#c2d99a', label: 'Wind' },
            { value: Object.values(f.injections).reduce((a, b) => a + Math.max(0, b), 0), color: '#e5e2f6', label: 'ISTS import' },
          ]}
        />
        <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-500">
          {Object.entries(mix).map(([k, v]) => (
            <span key={k}>
              {k} {fmtMW(v)}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <FitPager
          items={rows}
          rowHeight={29}
          reserve={60}
          render={(slice) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Station</TableHead>
                  <TableHead>Fuel</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Capacity</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map(({ g, v }) => (
                  <TableRow key={g.id} className="cursor-pointer" onClick={() => select({ kind: 'station', id: g.id })}>
                    <TableCell className="max-w-[170px] truncate text-xs">{g.name}</TableCell>
                    <TableCell className="text-[11px] text-slate-500">{g.type}</TableCell>
                    <TableCell className="text-right font-mono text-[11px]">{v ? v.mw.toFixed(0) : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-[11px]">{g.capacityMW}</TableCell>
                    <TableCell>{v?.src === 'KPTCL' ? <Badge variant="success">KPTCL</Badge> : <Badge variant="outline">sim</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        />
      </div>
    </div>
  )
}
