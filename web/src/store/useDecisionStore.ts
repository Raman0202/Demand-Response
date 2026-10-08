// Guided decision workflow: one event = one pass through the 8-step decision flow.
import { create } from 'zustand'
import { assess, flexibility, options, optimizeWithTwin, type Assessment, type Iteration } from '@/engine/decision'
import type { FlexEvaluation } from '@/engine/flexibility'
import { optimize, type PlanResult, type StrategyId } from '@/engine/optimizer'
import { PRESETS } from '@/engine/scenarios'
import { settle, simulateDelivery, type DeliveryRow, type Settlement } from '@/engine/settlement'
import { blockOf, fmtClock, useGridStore } from './useGridStore'
import { useHistoryStore } from './useHistoryStore'
import { useUIStore } from './useUIStore'

export const STEPS = [
  { id: 'detect', title: 'Detect', verb: 'Sense', question: 'What is happening on the grid right now?' },
  { id: 'exposure', title: 'Exposure', verb: 'Price', question: 'What does it cost if we do nothing?' },
  { id: 'flex', title: 'Flexibility', verb: 'Inventory', question: 'What can each resource really deliver?' },
  { id: 'options', title: 'Options', verb: 'Compare', question: 'Which strategy is cheapest and feasible?' },
  { id: 'plan', title: 'Plan', verb: 'Optimize', question: 'Who does what, block by block — and why?' },
  { id: 'twin', title: 'Digital Twin', verb: 'Validate', question: 'Is the plan physically safe?' },
  { id: 'dispatch', title: 'Dispatch', verb: 'Approve', question: 'Approve and send signed commands.' },
  { id: 'settle', title: 'Verify & Settle', verb: 'Settle', question: 'Did it work, and who gets paid?' },
] as const

export type DispatchPhase = 'idle' | 'sending' | 'acking' | 'ramping' | 'done'

interface DecisionState {
  status: 'idle' | 'open' | 'closed'
  eventId: string | null
  scenarioLabel: string
  openedSim: string
  step: number
  furthest: number
  assessment: Assessment | null
  evaluations: FlexEvaluation[]
  strategies: ReturnType<typeof options>
  strategy: StrategyId
  iterations: Iteration[]
  twinRevealed: number
  approval: { primary: boolean; secondary: boolean }
  dispatch: { phase: DispatchPhase; rows: DeliveryRow[]; progress: number; shadow: boolean; startedAt: number }
  redispatch: PlanResult | null
  settlement: Settlement | null

  openEvent: () => void
  goTo: (step: number) => void
  next: () => void
  back: () => void
  setStrategy: (s: StrategyId) => void
  runTwin: () => void
  setApproval: (k: 'primary' | 'secondary', v: boolean) => void
  sendDispatch: () => void
  redispatchShortfall: () => void
  computeSettlement: () => void
  closeEvent: () => void
  reset: () => void
}

const audit = (kind: Parameters<ReturnType<typeof useHistoryStore.getState>['log']>[0]['kind'], message: string, actor = 'KSFP engine') => {
  const st = useDecisionStore.getState()
  useHistoryStore.getState().log({ kind, message, actor, eventId: st.eventId ?? undefined, sim: fmtClock(useGridStore.getState().simMinutes) })
}

let timers: ReturnType<typeof setTimeout>[] = []
const clearTimers = () => {
  timers.forEach(clearTimeout)
  timers = []
}

export const finalPlan = (s: Pick<DecisionState, 'iterations'>) => s.iterations[s.iterations.length - 1]?.plan ?? null

