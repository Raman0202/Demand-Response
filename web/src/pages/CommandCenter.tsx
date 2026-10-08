// Overview — DR headline numbers, then the four operator questions on one screen:
// NOW (what is happening) · AT RISK (what is abnormal) · NEXT (what will happen) · INTENT (what the system will do)
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Activity, BatteryCharging, Bot, Check, CheckCheck, Clock3, IndianRupee, Loader2, Send, ShieldCheck, Target, Telescope, Users } from 'lucide-react'
import { FitPager } from '@/components/common'
import { Empty, GoLink, KpiCard, Panel, Prio, StoryChain } from '@/components/page'
import { TerritoryMap } from '@/components/three/TerritoryMap'
import { Button } from '@/components/ui/button'
import type { Alarm, DecisionSummary } from '@/data/types'
import { useApi } from '@/hooks'
import { api } from '@/lib/api'
import { capacity, useParticipants } from '@/lib/dr'
import { fmtMW, fmtRs } from '@/lib/geo'
import { chartTooltip, signed } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/store/useAuth'
import { clock, useLive } from '@/store/useLive'
import { useUI } from '@/store/useUI'

interface Overview {
  risk: { alarms: Alarm[]; incidents: { id: string; title: string; priority: number }[]; data_issues: Record<string, string>; confidence: number }
  next: ForecastT | null
  intent: {
    active: (DecisionSummary & { narrative: Record<string, unknown>; current: { allocations: { id: string; short: string; mw: number; type: string }[] } }) | null
    recent: DecisionSummary[]
  }
}
interface Band {
  p10: number
  p50: number
  p90: number
}
export interface ForecastT {
  blocks: { ts: number; label: string; ace: Band; deviation: Band; demand: Band; re: Band; max_line?: { label: string; loading: number } }[]
  violations: { label: string; lead_min: number; loading?: number; line?: string }[]
  accuracy: { mape_1block_pct: number | null; samples: number }
  model: string
}

