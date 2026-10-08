// Primary navigation (operator destinations) + system-status cluster. Metrics live on pages, not here.
import { useState } from 'react'
import {
  Activity,
  Bell,
  Bot,
  ChevronDown,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  LogOut,
  Network,
  PauseCircle,
  PlayCircle,
  Receipt,
  Settings2,
  ShieldAlert,
  Wifi,
  WifiOff,
  Users,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { NotificationBell } from './Notifications'
import { SEVERITY_STYLE } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { useAuth } from '@/store/useAuth'
import { useLive } from '@/store/useLive'
import { useUI, type Page } from '@/store/useUI'

const LEVELS = ['Monitor', 'Advisory', 'Supervised', 'Autonomous']

// DR operator workflow: overview → events (act) → programs (capacity) → grid & forecast (context) → alarms
const PRIMARY: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'command', label: 'Overview', icon: LayoutDashboard },
  { id: 'decisions', label: 'DR Events', icon: Zap },
  { id: 'resources', label: 'Programs', icon: Users },
  { id: 'operations', label: 'Grid', icon: Network },
  { id: 'analysis', label: 'Forecast', icon: LineChart },
  { id: 'alarms', label: 'Alarms', icon: Bell },
]

const MORE: { id: Page; label: string; hint: string; icon: typeof LayoutDashboard; perm?: string }[] = [
  { id: 'whatif', label: 'What-if sandbox', hint: 'Test a DR event before it happens — no dispatch', icon: FlaskConical, perm: 'whatif' },
  { id: 'reports', label: 'Settlement & Audit', hint: 'Baseline, delivery, payments, audit trail', icon: Receipt },
  { id: 'admin', label: 'Administration', hint: 'Autonomy policy, data sources, simulator, users', icon: Settings2 },
]

