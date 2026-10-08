import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Info, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function Kpi({
  label,
  value,
  sub,
  tone = 'default',
  icon,
  hint,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'
  icon?: ReactNode
  hint?: string
}) {
  const toneCls = {
    default: 'text-foreground',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-500',
    info: 'text-sky-600',
  }[tone]
  const body = (
    <div className="rounded-xl border bg-card px-3 py-2 shadow-xs">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
        {hint && <Info className="size-3 opacity-60" />}
      </div>
      <div className={cn('mt-0.5 font-mono text-base font-semibold tabular-nums', toneCls)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
  if (!hint) return body
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  )
}

/** Plain-language "what the system concluded" banner shown at the top of each decision step. */
export function SystemSays({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'good' | 'warn' | 'bad' }) {
  const cls = {
    info: 'border-sky-400/30 bg-sky-400/5',
    good: 'border-emerald-400/30 bg-emerald-400/5',
    warn: 'border-amber-400/30 bg-amber-400/5',
    bad: 'border-red-400/40 bg-red-400/5',
  }[tone]
  return (
    <div className={cn('flex gap-3 rounded-xl border px-3 py-2.5', cls)}>
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-600" />
      <div className="text-sm leading-relaxed">
        <span className="mr-1 text-[10px] font-semibold tracking-wider text-sky-600 uppercase">System says</span>
        {children}
      </div>
    </div>
  )
}

/** A worked calculation: formula, then the numbers substituted, then the result. */
export function Calc({ title, formula, steps, result }: { title: string; formula: ReactNode; steps?: ReactNode[]; result: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="mt-1 font-mono text-[13px] text-sky-700">{formula}</div>
      {steps?.map((s, i) => (
        <div key={i} className="font-mono text-[12px] text-muted-foreground">
          = {s}
        </div>
      ))}
      <div className="mt-1 font-mono text-sm font-semibold">→ {result}</div>
    </div>
  )
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="text-sm font-semibold">{children}</h3>
      {aside}
    </div>
  )
}

export function Why({ children }: { children: ReactNode }) {
  return <div className="space-y-2 rounded-xl border bg-white p-4 text-sm leading-relaxed text-slate-600">{children}</div>
}

export function Bar({ segments, height = 10 }: { segments: { value: number; color: string; label: string }[]; height?: number }) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1
  return (
    <div className="flex w-full overflow-hidden rounded-full bg-muted" style={{ height }}>
      {segments.map((s) => (
        <Tooltip key={s.label}>
          <TooltipTrigger asChild>
            <div style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: s.color }} className="h-full transition-all" />
          </TooltipTrigger>
          <TooltipContent>
            {s.label}: {s.value.toFixed(0)} MW
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

/**
 * Fit-to-height pagination: measures its container and shows as many rows as fit,
 * so long tables page horizontally instead of scrolling vertically.
 */
export function FitPager<T>({
  items,
  rowHeight,
  reserve = 72,
  render,
  className,
}: {
  items: T[]
  rowHeight: number
  reserve?: number
  render: (slice: T[], offset: number) => ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(8)
  const [page, setPage] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize(Math.max(1, Math.floor((el.clientHeight - reserve) / rowHeight)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rowHeight, reserve])
  // new data can mean shorter rows or more room: start again from the estimate (the shrink pass below runs before paint)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setSize(Math.max(1, Math.floor((el.clientHeight - reserve) / rowHeight)))
  }, [items, rowHeight, reserve])
  // rowHeight is an estimate: if the rendered rows are taller, shrink the page until it fits (never scroll).
  // Runs after every render but only ever decrements, so it terminates at the largest size that fits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const b = body.current
    if (b && size > 1 && b.scrollHeight > b.clientHeight + 1) setSize(size - 1)
  })
  const pages = Math.max(1, Math.ceil(items.length / size))
  const p = Math.min(page, pages - 1)
  return (
    <div ref={ref} className={cn('flex h-full min-h-0 flex-col', className)}>
      <div ref={body} className="min-h-0 flex-1 overflow-hidden">
        {render(items.slice(p * size, (p + 1) * size), p * size)}
      </div>
      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-between border-t px-2 pt-1.5 text-[11px] text-muted-foreground">
          <span>
            {p * size + 1}–{Math.min(items.length, (p + 1) * size)} of {items.length}
          </span>
          <div className="flex items-center gap-1">
            {Array.from({ length: pages }, (_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={cn('size-1.5 rounded-full transition-all', i === p ? 'w-4 bg-sky-500' : 'bg-slate-300 hover:bg-slate-400')}
                aria-label={`Page ${i + 1}`}
              />
            ))}
            <button className="ml-1 rounded p-0.5 hover:bg-slate-100 disabled:opacity-30" disabled={p === 0} onClick={() => setPage(p - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </button>
            <button className="rounded p-0.5 hover:bg-slate-100 disabled:opacity-30" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export interface Section {
  id: string
  label: ReactNode
  content: ReactNode
}

/** Horizontal section tabs that fill the remaining height (replaces vertical stacking). */
export function SectionTabs({ sections, value, onValueChange }: { sections: Section[]; value?: string; onValueChange?: (v: string) => void }) {
  return (
    <Tabs defaultValue={value === undefined ? sections[0]?.id : undefined} value={value} onValueChange={onValueChange} className="flex min-h-0 flex-1 flex-col gap-3">
      <TabsList className="shrink-0">
        {sections.map((s) => (
          <TabsTrigger key={s.id} value={s.id} className="px-3 text-xs">
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map((s) => (
        <TabsContent key={s.id} value={s.id} className="min-h-0 flex-1 overflow-hidden animate-in fade-in duration-200">
          {s.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

/** Fixed-height step layout: pinned conclusion on top, tabbed detail below. */
export function StepShell({ says, children }: { says: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0">{says}</div>
      {children}
    </div>
  )
}
