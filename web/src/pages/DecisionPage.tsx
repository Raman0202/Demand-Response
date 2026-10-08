import { useEffect, useMemo } from 'react'
import { ArrowLeft, ArrowRight, Check, FlaskConical, Lock, Play, Siren } from 'lucide-react'
import { StepDetect, StepExposure, StepFlex, StepOptions } from '@/components/decision/StepsA'
import { StepDispatch, StepPlan, StepSettle, StepTwin } from '@/components/decision/StepsB'
import { KarnatakaMap, type MapOverlay } from '@/components/three/KarnatakaMap'
import type { Focus } from '@/components/three/focus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ASSET_BY_ID, BUS_BY_ID } from '@/data/karnataka'
import { fmtMW, fmtRs } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { SEVERITY_STYLE } from '@/lib/ui'
import { finalPlan, STEPS, useDecisionStore } from '@/store/useDecisionStore'
import { useGridStore } from '@/store/useGridStore'
import { useUIStore } from '@/store/useUIStore'

const NEXT_LABEL = ['Price the exposure', 'Check flexibility', 'Compare options', 'See the dispatch plan', 'Validate in Digital Twin', 'Go to approval', 'Verify & settle']

export function DecisionPage() {
  const status = useDecisionStore((s) => s.status)
  if (status === 'idle') return <EmptyState />
  return <DecisionFlow />
}

function EmptyState() {
  const openEvent = useDecisionStore((s) => s.openEvent)
  const setPage = useUIStore((s) => s.setPage)
  const severity = useGridStore((s) => s.assessment.severity)
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Decision Center</h1>
        <p className="mt-1 text-muted-foreground">
          Every grid event goes through the same transparent 8-step flow. At each step the system shows <b>what it concluded</b>, <b>the numbers</b>, and <b>why</b> — so an
          operator can check the decision before anything is dispatched.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <Card key={s.id} className="gap-1 py-3">
            <CardContent>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="grid size-5 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{i + 1}</span>
                {s.verb}
              </div>
              <div className="mt-1 font-medium">{s.title}</div>
              <div className="text-xs text-muted-foreground">{s.question}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={openEvent} variant={severity === 'NORMAL' ? 'secondary' : 'default'}>
          <Siren className="size-4" /> Open event from live grid state {severity !== 'NORMAL' && `(${severity})`}
        </Button>
        <Button size="lg" variant="outline" onClick={() => setPage('scenario')}>
          <FlaskConical className="size-4" /> Pick a scenario first
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tip: the grid is currently <b>{severity}</b>. For a meaningful walkthrough, inject a scenario such as “Cloud cover over Pavagada” or “Comms failure during event” in the
        Scenario Lab.
      </p>
    </div>
  )
}

