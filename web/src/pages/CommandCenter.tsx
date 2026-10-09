// Overview — the spatial workspace. The live territory map is the canvas; DR headline numbers and the four operator
// questions (AT RISK · NEXT · INTENT, with NOW being the map itself) float over it as glass panels. Selecting anything
// flies the camera there and lights up what it touches; the active DR event plays out on the map with a scrubbable timeline.
import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import {
  Activity,
  BatteryCharging,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock3,
  Crosshair,
  IndianRupee,
  Loader2,
  MapPin,
  Send,
  ShieldCheck,
  ShieldAlert,
  Target,
  Telescope,
  Users,
} from 'lucide-react'
import { FitPager } from '@/components/common'
import { GoLink, KpiCard, Prio, StoryChain } from '@/components/page'
import { EventTimeline } from '@/components/spatial/EventTimeline'
import { glass, GlassPanel } from '@/components/spatial/Glass'
import { useEventPlayback } from '@/components/spatial/useEventPlayback'
import { TerritoryMap } from '@/components/three/TerritoryMap'
import { Button } from '@/components/ui/button'
import { ASSET_BY_ID, ASSET_TYPE_META } from '@/data/topology'
import type { Alarm, DecisionSummary } from '@/data/types'
import { useApi } from '@/hooks'
import { api } from '@/lib/api'
import { capacity, useParticipants } from '@/lib/dr'
import { fmtMW, fmtRs } from '@/lib/geo'
import { alarmSelection, worldOf, type Sel } from '@/lib/spatial'
import { chartTooltip, signed } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/store/useAuth'
import { clock, clockS, useLive } from '@/store/useLive'
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
  const selection = useUI((s) => s.selection)
  const playhead = useUI((s) => s.playhead)
  const focus = useUI((s) => s.focus)
  const select = useUI((s) => s.select)
  const setCamera = useUI((s) => s.setCamera)
  const go = useUI((s) => s.go)
  const [kpisOpen, setKpisOpen] = useState(true)
  const [timelineFor, setTimelineFor] = useState<string | null | undefined>(undefined) // undefined = follow active event

  // the event in context: one the operator picked, otherwise the live one
  const eventId = selection?.kind === 'event' ? selection.id : timelineFor === undefined ? (f?.active_decision?.id ?? null) : timelineFor
  const pb = useEventPlayback(eventId, playhead)
  const showTimeline = !!eventId && !!pb.detail

  if (!f) return null

  const flyToEvent = (id: string, participants: string[]) => {
    setTimelineFor(id)
    focus({ kind: 'event', id }, worldOf({ kind: 'event', id }, participants))
  }

  const cardActions = (sel: Sel) => (
    <>
      {sel.kind === 'asset' && (
        <Button size="sm" variant="outline" className="h-7 bg-white/70" onClick={() => go('resources')}>
          <Users className="size-3.5" /> Programs
        </Button>
      )}
      {(sel.kind === 'line' || sel.kind === 'bus' || sel.kind === 'channel' || sel.kind === 'station' || sel.kind === 'gen') && (
        <Button size="sm" variant="outline" className="h-7 bg-white/70" onClick={() => go('operations')}>
          <MapPin className="size-3.5" /> Grid view
        </Button>
      )}
      {sel.kind === 'event' && (
        <Button size="sm" variant="outline" className="h-7 bg-white/70" onClick={() => go('decisions', sel.id)}>
          Open event
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7"
        onClick={() => {
          select(null)
          setCamera('STATE')
        }}
      >
        <Crosshair className="size-3.5" /> Reset view
      </Button>
    </>
  )

  return (
    <div className="relative h-full overflow-hidden">
      <div className="absolute inset-0 isolate">
        <TerritoryMap
          overlay={eventId ? pb.overlay : undefined}
          chrome={{
            bare: true,
            toolbarClass: cn('left-3 transition-[top]', kpisOpen ? 'top-[112px]' : 'top-[60px]'),
            legendClass: cn('left-3', showTimeline ? 'bottom-[120px]' : 'bottom-3'),
            cardActions,
            // while replaying, the event card shows the moment under the playhead, not the live state
            cardRows: (sel) =>
              sel.kind === 'event' && pb.detail?.id === sel.id && !pb.live && pb.point
                ? [
                    ['Replay at', clockS(pb.at)],
                    ['Target', fmtMW(pb.point.target)],
                    ['Dispatched', fmtMW(pb.point.dispatched)],
                    ['Delivered', fmtMW(pb.point.delivered)],
                    ['Participants active', String(pb.activeCount)],
                  ]
                : null,
          }}
        />
      </div>

      {/* floating chrome: pointer events only on the panels themselves */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-3">
        <DrStrip open={kpisOpen} onToggle={() => setKpisOpen(!kpisOpen)} />
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col justify-end">
            {showTimeline && (
              <EventTimeline
                pb={pb}
                onClose={() => {
                  setTimelineFor(null)
                  if (selection?.kind === 'event') select(null)
                }}
              />
            )}
          </div>
          <div className="flex w-[380px] shrink-0 flex-col gap-3">
            <RiskPanel data={data} onLocate={(sel) => (sel ? select(sel) : f.active_decision ? flyToEvent(f.active_decision.id, pb.participants) : setCamera('STATE'))} />
            <NextPanel forecast={data?.next ?? null} />
            <IntentPanel data={data} onShow={flyToEvent} participants={pb.detail?.id === data?.intent.active?.id ? pb.participants : []} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ DR HEADLINE */
// The six numbers a DR operator watches: how much is needed, how much can be called, what is called, what is delivered,
// who is reachable, and what it is worth.
function DrStrip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const f = useLive((s) => s.frame)!
  const go = useUI((s) => s.go)
  const { data: parts } = useParticipants()
  const { data: rep } = useApi<{ net_benefit_rs: number; avoided_dsm_rs: number; decisions: number; delivered_mwh: number }>('/reports/summary', { intervalMs: 15000 })
  const c = capacity(parts ?? [])
  const need = f.requirement
  const covered = need > 0 ? Math.min(1, c.dispatched / need) : 1
  const ev = f.active_decision
  const g = 'border-white/70 bg-white/80 shadow-lg shadow-slate-900/[0.06] backdrop-blur-md'

  const toggle = (
    <button
      onClick={onToggle}
      className={cn('pointer-events-auto grid w-7 shrink-0 place-items-center rounded-xl text-slate-500 hover:text-slate-800', glass)}
      aria-label={open ? 'Collapse KPIs' : 'Expand KPIs'}
    >
      {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
    </button>
  )
  if (!open)
    return (
      <div className="flex shrink-0 gap-2">
        <div className={cn('pointer-events-auto flex min-w-0 flex-1 items-center gap-5 rounded-xl px-3 py-2 text-[12px]', glass)}>
          <Chip label="Need" value={need > 1 ? fmtMW(need) : 'none'} tone={f.severity === 'NORMAL' ? 'text-emerald-700' : 'text-amber-700'} />
          <Chip label="Available" value={fmtMW(c.available)} />
          <Chip label="Dispatched" value={fmtMW(c.dispatched)} />
          <Chip label="Delivering" value={fmtMW(c.delivering)} />
          <Chip label="Online" value={`${c.online}/${c.participants}`} />
          {ev && <Chip label={`Event ${ev.id}`} value={ev.state.replace('_', ' ')} tone="text-amber-700" />}
        </div>
        {toggle}
      </div>
    )
  return (
    <div className="flex shrink-0 gap-2">
      <div className="pointer-events-auto grid min-w-0 flex-1 grid-cols-6 gap-2">
        <KpiCard
          className={g}
          icon={<Target />}
          label="Grid need now"
          value={need > 1 ? `${fmtMW(need)} ${f.direction === 'UP' ? '↓ load' : '↑ load'}` : 'None'}
          sub={need > 1 ? `ACE ${signed(f.ace)} MW · ${f.frequency.toFixed(2)} Hz` : `ACE ${signed(f.ace)} MW — within band`}
          tone={f.severity === 'EMERGENCY' ? 'bad' : f.severity === 'ALERT' ? 'warn' : 'good'}
          onClick={() => go('analysis')}
        />
        <KpiCard
          className={g}
          icon={<BatteryCharging />}
          label="Flexibility available"
          value={fmtMW(c.available)}
          fill={c.contracted ? c.available / c.contracted : 0}
          sub={`of ${fmtMW(c.contracted)} contracted · reliability-weighted`}
          tone={need > 1 && c.available < need - c.dispatched ? 'warn' : 'info'}
          onClick={() => go('resources')}
        />
        <KpiCard
          className={g}
          icon={<Send />}
          label="Dispatched"
          value={fmtMW(c.dispatched)}
          fill={need > 1 ? covered : undefined}
          sub={need > 1 ? `${(covered * 100).toFixed(0)}% of need · ${c.active} participants` : `${c.active} participants active`}
          tone={need > 1 && covered < 0.8 ? 'warn' : c.dispatched > 0.5 ? 'info' : undefined}
          onClick={() => go('decisions')}
        />
        <KpiCard
          className={g}
          icon={<Activity />}
          label="Delivering (metered)"
          value={fmtMW(c.delivering)}
          fill={c.dispatched > 0.5 ? c.delivering / c.dispatched : undefined}
          sub={c.dispatched > 0.5 ? `${((c.delivering / c.dispatched) * 100).toFixed(0)}% of dispatched` : 'no active dispatch'}
          tone={c.dispatched > 0.5 ? (c.delivering / c.dispatched >= 0.85 ? 'good' : 'warn') : undefined}
          onClick={() => go('decisions')}
        />
        <KpiCard
          className={g}
          icon={<Users />}
          label="Participants online"
          value={`${c.online} / ${c.participants}`}
          fill={c.participants ? c.online / c.participants : 0}
          sub={c.commsLost || c.outOfService ? `${c.commsLost} comms lost · ${c.outOfService} out of service` : 'all reachable'}
          tone={c.commsLost ? 'warn' : 'good'}
          onClick={() => go('resources')}
        />
        <KpiCard
          className={g}
          icon={<IndianRupee />}
          label={ev ? `Event ${ev.id}` : 'Programme value'}
          value={ev ? ev.state.replace('_', ' ') : fmtRs(rep?.net_benefit_rs ?? 0)}
          sub={ev ? `${fmtMW(ev.planned_mw)} planned · rev ${ev.revision}` : `${rep?.decisions ?? 0} events settled · ${fmtRs(rep?.avoided_dsm_rs ?? 0)} penalties avoided`}
          tone={ev ? (ev.state === 'AWAITING_APPROVAL' ? 'warn' : 'info') : 'good'}
          onClick={() => go(ev ? 'decisions' : 'reports', ev?.id)}
        />
      </div>
      {toggle}
    </div>
  )
}

function Chip({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={cn('font-mono font-semibold tabular-nums text-slate-800', tone)}>{value}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ AT RISK */
function RiskPanel({ data, onLocate }: { data: Overview | null; onLocate: (sel: Sel | null) => void }) {
  const go = useUI((s) => s.go)
  const can = useAuth((s) => s.can)
  const f = useLive((s) => s.frame)!
  const alarms = data?.risk.alarms ?? []
  const dq = Object.keys(f.quality_issues).length
  return (
    <GlassPanel
      className="flex-[0.85]"
      tone={f.counts.p1 ? 'bad' : undefined}
      icon={<ShieldAlert className={f.counts.p1 ? 'text-rose-500' : alarms.length ? 'text-amber-500' : 'text-emerald-500'} />}
      title="At risk — what is abnormal"
      collapsedHint={`${f.counts.alarms} alarms · ${f.counts.p1} critical`}
      aside={<GoLink onClick={() => go('alarms')}>All ({f.counts.alarms})</GoLink>}
      bodyClass="flex flex-col gap-1.5"
    >
      {dq > 0 && (
        <div className="shrink-0 rounded-md bg-amber-50/80 px-2 py-1 text-[11px] text-amber-800">
          Data quality: {dq} point(s) stale/suspect · confidence {(f.confidence * 100).toFixed(0)}%
        </div>
      )}
      {alarms.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50/80 px-2.5 py-2 text-[12px] text-emerald-800">
          <ShieldCheck className="size-4" /> No active alarms. Network, balance and data quality are within limits.
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <FitPager
            items={alarms}
            rowHeight={44}
            reserve={30}
            render={(slice) => (
              <div className="space-y-1">
                {slice.map((a) => {
                  const where = alarmSelection(a)
                  return (
                    <div
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onLocate(where)}
                      onKeyDown={(e) => e.key === 'Enter' && onLocate(where)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border border-slate-900/[0.06] bg-white/60 px-2 py-1 transition hover:bg-white',
                        !a.acked && 'border-l-2 border-l-amber-400',
                      )}
                      title={where ? 'Show on map' : 'System-wide'}
                    >
                      <Prio p={a.priority} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-slate-700">{a.title}</div>
                        <div className="truncate text-[10px] text-slate-500">
                          {clock(a.raised_at)} · {a.detail}
                        </div>
                      </div>
                      {where && <MapPin className="size-3.5 shrink-0 text-sky-600" />}
                      {!a.acked && can('ack_alarm') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation()
                            void api(`/alarms/${a.id}/ack`, { method: 'POST' })
                          }}
                        >
                          <Check className="size-3" /> Ack
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          />
        </div>
      )}
    </GlassPanel>
  )
}

/* ------------------------------------------------------------------ NEXT */
function NextPanel({ forecast }: { forecast: ForecastT | null }) {
  const go = useUI((s) => s.go)
  const select = useUI((s) => s.select)
  const rows = forecast?.blocks.map((b) => ({ label: b.label, p50: b.ace.p50, band: [b.ace.p10, b.ace.p90] })) ?? []
  const v = forecast?.violations ?? []
  return (
    <GlassPanel
      className="flex-[0.9]"
      icon={<Telescope className="text-sky-600" />}
      title="Next — what will happen (2 h)"
      collapsedHint={v.length ? `${v.length} predicted violation(s)` : 'no violations predicted'}
      aside={<GoLink onClick={() => go('analysis')}>Forecast</GoLink>}
      bodyClass="flex flex-col gap-1.5"
    >
      <div className="min-h-[70px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeOpacity={0.6} vertical={false} />
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
      <div className="shrink-0 space-y-1">
        {v.length === 0 ? (
          <div className="text-[11px] text-emerald-700">No predicted violations in the horizon.</div>
        ) : (
          v.slice(0, 2).map((x, i) => (
            <button
              key={i}
              disabled={!x.line}
              onClick={() => x.line && select({ kind: 'line', id: x.line })}
              className="flex w-full items-center gap-2 rounded-md bg-white/60 px-2 py-1 text-left text-[11px] transition enabled:hover:bg-white"
            >
              <Clock3 className="size-3 shrink-0 text-amber-600" />
              <span className="font-mono text-amber-700">+{x.lead_min}m</span>
              <span className="flex-1 truncate">
                {x.label}
                {x.loading ? ` ${(x.loading * 100).toFixed(0)}%` : ''}
              </span>
              {x.line && <MapPin className="size-3 shrink-0 text-sky-600" />}
            </button>
          ))
        )}
      </div>
    </GlassPanel>
  )
}

/* ------------------------------------------------------------------ INTENT */
function IntentPanel({ data, onShow, participants }: { data: Overview | null; onShow: (id: string, participants: string[]) => void; participants: string[] }) {
  const go = useUI((s) => s.go)
  const select = useUI((s) => s.select)
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
  const allocs = d?.current?.allocations ?? []
  const who = (participants.length ? participants : allocs.map((a) => a.id)).filter((id) => ASSET_BY_ID[id] && ASSET_BY_ID[id].type !== 'generation')
  return (
    <GlassPanel
      className="flex-[1.45]"
      tone={d?.state === 'AWAITING_APPROVAL' ? 'warn' : undefined}
      icon={<Bot className="text-sky-600" />}
      title="Intent — what the system will do"
      collapsedHint={d ? `${d.state.replace('_', ' ').toLowerCase()} · ${fmtMW(d.planned_mw)}` : 'monitoring'}
      aside={d ? <GoLink onClick={() => go('decisions', d.id)}>Open event</GoLink> : <GoLink onClick={() => go('decisions')}>DR events</GoLink>}
      bodyClass="flex flex-col gap-2"
    >
      {!d ? (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50/80 px-3 py-2 text-[12px] text-emerald-800">
            <ShieldCheck className="size-4" /> Monitoring. The system opens a DR event when the grid need stays above 100 MW for a minute.
          </div>
          <div className="mt-2 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Recent outcomes</div>
          <div className="min-h-0 flex-1 space-y-1 overflow-hidden">
            {(data?.intent.recent ?? []).slice(0, 5).map((x) => (
              <button key={x.id} onClick={() => onShow(x.id, [])} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] hover:bg-white/70">
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
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">{d.headline}</span>
            <Button size="sm" variant="outline" className="h-6 shrink-0 bg-white/70 px-2 text-[11px]" onClick={() => onShow(d.id, who)}>
              <MapPin className="size-3" /> Show on map
            </Button>
          </div>
          {who.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-1">
              {who.slice(0, 8).map((id) => (
                <button
                  key={id}
                  onClick={() => select({ kind: 'asset', id })}
                  className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-slate-700 ring-1 ring-slate-900/10 transition hover:bg-white"
                >
                  <span className="size-1.5 rounded-full" style={{ background: ASSET_TYPE_META[ASSET_BY_ID[id].type]?.color }} />
                  {ASSET_BY_ID[id].short}
                </button>
              ))}
              {who.length > 8 && <span className="px-1 text-[10px] text-slate-500">+{who.length - 8} more</span>}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            <StoryChain narrative={d.narrative} compact />
          </div>
          {d.state === 'AWAITING_APPROVAL' && (
            <div className="flex shrink-0 items-center gap-2 rounded-lg bg-amber-50/90 px-2.5 py-2">
              <div className="flex-1 text-[11px] text-amber-900">
                {d.awaiting_mw.toFixed(0)} MW needs approval{d.needs_dual ? ' · dual authorisation' : ''}
                {d.approvals.length > 0 && ` · approved by ${d.approvals.map((a) => a.user).join(', ')}`}
              </div>
              {can('approve') && !alreadyApproved && (
                <Button size="sm" className="h-7" disabled={busy || (d.approvals.length > 0 && !can('approve_dual'))} onClick={approve}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} {d.approvals.length ? 'Second approval' : 'Approve'}
                </Button>
              )}
            </div>
          )}
          {msg && <div className="shrink-0 text-[11px] text-slate-600">{msg}</div>}
        </>
      )}
    </GlassPanel>
  )
}
