// Resources — the flexibility registry with live state, learned reliability and service status.
import { useMemo, useState } from 'react'
import { Boxes } from 'lucide-react'
import { FitPager } from '@/components/common'
import { PageHeader, Panel } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ASSET_TYPE_META } from '@/data/topology'
import type { Asset } from '@/data/types'
import { useApi } from '@/hooks'
import { api } from '@/lib/api'
import { fmtMW } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { useAuth } from '@/store/useAuth'
import { useUI } from '@/store/useUI'

type Resource = Omit<Asset, 'reliability' | 'maxLoadMW'> & {
  reliability: number
  out_of_service: boolean
  live: { mw: number; soc: number | null; heartbeat_age_s: number | null; setpoint: number }
}

export function ResourcesPage() {
  const { data, reload } = useApi<Resource[]>('/resources', { intervalMs: 3000 })
  const can = useAuth((s) => s.can)
  const select = useUI((s) => s.select)
  const [type, setType] = useState('ALL')
  const [edit, setEdit] = useState<Resource | null>(null)
  const [reason, setReason] = useState('')
  const all = useMemo(() => data ?? [], [data])
  const byType = useMemo(() => {
    const t: Record<string, { n: number; mw: number; active: number }> = {}
    for (const r of all) {
      t[r.type] ??= { n: 0, mw: 0, active: 0 }
      t[r.type].n += 1
      t[r.type].mw += r.contractMW
      if (r.live.setpoint > 0.5) t[r.type].active += 1
    }
    return t
  }, [all])
  const rows = all.filter((r) => type === 'ALL' || r.type === type)
  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader icon={<Boxes className="size-4" />} title="Flexibility resources" />
      <div className="grid shrink-0 grid-cols-7 gap-2">
        {['ALL', ...Object.keys(byType)].map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn('rounded-xl border bg-white px-3 py-2 text-left shadow-xs transition hover:bg-slate-50', type === t && 'border-sky-300 bg-sky-50')}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              {t !== 'ALL' && <span className="size-2 rounded-full" style={{ background: ASSET_TYPE_META[t]?.color }} />}
              {t === 'ALL' ? 'All types' : (ASSET_TYPE_META[t]?.label ?? t)}
            </div>
            <div className="font-mono text-sm font-semibold">{t === 'ALL' ? all.length : fmtMW(byType[t].mw)}</div>
            <div className="text-[10px] text-slate-500">{t === 'ALL' ? 'resources' : `${byType[t].n} units · ${byType[t].active} active`}</div>
          </button>
        ))}
      </div>
      <Panel className="flex-1" bodyClass="p-1.5">
        <FitPager
          items={rows}
          rowHeight={43}
          reserve={64}
          render={(slice) => (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resource</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>DISCOM / bus</TableHead>
                  <TableHead className="text-right">Contract</TableHead>
                  <TableHead className="text-right">Response</TableHead>
                  <TableHead className="text-right">Bid ₹/MWh</TableHead>
                  <TableHead>Reliability</TableHead>
                  <TableHead className="text-right">Setpoint → live</TableHead>
                  <TableHead>Telemetry</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((r) => {
                  const hb = r.live.heartbeat_age_s
                  return (
                    <TableRow key={r.id} className={cn('cursor-pointer', r.out_of_service && 'opacity-60')} onClick={() => select({ kind: 'asset', id: r.id })}>
                      <TableCell className="max-w-[240px]">
                        <div className="truncate text-xs font-medium">{r.name}</div>
                        <div className="truncate text-[10px] text-slate-500">
                          {r.id} · {r.protocol}
                        </div>
                      </TableCell>
                      <TableCell className="text-[11px]" style={{ color: ASSET_TYPE_META[r.type]?.color }}>
                        {ASSET_TYPE_META[r.type]?.label ?? r.type}
                      </TableCell>
                      <TableCell className="text-[11px] text-slate-500">
                        {r.discom} · {r.bus}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px]">{r.contractMW} MW</TableCell>
                      <TableCell className="text-right font-mono text-[11px]">{r.responseMin} min</TableCell>
                      <TableCell className="text-right font-mono text-[11px]">{r.bidRs.toLocaleString('en-IN')}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={cn('h-full rounded-full', r.reliability >= 0.9 ? 'bg-emerald-400' : r.reliability >= 0.75 ? 'bg-amber-400' : 'bg-rose-400')}
                              style={{ width: `${r.reliability * 100}%` }}
                            />
                          </div>
                          <span className="font-mono text-[10px]">{(r.reliability * 100).toFixed(0)}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[11px]">
                        {r.live.setpoint > 0.5 ? `${r.live.setpoint.toFixed(0)} → ${r.live.mw.toFixed(0)}` : '—'}
                        {r.live.soc != null && <div className="text-[10px] text-slate-500">SoC {(r.live.soc * 100).toFixed(0)}%</div>}
                      </TableCell>
                      <TableCell>
                        {hb == null ? (
                          <span className="text-[10px] text-slate-400">n/a</span>
                        ) : hb > 60 ? (
                          <Badge variant="destructive">lost {hb.toFixed(0)}s</Badge>
                        ) : (
                          <Badge variant="success">OK</Badge>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {can('resources') ? (
                          <Button size="sm" variant={r.out_of_service ? 'outline' : 'ghost'} className="h-6 px-2 text-[11px]" onClick={() => setEdit(r)}>
                            {r.out_of_service ? 'Return to service' : 'Take out'}
                          </Button>
                        ) : (
                          <Badge variant={r.out_of_service ? 'destructive' : 'secondary'}>{r.out_of_service ? 'out of service' : 'available'}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        />
      </Panel>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {edit?.out_of_service ? 'Return to service' : 'Take out of service'}: {edit?.short}
            </DialogTitle>
            <DialogDescription>
              {edit?.out_of_service
                ? 'The optimiser will consider this resource again from the next block.'
                : 'The optimiser will stop dispatching this resource; any active setpoint is released at the next revision.'}{' '}
              The change is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 3}
              onClick={async () => {
                await api(`/resources/${edit!.id}`, { method: 'PATCH', body: { out_of_service: !edit!.out_of_service, reason } })
                setEdit(null)
                setReason('')
                reload()
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