export const useDecisionStore = create<DecisionState>((set, get) => ({
  status: 'idle',
  eventId: null,
  scenarioLabel: '',
  openedSim: '',
  step: 0,
  furthest: 0,
  assessment: null,
  evaluations: [],
  strategies: [],
  strategy: 'OPTIMAL',
  iterations: [],
  twinRevealed: 0,
  approval: { primary: false, secondary: false },
  dispatch: { phase: 'idle', rows: [], progress: 0, shadow: false, startedAt: 0 },
  redispatch: null,
  settlement: null,

  openEvent: () => {
    clearTimers()
    const grid = useGridStore.getState()
    if (grid.dispatch) grid.setDispatch(null)
    const g = useGridStore.getState()
    const a = assess(g.snapshot)
    const learned = useHistoryStore.getState().learned
    const evaluations = flexibility(a, g.assets, learned)
    const strategies = options(a, evaluations)
    const iterations = optimizeWithTwin(a, evaluations, 'OPTIMAL')
    const n = useHistoryStore.getState().events.length + 1
    const eventId = `KA-DR-${new Date().getFullYear()}-${String(blockOf(g.simMinutes)).padStart(2, '0')}${String(n).padStart(3, '0')}`
    const preset = PRESETS.find((p) => p.id === g.activePresetId)
    set({
      status: 'open',
      eventId,
      scenarioLabel: preset?.title ?? (a.severity === 'NORMAL' ? 'Routine balancing review' : 'Custom scenario'),
      openedSim: fmtClock(g.simMinutes),
      step: 0,
      furthest: 0,
      assessment: a,
      evaluations,
      strategies,
      strategy: 'OPTIMAL',
      iterations,
      twinRevealed: 0,
      approval: { primary: false, secondary: false },
      dispatch: { phase: 'idle', rows: [], progress: 0, shadow: false, startedAt: 0 },
      redispatch: null,
      settlement: null,
    })
    useUIStore.getState().setPage('decision')
    audit(
      'EVENT',
      `Event opened: ${a.severity}, ACE ${a.ace.ace.toFixed(0)} MW, f ${a.snapshot.frequency.toFixed(2)} Hz, requirement ${a.requirementMW.toFixed(0)} MW ${a.direction}`,
    )
  },

  goTo: (step) => {
    const s = get()
    if (step <= s.furthest + 1 && step >= 0 && step < STEPS.length) set({ step, furthest: Math.max(s.furthest, step) })
  },
  next: () => {
    const s = get()
    get().goTo(s.step + 1)
    const st = STEPS[s.step + 1]
    if (st && s.furthest < s.step + 1) audit('ANALYSIS', `Step reviewed → ${st.title}`, 'Operator')
  },
  back: () => get().goTo(get().step - 1),

  setStrategy: (strategy) => {
    const s = get()
    if (!s.assessment) return
    const iterations = optimizeWithTwin(s.assessment, s.evaluations, strategy)
    set({ strategy, iterations, twinRevealed: 0 })
    audit('ANALYSIS', `Strategy selected: ${strategy}`, 'Operator')
  },

  runTwin: () => {
    clearTimers()
    const total = get().iterations.length
    set({ twinRevealed: 0 })
    for (let i = 1; i <= total; i++) {
      timers.push(
        setTimeout(() => {
          set({ twinRevealed: i })
          const it = get().iterations[i - 1]
          audit('TWIN', `Twin pass ${i}: ${it.note}`)
        }, i * 1100),
      )
    }
  },

  setApproval: (k, v) => set((s) => ({ approval: { ...s.approval, [k]: v } })),

  sendDispatch: () => {
    const s = get()
    const plan = finalPlan(s)
    if (!plan || !s.assessment || !s.eventId) return
    clearTimers()
    const shadow = useUIStore.getState().mode === 'SHADOW'
    const rows = simulateDelivery(plan, s.eventId, s.assessment.snapshot)
    set({ dispatch: { phase: 'sending', rows, progress: 0, shadow, startedAt: Date.now() } })
    const mode = useUIStore.getState().mode
    audit(
      'APPROVAL',
      mode === 'CLOSED_LOOP' && plan.allocations.every((x) => x.type === 'bess' || x.type === 'generation' || x.type === 'rtm')
        ? 'Auto-authorised by closed-loop policy after twin approval'
        : `Approved by Shift Engineer${s.approval.secondary ? ' + Shift-in-charge (dual authorisation)' : ''} in ${mode} mode`,
      'SLDC Shift Engineer',
    )
    audit(
      'COMMAND',
      shadow
        ? `SHADOW decision recorded (no commands sent): ${plan.allocations.length} resources, ${plan.allocations.reduce((a, x) => a + x.mwByBlock[0], 0).toFixed(0)} MW`
        : `Signed dispatch sent to ${plan.allocations.length} resources via IEC-104 / OpenADR 3 / ICCP`,
      'SLDC Shift Engineer',
    )
    timers.push(setTimeout(() => set((st) => ({ dispatch: { ...st.dispatch, phase: 'acking' } })), 1600))
    timers.push(
      setTimeout(() => {
        const acked = rows.filter((r) => r.acked).length
        audit(
          'ACK',
          `${acked}/${rows.length} acknowledgements received${
            acked < rows.length
              ? ' — ' +
                rows
                  .filter((r) => !r.acked)
                  .map((r) => r.name)
                  .join(', ') +
                ' silent'
              : ''
          }`,
        )
        set((st) => ({ dispatch: { ...st.dispatch, phase: 'ramping' } }))
      }, 3200),
    )
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      timers.push(
        setTimeout(
          () => {
            const progress = i / steps
            set((st) => ({ dispatch: { ...st.dispatch, progress, phase: i === steps ? 'done' : 'ramping' } }))
            if (!shadow) {
              const mw: Record<string, number> = {}
              for (const r of rows) if (r.assetId !== 'RTM') mw[r.assetId] = r.deliveredMW * progress
              useGridStore.getState().setDispatch({ eventId: s.eventId!, direction: plan.direction, mw })
            }
            if (i === steps) {
              const d = rows.reduce((a, r) => a + r.deliveredMW, 0)
              audit('MV', `Telemetry confirms ${d.toFixed(0)} MW delivered of ${rows.reduce((a, r) => a + r.allocatedMW, 0).toFixed(0)} MW commanded`)
            }
          },
          3200 + i * 400,
        ),
      )
    }
  },

  redispatchShortfall: () => {
    const s = get()
    const plan = finalPlan(s)
    if (!plan || !s.assessment || !s.eventId) return
    const rows = s.dispatch.rows
    const shortfall = rows.reduce((a, r) => a + (r.expectedMW - r.deliveredMW), 0)
    if (shortfall < 1) return
    const used = [...rows.map((r) => r.assetId), ...(s.redispatch?.allocations.map((a) => a.assetId) ?? [])]
    const extra = optimize({
      snapshot: s.assessment.snapshot,
      evaluations: s.evaluations,
      direction: s.assessment.direction,
      requirementMW: shortfall,
      deviationMW: shortfall,
      severity: s.assessment.severity === 'NORMAL' ? 'ALERT' : s.assessment.severity,
      strategy: 'OPTIMAL',
      exclude: used,
    })
    const extraRows = simulateDelivery(extra, s.eventId + '-R', s.assessment.snapshot)
    const all = [...rows, ...extraRows]
    set({ redispatch: extra, dispatch: { ...s.dispatch, rows: all } })
    if (!s.dispatch.shadow) {
      const mw: Record<string, number> = {}
      for (const r of all) if (r.assetId !== 'RTM') mw[r.assetId] = r.deliveredMW
      useGridStore.getState().setDispatch({ eventId: s.eventId, direction: plan.direction, mw })
    }
    audit('COMMAND', `Shortfall ${shortfall.toFixed(0)} MW re-dispatched to ${extra.allocations.map((a) => a.name).join(', ') || 'no remaining resources'}`, 'SLDC Shift Engineer')
  },

  computeSettlement: () => {
    const s = get()
    const plan = finalPlan(s)
    if (!plan || !s.assessment) return
    const merged: PlanResult = s.redispatch ? { ...plan, allocations: [...plan.allocations, ...s.redispatch.allocations] } : plan
    const settlement = settle(merged, s.dispatch.rows, s.evaluations, s.assessment.snapshot, s.assessment.deviationMW)
    set({ settlement })
    audit('SETTLEMENT', `Settlement computed: payments ₹${(settlement.paymentsRs / 1e5).toFixed(2)} L, avoided DSM ₹${(settlement.avoidedDsmRs / 1e5).toFixed(2)} L`)
  },

  closeEvent: () => {
    const s = get()
    if (!s.settlement) get().computeSettlement()
    const st = get()
    const set2 = st.settlement
    if (set2 && st.assessment && st.eventId) {
      const learnedUpd: Record<string, number> = {}
      if (!st.dispatch.shadow) for (const r of set2.rows) if (r.assetId !== 'RTM') learnedUpd[r.assetId] = r.newReliability
      useHistoryStore.getState().learn(learnedUpd)
      useHistoryStore.getState().addEvent({
        id: st.eventId,
        openedAt: st.openedSim,
        closedAt: fmtClock(useGridStore.getState().simMinutes),
        scenario: st.scenarioLabel,
        severity: st.assessment.severity,
        direction: st.assessment.direction,
        requirementMW: st.assessment.requirementMW,
        allocatedMW: set2.allocatedMW,
        deliveredMW: set2.deliveredMW,
        doNothingRs: set2.doNothingRs,
        paymentsRs: set2.paymentsRs,
        avoidedDsmRs: set2.avoidedDsmRs,
        netBenefitRs: set2.netBenefitRs,
        mode: st.dispatch.shadow ? 'SHADOW' : useUIStore.getState().mode,
        assets: set2.rows.length,
      })
    }
    audit('EVENT', 'Event closed; resources released; reliability scores updated', 'SLDC Shift Engineer')
    clearTimers()
    useGridStore.getState().setDispatch(null)
    useGridStore.getState().resetScenario()
    set({ status: 'closed' })
  },

  reset: () => {
    clearTimers()
    useGridStore.getState().setDispatch(null)
    set({ status: 'idle', eventId: null, step: 0, furthest: 0, assessment: null, iterations: [], settlement: null, redispatch: null, twinRevealed: 0 })
  },
}))
