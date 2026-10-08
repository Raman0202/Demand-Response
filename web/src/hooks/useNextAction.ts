import { STEPS, useDecisionStore } from '@/store/useDecisionStore'
import { useGridStore } from '@/store/useGridStore'
import { useUIStore } from '@/store/useUIStore'

/** Single context-aware "next best action" shared by the lifecycle rail. */
export function useNextAction() {
  const severity = useGridStore((s) => s.assessment.severity)
  const ace = useGridStore((s) => s.assessment.ace.ace)
  const d = useDecisionStore()
  const setPage = useUIStore((s) => s.setPage)
  const page = useUIStore((s) => s.page)

  if (d.status === 'open') {
    const goDecision = (step?: number) => () => {
      setPage('decision')
      if (step !== undefined) d.goTo(step)
    }
    if (page !== 'decision') return { label: `Resume: ${STEPS[d.step].title}`, hint: `${d.eventId} · step ${d.step + 1}/8`, run: goDecision(), tone: 'default' as const }
    if (d.step === 5 && d.twinRevealed < d.iterations.length) return { label: 'Run Digital Twin', hint: 'Validate before any command', run: d.runTwin, tone: 'default' as const }
    if (d.step === 6 && d.dispatch.phase === 'idle') return { label: 'Approve below', hint: 'Authorisation needed', run: () => {}, tone: 'muted' as const }
    if (d.step === 6 && d.dispatch.phase !== 'done') return { label: 'Dispatching…', hint: 'Watch the command wave', run: () => {}, tone: 'muted' as const }
    if (d.step === 7 && !d.settlement) return { label: 'Compute settlement', hint: 'M&V complete', run: d.computeSettlement, tone: 'default' as const }
    if (d.step === 7 && d.settlement) return { label: 'Close event & learn', hint: 'Release resources', run: d.closeEvent, tone: 'success' as const }
    return { label: `Next: ${STEPS[d.step + 1].title}`, hint: STEPS[d.step + 1].question, run: d.next, tone: 'default' as const }
  }
  if (d.status === 'closed' && page === 'decision') return { label: 'Review settlement', hint: 'Event closed', run: () => setPage('settlement'), tone: 'default' as const }
  if (severity !== 'NORMAL')
    return {
      label: 'Start guided decision',
      hint: `${severity} · ACE ${ace.toFixed(0)} MW`,
      run: d.openEvent,
      tone: severity === 'EMERGENCY' ? ('danger' as const) : ('default' as const),
    }
  if (page === 'scenario') return { label: 'Pick a scenario below', hint: 'Then inject it', run: () => {}, tone: 'muted' as const }
  return { label: 'Try a scenario', hint: 'Grid is balanced', run: () => setPage('scenario'), tone: 'soft' as const }
}
