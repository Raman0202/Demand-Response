import { useMemo, useState } from 'react'
import { Area, Bar as RBar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowRight, CheckCircle2, Cpu, FileSignature, KeyRound, Loader2, Radio, RefreshCw, Send, ShieldCheck, XCircle } from 'lucide-react'
import { Calc, FitPager, Kpi, SectionTabs, StepShell, SystemSays, Why } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ASSET_BY_ID, ASSET_TYPE_META, BLOCK_MIN } from '@/data/karnataka'
import type { CheckStatus } from '@/engine/twin'
import { fmtMW, fmtRs } from '@/lib/geo'
import { chartTooltip } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { finalPlan, useDecisionStore } from '@/store/useDecisionStore'
import { useUIStore } from '@/store/useUIStore'

const COLORS = ['#7dd3fc', '#86efac', '#fcd34d', '#c4b5fd', '#f9a8d4', '#5eead4', '#fde68a', '#fda4af', '#bef264', '#93c5fd', '#d8b4fe', '#6ee7b7']

const short = (id: string, fallback: string) => ASSET_BY_ID[id]?.short ?? fallback

/* ------------------------------------------------------------------ 5. PLAN */
export function StepPlan() {
  const s = useDecisionStore()
  const plan = s.iterations[0]?.plan
  const a = s.assessment!
  const chart = useMemo(() => {
    if (!plan) return []
    return Array.from({ length: plan.blocks }, (_, b) => {
      const row: Record<string, number | string> = { block: `B${b + 1}`, need: plan.needByBlock[b] }
      for (const al of plan.allocations) row[al.assetId] = +al.expectedByBlock[b].toFixed(1)
      return row
    })
  }, [plan])
  if (!plan) return null
  const peak = Math.max(...plan.suppliedByBlock)
  const bindings = [...new Map(plan.bindings.map((b) => [b.assetId + b.lineId, b])).values()]
  return (
    <StepShell
      says={
        <SystemSays tone={plan.costs.savingsRs > 0 ? 'good' : 'warn'}>
          Dispatch <b>{plan.allocations.length} resources</b> for up to <b>{fmtMW(peak)}</b> expected. Total {fmtRs(plan.costs.totalRs)} incl. residual DSM & rebound —{' '}
          {plan.costs.savingsRs > 0 ? (
            <>
              <b>{fmtRs(plan.costs.savingsRs)} cheaper</b> than doing nothing.
            </>
          ) : (
            <>dearer than doing nothing, but required for security (IEGC: ACE → 0).</>
          )}{' '}
          {bindings.length > 0 && <>The network capped {new Set(bindings.map((b) => b.assetId)).size} resource(s).</>}
        </SystemSays>
      }
    >
      <SectionTabs
        sections={[
          {
            id: 'delivery',
            label: 'Delivery',
            content: (
              <div className="flex h-full flex-col gap-3">
                <div className="grid shrink-0 grid-cols-4 gap-2">
                  <Kpi label="Resource cost" value={fmtRs(plan.costs.resourceRs + plan.costs.rtmRs)} />
                  <Kpi
                    label="Residual DSM"
                    value={fmtRs(plan.costs.residualDsmRs)}
                    sub={plan.costs.residualDsmRs < 0 ? 'receivable' : undefined}
                    tone={plan.costs.residualDsmRs > 0 ? 'warn' : 'good'}
                  />
                  <Kpi label="Rebound cost" value={fmtRs(plan.costs.reboundRs)} sub={`+${plan.postReboundMW[0].toFixed(0)} MW after release`} />
                  <Kpi label="Saving" value={fmtRs(plan.costs.savingsRs)} tone={plan.costs.savingsRs > 0 ? 'good' : 'bad'} />
                </div>
                <Card className="min-h-0 flex-1 gap-1 py-3">
                  <CardHeader>
                    <CardTitle className="text-sm">Expected delivery by block vs requirement</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chart}>
                        <CartesianGrid stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="block" tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={44} />
                        <RTooltip {...chartTooltip} formatter={(v, n) => [`${Number(v).toFixed(0)} MW`, ASSET_BY_ID[n as string]?.short ?? n]} />
                        {plan.allocations.map((al, i) => (
                          <RBar key={al.assetId} dataKey={al.assetId} stackId="a" fill={COLORS[i % COLORS.length]} isAnimationActive={false} />
                        ))}
                        <Line type="stepAfter" dataKey="need" stroke="#475569" strokeDasharray="5 4" strokeWidth={2} dot={false} name="Requirement" isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            id: 'merit',
            label: `Merit order (${plan.allocations.length})`,
            content: (
              <Card className="h-full gap-0 py-2">
                <CardContent className="h-full px-2">
                  <FitPager
                    items={plan.allocations}
                    rowHeight={46}
                    render={(slice) => (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>#</TableHead>
                            <TableHead>Resource</TableHead>
                            <TableHead>MW by block</TableHead>
                            <TableHead className="text-right">₹/kWh eff.</TableHead>
                            <TableHead className="text-right">Cost</TableHead>
                            <TableHead>Limits</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {slice.map((al) => (
                            <TableRow key={al.assetId}>
                              <TableCell className="font-mono text-xs">{al.rank}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="size-2.5 rounded-sm" style={{ background: COLORS[(al.rank - 1) % COLORS.length] }} />
                                  <div className="leading-tight">
                                    <div className="text-xs font-medium">{short(al.assetId, al.name)}</div>
                                    <div className="text-[10px] text-muted-foreground">rel. {(al.reliability * 100).toFixed(0)}%</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-[11px]">{al.mwByBlock.map((x) => x.toFixed(0)).join(' · ')}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{al.effectiveCost.toFixed(2)}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{fmtRs(al.costRs)}</TableCell>
                              <TableCell className="max-w-[240px]">
                                <div className="flex flex-wrap gap-1">
                                  {al.caps.length ? (
                                    al.caps.slice(0, 2).map((c) => (
                                      <Badge key={c} variant={c.startsWith('Network') ? 'destructive' : 'warning'} className="max-w-[230px] truncate text-[9px]">
                                        {c}
                                      </Badge>
                                    ))
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground">full requested MW</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  />
                </CardContent>
              </Card>
            ),
          },
          {
            id: 'constraints',
            label: `Constraints & unused (${bindings.length + plan.skipped.length})`,
            content: (
              <div className="grid h-full grid-cols-2 gap-3">
                <Card className="gap-2 py-3">
                  <CardHeader>
                    <CardTitle className="text-sm">Network constraints that shaped the plan</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1">
                    {bindings.length ? (
                      <FitPager
                        items={bindings}
                        rowHeight={34}
                        reserve={30}
                        render={(slice) => (
                          <ul className="space-y-1.5 text-xs">
                            {slice.map((b) => (
                              <li key={b.assetId + b.lineId} className="flex gap-2 rounded-md bg-rose-50 px-2 py-1.5 text-rose-700">
                                <AlertTriangle className="mt-0.5 size-3 shrink-0" /> <span className="line-clamp-1">{b.detail}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">No line reached its limit — the plan is not network-constrained.</p>
                    )}
                  </CardContent>
                </Card>
                <Card className="gap-2 py-3">
                  <CardHeader>
                    <CardTitle className="text-sm">Not used — and why</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1">
                    <FitPager
                      items={plan.skipped}
                      rowHeight={34}
                      reserve={30}
                      render={(slice) => (
                        <ul className="space-y-1.5 text-xs">
                          {slice.map((sk) => (
                            <li key={sk.assetId} className="line-clamp-1 rounded-md bg-slate-50 px-2 py-1.5 text-muted-foreground">
                              <span className="font-medium text-foreground">{short(sk.assetId, sk.name)}</span> — {sk.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    />
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            id: 'why',
            label: 'Why',
            content: (
              <Why>
                <p>
                  For every block the engine walks resources in effective-cost order and allocates MW subject to availability, ramp, response time, maximum duration, BESS energy
                  and line headroom (PTDF). A resource that would push a line past its limit is capped at the MW that keeps the line at 100%.
                </p>
                <p>
                  Objective: min Σ C_DR·P·Δt + C_BESS + C_rebound + C_market + λ·S. Severity {a.severity}:{' '}
                  {a.severity === 'NORMAL' ? 'economic DR only (cheaper than the DSM marginal rate).' : 'security dispatch — cover ACE regardless of price.'}
                </p>
              </Why>
            ),
          },
        ]}
      />
    </StepShell>
  )
}

/* ------------------------------------------------------------------ 6. TWIN */
const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="size-4 text-emerald-500" />,
  warn: <AlertTriangle className="size-4 text-amber-500" />,
  fail: <XCircle className="size-4 text-red-500" />,
}

export function StepTwin() {
  const s = useDecisionStore()
  const revealed = s.twinRevealed
  const it = revealed > 0 ? s.iterations[revealed - 1] : null
  const done = revealed >= s.iterations.length
  const last = s.iterations.at(-1)!
  const minutes = useMemo(() => it?.twin.minutes.map((m) => ({ ...m, t: m.t + 1 })) ?? [], [it])
  const socData = useMemo(() => {
    if (!it) return []
    const ids = Object.keys(it.twin.soc)
    const len = ids.length ? it.twin.soc[ids[0]].length : 0
    return Array.from({ length: len }, (_, m) => {
      const row: Record<string, number> = { t: m }
      for (const id of ids) row[id] = +(it.twin.soc[id][m] * 100).toFixed(1)
      return row
    })
  }, [it])

  if (revealed === 0)
    return (
      <StepShell
        says={
          <SystemSays>
            Before any command leaves the SLDC, the plan is replayed minute-by-minute: live heartbeats, response lag, SoC, post-dispatch power flow, voltage, P90 reserve, ancillary
            arbitration and rebound. Unsafe plans are automatically re-solved.
          </SystemSays>
        }
      >
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_280px] gap-3">
          <div className="grid grid-cols-2 content-start gap-2">
            {[
              'Heartbeat & command path',
              'BESS SoC trajectory',
              'Line loading (DC PF)',
              'Voltage (estimated)',
              'Response lag',
              'P90 reserve kept',
              'No SRAS/TRAS double-commit',
              'Rebound',
            ].map((c) => (
              <div key={c} className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-xs text-muted-foreground">
                <Cpu className="size-3.5 text-sky-500" /> {c}
              </div>
            ))}
          </div>
          <Card className="items-center justify-center gap-3 text-center">
            <Cpu className="size-10 text-sky-500" />
            <div className="text-sm text-muted-foreground">Plan ready: {s.iterations[0].plan.allocations.length} resources</div>
            <Button size="lg" onClick={s.runTwin} className="rounded-full">
              Run Digital Twin
            </Button>
          </Card>
        </div>
      </StepShell>
    )

  return (
    <StepShell
      says={
        done ? (
          <SystemSays tone={last.twin.ok ? 'good' : 'bad'}>
            {last.twin.ok ? (
              <>
                <b>SAFE.</b>{' '}
                {s.iterations.length > 1
                  ? `The first plan was rejected; after ${s.iterations.length - 1} automatic re-solve(s) the twin approved it.`
                  : 'Approved on the first pass.'}{' '}
                {last.twin.checks.filter((c) => c.status === 'warn').length > 0 && `${last.twin.checks.filter((c) => c.status === 'warn').length} warning(s) to note.`}
              </>
            ) : (
              <>
                <b>UNSAFE.</b> No automatic fix found. Change strategy (step 4) or escalate.
              </>
            )}
          </SystemSays>
        ) : (
          <SystemSays>
            <Loader2 className="mr-1 inline size-4 animate-spin" /> Simulating pass {revealed + 1}…
          </SystemSays>
        )
      }
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {s.iterations.slice(0, revealed).map((x, i) => (
          <div key={x.n} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
            <div className={cn('rounded-xl border px-3 py-1.5 text-xs', x.twin.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50')}>
              <div className="font-semibold">
                Pass {x.n}: {x.twin.ok ? 'approved' : 'rejected'}
              </div>
              <div className="text-[10px] text-muted-foreground">{x.note}</div>
            </div>
            {i < revealed - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
          </div>
        ))}
        {!done && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
      {it && (
        <SectionTabs
          sections={[
            {
              id: 'checks',
              label: `Safety checks · pass ${it.n}`,
              content: (
                <div className="grid h-full auto-rows-min grid-cols-3 gap-2">
                  {it.twin.checks.map((c) => (
                    <div
                      key={c.id}
                      className={cn(
                        'flex gap-2 rounded-xl border px-3 py-2',
                        c.status === 'fail' ? 'border-rose-200 bg-rose-50' : c.status === 'warn' ? 'border-amber-200 bg-amber-50/60' : 'bg-white',
                      )}
                    >
                      <span className="mt-0.5">{STATUS_ICON[c.status]}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{c.label}</div>
                        <div className="line-clamp-2 text-[11px] text-muted-foreground">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              id: 'response',
              label: 'Response & SoC',
              content: (
                <div className="grid h-full grid-cols-2 gap-3">
                  <Card className="gap-1 py-3">
                    <CardHeader>
                      <CardTitle className="text-sm">Minute-by-minute response (MW)</CardTitle>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={minutes}>
                          <CartesianGrid stroke="#e2e8f0" vertical={false} />
                          <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} interval={9} unit="m" />
                          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={44} />
                          <RTooltip {...chartTooltip} formatter={(v) => `${Number(v).toFixed(0)} MW`} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Area type="monotone" dataKey="delivered" name="Simulated" stroke="#34b27b" fill="#86efac55" isAnimationActive={false} />
                          <Line type="stepAfter" dataKey="planned" name="Planned" stroke="#38bdf8" dot={false} isAnimationActive={false} />
                          <Line type="stepAfter" dataKey="need" name="Requirement" stroke="#475569" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                  <Card className="gap-1 py-3">
                    <CardHeader>
                      <CardTitle className="text-sm">BESS state of charge (%)</CardTitle>
                    </CardHeader>
                    <CardContent className="min-h-0 flex-1">
                      {socData.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={socData}>
                            <CartesianGrid stroke="#e2e8f0" vertical={false} />
                            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#64748b' }} interval={9} unit="m" />
                            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} width={36} />
                            <RTooltip {...chartTooltip} formatter={(v, n) => [`${v}%`, ASSET_BY_ID[n as string]?.short ?? n]} />
                            {Object.keys(it.twin.soc).map((id, i) => (
                              <Line key={id} dataKey={id} stroke={['#10b981', '#0ea5e9', '#8b5cf6'][i % 3]} strokeWidth={2} dot={false} isAnimationActive={false} />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-muted-foreground">No BESS in this plan</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ),
            },
            {
              id: 'why',
              label: 'Why',
              content: (
                <Why>
                  <p>
                    The optimizer works on 15-minute averages and registry data. The twin works at 1-minute resolution with live state: an asset that stopped answering heartbeats,
                    a battery that would cross its SoC floor mid-event, or a line that would overload are all caught here and re-solved.
                  </p>
                  <p>
                    <b>AI predicts, optimisation decides, hard constraints protect.</b>
                  </p>
                </Why>
              ),
            },
          ]}
        />
      )}
    </StepShell>
  )
}

/* ------------------------------------------------------------------ 7. DISPATCH */
function sig(id: string, n: string) {
  let h = 5381
  for (const c of id + n) h = (h * 33) ^ c.charCodeAt(0)
  return 'ed25519:' + (h >>> 0).toString(16).padStart(8, '0') + '…'
}

export function StepDispatch() {
  const s = useDecisionStore()
  const mode = useUIStore((x) => x.mode)
  const plan = finalPlan(s)!
  const total = Math.max(...Array.from({ length: plan.blocks }, (_, b) => plan.allocations.reduce((acc, a) => acc + a.mwByBlock[b], 0)))
  const needsDual = total > 200
  const autoEligible = plan.allocations.every((a) => a.type === 'bess' || a.type === 'generation' || a.type === 'rtm')
  const auto = mode === 'CLOSED_LOOP' && autoEligible
  const approved = auto || (s.approval.primary && (!needsDual || s.approval.secondary))
  const phase = s.dispatch.phase
  const rows = s.dispatch.rows
  const acked = rows.filter((r) => r.acked).length

  return (
    <StepShell
      says={
        <SystemSays tone={mode === 'SHADOW' ? 'info' : 'warn'}>
          {mode === 'SHADOW' ? (
            <>
              <b>Shadow mode:</b> the decision is recorded and simulated, but <b>no command is sent</b> — compare it with what the shift engineer actually did.
            </>
          ) : auto ? (
            <>
              <b>Closed loop:</b> all resources are BESS/generation and the twin approved, so dispatch is auto-authorised.
            </>
          ) : (
            <>
              Review {plan.allocations.length} signed commands.{' '}
              {needsDual ? `${fmtMW(total)} exceeds 200 MW → dual authorisation required.` : 'Single authorisation is sufficient.'}
              {mode === 'CLOSED_LOOP' && ' (Closed loop falls back to advisory: plan includes demand-side resources.)'}
            </>
          )}
        </SystemSays>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-3">
        <Card className="min-h-0 gap-1 py-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSignature className="size-4 text-sky-500" /> Signed commands
            </CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 px-2">
            <FitPager
              items={plan.allocations}
              rowHeight={37}
              render={(slice) => (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Resource</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Setpoint</TableHead>
                      <TableHead>Signature</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slice.map((al) => {
                      const asset = ASSET_BY_ID[al.assetId]
                      const r = rows.find((x) => x.assetId === al.assetId)
                      const mw = Math.max(...al.mwByBlock)
                      const dur = al.mwByBlock.filter((x) => x > 0).length * BLOCK_MIN
                      let st: React.ReactNode = <Badge variant="outline">ready</Badge>
                      if (phase === 'sending') st = <Badge variant="warning">sent</Badge>
                      if (phase === 'acking' || phase === 'ramping' || phase === 'done')
                        st = r?.acked ? <Badge variant="success">ack</Badge> : <Badge variant="destructive">no ack</Badge>
                      return (
                        <TableRow key={al.assetId}>
                          <TableCell className="text-xs font-medium">{asset?.short ?? al.name}</TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">{asset?.protocol ?? 'Exchange API'}</TableCell>
                          <TableCell className="font-mono text-[11px]">
                            {al.type === 'rtm' ? 'Bid ' : plan.direction === 'UP' ? (asset?.type === 'generation' || asset?.type === 'bess' ? '+' : '−') : '±'}
                            {mw.toFixed(0)} MW × {dur}m
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">{sig(al.assetId, s.eventId ?? '')}</TableCell>
                          <TableCell>{st}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {r && (phase === 'ramping' || phase === 'done') ? `${(r.deliveredMW * (phase === 'done' ? 1 : s.dispatch.progress)).toFixed(0)} MW` : '—'}
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

        {phase === 'idle' ? (
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="size-4 text-sky-500" /> Authorisation
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              {auto ? (
                <div className="flex items-center gap-2 text-xs text-emerald-600">
                  <ShieldCheck className="size-4" /> Auto-authorised by closed-loop policy (twin pass {s.iterations.length}).
                </div>
              ) : (
                <>
                  <Label className="items-start gap-3 rounded-lg border bg-white p-2.5 font-normal">
                    <Checkbox checked={s.approval.primary} onCheckedChange={(v) => s.setApproval('primary', !!v)} className="mt-0.5" />
                    <span>
                      <span className="font-medium">Shift Engineer, KPTCL SLDC</span>
                      <span className="block text-xs text-muted-foreground">Reviewed exposure, options, plan & twin.</span>
                    </span>
                  </Label>
                  {needsDual && (
                    <Label className="items-start gap-3 rounded-lg border bg-white p-2.5 font-normal">
                      <Checkbox checked={s.approval.secondary} onCheckedChange={(v) => s.setApproval('secondary', !!v)} className="mt-0.5" />
                      <span>
                        <span className="font-medium">Shift-in-charge</span>
                        <span className="block text-xs text-muted-foreground">Second authorisation (&gt;200 MW).</span>
                      </span>
                    </Label>
                  )}
                </>
              )}
              <div className="mt-auto space-y-1 rounded-lg bg-slate-50 p-2.5 text-[11px] text-muted-foreground">
                <div>Path: Optimizer → Twin → Authorisation → Command → Ack → Telemetry</div>
                <div>IEC-104 / ICCP for grid assets · OpenADR 3 via aggregator VEN</div>
              </div>
              <Button size="lg" className="w-full rounded-full" disabled={!approved} onClick={s.sendDispatch} variant={mode === 'SHADOW' ? 'secondary' : 'default'}>
                <Send className="size-4" /> {mode === 'SHADOW' ? 'Record shadow decision' : `Dispatch ${plan.allocations.length} resources`}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radio className="size-4 text-sky-500" /> {s.dispatch.shadow ? 'Shadow simulation' : 'Live dispatch'}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2.5">
              {(['sending', 'acking', 'ramping', 'done'] as const).map((p, i) => {
                const idx = ['sending', 'acking', 'ramping', 'done'].indexOf(phase)
                const label = ['Commands sent (signed, mTLS)', `Acknowledgements ${acked}/${rows.length}`, 'Assets ramping — telemetry confirming', 'Delivery confirmed'][i]
                return (
                  <div key={p} className={cn('flex items-center gap-2 text-xs', i > idx && 'opacity-40')}>
                    {i < idx || phase === 'done' ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : i === idx ? (
                      <Loader2 className="size-4 animate-spin text-sky-500" />
                    ) : (
                      <span className="size-4 rounded-full border" />
                    )}
                    {label}
                  </div>
                )
              })}
              <Progress value={phase === 'done' ? 100 : phase === 'ramping' ? 40 + s.dispatch.progress * 60 : phase === 'acking' ? 30 : 12} />
              {rows.some((r) => !r.acked) && phase !== 'sending' && (
                <Alert variant="warning" className="mt-auto">
                  <AlertTriangle />
                  <AlertTitle>Missing acknowledgement</AlertTitle>
                  <AlertDescription>
                    {rows
                      .filter((r) => !r.acked)
                      .map((r) => short(r.assetId, r.name))
                      .join(', ')}{' '}
                    silent — no blind resend; shortfall re-dispatched in the next step.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </StepShell>
  )
}

/* ------------------------------------------------------------------ 8. SETTLE */
export function StepSettle() {
  const s = useDecisionStore()
  const setPage = useUIStore((x) => x.setPage)
  const rows = s.dispatch.rows
  const st = s.settlement
  const plan = finalPlan(s)!
  const expected = rows.reduce((a, r) => a + r.expectedMW, 0)
  const delivered = rows.reduce((a, r) => a + r.deliveredMW, 0)
  const shortfall = Math.max(0, expected - delivered)
  const [tab, setTab] = useState(st ? 'settlement' : 'mv')

  if (s.dispatch.phase !== 'done') return <SystemSays tone="warn">Dispatch has not completed yet. Go back to step 7.</SystemSays>

  return (
    <StepShell
      says={
        <SystemSays tone={shortfall < 10 ? 'good' : 'warn'}>
          {s.dispatch.shadow && <b>[SHADOW] </b>}
          Telemetry: <b>{fmtMW(delivered)}</b> delivered vs <b>{fmtMW(expected)}</b> expected ({((delivered / Math.max(1, expected)) * 100).toFixed(0)}%).{' '}
          {shortfall >= 10 ? (
            <>
              Shortfall <b>{fmtMW(shortfall)}</b> — re-dispatch the next resources before settling.
            </>
          ) : (
            <>Within tolerance — settle and close.</>
          )}
        </SystemSays>
      }
    >
      <SectionTabs
        value={tab}
        onValueChange={setTab}
        sections={[
          {
            id: 'mv',
            label: 'Measurement & verification',
            content: (
              <div className="flex h-full flex-col gap-3">
                <div className="grid shrink-0 grid-cols-4 gap-2">
                  <Kpi label="Commanded" value={fmtMW(rows.reduce((a, r) => a + r.allocatedMW, 0))} />
                  <Kpi label="Expected" value={fmtMW(expected)} />
                  <Kpi label="Delivered" value={fmtMW(delivered)} tone={shortfall < 10 ? 'good' : 'warn'} />
                  <Kpi label="Shortfall" value={fmtMW(shortfall)} tone={shortfall < 10 ? 'good' : 'bad'} />
                </div>
                {(shortfall >= 10 && !st) || s.redispatch ? (
                  <div className="flex shrink-0 items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs">
                    <RefreshCw className="size-4 text-sky-600" />
                    <span className="flex-1">
                      {s.redispatch
                        ? s.redispatch.allocations.length
                          ? `Re-dispatched: ${s.redispatch.allocations.map((a) => `${short(a.assetId, a.name)} ${Math.max(...a.mwByBlock).toFixed(0)} MW`).join(', ')}`
                          : 'No spare resources left — residual settles under DSM.'
                        : `${fmtMW(shortfall)} short of expectation.`}
                    </span>
                    {!s.redispatch && (
                      <Button size="sm" variant="secondary" onClick={s.redispatchShortfall}>
                        Re-dispatch shortfall
                      </Button>
                    )}
                  </div>
                ) : null}
                <Card className="min-h-0 flex-1 gap-0 py-2">
                  <CardContent className="h-full px-2">
                    <FitPager
                      items={st?.rows ?? rows}
                      rowHeight={33}
                      render={(slice) => (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Resource</TableHead>
                              <TableHead className="text-right">Allocated</TableHead>
                              <TableHead className="text-right">Delivered</TableHead>
                              <TableHead className="text-right">Performance</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {slice.map((r) => (
                              <TableRow key={r.assetId}>
                                <TableCell className="text-xs">
                                  <span className="mr-1.5 inline-block size-2 rounded-sm" style={{ background: ASSET_TYPE_META[r.type]?.color ?? '#c084fc' }} />
                                  {short(r.assetId, r.name)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">{r.allocatedMW.toFixed(0)} MW</TableCell>
                                <TableCell className="text-right font-mono text-xs">{r.deliveredMW.toFixed(0)} MW</TableCell>
                                <TableCell className={cn('text-right font-mono text-xs', r.performance < 0.9 && 'text-amber-600', r.performance < 0.5 && 'text-red-500')}>
                                  {(r.performance * 100).toFixed(0)}%
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    />
                  </CardContent>
                </Card>
              </div>
            ),
          },
          {
            id: 'settlement',
            label: 'Settlement',
            content: !st ? (
              <Card className="h-full items-center justify-center gap-3 text-center">
                <div className="text-sm text-muted-foreground">Payments use delivered energy × incentive × performance factor.</div>
                <Button
                  size="lg"
                  className="rounded-full"
                  onClick={() => {
                    s.computeSettlement()
                    setTab('settlement')
                  }}
                >
                  Compute settlement
                </Button>
              </Card>
            ) : (
              <div className="grid h-full grid-cols-[minmax(0,1fr)_300px] gap-3">
                <Card className="min-h-0 gap-0 py-2">
                  <CardContent className="h-full px-2">
                    <FitPager
                      items={st.rows}
                      rowHeight={33}
                      render={(slice) => (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Resource</TableHead>
                              <TableHead className="text-right">MWh</TableHead>
                              <TableHead className="text-right">₹/kWh</TableHead>
                              <TableHead className="text-right">PF</TableHead>
                              <TableHead className="text-right">Payment</TableHead>
                              <TableHead className="text-right">Reliability</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {slice.map((sr) => (
                              <TableRow key={sr.assetId}>
                                <TableCell className="text-xs">{short(sr.assetId, sr.name)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{sr.energyMWh.toFixed(1)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{sr.rateRs.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{sr.perfFactor.toFixed(2)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{fmtRs(sr.paymentRs)}</TableCell>
                                <TableCell className="text-right font-mono text-[11px]">
                                  {sr.type === 'rtm'
                                    ? '—'
                                    : `${((s.evaluations.find((e) => e.asset.id === sr.assetId)?.reliability ?? 0) * 100).toFixed(0)}→${(sr.newReliability * 100).toFixed(0)}%`}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    />
                  </CardContent>
                </Card>
                <div className="flex min-h-0 flex-col gap-2">
                  <Kpi label="DSM if no action" value={fmtRs(st.doNothingRs)} />
                  <Kpi label="Residual DSM" value={fmtRs(st.residualDsmRs)} />
                  <Kpi label="Payments" value={fmtRs(st.paymentsRs)} />
                  <Kpi label="Net benefit to state" value={fmtRs(st.netBenefitRs)} tone={st.netBenefitRs >= 0 ? 'good' : 'warn'} />
                  <div className="mt-auto">
                    {s.status !== 'closed' ? (
                      <Button size="lg" variant="success" className="w-full rounded-full" onClick={s.closeEvent}>
                        <CheckCircle2 className="size-4" /> Close event & learn
                      </Button>
                    ) : (
                      <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <CheckCircle2 className="size-4" /> Event closed
                        </div>
                        <div>Resources released, reliability updated, trail in the audit log.</div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setPage('settlement')}>
                            History
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setPage('monitor')}>
                            Monitor
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: 'method',
            label: 'Method',
            content: (
              <div className="grid grid-cols-2 gap-3">
                <Calc
                  title="Settlement rule"
                  formula="Payment = Delivered energy × Incentive × Performance factor"
                  steps={['PF = 1.0 if ≥90% · linear 50–90% · 0 below 50%', 'Ancillary participation settles per CERC/GRID-INDIA procedure']}
                  result="performance-based, energy-metered"
                />
                <Calc
                  title="Adjusted baseline (anti-gaming)"
                  formula="B_adj = B_ML + (L_pre-event − B_pre-event), capped ±20%"
                  steps={['ML baseline: LightGBM on weather, day-of-week, ToU, production plan, lagged load']}
                  result={`DR = B_adj − L_actual · direction ${plan.direction}`}
                />
              </div>
            ),
          },
        ]}
      />
    </StepShell>
  )
}