function useOverlay(): MapOverlay | undefined {
  const s = useDecisionStore()
  return useMemo(() => {
    const plan = finalPlan(s)
    const first = s.iterations[0]?.plan
    if (s.step === 2) {
      const focus: Focus = {}
      for (const e of s.evaluations) {
        if (e.asset.type === 'generation') continue
        if (!e.eligible) focus[e.asset.id] = { mw: 0, status: 'excluded' }
      }
      return { focus, caption: 'Rings show contracted state DR; red tags are excluded resources' }
    }
    if (s.step === 4 && first) {
      const focus: Focus = {}
      for (const a of first.allocations) if (a.type !== 'rtm') focus[a.assetId] = { mw: Math.max(...a.mwByBlock), status: 'planned' }
      return {
        focus,
        loading: first.loadingAfter,
        highlightLines: [...new Set(first.bindings.map((b) => b.lineId))],
        caption: 'Planned dispatch · line colours show loading AFTER dispatch',
      }
    }
    if (s.step === 5) {
      const idx = Math.max(0, s.twinRevealed - 1)
      const it = s.iterations[idx]
      if (!it || s.twinRevealed === 0) return { caption: 'Run the Digital Twin to simulate the plan before any command is sent' }
      const focus: Focus = {}
      for (const a of it.plan.allocations) if (a.type !== 'rtm') focus[a.assetId] = { mw: Math.max(...a.mwByBlock), status: 'planned' }
      for (const id of it.twin.actions.exclude) focus[id] = { mw: 0, status: 'excluded' }
      return {
        focus,
        loading: it.plan.loadingAfter,
        caption: `Twin pass ${it.n}: ${it.twin.ok ? 'SAFE' : 'UNSAFE → re-solving'}`,
      }
    }
    if ((s.step === 6 || s.step === 7) && plan) {
      const phase = s.dispatch.phase
      const focus: Focus = {}
      const rows = s.dispatch.rows
      for (const a of plan.allocations) {
        if (a.type === 'rtm') continue
        const r = rows.find((x) => x.assetId === a.assetId)
        let status: Focus[string]['status'] = 'planned'
        let mw = Math.max(...a.mwByBlock)
        if (phase === 'sending') status = 'sent'
        else if (phase === 'acking') status = r?.acked ? 'acked' : 'failed'
        else if (phase === 'ramping' || phase === 'done') {
          status = r?.acked ? 'delivering' : 'failed'
          mw = (r?.deliveredMW ?? 0) * (phase === 'done' ? 1 : s.dispatch.progress)
        }
        focus[a.assetId] = { mw, status }
      }
      for (const a of s.redispatch?.allocations ?? []) {
        const r = rows.find((x) => x.assetId === a.assetId)
        if (a.type !== 'rtm') focus[a.assetId] = { mw: r?.deliveredMW ?? 0, status: 'delivering' }
      }
      const targets =
        phase === 'idle'
          ? []
          : plan.allocations
              .filter((a) => a.type !== 'rtm')
              .map((a) => {
                const asset = ASSET_BY_ID[a.assetId]
                return { id: a.assetId, lon: asset.lon, lat: asset.lat, ok: rows.find((x) => x.assetId === a.assetId)?.acked ?? true }
              })
      return {
        focus,
        wave: { targets, phase },
        caption:
          phase === 'idle'
            ? 'Awaiting approval — nothing has been sent'
            : phase === 'sending'
              ? 'Signed commands travelling SLDC → assets'
              : phase === 'acking'
                ? 'Acknowledgements returning'
                : s.dispatch.shadow
                  ? 'SHADOW mode — showing what WOULD have happened'
                  : 'Assets responding · telemetry confirming delivery',
      }
    }
    return undefined
  }, [s])
}

