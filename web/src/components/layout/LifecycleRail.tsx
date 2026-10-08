import { ArrowRight, Eye, FlaskConical, GraduationCap, Rocket, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useNextAction } from '@/hooks/useNextAction'
import { useDecisionStore } from '@/store/useDecisionStore'
import { useUIStore, type Page } from '@/store/useUIStore'

type PhaseId = 'observe' | 'simulate' | 'decide' | 'act' | 'learn'

const PHASES: { id: PhaseId; label: string; sub: string; icon: typeof Eye }[] = [
  { id: 'observe', label: 'Observe', sub: 'Live grid & 3D twin', icon: Eye },
  { id: 'simulate', label: 'Simulate', sub: 'What-if scenarios', icon: FlaskConical },
  { id: 'decide', label: 'Decide', sub: 'Detect → validate', icon: Workflow },
  { id: 'act', label: 'Act', sub: 'Approve & dispatch', icon: Rocket },
  { id: 'learn', label: 'Learn', sub: 'Verify, settle, audit', icon: GraduationCap },
]

/** Which lifecycle phase the operator is in, derived from page + event state. */
function currentPhase(page: Page, step: number, open: boolean): PhaseId {
  if (page === 'scenario') return 'simulate'
  if (page === 'decision' && open) return step >= 7 ? 'learn' : step === 6 ? 'act' : 'decide'
  if (page === 'settlement' || page === 'audit') return 'learn'
  return 'observe'
}

export function LifecycleRail() {
  const page = useUIStore((s) => s.page)
  const setPage = useUIStore((s) => s.setPage)
  const d = useDecisionStore()
  const open = d.status === 'open'
  const phase = currentPhase(page, d.step, open)
  const idx = PHASES.findIndex((p) => p.id === phase)
  const next = useNextAction()

  const go = (id: PhaseId) => {
    if (id === 'observe') setPage('monitor')
    if (id === 'simulate') setPage('scenario')
    if (id === 'decide') {
      setPage('decision')
      if (open && d.step > 5) d.goTo(5)
    }
    if (id === 'act') {
      setPage('decision')
      if (open && d.furthest >= 5) d.goTo(6)
    }
    if (id === 'learn') {
      if (open && d.dispatch.phase === 'done') {
        setPage('decision')
        d.goTo(7)
      } else setPage('settlement')
    }
  }

  const decideProgress = open ? Math.min(6, d.step + 1) / 6 : 0

  return (
    <div className="flex items-center gap-3 border-b bg-gradient-to-r from-sky-50 via-white to-emerald-50 px-4 py-2">
      <ol className="flex flex-1 items-center">
        {PHASES.map((p, i) => {
          const Icon = p.icon
          const active = i === idx
          const done = i < idx && (open || p.id === 'observe')
          return (
            <li key={p.id} className="flex flex-1 items-center last:flex-none">
              <button
                onClick={() => go(p.id)}
                className={cn(
                  'group flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-left transition',
                  active ? 'bg-white shadow-sm ring-1 ring-sky-200' : 'hover:bg-white/70',
                )}
              >
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-full transition',
                    active ? 'bg-sky-500 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
                  )}
                >
                  <Icon className="size-3.5" />
                </span>
                <span className="leading-tight">
                  <span className={cn('block text-xs font-semibold', active ? 'text-slate-800' : 'text-slate-600')}>{p.label}</span>
                  <span className="block text-[10px] text-slate-500">{p.id === 'decide' && open ? `step ${Math.min(d.step + 1, 6)} of 6` : p.sub}</span>
                </span>
              </button>
              {i < PHASES.length - 1 && (
                <div className="relative mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-700"
                    style={{ width: i < idx ? '100%' : i === idx && p.id === 'decide' ? `${decideProgress * 100}%` : '0%' }}
                  />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <div className="flex items-center gap-2 pl-2">
        <div className="hidden text-right leading-tight xl:block">
          <div className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Next best action</div>
          <div className="max-w-[220px] truncate text-[11px] text-slate-600">{next.hint}</div>
        </div>
        <Button
          size="sm"
          onClick={next.run}
          disabled={next.tone === 'muted'}
          variant={next.tone === 'danger' ? 'destructive' : next.tone === 'success' ? 'success' : next.tone === 'soft' ? 'outline' : 'default'}
          className="rounded-full"
        >
          {next.label} <ArrowRight className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
