import { Boxes, Eye, FlaskConical, Hand, LayoutDashboard, Receipt, ScrollText, ShieldCheck, Workflow } from 'lucide-react'
import type { OperatingMode } from '@/engine/types'
import { cn } from '@/lib/utils'
import { STEPS, useDecisionStore } from '@/store/useDecisionStore'
import { useUIStore, type Page } from '@/store/useUIStore'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const NAV: { id: Page; label: string; hint: string; icon: typeof LayoutDashboard }[] = [
  { id: 'monitor', label: 'Grid Monitor', hint: 'Live state & 3D Karnataka twin', icon: LayoutDashboard },
  { id: 'decision', label: 'Decision Center', hint: 'Guided 8-step decision flow', icon: Workflow },
  { id: 'scenario', label: 'Scenario Lab', hint: 'Stress-test & compare strategies', icon: FlaskConical },
  { id: 'flexibility', label: 'Flexibility Registry', hint: 'Assets, contracts, reservations', icon: Boxes },
  { id: 'settlement', label: 'Settlement & M&V', hint: 'Performance & payments', icon: Receipt },
  { id: 'audit', label: 'Audit Log', hint: 'Immutable command trail', icon: ScrollText },
]

const MODES: { id: OperatingMode; label: string; icon: typeof Eye; desc: string }[] = [
  { id: 'SHADOW', label: 'Shadow', icon: Eye, desc: 'System decides but sends nothing. Compare with operator actions.' },
  { id: 'ADVISORY', label: 'Advisory', icon: Hand, desc: 'Operator approves every dispatch (human-in-the-loop).' },
  { id: 'CLOSED_LOOP', label: 'Closed loop', icon: ShieldCheck, desc: 'BESS/generation auto-dispatch after twin approval; DR still needs approval.' },
]

export function Sidebar() {
  const page = useUIStore((s) => s.page)
  const setPage = useUIStore((s) => s.setPage)
  const mode = useUIStore((s) => s.mode)
  const setMode = useUIStore((s) => s.setMode)
  const status = useDecisionStore((s) => s.status)
  const step = useDecisionStore((s) => s.step)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-2.5 border-b px-4 py-3.5">
        <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-sky-300 to-emerald-300 text-sm font-black text-slate-800">KA</div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">KSFP</div>
          <div className="text-[10px] text-muted-foreground">State Flexibility & DR Platform</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map(({ id, label, hint, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={cn('group flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-accent', page === id && 'bg-accent ring-1 ring-primary/30')}
          >
            <Icon className={cn('mt-0.5 size-4 text-muted-foreground', page === id && 'text-primary')} />
            <span className="flex-1">
              <span className="flex items-center justify-between text-sm font-medium">
                {label}
                {id === 'decision' && status === 'open' && (
                  <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-700">
                    {step + 1}/{STEPS.length}
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="mt-auto space-y-2 border-t p-3">
        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">Operating mode</div>
        <div className="grid gap-1">
          {MODES.map(({ id, label, icon: Icon, desc }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setMode(id)}
                  className={cn(
                    'flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs transition hover:bg-accent',
                    mode === id && 'border-primary/40 bg-primary/10 text-primary',
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                  {mode === id && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{desc}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">Rollout path: Shadow (1–3 months) → Advisory → limited closed loop (BESS first).</p>
      </div>
    </aside>
  )
}