function DecisionFlow() {
  const s = useDecisionStore()
  const overlay = useOverlay()
  useAutoCamera()
  const a = s.assessment!
  const plan = finalPlan(s)
  const canNext = (() => {
    if (s.step === 5) return s.twinRevealed >= s.iterations.length && s.iterations.at(-1)?.twin.ok
    if (s.step === 6) return s.dispatch.phase === 'done'
    return s.step < STEPS.length - 1
  })()
  const blockedReason =
    s.step === 5 && s.twinRevealed < s.iterations.length
      ? 'Run the Digital Twin first'
      : s.step === 5 && !s.iterations.at(-1)?.twin.ok
        ? 'Twin could not find a safe plan'
        : s.step === 6 && s.dispatch.phase !== 'done'
          ? s.dispatch.phase === 'idle'
            ? 'Approve & dispatch first'
            : 'Dispatch in progress…'
          : ''

  return (
    <div className="flex h-full flex-col">
      {/* event header */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-white px-4 py-2.5">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold ring-1', SEVERITY_STYLE[a.severity])}>{a.severity}</span>
        <div className="leading-tight">
          <div className="font-semibold">{s.scenarioLabel}</div>
          <div className="text-[11px] text-muted-foreground">
            {s.eventId} · opened {s.openedSim} · {a.direction === 'UP' ? 'needs UP flexibility (reduce load / add supply)' : 'needs DOWN flexibility (absorb surplus)'} ·{' '}
            {a.snapshot.durationBlocks} blocks ({a.snapshot.durationBlocks * 15} min)
          </div>
        </div>
        {s.status === 'closed' && <Badge variant="success">Closed</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {plan && s.step >= 6 && (
            <Badge variant="info" className="font-mono">
              Plan: {plan.allocations.length} resources · {Math.max(...plan.suppliedByBlock).toFixed(0)} MW
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={s.reset}>
            Discard
          </Button>
        </div>
      </div>

      {/* body: chain-of-conclusions rail · step content · live 3D twin */}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[230px_minmax(0,1fr)_minmax(0,0.85fr)]">
        <StepRail canNext={!!canNext} />
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b bg-white/70 px-5 py-2.5">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-sky-600 uppercase">
              Step {s.step + 1} of {STEPS.length} · {STEPS[s.step].verb}
            </div>
            <h2 className="text-lg font-semibold text-slate-800">{STEPS[s.step].question}</h2>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${((s.step + 1) / STEPS.length) * 100}%` }}
              />
            </div>
          </div>
          <div key={s.step} className="min-h-0 flex-1 overflow-hidden p-4 animate-in fade-in slide-in-from-right-3 duration-300">
            {s.step === 0 && <StepDetect />}
            {s.step === 1 && <StepExposure />}
            {s.step === 2 && <StepFlex />}
            {s.step === 3 && <StepOptions />}
            {s.step === 4 && <StepPlan />}
            {s.step === 5 && <StepTwin />}
            {s.step === 6 && <StepDispatch />}
            {s.step === 7 && <StepSettle />}
          </div>
        </div>
        <div className="hidden min-h-0 border-l bg-slate-50/60 p-3 lg:block">
          <KarnatakaMap overlay={overlay} compact />
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center gap-3 border-t bg-white/90 px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,23,42,0.04)] backdrop-blur">
        <Button variant="outline" onClick={s.back} disabled={s.step === 0}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        <div className="flex-1 text-center text-xs text-muted-foreground">{blockedReason || (s.step < STEPS.length - 1 ? `Next: ${STEPS[s.step + 1].title}` : 'Final step')}</div>
        {s.step === 5 && s.twinRevealed < s.iterations.length ? (
          <Button onClick={s.runTwin}>
            <Play className="size-4" /> Run Digital Twin
          </Button>
        ) : s.step < STEPS.length - 1 ? (
          <Button onClick={s.next} disabled={!canNext}>
            {NEXT_LABEL[s.step]} <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** One-line conclusion carried forward from each step — the "chain of reasoning". */
function useConclusions(): (string | null)[] {
  const s = useDecisionStore()
  const a = s.assessment
  if (!a) return STEPS.map(() => null)
  const evs = s.evaluations.filter((e) => e.eligible)
  const best = [...s.strategies].sort((x, y) => x.plan.costs.totalRs - y.plan.costs.totalRs)[0]
  const chosen = s.strategies.find((x) => x.id === s.strategy)
  const first = s.iterations[0]?.plan
  const last = s.iterations.at(-1)
  const rows = s.dispatch.rows
  return [
    `${a.requirementMW.toFixed(0)} MW ${a.direction} · ${a.severity}`,
    a.doNothingRs >= 0 ? `${fmtRs(a.doNothingRs)} if idle` : `${fmtRs(-a.doNothingRs)} receivable`,
    `${fmtMW(evs.reduce((x, e) => x + e.expectedMW, 0))} expected · ${evs.length} assets`,
    chosen ? `${chosen.label} · ${fmtRs(chosen.plan.costs.totalRs)}${best && best.id === chosen.id ? ' ★' : ''}` : null,
    first ? `${first.allocations.length} resources · saves ${fmtRs(first.costs.savingsRs)}` : null,
    s.twinRevealed >= s.iterations.length && last ? (last.twin.ok ? `SAFE after ${s.iterations.length} pass${s.iterations.length > 1 ? 'es' : ''}` : 'UNSAFE') : null,
    s.dispatch.phase === 'done'
      ? `${s.dispatch.shadow ? 'Shadow · ' : ''}${rows.filter((r) => r.acked).length}/${rows.length} acked`
      : s.dispatch.phase !== 'idle'
        ? 'in progress…'
        : null,
    s.settlement ? `net ${fmtRs(s.settlement.netBenefitRs)}` : null,
  ]
}

function StepRail({ canNext }: { canNext: boolean }) {
  const s = useDecisionStore()
  const conclusions = useConclusions()
  return (
    <nav className="hidden min-h-0 overflow-hidden border-r bg-white/60 px-3 py-3 lg:block">
      <div className="mb-2 px-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Decision chain</div>
      <ol className="relative">
        {STEPS.map((st, i) => {
          const done = i < s.step || (s.status === 'closed' && i <= s.step)
          const current = i === s.step
          const reachable = i <= s.furthest + 1 && !(i === s.step + 1 && !canNext)
          const c = i <= s.furthest || current ? conclusions[i] : null
          return (
            <li key={st.id} className="relative pb-1">
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    'absolute top-8 left-[13px] h-[calc(100%-1.75rem)] w-0.5 rounded-full transition-colors duration-500',
                    i < s.step ? 'bg-emerald-300' : 'bg-slate-200',
                  )}
                />
              )}
              <button
                onClick={() => reachable && s.goTo(i)}
                disabled={!reachable}
                className={cn(
                  'relative flex w-full items-start gap-2.5 rounded-xl px-1.5 py-1.5 text-left transition',
                  current && 'bg-sky-50 ring-1 ring-sky-200',
                  !current && reachable && 'hover:bg-slate-50',
                  !reachable && 'opacity-45',
                )}
              >
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ring-4 ring-white transition',
                    done ? 'bg-emerald-400 text-white' : current ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {done ? <Check className="size-3" /> : !reachable ? <Lock className="size-2.5" /> : i + 1}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block text-[10px] text-slate-500">{st.verb}</span>
                  <span className={cn('block text-sm font-medium', current ? 'text-slate-900' : 'text-slate-700')}>{st.title}</span>
                  {c && (
                    <span
                      className={cn(
                        'mt-1 inline-block max-w-full truncate rounded-md px-1.5 py-0.5 font-mono text-[10px] animate-in fade-in',
                        done ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700',
                      )}
                    >
                      {c}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Fly the 3D camera to where the action is for the current step. */
function useAutoCamera() {
  const step = useDecisionStore((s) => s.step)
  const iterations = useDecisionStore((s) => s.iterations)
  const setCamera = useUIStore((s) => s.setCamera)
  const outaged = useGridStore((s) => s.snapshot.outagedLines.length)
  useEffect(() => {
    if (step === 0) setCamera(outaged ? 'BENGALURU' : 'STATE')
    else if (step === 4 || step === 5) {
      const plan = iterations.at(-1)?.plan
      if (!plan) return
      const mwBy: Record<string, number> = {}
      for (const a of plan.allocations) {
        const region = a.bus ? (BUS_BY_ID[a.bus]?.region ?? 'STATE') : 'STATE'
        mwBy[region] = (mwBy[region] ?? 0) + Math.max(...a.mwByBlock)
      }
      const total = Object.values(mwBy).reduce((x, y) => x + y, 0)
      setCamera((mwBy.BENGALURU ?? 0) > total * 0.55 ? 'BENGALURU' : (mwBy.NORTH ?? 0) > total * 0.55 ? 'NORTH' : 'STATE')
    } else if (step === 6) setCamera('TILT')
    else setCamera('STATE')
  }, [step, iterations, outaged, setCamera])
}