export function TopNav() {
  const page = useUI((s) => s.page)
  const go = useUI((s) => s.go)
  const f = useLive((s) => s.frame)
  const conn = useLive((s) => s.conn)
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const can = useAuth((s) => s.can)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const counts: Partial<Record<Page, { n: number; tone: string } | null>> = {
    decisions: f?.counts.awaiting
      ? { n: f.counts.awaiting, tone: 'bg-amber-500 text-white' }
      : f?.counts.decisions_open
        ? { n: f.counts.decisions_open, tone: 'bg-sky-500 text-white' }
        : null,
    alarms: f?.counts.unacked ? { n: f.counts.unacked, tone: f.counts.p1 ? 'bg-rose-500 text-white' : 'bg-amber-500 text-white' } : null,
  }
  const eff = f?.autonomy.effective ?? 0
  const degraded = f && f.autonomy.effective < f.autonomy.level

  async function suspend() {
    setBusy(true)
    try {
      await api('/autonomy/suspend', { method: 'POST', body: { reason } })
      setSuspendOpen(false)
      setReason('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b bg-white/90 px-3 backdrop-blur">
      <button onClick={() => go('command')} className="flex items-center gap-2 pr-2">
        <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-emerald-400 text-white">
          <Zap className="size-4" />
        </div>
        <div className="hidden text-left leading-tight xl:block">
          <div className="text-sm font-semibold">Demand Response</div>
          <div className="text-[10px] text-muted-foreground">Autonomous DR operations</div>
        </div>
      </button>

      <nav className="flex items-center gap-0.5">
        {PRIMARY.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100',
              page === id && 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
            )}
          >
            <Icon className="size-4" />
            {label}
            {counts[id] && <span className={cn('ml-0.5 rounded-full px-1.5 text-[10px] font-bold tabular-nums', counts[id]!.tone)}>{counts[id]!.n}</span>}
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-slate-600 transition hover:bg-slate-100',
                MORE.some((m) => m.id === page) && 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
              )}
            >
              {MORE.find((m) => m.id === page)?.label ?? 'More'} <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {MORE.filter((m) => !m.perm || can(m.perm)).map(({ id, label, hint, icon: Icon }) => (
              <DropdownMenuItem key={id} onClick={() => go(id)} className="items-start">
                <Icon className="mt-0.5" />
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* system status — qualifies everything on screen */}
      <div className="ml-auto flex items-center gap-2">
        {f && (
          <>
            <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ring-1', SEVERITY_STYLE[f.severity])}>{f.severity}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 transition',
                    f.autonomy.suspended
                      ? 'bg-rose-50 text-rose-700 ring-rose-300'
                      : degraded
                        ? 'bg-amber-50 text-amber-700 ring-amber-300'
                        : 'bg-sky-50 text-sky-700 ring-sky-200',
                  )}
                >
                  <Bot className="size-3.5" />
                  {f.autonomy.suspended ? 'Autonomy suspended' : `L${eff} ${LEVELS[eff]}`}
                  {degraded && !f.autonomy.suspended && ' (degraded)'}
                  <ChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>
                  Configured L{f.autonomy.level} {LEVELS[f.autonomy.level]} · effective L{eff}
                </DropdownMenuLabel>
                {f.autonomy.reasons.map((r) => (
                  <div key={r} className="px-2 pb-1 text-[11px] text-amber-700">
                    {r}
                  </div>
                ))}
                <DropdownMenuSeparator />
                {can('autonomy') ? (
                  f.autonomy.suspended ? (
                    <DropdownMenuItem onClick={() => api('/autonomy/resume', { method: 'POST' })}>
                      <PlayCircle /> Resume autonomy
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => setSuspendOpen(true)} className="text-rose-700">
                      <PauseCircle /> Suspend autonomy (kill switch)…
                    </DropdownMenuItem>
                  )
                ) : (
                  <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Suspend/resume requires Shift-in-Charge.</div>
                )}
                <DropdownMenuItem onClick={() => go('admin')}>
                  <Settings2 /> Autonomy policy…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
                    f.confidence >= 0.97 ? 'text-emerald-700 ring-emerald-200' : f.confidence >= 0.85 ? 'text-amber-700 ring-amber-200' : 'bg-rose-50 text-rose-700 ring-rose-300',
                  )}
                >
                  <ShieldAlert className="size-3" /> Data {(f.confidence * 100).toFixed(0)}%
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Data confidence of the state estimate. Below 85% autonomy degrades to advisory automatically.
                {f.source.kptcl && ` SLDC feed: ${f.source.kptcl.ok}/${f.source.kptcl.total} pages, ${f.source.kptcl.live} live channels.`}
              </TooltipContent>
            </Tooltip>
            <div className="text-right leading-tight">
              <div className="font-mono text-[13px] font-semibold tabular-nums">{f.clock}</div>
              <div className="text-[10px] text-muted-foreground">
                Block {f.block}/96{f.time_scale !== 1 && ` · sim ×${f.time_scale}`}
              </div>
            </div>
          </>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'grid size-7 place-items-center rounded-full',
                conn === 'live' ? 'text-emerald-600' : conn === 'offline' ? 'text-rose-600' : 'animate-pulse text-amber-600',
              )}
            >
              {conn === 'live' ? <Wifi className="size-4" /> : conn === 'offline' ? <WifiOff className="size-4" /> : <Activity className="size-4" />}
            </span>
          </TooltipTrigger>
          <TooltipContent>Real-time stream: {conn}</TooltipContent>
        </Tooltip>
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-full py-0.5 pr-2 pl-0.5 ring-1 ring-slate-200 transition hover:bg-slate-50">
              <span className="grid size-7 place-items-center rounded-full bg-slate-800 text-[11px] font-bold text-white uppercase">{user?.username.slice(0, 2)}</span>
              <span className="hidden text-left leading-tight xl:block">
                <span className="block text-[12px] font-medium">{user?.username}</span>
                <span className="block text-[10px] text-muted-foreground">{user?.role_label}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{user?.display}</DropdownMenuLabel>
            <div className="px-2 pb-1.5 text-[11px] text-muted-foreground">{user?.permissions.join(' · ')}</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout()}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend autonomy</DialogTitle>
            <DialogDescription>
              New automatic actions stop immediately; every decision will require approval. Commands already executing continue unless you abort their decision. This is audited.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || busy} onClick={suspend}>
              <PauseCircle className="size-4" /> Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}