export function CommandCenter() {
  const f = useLive((s) => s.frame)
  const { data } = useApi<Overview>('/overview', { intervalMs: 5000 })
  if (!f) return null
  return (
    <div className="flex h-full flex-col gap-3">
      <DrStrip />
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3">
        <NowPanel />
        <div className="col-span-5 grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[0.72fr_0.85fr_1.55fr] gap-3">
          <RiskPanel data={data} />
          <NextPanel forecast={data?.next ?? null} />
          <IntentPanel data={data} />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ DR HEADLINE */
// The six numbers a DR operator watches: how much is needed, how much can be called, what is called, what is delivered,
// who is reachable, and what it is worth.
function DrStrip() {
  const f = useLive((s) => s.frame)!
  const go = useUI((s) => s.go)
  const { data: parts } = useParticipants()
  const { data: rep } = useApi<{ net_benefit_rs: number; avoided_dsm_rs: number; decisions: number; delivered_mwh: number }>('/reports/summary', { intervalMs: 15000 })
  const c = capacity(parts ?? [])
  const need = f.requirement
  const covered = need > 0 ? Math.min(1, c.dispatched / need) : 1
  const ev = f.active_decision
  return (
    <div className="grid shrink-0 grid-cols-6 gap-2">
      <KpiCard
        icon={<Target />}
        label="Grid need now"
        value={need > 1 ? `${fmtMW(need)} ${f.direction === 'UP' ? '↓ load' : '↑ load'}` : 'None'}
        sub={need > 1 ? `ACE ${signed(f.ace)} MW · ${f.frequency.toFixed(2)} Hz` : `ACE ${signed(f.ace)} MW — within band`}
        tone={f.severity === 'EMERGENCY' ? 'bad' : f.severity === 'ALERT' ? 'warn' : 'good'}
        onClick={() => go('analysis')}
      />
      <KpiCard
        icon={<BatteryCharging />}
        label="Flexibility available"
        value={fmtMW(c.available)}
        fill={c.contracted ? c.available / c.contracted : 0}
        sub={`of ${fmtMW(c.contracted)} contracted · reliability-weighted`}
        tone={need > 1 && c.available < need - c.dispatched ? 'warn' : 'info'}
        onClick={() => go('resources')}
      />
      <KpiCard
        icon={<Send />}
        label="Dispatched"
        value={fmtMW(c.dispatched)}
        fill={need > 1 ? covered : undefined}
        sub={need > 1 ? `${(covered * 100).toFixed(0)}% of need · ${c.active} participants` : `${c.active} participants active`}
        tone={need > 1 && covered < 0.8 ? 'warn' : c.dispatched > 0.5 ? 'info' : undefined}
        onClick={() => go('decisions')}
      />
      <KpiCard
        icon={<Activity />}
        label="Delivering (metered)"
        value={fmtMW(c.delivering)}
        fill={c.dispatched > 0.5 ? c.delivering / c.dispatched : undefined}
        sub={c.dispatched > 0.5 ? `${((c.delivering / c.dispatched) * 100).toFixed(0)}% of dispatched` : 'no active dispatch'}
        tone={c.dispatched > 0.5 ? (c.delivering / c.dispatched >= 0.85 ? 'good' : 'warn') : undefined}
        onClick={() => go('decisions')}
      />
      <KpiCard
        icon={<Users />}
        label="Participants online"
        value={`${c.online} / ${c.participants}`}
        fill={c.participants ? c.online / c.participants : 0}
        sub={c.commsLost || c.outOfService ? `${c.commsLost} comms lost · ${c.outOfService} out of service` : 'all reachable'}
        tone={c.commsLost ? 'warn' : 'good'}
        onClick={() => go('resources')}
      />
      <KpiCard
        icon={<IndianRupee />}
        label={ev ? `Event ${ev.id}` : 'Programme value'}
        value={ev ? ev.state.replace('_', ' ') : fmtRs(rep?.net_benefit_rs ?? 0)}
        sub={ev ? `${fmtMW(ev.planned_mw)} planned · rev ${ev.revision}` : `${rep?.decisions ?? 0} events settled · ${fmtRs(rep?.avoided_dsm_rs ?? 0)} penalties avoided`}
        tone={ev ? (ev.state === 'AWAITING_APPROVAL' ? 'warn' : 'info') : 'good'}
        onClick={() => go(ev ? 'decisions' : 'reports', ev?.id)}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ NOW */
function NowPanel() {
  const f = useLive((s) => s.frame)!
  const trend = useLive((s) => s.trend)
  const go = useUI((s) => s.go)
  const t = trend.slice(-240)
  const vitals = [
    { k: 'frequency', label: 'Frequency', v: `${f.frequency.toFixed(3)} Hz`, tone: f.frequency < 49.9 || f.frequency > 50.05 ? 'warn' : 'ok', color: '#38bdf8' },
    { k: 'ace', label: 'ACE', v: `${signed(f.ace)} MW`, tone: Math.abs(f.ace) >= 300 ? 'bad' : Math.abs(f.ace) >= 100 ? 'warn' : 'ok', color: '#8b5cf6' },
    { k: 'demand', label: 'System demand', v: fmtMW(f.demand), tone: 'ok', color: '#0ea5e9' },
    { k: 're', label: 'Renewables', v: fmtMW(f.re), tone: 'ok', color: '#65a30d' },
  ] as const
  return (
    <Panel
      className="col-span-7"
      title={
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> Now — what is happening
        </span>
      }
      aside={<GoLink onClick={() => go('operations')}>Grid view</GoLink>}
      bodyClass="relative p-0"
    >
      <TerritoryMap compact className="rounded-none border-0" />
      <div className="pointer-events-none absolute top-2 right-2 grid w-[150px] gap-1.5">
        {vitals.map((x) => (
          <div
            key={x.k}
            className={cn(
              'rounded-lg border bg-white/90 px-2 py-1 shadow-xs backdrop-blur',
              x.tone === 'bad' ? 'border-rose-200' : x.tone === 'warn' ? 'border-amber-200' : 'border-slate-200',
            )}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[10px] text-slate-500">{x.label}</span>
              <span
                className={cn('font-mono text-[12px] font-semibold tabular-nums', x.tone === 'bad' ? 'text-rose-600' : x.tone === 'warn' ? 'text-amber-700' : 'text-slate-800')}
              >
                {x.v}
              </span>
            </div>
            <div className="h-5">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={t}>
                  <YAxis hide domain={['dataMin', 'dataMax']} />
                  <Line dataKey={x.k} stroke={x.color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ AT RISK */
function RiskPanel({ data }: { data: Overview | null }) {
  const go = useUI((s) => s.go)
  const can = useAuth((s) => s.can)
  const f = useLive((s) => s.frame)!
  const alarms = data?.risk.alarms ?? []
  const dq = Object.keys(f.quality_issues).length
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', f.counts.p1 ? 'bg-rose-500' : alarms.length ? 'bg-amber-500' : 'bg-emerald-500')} /> At risk — what is abnormal
        </span>
      }
      aside={<GoLink onClick={() => go('alarms')}>All alarms ({f.counts.alarms})</GoLink>}
      bodyClass="flex flex-col gap-1.5 overflow-hidden"
    >
      {dq > 0 && (
        <div className="shrink-0 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
          Data quality: {dq} point(s) stale/suspect · confidence {(f.confidence * 100).toFixed(0)}%
        </div>
      )}
      {alarms.length === 0 ? (
        <Empty>No active alarms. Network, balance and data quality are within limits.</Empty>
      ) : (
        <div className="min-h-0 flex-1">
          <FitPager
            items={alarms}
            rowHeight={46}
            reserve={30}
            render={(slice) => (
              <div className="space-y-1">
                {slice.map((a) => (
                  <div key={a.id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1', !a.acked && 'border-l-2 border-l-amber-400')}>
                    <Prio p={a.priority} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-slate-700">{a.title}</div>
                      <div className="truncate text-[10px] text-slate-500">
                        {clock(a.raised_at)} · {a.detail}
                      </div>
                    </div>
                    {!a.acked && can('ack_alarm') && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => api(`/alarms/${a.id}/ack`, { method: 'POST' })}>
                        <Check className="size-3" /> Ack
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          />
        </div>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ NEXT */
function NextPanel({ forecast }: { forecast: ForecastT | null }) {
  const go = useUI((s) => s.go)
  const rows = forecast?.blocks.map((b) => ({ label: b.label, p50: b.ace.p50, band: [b.ace.p10, b.ace.p90] })) ?? []
  const v = forecast?.violations ?? []
  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Telescope className="size-3.5 text-sky-600" /> Next — what will happen (2 h)
        </span>
      }
      aside={<GoLink onClick={() => go('analysis')}>Forecast</GoLink>}
      bodyClass="grid grid-cols-[1.3fr_1fr] gap-3"
    >
      <div className="min-h-0">
        <div className="text-[10px] text-slate-500">ACE forecast — P50 with P10–P90 band (MW)</div>
        <div className="h-[calc(100%-14px)]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#94a3b8' }} interval={1} />
              <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} width={34} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <ReferenceLine y={-100} stroke="#fcd34d" strokeDasharray="3 3" />
              <ReferenceLine y={100} stroke="#fcd34d" strokeDasharray="3 3" />
              <RTooltip
                {...chartTooltip}
                formatter={(val) => (Array.isArray(val) ? `${Number(val[0]).toFixed(0)} … ${Number(val[1]).toFixed(0)} MW` : `${Number(val).toFixed(0)} MW`)}
              />
              <Area dataKey="band" stroke="none" fill="#c4b5fd55" isAnimationActive={false} />
              <Line dataKey="p50" stroke="#7c3aed" dot={false} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="min-h-0 space-y-1 overflow-hidden">
        <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Predicted risks</div>
        {v.length === 0 ? (
          <div className="text-[12px] text-emerald-700">No predicted violations in the horizon.</div>
        ) : (
          v.slice(0, 4).map((x, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1 text-[11px]">
              <Clock3 className="size-3 shrink-0 text-amber-600" />
              <span className="font-mono text-amber-700">+{x.lead_min}m</span>
              <span className="truncate">
                {x.label}
                {x.loading ? ` ${(x.loading * 100).toFixed(0)}%` : ''}
              </span>
            </div>
          ))
        )}
        {forecast?.accuracy.mape_1block_pct != null && <div className="pt-1 text-[10px] text-slate-400">1-block demand MAPE {forecast.accuracy.mape_1block_pct}%</div>}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ INTENT */
function IntentPanel({ data }: { data: Overview | null }) {
  const go = useUI((s) => s.go)
  const can = useAuth((s) => s.can)
  const user = useAuth((s) => s.user)
  const d = data?.intent.active
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function approve() {
    if (!d) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await api<DecisionSummary>(`/decisions/${d.id}/approve`, { method: 'POST' })
      setMsg(r.state === 'EXECUTING' ? 'Approved — commands released.' : 'Recorded — awaiting second (dual) authorisation.')
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const alreadyApproved = d?.approvals.some((a) => a.user === user?.username)
  return (
    <Panel
      className={cn(d?.state === 'AWAITING_APPROVAL' && 'ring-2 ring-amber-300')}
      title={
        <span className="flex items-center gap-1.5">
          <Bot className="size-3.5 text-sky-600" /> Intent — what the system will do
        </span>
      }
      aside={d ? <GoLink onClick={() => go('decisions', d.id)}>Open decision</GoLink> : <GoLink onClick={() => go('decisions')}>Decisions</GoLink>}
      bodyClass="flex flex-col gap-2 overflow-hidden"
    >
      {!d ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
            <ShieldCheck className="size-4" /> Monitoring. No action required — the system will act when ACE leaves ±100 MW for 60 s.
          </div>
          <div className="mt-2 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Recent outcomes</div>
          <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
            {(data?.intent.recent ?? []).slice(0, 4).map((x) => (
              <button key={x.id} onClick={() => go('decisions', x.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-slate-50">
                <CheckCheck className="size-3.5 text-emerald-600" />
                <span className="font-mono text-slate-500">{x.id}</span>
                <span className="flex-1 truncate">{x.closed_reason || x.headline}</span>
                {x.net_benefit_rs != null && <span className={cn('font-mono', x.net_benefit_rs >= 0 ? 'text-emerald-700' : 'text-amber-700')}>{fmtRs(x.net_benefit_rs)}</span>}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', d.state === 'AWAITING_APPROVAL' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800')}>
              {d.state.replace('_', ' ')}
            </span>
            <span className="truncate text-[12px] font-semibold text-slate-700">{d.headline}</span>
            <span className="ml-auto font-mono text-[10px] text-slate-400">
              {d.id} · rev {d.revision}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <StoryChain narrative={d.narrative} compact />
          </div>
          {d.state === 'AWAITING_APPROVAL' && (
            <div className="flex shrink-0 items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-2">
              <div className="flex-1 text-[11px] text-amber-900">
                {d.awaiting_mw.toFixed(0)} MW needs approval{d.needs_dual ? ' · dual authorisation' : ''}
                {d.approvals.length > 0 && ` · approved by ${d.approvals.map((a) => a.user).join(', ')}`}
              </div>
              {can('approve') && !alreadyApproved && (
                <Button size="sm" className="h-7" disabled={busy || (d.approvals.length > 0 && !can('approve_dual'))} onClick={approve}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {d.approvals.length ? 'Second approval' : 'Approve'}
                </Button>
              )}
              <Button size="sm" variant="outline" className="h-7" onClick={() => go('decisions', d.id)}>
                Review
              </Button>
            </div>
          )}
          {msg && <div className="shrink-0 text-[11px] text-slate-600">{msg}</div>}
        </>
      )}
    </Panel>
  )
}
