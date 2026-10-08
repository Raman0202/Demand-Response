import { Activity, Pause, Play } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { freqClass, SEVERITY_STYLE, signed } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useDecisionStore } from '@/store/useDecisionStore'
import { blockOf, fmtClock, useGridStore } from '@/store/useGridStore'
import { useUIStore } from '@/store/useUIStore'

export function TopBar() {
  const sim = useGridStore((s) => s.simMinutes)
  const running = useGridStore((s) => s.running)
  const setRunning = useGridStore((s) => s.setRunning)
  const a = useGridStore((s) => s.assessment)
  const dispatching = useGridStore((s) => s.dispatch)
  const status = useDecisionStore((s) => s.status)
  const eventId = useDecisionStore((s) => s.eventId)
  const setPage = useUIStore((s) => s.setPage)
  const mode = useUIStore((s) => s.mode)
  const f = a.snapshot.frequency
  const eventOpen = status === 'open'

  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-card/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" className="size-7" onClick={() => setRunning(!running)} aria-label={running ? 'Pause' : 'Play'}>
          {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </Button>
        <div className="leading-tight">
          <div className="font-mono text-sm font-semibold tabular-nums">{fmtClock(sim)} IST</div>
          <div className="text-[10px] text-muted-foreground">Block {blockOf(sim)}/96 · SRLDC control area · KPTCL SLDC</div>
        </div>
      </div>

      <div className="mx-2 h-8 w-px bg-border" />

      <Metric label="Frequency" value={`${f.toFixed(3)} Hz`} className={freqClass(f)} hint="IEGC band 49.90–50.05 Hz" />
      <Metric
        label="ACE"
        value={`${signed(a.ace.ace)} MW`}
        className={Math.abs(a.ace.ace) >= 100 ? 'text-amber-600' : 'text-foreground'}
        hint="ACE = (Ia − Is) − 10·Bf·(Fa − Fs). Negative ⇒ state is short."
      />
      <Metric
        label="Deviation"
        value={`${signed(a.deviationMW)} MW`}
        className={Math.abs(a.deviationMW) > 100 ? 'text-amber-600' : 'text-foreground'}
        hint="Actual drawal − scheduled drawal (DSM basis)"
      />
      <Metric label="Demand" value={`${(a.snapshot.demandMW / 1000).toFixed(2)} GW`} hint="State demand met" />

      <div className="ml-auto flex items-center gap-2">
        {dispatching && (
          <Badge variant="success" className="gap-1">
            <Activity className="size-3" /> DR active
          </Badge>
        )}
        <Badge variant="outline" className="text-[10px]">
          Mode: {mode.replace('_', ' ')}
        </Badge>
        <span className={cn('rounded-md px-2 py-1 text-xs font-bold tracking-wide ring-1', SEVERITY_STYLE[a.severity])}>{a.severity}</span>
        {eventOpen && (
          <button onClick={() => setPage('decision')} className="rounded-md bg-sky-50 px-2 py-1 font-mono text-[11px] text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-100">
            {eventId}
          </button>
        )}
      </div>
    </header>
  )
}

function Metric({ label, value, className, hint }: { label: string; value: string; className?: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="cursor-default leading-tight">
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
          <div className={cn('font-mono text-sm font-semibold tabular-nums', className)}>{value}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
