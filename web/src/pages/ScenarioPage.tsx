import { useMemo, useState } from 'react'
import { ArrowRight, CloudSun, FlaskConical, RotateCcw, Trophy, Zap } from 'lucide-react'
import { Kpi, SystemSays } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ASSETS, LINES } from '@/data/karnataka'
import { assess, flexibility, options } from '@/engine/decision'
import { BASELINE_SCENARIO, buildSnapshot, type ScenarioParams, type ShockRegion } from '@/engine/grid'
import { lineLabel } from '@/engine/network'
import { PRESETS } from '@/engine/scenarios'
import { fmtMW, fmtRs } from '@/lib/geo'
import { cn } from '@/lib/utils'
import { useDecisionStore } from '@/store/useDecisionStore'
import { useGridStore } from '@/store/useGridStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { SEVERITY_STYLE } from '@/lib/ui'

const TAG_STYLE: Record<string, string> = {
  Deficit: 'bg-amber-500/15 text-amber-600',
  Network: 'bg-orange-500/15 text-orange-600',
  Market: 'bg-violet-500/15 text-violet-600',
  Resilience: 'bg-sky-500/15 text-sky-600',
  Emergency: 'bg-red-500/15 text-red-600',
  Surplus: 'bg-emerald-500/15 text-emerald-600',
}

