// Alarms & events — prioritised, correlated into incidents; acknowledge and shelve with reasons.
import { useState } from 'react'
import { Archive, Check, CheckCheck } from 'lucide-react'
import { FitPager } from '@/components/common'
import { Empty, Panel, Prio, Stat, StatStrip } from '@/components/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Alarm } from '@/data/types'
import { useApi } from '@/hooks'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAuth } from '@/store/useAuth'
import { clockS, useLive } from '@/store/useLive'
import { useUI } from '@/store/useUI'

interface Incident {
  id: string
  category: string
  title: string
  opened_at: number
  closed_at: number | null
  priority: number
  alarm_ids: string[]
  decision_id: string | null
}

export function AlarmsPage() {
  const [status, setStatus] = useState('active')
  const { data, reload } = useApi<{ items: Alarm[]; total: number; incidents: Incident[] }>(`/alarms?status=${status}&limit=500`, { intervalMs: 4000 })
  const can = useAuth((s) => s.can)
  const f = useLive((s) => s.frame)
  const go = useUI((s) => s.go)
  const [shelve, setShelve] = useState<Alarm | null>(null)
  const [reason, setReason] = useState('')
  const items = data?.items ?? []
  const incidents = data?.incidents ?? []

  async function ack(id: string) {
    await api(`/alarms/${id}/ack`, { method: 'POST' })
    reload()
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <StatStrip>
        <Stat label="Active alarms" value={String(f?.counts.alarms ?? 0)} tone={(f?.counts.alarms ?? 0) ? 'warn' : 'good'} />
        <Stat label="Critical (P1)" value={String(f?.counts.p1 ?? 0)} tone={(f?.counts.p1 ?? 0) ? 'bad' : 'good'} />
        <Stat label="Unacknowledged" value={String(f?.counts.unacked ?? 0)} tone={(f?.counts.unacked ?? 0) ? 'warn' : 'good'} />
        <Stat label="Open incidents" value={String(incidents.filter((i) => !i.closed_at).length)} />
        <Stat label="In this view" value={String(data?.total ?? items.length)} sub={status === 'all' ? 'history' : status} />
        <Stat label="Data confidence" value={`${((f?.confidence ?? 1) * 100).toFixed(0)}%`} tone={(f?.confidence ?? 1) < 0.85 ? 'warn' : 'good'} />
      </StatStrip>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
        <Panel
          title={
            <Tabs value={status} onValueChange={setStatus}>
              <TabsList className="h-7">
                <TabsTrigger value="active" className="text-xs">
                  Active
                </TabsTrigger>
                <TabsTrigger value="shelved" className="text-xs">
                  Shelved
                </TabsTrigger>
                <TabsTrigger value="all" className="text-xs">
                  History
                </TabsTrigger>
              </TabsList>
            </Tabs>
          }
          aside={
            can('ack_alarm') && (
              <Button size="sm" variant="outline" className="h-7" onClick={() => api('/alarms/ack-all', { method: 'POST' }).then(reload)}>
                <CheckCheck className="size-3.5" /> Acknowledge all
              </Button>
            )
          }
          bodyClass="p-1.5"
        >
          {items.length === 0 ? (
            <Empty>No alarms in this view.</Empty>
          ) : (
            <FitPager
              items={items}
              rowHeight={41}
              reserve={64}
              render={(slice) => (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>P</TableHead>
                      <TableHead>Alarm</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Raised</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slice.map((a) => (
                      <TableRow key={a.id} className={cn(!a.acked && a.state === 'ACTIVE' && 'bg-amber-50/40')}>
                        <TableCell>
                          <Prio p={a.priority} />
                        </TableCell>
                        <TableCell className="max-w-[340px]">
                          <div className="truncate text-xs font-medium">{a.title}</div>
                          <div className="truncate text-[10px] text-slate-500">{a.detail}</div>
                        </TableCell>
                        <TableCell className="text-[11px] text-slate-500">{a.category}</TableCell>
                        <TableCell className="font-mono text-[11px]">{clockS(a.raised_at)}</TableCell>
                        <TableCell>
                          <Badge variant={a.state === 'ACTIVE' ? 'warning' : 'secondary'}>{a.state}</Badge>
                          {a.acked && <span className="ml-1 text-[10px] text-slate-500">ack {a.acked_by}</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {!a.acked && can('ack_alarm') && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => ack(a.id)}>
                              <Check className="size-3" /> Ack
                            </Button>
                          )}
                          {a.state === 'ACTIVE' && can('shelve_alarm') && (
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setShelve(a)}>
                              <Archive className="size-3" /> Shelve
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            />
          )}
        </Panel>
        <Panel title="Incidents (correlated alarms)" bodyClass="p-1.5">
          {incidents.length === 0 ? (
            <Empty>No incidents.</Empty>
          ) : (
            <FitPager
              items={incidents}
              rowHeight={58}
              reserve={36}
              render={(slice) => (
                <div className="space-y-1">
                  {slice.map((i) => (
                    <div key={i.id} className={cn('rounded-lg border px-2.5 py-1.5', !i.closed_at && 'border-l-2 border-l-amber-400')}>
                      <div className="flex items-center gap-1.5">
                        <Prio p={i.priority} />
                        <span className="font-mono text-[10px] text-slate-500">{i.id}</span>
                        <Badge variant={i.closed_at ? 'secondary' : 'warning'} className="ml-auto">
                          {i.closed_at ? 'closed' : 'open'}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] font-medium">{i.title}</div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        {clockS(i.opened_at)} · {i.alarm_ids.length} alarm(s)
                        {i.decision_id && (
                          <button className="text-sky-700 hover:underline" onClick={() => go('decisions', i.decision_id)}>
                            → decision {i.decision_id}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            />
          )}
        </Panel>
      </div>
      <Dialog open={!!shelve} onOpenChange={(o) => !o && setShelve(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shelve alarm for 30 minutes</DialogTitle>
            <DialogDescription>{shelve?.title} — shelved alarms are hidden from the active list but remain in history and the audit trail.</DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShelve(null)}>
              Cancel
            </Button>
            <Button
              disabled={reason.trim().length < 3}
              onClick={async () => {
                await api(`/alarms/${shelve!.id}/shelve`, { method: 'POST', body: { minutes: 30, reason } })
                setShelve(null)
                setReason('')
                reload()
              }}
            >
              Shelve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
