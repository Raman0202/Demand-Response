import { Bar as RBar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, Clock, Lock, ShieldAlert, Trophy, XCircle } from 'lucide-react'
import { Bar, Calc, FitPager, Kpi, SectionTabs, StepShell, SystemSays, Why } from '@/components/common'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ASSET_TYPE_META, BASE_DEMAND_MW } from '@/data/karnataka'
import { DEFAULT_DSM_CONFIG, type FreqBand } from '@/engine/dsm'
import { lineLabel } from '@/engine/network'
import { RTM_LEAD_BLOCKS, type StrategyId } from '@/engine/optimizer'
import { PRESETS } from '@/engine/scenarios'
import { fmtMW, fmtRs } from '@/lib/geo'
import { chartTooltip } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useDecisionStore } from '@/store/useDecisionStore'
import { useGridStore } from '@/store/useGridStore'

/* ------------------------------------------------------------------ 1. DETECT */
export function StepDetect() {
  const a = useDecisionStore((s) => s.assessment)!
  const scenario = useGridStore((s) => s.scenario)
  const presetId = useGridStore((s) => s.activePresetId)
  const preset = PRESETS.find((p) => p.id === presetId)
  const s = a.snapshot
  const short = a.direction === 'UP'
  const fOk = s.frequency >= 49.9 && s.frequency <= 50.05
  const aceAbs = Math.abs(a.ace.ace)
  const triggers = [
    { ok: fOk, label: `Frequency ${s.frequency.toFixed(3)} Hz is ${fOk ? 'inside' : 'outside'} the 49.90–50.05 Hz band → ${fOk ? 'no trigger' : 'ALERT'}` },
    { ok: aceAbs < 100, label: `|ACE| ${aceAbs.toFixed(0)} MW is ${aceAbs < 100 ? 'below' : 'above'} the 100 MW alert threshold → ${aceAbs < 100 ? 'no trigger' : 'ALERT'}` },
    {
      ok: s.frequency >= 49.8,
      label: `Frequency is ${s.frequency >= 49.8 ? 'above' : 'below'} the 49.80 Hz emergency threshold → ${s.frequency >= 49.8 ? 'no trigger' : 'EMERGENCY'}`,
    },
    { ok: aceAbs <= 1500, label: `|ACE| is ${aceAbs <= 1500 ? 'below' : 'above'} the 1,500 MW emergency threshold → ${aceAbs <= 1500 ? 'no trigger' : 'EMERGENCY'}` },
  ]
  const causes = [
    scenario.demandShockMW !== 0 && `Demand ${scenario.demandShockMW > 0 ? '+' : ''}${scenario.demandShockMW} MW vs forecast (${scenario.shockRegion.toLowerCase()})`,
    scenario.reDropMW > 0 && `Renewable shortfall −${scenario.reDropMW} MW vs forecast (solar 70% / wind 30%)`,
    scenario.outagedLines.length > 0 && `Transmission outage: ${scenario.outagedLines.map(lineLabel).join(', ')}`,
    scenario.heartbeatLost.length > 0 && `${scenario.heartbeatLost.length} DR asset(s) with degraded comms (not yet visible to registry)`,
    scenario.frequency !== 50 && `Grid frequency ${scenario.frequency.toFixed(2)} Hz (all-India condition)`,
  ].filter(Boolean) as string[]

  return (
    <StepShell
      says={
        <SystemSays tone={a.severity === 'NORMAL' ? 'good' : a.severity === 'ALERT' ? 'warn' : 'bad'}>
          {a.severity === 'NORMAL' && Math.abs(a.ace.ace) < 30 ? (
            <>The state is balanced (ACE {a.ace.ace.toFixed(0)} MW). A routine review can still pre-position flexibility, but no dispatch is needed.</>
          ) : (
            <>
              Karnataka is {a.deviationMW >= 0 ? 'over-drawing' : 'under-drawing'} <b>{Math.abs(a.deviationMW).toFixed(0)} MW</b> against schedule at{' '}
              <b>{s.frequency.toFixed(2)} Hz</b>. ACE is <b>{a.ace.ace.toFixed(0)} MW</b> → the state needs{' '}
              <b>
                {a.requirementMW.toFixed(0)} MW of {short ? 'UP' : 'DOWN'} flexibility
              </b>{' '}
              for {s.durationBlocks} blocks. Classified <b>{a.severity}</b>.
            </>
          )}
        </SystemSays>
      }
    >
      <SectionTabs
        sections={[
          {
            id: 'overview',
            label: 'Overview',
            content: (
              <div className="flex h-full flex-col gap-3">
                <div className="grid grid-cols-4 gap-2">
                  <Kpi label="Demand" value={fmtMW(s.demandMW)} sub={`forecast ${fmtMW(BASE_DEMAND_MW)}`} />
                  <Kpi
                    label="Renewables"
                    value={fmtMW(s.reMW)}
                    sub={scenario.reDropMW ? `−${scenario.reDropMW} vs forecast` : 'on forecast'}
                    tone={scenario.reDropMW ? 'warn' : 'default'}
                  />
                  <Kpi label="Drawal / schedule" value={fmtMW(s.drawalMW)} sub={`schedule ${fmtMW(s.scheduleMW)}`} />
                  <Kpi label="Requirement" value={fmtMW(a.requirementMW)} sub={`${a.direction} · P90 margin ${a.marginMW.toFixed(0)} MW`} tone="info" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Calc
                    title="Deviation (CERC DSM basis)"
                    formula="D = Actual drawal − Scheduled drawal"
                    steps={[`${s.drawalMW.toFixed(0)} − ${s.scheduleMW.toFixed(0)}`]}
                    result={
                      <span className={a.deviationMW > 0 ? 'text-amber-600' : 'text-sky-600'}>
                        {a.deviationMW.toFixed(0)} MW ({a.dsm.deviationPct.toFixed(1)}% of schedule)
                      </span>
                    }
                  />
                  <Calc
                    title="Area Control Error (IEGC)"
                    formula="ACE = (Ia − Is) − 10·Bf·(Fa − Fs) + Offset"
                    steps={[
                      `(${a.ace.Ia.toFixed(0)} − (${a.ace.Is.toFixed(0)})) − 10·(${a.ace.bf})·(${a.ace.fa.toFixed(3)} − 50)`,
                      `${(a.ace.Ia - a.ace.Is).toFixed(0)} ${a.ace.freqTerm >= 0 ? '+' : '−'} ${Math.abs(a.ace.freqTerm).toFixed(0)}`,
                    ]}
                    result={
                      <span className={a.ace.ace < 0 ? 'text-amber-600' : 'text-sky-600'}>
                        {a.ace.ace.toFixed(0)} MW → {a.direction} {a.requirementMW.toFixed(0)} MW
                      </span>
                    }
                  />
                </div>
              </div>
            ),
          },
          {
            id: 'severity',
            label: 'Severity & drivers',
            content: (
              <div className="grid h-full grid-cols-2 gap-3">
                <Card className="gap-3">
                  <CardHeader>
                    <CardTitle className="text-sm">Why {a.severity}?</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {triggers.map((t) => (
                      <div key={t.label} className="flex items-start gap-2 text-xs">
                        {t.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
                        <span className={cn(!t.ok && 'font-medium text-amber-700')}>{t.label}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="gap-3">
                  <CardHeader>
                    <CardTitle className="text-sm">What changed vs the day-ahead plan</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {preset && <p className="mb-2 text-xs text-muted-foreground">{preset.summary}</p>}
                    {causes.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-xs">
                        {causes.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">No deviation drivers — the grid is on plan.</p>
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
                  Frequency alone is not enough: the state can be at 50.00 Hz while over-drawing, or a substation can be overloaded while the state is balanced. The engine combines{' '}
                  <b>deviation</b> (money), <b>ACE</b> (IEGC control obligation), <b>forecast residual</b> (P90 margin) and <b>network state</b> (line loading).
                </p>
                <p>Bf = {a.ace.bf} MW/0.1 Hz (negative by convention). A negative ACE means the state is short and must add supply or reduce load.</p>
              </Why>
            ),
          },
        ]}
      />
    </StepShell>
  )
}

/* ------------------------------------------------------------------ 2. EXPOSURE */
export function StepExposure() {
  const a = useDecisionStore((s) => s.assessment)!
  const d = a.dsm
  const s = a.snapshot
  const cfg = DEFAULT_DSM_CONFIG
  const table = a.deviationMW >= 0 ? cfg.overdrawal : cfg.underdrawal
  const payable = d.amountRs >= 0
  return (
    <StepShell
      says={
        <SystemSays tone={payable ? 'warn' : 'info'}>
          {payable ? (
            <>
              Doing nothing costs about <b>{fmtRs(d.amountRs)}</b> per 15-min block — <b>{fmtRs(a.doNothingRs)}</b> over the {s.durationBlocks}-block event. Every option must beat
              this.
            </>
          ) : (
            <>Under-drawal here earns {fmtRs(-d.amountRs)} per block — little money at stake, but IEGC still requires ACE → 0 for security.</>
          )}
        </SystemSays>
      }
    >
      <SectionTabs
        sections={[
          {
            id: 'calc',
            label: 'Calculation',
            content: (
              <div className="flex h-full flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <Calc
                    title="Normal Rate — CERC DSM Regulations 2024"
                    formula="NR = max(A, B, C)"
                    steps={[
                      `A (DAM) ₹${d.nr.A.toFixed(2)} · B (RTM) ₹${d.nr.B.toFixed(2)}`,
                      `C = ⅓·${d.nr.A.toFixed(2)} + ⅓·${d.nr.B.toFixed(2)} + ⅓·${s.prices.asc.toFixed(2)} = ₹${d.nr.C.toFixed(2)}`,
                    ]}
                    result={
                      <>
                        NR = ₹{d.nr.nr.toFixed(2)}/kWh <span className="text-xs text-muted-foreground">(binding: {d.nr.binding})</span>
                      </>
                    }
                  />
                  <Calc
                    title="Energy, not MW — per 15-min block"
                    formula="E_dev = |D| × 0.25 h"
                    steps={[`${Math.abs(d.deviationMW).toFixed(0)} MW × 0.25 h`]}
                    result={`${d.energyMWh.toFixed(1)} MWh = ${(d.energyMWh * 1000).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kWh`}
                  />
                </div>
                <Calc
                  title={`Charge with volume band (min(${cfg.bandPct}% × schedule, ${cfg.bandCapMW} MW) = ${d.bandMW.toFixed(0)} MW) & frequency multiplier`}
                  formula="Charge = E_within × m₁·NR + E_beyond × m₂·NR"
                  steps={[
                    `${(d.withinMW * 250).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kWh × ${d.multWithin}·₹${d.nr.nr.toFixed(2)} + ${(d.beyondMW * 250).toLocaleString('en-IN', { maximumFractionDigits: 0 })} kWh × ${d.multBeyond}·₹${d.nr.nr.toFixed(2)}`,
                  ]}
                  result={
                    <span className={payable ? 'text-amber-600' : 'text-sky-600'}>
                      {fmtRs(Math.abs(d.amountRs))} per block {payable ? 'payable' : 'receivable'} → {fmtRs(Math.abs(a.doNothingRs))} for {s.durationBlocks} blocks
                    </span>
                  }
                />
              </div>
            ),
          },
          {
            id: 'rules',
            label: 'Rule table',
            content: (
              <Card className="gap-3">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-sm">
                    {a.deviationMW >= 0 ? 'Over-drawal (payable)' : 'Under-drawal (receivable)'}
                    <Badge variant="warning">Illustrative multipliers</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Frequency band</TableHead>
                        <TableHead>Within band (m₁)</TableHead>
                        <TableHead>Beyond band (m₂)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(['LOW', 'NORMAL', 'HIGH'] as FreqBand[]).map((fb) => (
                        <TableRow key={fb} className={cn(fb === d.freqBand && 'bg-sky-50')}>
                          <TableCell>
                            {fb === 'LOW' ? `< ${cfg.freqLow} Hz` : fb === 'HIGH' ? `≥ ${cfg.freqHigh} Hz` : `${cfg.freqLow}–${cfg.freqHigh} Hz`}
                            {fb === d.freqBand && (
                              <Badge variant="info" className="ml-2">
                                now
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="font-mono">{table[fb].within}× NR</TableCell>
                          <TableCell className="font-mono">{table[fb].beyond}× NR</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    Config <span className="font-mono">{cfg.version}</span> · {cfg.buyerCategory}. Load the notified CERC table (incl. 2024–2026 amendments) into{' '}
                    <span className="font-mono">dsm_rules.json</span> — no code change needed.
                  </p>
                </CardContent>
              </Card>
            ),
          },
          {
            id: 'why',
            label: 'Why',
            content: (
              <Why>
                <p>DSM settlement is energy-based per 15-minute block. A ₹/MW “penalty” is wrong — 22 MW for one block is 5.5 MWh, priced per kWh at the applicable rate.</p>
                <p>
                  NR follows the market (DAM, RTM and ancillary cost), so the cost of doing nothing changes every block. The marginal rate of the next MW here is ₹
                  {d.marginalRate.toFixed(2)}/kWh.
                </p>
              </Why>
            ),
          },
        ]}
      />
    </StepShell>
  )
}

/* ------------------------------------------------------------------ 3. FLEXIBILITY */
export function StepFlex() {
  const a = useDecisionStore((s) => s.assessment)!
  const evs = useDecisionStore((s) => s.evaluations)
  const eligible = evs.filter((e) => e.eligible)
  const excluded = evs.filter((e) => !e.eligible)
  const avail = eligible.reduce((x, e) => x + e.availableMW, 0)
  const expected = eligible.reduce((x, e) => x + e.expectedMW, 0)
  const locked = evs.reduce((x, e) => x + e.lockedMW, 0)
  const enough = expected >= a.requirementMW
  const sorted = [...evs].sort((x, y) => Number(y.eligible) - Number(x.eligible) || x.effectiveCost - y.effectiveCost)
  return (
    <StepShell
      says={
        <SystemSays tone={enough ? 'good' : 'warn'}>
          {eligible.length} resources offer <b>{fmtMW(avail)}</b>; after reliability we expect <b>{fmtMW(expected)}</b>
          {enough ? ' — enough to cover the requirement.' : ` — ${fmtMW(a.requirementMW - expected)} short; the residual will settle under DSM or escalate.`} <b>{fmtMW(locked)}</b>{' '}
          stays locked to SRAS/TRAS. {excluded.length > 0 && `${excluded.length} excluded.`}
        </SystemSays>
      }
    >
      <SectionTabs
        sections={[
          {
            id: 'resources',
            label: `Resources (${evs.length})`,
            content: (
              <Card className="h-full gap-0 py-2">
                <CardContent className="h-full px-2">
                  <FitPager
                    items={sorted}
                    rowHeight={41}
                    reserve={70}
                    render={(slice) => (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Resource</TableHead>
                            <TableHead className="text-right">Avail.</TableHead>
                            <TableHead className="text-right">Reliab.</TableHead>
                            <TableHead className="text-right">Expected</TableHead>
                            <TableHead className="text-right">Resp.</TableHead>
                            <TableHead className="text-right">₹/kWh eff.</TableHead>
                            <TableHead>Notes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {slice.map((e) => {
                            const meta = ASSET_TYPE_META[e.asset.type]
                            return (
                              <TableRow key={e.asset.id} className={cn(!e.eligible && 'opacity-60')}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <span className="grid size-5 place-items-center rounded text-[10px] font-bold text-white" style={{ background: meta.color }}>
                                      {meta.letter}
                                    </span>
                                    <div className="leading-tight">
                                      <div className="text-xs font-medium">{e.asset.short}</div>
                                      <div className="text-[10px] text-muted-foreground">
                                        {meta.label} · {e.asset.discom}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">{e.availableMW.toFixed(0)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{(e.reliability * 100).toFixed(0)}%</TableCell>
                                <TableCell className="text-right font-mono text-xs font-semibold">{e.expectedMW.toFixed(0)}</TableCell>
                                <TableCell className="text-right font-mono text-xs">{e.asset.responseMin}m</TableCell>
                                <TableCell className="text-right font-mono text-xs">{e.effectiveCost.toFixed(2)}</TableCell>
                                <TableCell className="max-w-[220px] truncate text-[10px] text-muted-foreground">
                                  {!e.eligible ? (
                                    <span className="flex items-center gap-1 text-red-500">
                                      <XCircle className="size-3" /> {e.exclusions.join('; ')}
                                    </span>
                                  ) : (
                                    e.notes.join(' · ') || '—'
                                  )}
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
            ),
          },
          {
            id: 'summary',
            label: 'Coverage',
            content: (
              <div className="flex h-full flex-col gap-3">
                <div className="space-y-1.5 rounded-xl border bg-white p-4">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Requirement {fmtMW(a.requirementMW)}</span>
                    <span>Expected {fmtMW(expected)}</span>
                  </div>
                  <Bar
                    height={12}
                    segments={[
                      { value: Math.min(expected, a.requirementMW), color: '#4cbf8b', label: 'Expected flexibility covering requirement' },
                      { value: Math.max(0, expected - a.requirementMW), color: '#7dd3fc', label: 'Spare (counts toward P90 reserve)' },
                      { value: Math.max(0, a.requirementMW - expected), color: '#f87171', label: 'Uncovered' },
                      { value: locked, color: '#c4b5fd', label: 'Locked to SRAS/TRAS' },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Calc
                    title="Upward flexibility per load"
                    formula="F_up = min(Baseline − P_min, Contract_state, Network)"
                    result="never above contract, never below technical minimum"
                  />
                  <Calc title="Expected deliverability" formula="F_expected = F_available × R" steps={['e.g. 10 MW × 0.92']} result="9.2 MW — contracted ≠ available" />
                </div>
                {a.severity === 'EMERGENCY' && (
                  <Alert variant="destructive">
                    <ShieldAlert />
                    <AlertTitle>Emergency layer active</AlertTitle>
                    <AlertDescription>Emergency DR shares are released in addition to state DR. Ancillary commitments remain locked.</AlertDescription>
                  </Alert>
                )}
              </div>
            ),
          },
          {
            id: 'why',
            label: 'Why',
            content: (
              <Why>
                <p>
                  <b>Effective cost</b> = (bid + opportunity + rebound) ÷ reliability, so an unreliable cheap bid does not beat a reliable slightly dearer one. BESS cost includes
                  recharge energy at off-peak price ÷ round-trip efficiency plus degradation.
                </p>
                <p>
                  <Lock className="mr-1 inline size-3" />
                  SRAS/TRAS portions are reserved for the national ancillary framework (ANCILLARY_MODE) and arbitrated out here — no “selling the same MW twice”.
                </p>
              </Why>
            ),
          },
        ]}
      />
    </StepShell>
  )
}

/* ------------------------------------------------------------------ 4. OPTIONS */
export function StepOptions() {
  const a = useDecisionStore((s) => s.assessment)!
  const strategies = useDecisionStore((s) => s.strategies)
  const selected = useDecisionStore((s) => s.strategy)
  const setStrategy = useDecisionStore((s) => s.setStrategy)
  const best = [...strategies].sort((x, y) => x.plan.costs.totalRs - y.plan.costs.totalRs || y.plan.coveragePct - x.plan.coveragePct)[0]
  const opt = strategies.find((s) => s.id === 'OPTIMAL')!
  const residual = Math.max(...opt.plan.residualByBlock)
  const rtm = strategies.find((s) => s.id === 'RTM')!
  const data = strategies.map((s) => ({ name: s.label, total: s.plan.costs.totalRs / 1e5, id: s.id }))

  return (
    <StepShell
      says={
        <SystemSays tone="good">
          Recommended: <b>{best.label}</b> — {fmtRs(best.plan.costs.totalRs)} vs {fmtRs(strategies[0].plan.costs.totalRs)} for doing nothing, covering{' '}
          {best.plan.coveragePct.toFixed(0)}%
          {best.plan.timeToEffectMin !== null && <>, responding in {best.plan.timeToEffectMin < 1 ? '<1' : best.plan.timeToEffectMin.toFixed(0)} min</>}.{' '}
          {rtm.plan.coveragePct === 0 && a.snapshot.durationBlocks <= RTM_LEAD_BLOCKS && <>RTM can&apos;t help — gate closure delivers from block {RTM_LEAD_BLOCKS + 1}.</>}
        </SystemSays>
      }
    >
      <SectionTabs
        sections={[
          {
            id: 'cards',
            label: 'Strategies',
            content: (
              <div className="grid h-full grid-cols-3 grid-rows-2 gap-2">
                {strategies.map((st) => {
                  const p = st.plan
                  const isBest = st.id === best.id
                  const isSel = st.id === selected
                  return (
                    <button
                      key={st.id}
                      onClick={() => setStrategy(st.id as StrategyId)}
                      disabled={st.id === 'NONE'}
                      className={cn(
                        'flex flex-col rounded-xl border bg-white p-3 text-left transition hover:border-sky-300 hover:shadow-sm disabled:cursor-default',
                        isSel && 'border-sky-400 bg-sky-50/60 ring-1 ring-sky-300',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{st.label}</span>
                        {isBest && (
                          <Badge variant="success">
                            <Trophy /> best
                          </Badge>
                        )}
                        {isSel && !isBest && <Badge variant="info">selected</Badge>}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{st.description}</div>
                      <div className="mt-auto pt-1 font-mono text-lg font-semibold">{fmtRs(p.costs.totalRs)}</div>
                      <div className="grid grid-cols-2 gap-x-2 text-[11px] text-muted-foreground">
                        <span>Coverage</span>
                        <span className="text-right font-mono text-foreground">{p.coveragePct.toFixed(0)}%</span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" /> Effect in
                        </span>
                        <span className="text-right font-mono text-foreground">
                          {p.timeToEffectMin === null ? '—' : `${p.timeToEffectMin < 1 ? '<1' : p.timeToEffectMin.toFixed(0)} min`}
                        </span>
                        <span>Max line</span>
                        <span className={cn('text-right font-mono', p.maxLoadingAfter.value > 1 ? 'text-red-500' : 'text-foreground')}>
                          {(p.maxLoadingAfter.value * 100).toFixed(0)}%
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            ),
          },
          {
            id: 'chart',
            label: 'Cost comparison',
            content: (
              <div className="flex h-full flex-col gap-3">
                <Card className="min-h-0 flex-1 gap-2">
                  <CardHeader>
                    <CardTitle className="text-sm">Total cost (₹ lakh) — resource + residual DSM + rebound</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-0 flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
                        <CartesianGrid stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} width={110} />
                        <RTooltip {...chartTooltip} formatter={(v) => `₹${Number(v).toFixed(2)} L`} />
                        <RBar dataKey="total" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                          {data.map((d) => (
                            <Cell key={d.id} fill={d.id === best.id ? '#4cbf8b' : d.id === selected ? '#7dd3fc' : '#cbd5e1'} />
                          ))}
                        </RBar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                {residual > 0.5 && (
                  <Alert variant={a.severity === 'EMERGENCY' ? 'destructive' : 'warning'} className="shrink-0">
                    <ShieldAlert />
                    <AlertTitle>Residual {fmtMW(residual)} even with all resources</AlertTitle>
                    <AlertDescription>
                      {a.severity === 'EMERGENCY'
                        ? 'Escalation: SLDC Automatic Demand Management Scheme — only for the residual, only after DR is exhausted (IEGC).'
                        : 'Residual settles under DSM. Consider an RTM bid for later blocks and pre-positioning BESS for the next peak.'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ),
          },
          {
            id: 'why',
            label: 'Why',
            content: (
              <Why>
                <p>
                  C* = min(C_DSM, C_RTM, C_GEN, C_BESS, C_DR, C_mix). Each option is a full optimisation restricted to that resource class with the same network, ramp, duration and
                  SoC constraints — a like-for-like comparison. Click a card to switch strategy; plan and twin re-compute.
                </p>
                <p>The decision tree checks generation first, then market, then BESS and DR — but the cheapest safe combination wins.</p>
              </Why>
            ),
          },
        ]}
      />
    </StepShell>
  )
}
