// Page template shared by every screen: Header → Primary → Visualisation → Exceptions → Actions → Details.
import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Bot, CircleCheck, Eye, Lightbulb, Rocket, Telescope, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PageHeader({ title, summary, actions, icon }: { title: string; summary?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {icon && <div className="grid size-8 place-items-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-100">{icon}</div>}
      <div className="min-w-0 flex-1 leading-tight">
        <h1 className="text-[15px] font-semibold text-slate-800">{title}</h1>
        {summary && <div className="truncate text-xs text-slate-500">{summary}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({
  title,
  aside,
  children,
  className,
  bodyClass,
  style,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClass?: string
  style?: CSSProperties
}) {
  return (
    <section style={style} className={cn('flex min-h-0 flex-col rounded-xl border bg-white shadow-xs', className)}>
      {(title || aside) && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-[13px] font-semibold text-slate-700">{title}</h2>
          {aside}
        </div>
      )}
      <div className={cn('min-h-0 flex-1 p-3', bodyClass)}>{children}</div>
    </section>
  )
}

/** One metric tile. Every page's KPI strip is built from these so the layout reads the same everywhere. */
export function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad'; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-white px-2.5 py-1.5 shadow-xs">
      <div className="truncate text-[10px] text-slate-500">{label}</div>
      <div
        className={cn(
          'truncate font-mono text-[13px] font-semibold',
          tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-rose-600' : 'text-slate-800',
        )}
      >
        {value}
      </div>
      {sub && <div className="truncate text-[10px] text-slate-400">{sub}</div>}
    </div>
  )
}

/** Headline KPI card: icon, value, context line and an optional fill bar (e.g. delivered / dispatched). */
export function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
  fill,
  onClick,
  children,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'good' | 'warn' | 'bad' | 'info'
  fill?: number
  onClick?: () => void
  children?: ReactNode
}) {
  const ring = tone === 'bad' ? 'border-rose-200 bg-rose-50/50' : tone === 'warn' ? 'border-amber-200 bg-amber-50/50' : 'bg-white'
  const text = tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : tone === 'info' ? 'text-sky-700' : 'text-slate-800'
  const bar = tone === 'bad' ? 'bg-rose-400' : tone === 'warn' ? 'bg-amber-400' : tone === 'good' ? 'bg-emerald-400' : 'bg-sky-400'
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={cn('flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2 text-left shadow-xs transition enabled:hover:shadow-sm', ring)}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <span className="text-slate-400 [&_svg]:size-3.5">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={cn('truncate font-mono text-lg leading-tight font-semibold tabular-nums', text)}>{value}</div>
      {fill != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full transition-all', bar)} style={{ width: `${Math.max(0, Math.min(100, fill * 100))}%` }} />
        </div>
      )}
      {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
      {children}
    </button>
  )
}

/** KPI strip directly under the page header: the page's primary numbers at a glance. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="grid shrink-0 auto-cols-fr grid-flow-col gap-2">{children}</div>
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-4 text-center text-xs text-slate-500">
      <div className="flex flex-col items-center gap-2">
        {icon ?? <CircleCheck className="size-6 text-emerald-400" />}
        {children}
      </div>
    </div>
  )
}

export const PRIORITY_STYLE: Record<number, string> = {
  1: 'bg-rose-500 text-white',
  2: 'bg-amber-500 text-white',
  3: 'bg-sky-100 text-sky-800',
  4: 'bg-slate-100 text-slate-600',
}

export function Prio({ p }: { p: number }) {
  return <span className={cn('inline-grid h-5 min-w-7 place-items-center rounded px-1 text-[10px] font-bold', PRIORITY_STYLE[p])}>P{p}</span>
}

const STEPS = [
  { k: 'situation', label: 'Situation', icon: Eye },
  { k: 'impact', label: 'Impact', icon: TriangleAlert },
  { k: 'prediction', label: 'Prediction', icon: Telescope },
  { k: 'recommendation', label: 'Recommendation', icon: Lightbulb },
  { k: 'action', label: 'Action', icon: Rocket },
  { k: 'outcome', label: 'Outcome', icon: Bot },
] as const

/** Situation → Impact → Prediction → Recommendation → Action → Outcome */
export function StoryChain({ narrative, compact }: { narrative: Record<string, unknown>; compact?: boolean }) {
  return (
    <ol className={cn('relative min-w-0', compact ? 'space-y-1.5' : 'space-y-2')}>
      {STEPS.map(({ k, label, icon: Icon }, i) => {
        const text = narrative[k] as string | undefined
        if (!text) return null
        return (
          <li key={k} className="relative flex min-w-0 gap-2.5">
            {i < STEPS.length - 1 && <span className="absolute top-6 left-[11px] h-[calc(100%-0.75rem)] w-px bg-slate-200" />}
            <span
              className={cn(
                'relative grid size-6 shrink-0 place-items-center rounded-full ring-4 ring-white',
                k === 'outcome' ? 'bg-emerald-100 text-emerald-700' : k === 'action' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              <Icon className="size-3.5" />
            </span>
            {compact ? (
              <div className="flex min-w-0 flex-1 items-baseline gap-2 pt-0.5" title={text}>
                <span className="w-[112px] shrink-0 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{label}</span>
                <span className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-slate-700">{text}</span>
              </div>
            ) : (
              <div className="min-w-0 pb-0.5">
                <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{label}</div>
                <div className="text-[13px] leading-snug text-slate-700">{text}</div>
              </div>
            )}
          </li>
        )
      })}
      {Array.isArray(narrative.reasons) && (narrative.reasons as string[]).length > 0 && !compact && (
        <li className="mt-1 flex items-start gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{(narrative.reasons as string[]).join(' · ')}</span>
        </li>
      )}
    </ol>
  )
}

export function GoLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-0.5 text-[11px] font-medium text-sky-700 hover:underline">
      {children} <ArrowRight className="size-3" />
    </button>
  )
}