export function ScenarioPage() {
  const live = useGridStore((s) => s.scenario)
  const applyLive = useGridStore((s) => s.setScenario)
  const applyPresetLive = useGridStore((s) => s.applyPreset)
  const resetLive = useGridStore((s) => s.resetScenario)
  const assets = useGridStore((s) => s.assets)
  const openEvent = useDecisionStore((s) => s.openEvent)
  const learned = useHistoryStore((s) => s.learned)
  const [draft, setDraft] = useState<ScenarioParams>(live)
  const [presetId, setPresetId] = useState<string | null>(useGridStore.getState().activePresetId)

  const set = (p: Partial<ScenarioParams>) => {
    setDraft((d) => ({ ...d, ...p }))
    setPresetId(null)
  }

  const preview = useMemo(() => {
    const snap = buildSnapshot(draft)
    const a = assess(snap)
    const evs = flexibility(a, assets, learned)
    const strategies = options(a, evs)
    const best = [...strategies].sort((x, y) => x.plan.costs.totalRs - y.plan.costs.totalRs)[0]
    return { a, strategies, best }
  }, [draft, assets, learned])

  const apply = (open: boolean) => {
    // presetId is cleared on any manual edit, so a set presetId means draft === preset
    if (presetId) applyPresetLive(presetId)
    else applyLive(draft)
    if (open) setTimeout(openEvent, 0)
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical className="size-5 text-sky-600" /> Scenario Lab
          </h1>
          <p className="text-xs text-muted-foreground">Pick or build a stress scenario → see the assessment instantly → compare strategies → inject it and walk the decision.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(BASELINE_SCENARIO)
              setPresetId(null)
              resetLive()
            }}
          >
            <RotateCcw className="size-4" /> Reset to base case
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
        <div className="flex min-h-0 flex-col gap-1.5">
          <div className="px-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">Scenario library</div>
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setDraft({ ...BASELINE_SCENARIO, ...p.params })
                setPresetId(p.id)
              }}
              className={cn(
                'rounded-xl border bg-white px-3 py-2 text-left transition hover:border-sky-300 hover:shadow-xs',
                presetId === p.id && 'border-sky-400 bg-sky-50 ring-1 ring-sky-300',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{p.title}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', TAG_STYLE[p.tag])}>{p.tag}</span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">{p.summary}</p>
            </button>
          ))}
        </div>

        <Card className="min-h-0 gap-3 py-3">
          <CardHeader>
            <CardTitle className="text-sm">Scenario controls</CardTitle>
            <CardDescription>Everything here is a draft until you inject it.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col justify-between gap-3">
            <Ctl label="Demand shock" value={`${draft.demandShockMW > 0 ? '+' : ''}${draft.demandShockMW} MW`}>
              <div className="flex items-center gap-3">
                <Slider min={-1000} max={1500} step={25} value={[draft.demandShockMW]} onValueChange={([v]) => set({ demandShockMW: v })} />
                <Select value={draft.shockRegion} onValueChange={(v) => set({ shockRegion: v as ShockRegion })}>
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BENGALURU">Bengaluru metro</SelectItem>
                    <SelectItem value="NORTH">North Karnataka</SelectItem>
                    <SelectItem value="STATEWIDE">Statewide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Ctl>
            <Ctl label="Renewable drop (cloud / wind lull)" value={draft.reDropMW ? `−${draft.reDropMW} MW` : '0 MW'} icon={<CloudSun className="size-3.5" />}>
              <Slider min={0} max={3000} step={50} value={[draft.reDropMW]} onValueChange={([v]) => set({ reDropMW: v })} />
            </Ctl>
            <Ctl label="Grid frequency" value={`${draft.frequency.toFixed(2)} Hz`}>
              <Slider min={49.7} max={50.2} step={0.01} value={[draft.frequency]} onValueChange={([v]) => set({ frequency: +v.toFixed(2) })} />
            </Ctl>
            <Ctl label="RTM clearing price" value={`₹${draft.prices.rtmAcp.toFixed(2)}/kWh`}>
              <Slider min={2} max={20} step={0.1} value={[draft.prices.rtmAcp]} onValueChange={([v]) => set({ prices: { ...draft.prices, rtmAcp: +v.toFixed(2) } })} />
            </Ctl>
            <div className="grid grid-cols-2 gap-4">
              <Ctl label="BESS fleet availability" value={`${(draft.bessAvailability * 100).toFixed(0)}%`}>
                <Slider min={0} max={1} step={0.05} value={[draft.bessAvailability]} onValueChange={([v]) => set({ bessAvailability: v })} />
              </Ctl>
              <Ctl label="Industrial DR compliance" value={`${(draft.industrialCompliance * 100).toFixed(0)}%`}>
                <Slider min={0.2} max={1} step={0.05} value={[draft.industrialCompliance]} onValueChange={([v]) => set({ industrialCompliance: v })} />
              </Ctl>
            </div>
            <Ctl label="Event horizon" value={`${draft.durationBlocks} blocks · ${draft.durationBlocks * 15} min`}>
              <Slider min={1} max={8} step={1} value={[draft.durationBlocks]} onValueChange={([v]) => set({ durationBlocks: v })} />
            </Ctl>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium">Transmission outage</div>
                <Select value={draft.outagedLines[0] ?? 'none'} onValueChange={(v) => set({ outagedLines: v === 'none' ? [] : [v] })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">None</SelectItem>
                    {LINES.filter((l) => !l.hvdc).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {lineLabel(l.id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium">Comms failure (heartbeat lost)</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 rounded-md border p-2">
                  {ASSETS.filter((a) => ['A_BWSSB', 'A_JSW', 'A_HAG', 'A_PBESS', 'A_WFLD', 'A_SDM'].includes(a.id)).map((a) => (
                    <Label key={a.id} className="text-xs font-normal">
                      <Checkbox
                        checked={draft.heartbeatLost.includes(a.id)}
                        onCheckedChange={(v) => set({ heartbeatLost: v ? [...draft.heartbeatLost, a.id] : draft.heartbeatLost.filter((x) => x !== a.id) })}
                      />
                      {a.short}
                    </Label>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-3">
          <SystemSays tone={preview.a.severity === 'NORMAL' ? 'good' : preview.a.severity === 'ALERT' ? 'warn' : 'bad'}>
            This scenario puts Karnataka in <b>{preview.a.severity}</b>: deviation {preview.a.deviationMW.toFixed(0)} MW, ACE {preview.a.ace.ace.toFixed(0)} MW →{' '}
            {preview.a.requirementMW.toFixed(0)} MW {preview.a.direction} requirement. Doing nothing costs {fmtRs(preview.a.doNothingRs)}; best strategy is{' '}
            <b>{preview.best.label}</b> at {fmtRs(preview.best.plan.costs.totalRs)}.
          </SystemSays>
          <div className="grid shrink-0 grid-cols-4 gap-2">
            <Kpi label="Severity" value={<span className={cn('rounded px-1.5 text-sm ring-1', SEVERITY_STYLE[preview.a.severity])}>{preview.a.severity}</span>} />
            <Kpi label="Deviation" value={`${preview.a.deviationMW.toFixed(0)} MW`} tone={Math.abs(preview.a.deviationMW) > 100 ? 'warn' : 'good'} />
            <Kpi label="ACE" value={`${preview.a.ace.ace.toFixed(0)} MW`} tone={Math.abs(preview.a.ace.ace) > 100 ? 'warn' : 'good'} />
            <Kpi label="DSM / block" value={fmtRs(preview.a.dsm.amountRs)} sub={`NR ₹${preview.a.dsm.nr.nr.toFixed(2)}`} />
          </div>

          <Card className="min-h-0 flex-1 gap-2 py-3">
            <CardHeader>
              <CardTitle className="text-sm">Strategy comparison</CardTitle>
              <CardDescription>Each row is a full network-aware optimisation restricted to that resource class.</CardDescription>
            </CardHeader>
            <CardContent className="px-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead className="text-right">Residual DSM</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Coverage</TableHead>
                    <TableHead className="text-right">Max line</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.strategies.map((st) => (
                    <TableRow key={st.id} className={cn(st.id === preview.best.id && 'bg-emerald-500/10')}>
                      <TableCell className="text-xs font-medium">
                        {st.label}
                        {st.id === preview.best.id && (
                          <Badge variant="success" className="ml-2">
                            <Trophy /> best
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtRs(st.plan.costs.residualDsmRs)}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold">{fmtRs(st.plan.costs.totalRs)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{st.plan.coveragePct.toFixed(0)}%</TableCell>
                      <TableCell className={cn('text-right font-mono text-xs', st.plan.maxLoadingAfter.value > 1 && 'text-red-500')}>
                        {(st.plan.maxLoadingAfter.value * 100).toFixed(0)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="lg" className="rounded-full" onClick={() => apply(true)}>
              <Zap className="size-4" /> Inject & open Decision Center <ArrowRight className="size-4" />
            </Button>
            <Button size="lg" variant="outline" className="rounded-full" onClick={() => apply(false)}>
              Inject into live grid only
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Injecting changes the live SCADA feed (3D map, KPIs, trends); event detection then raises the alert as in the control room. P90 margin {fmtMW(preview.a.marginMW)}.
          </p>
        </div>
      </div>
    </div>
  )
}

function Ctl({ label, value, children, icon }: { label: string; value: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-medium">
          {icon}
          {label}
        </span>
        <span className="font-mono text-sky-600">{value}</span>
      </div>
      {children}
    </div>
  )
}
