// Forecast & Analysis — what will happen (P10–P90), predicted violations, recent behaviour, forecast accuracy.
import { Area, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Clock3, LineChart as LineIcon } from 'lucide-react'
import { PageHeader, Panel, Stat, StatStrip } from '@/components/page'
import { useApi } from '@/hooks'
import { fmtMW, fmtRs } from '@/lib/geo'
import { chartTooltip } from '@/lib/ui'
import { useLive } from '@/store/useLive'
import type { ForecastT } from './CommandCenter'

export function AnalysisPage() {
  const { data: fc } = useApi<ForecastT>('/forecast', { intervalMs: 15000 })
  const trend = useLive((s) => s.trend)
  const f = useLive((s) => s.frame)!
  const rows =
    fc?.blocks.map((b) => ({
      label: b.label,
      ace: b.ace.p50,
      aceBand: [b.ace.p10, b.ace.p90],
      demand: b.demand.p50,
      demandBand: [b.demand.p10, b.demand.p90],
      re: b.re.p50,
      reBand: [b.re.p10, b.re.p90],
      maxLine: b.max_line ? b.max_line.loading * 100 : null,
    })) ?? []
  const t = trend.slice(-360)
  const b1 = fc?.blocks[0]
  const mw = (v: number) => `${(v / 1000).toFixed(1)}k`
  const legend = { iconSize: 8, wrapperStyle: { fontSize: 10, paddingTop: 2 } } as const
  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader icon={<LineIcon className="size-4" />} title="Forecast & Analysis" />
      <StatStrip>
        <Stat
          label="ACE in 1 block (P50)"
          value={b1 ? fmtMW(b1.ace.p50) : '—'}
          sub={b1 ? `P10 ${fmtMW(b1.ace.p10)} · P90 ${fmtMW(b1.ace.p90)}` : undefined}
          tone={b1 && Math.abs(b1.ace.p50) > 100 ? 'warn' : 'good'}
        />
        <Stat label="Demand in 1 block (P50)" value={b1 ? fmtMW(b1.demand.p50) : '—'} sub={`now ${fmtMW(f.demand)}`} />
        <Stat label="Renewables in 1 block (P50)" value={b1 ? fmtMW(b1.re.p50) : '—'} sub={`now ${fmtMW(f.re)}`} />
        <Stat label="Predicted violations (2 h)" value={String(fc?.violations.length ?? 0)} tone={fc?.violations.length ? 'warn' : 'good'} />
        <Stat label="Forecast MAPE (1 block)" value={fc?.accuracy.mape_1block_pct != null ? `${fc.accuracy.mape_1block_pct}%` : '—'} sub={`${fc?.accuracy.samples ?? 0} samples`} />
        <Stat label="DSM exposure now" value={`${fmtRs(f.dsm_per_block_rs)}/block`} sub={`NR ₹${f.nr}/kWh`} tone={f.dsm_per_block_rs > 0 ? 'warn' : 'good'} />
      </StatStrip>
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
        <Panel title="ACE forecast — next 8 blocks (P50, P10–P90)" className="col-span-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={44} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <ReferenceLine y={100} stroke="#fcd34d" strokeDasharray="4 4" />
              <ReferenceLine y={-100} stroke="#fcd34d" strokeDasharray="4 4" />
              <RTooltip {...chartTooltip} />
              <Legend {...legend} />
              <Area dataKey="aceBand" stroke="none" fill="#c4b5fd66" isAnimationActive={false} name="P10–P90 band" />
              <Line dataKey="ace" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} name="ACE P50" />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Predicted violations — next 2 h">
          <div className="h-full space-y-1.5 overflow-hidden">
            {(fc?.violations ?? []).length === 0 ? (
              <div className="text-xs text-emerald-700">No predicted constraint or balance violations within 2 hours.</div>
            ) : (
              fc!.violations.slice(0, 8).map((v, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px]">
                  <Clock3 className="size-3.5 shrink-0 text-amber-600" />
                  <span className="w-12 font-mono text-amber-700">+{v.lead_min}m</span>
                  <span className="flex-1 truncate">{v.label}</span>
                  {v.loading && <span className="font-mono text-rose-600">{(v.loading * 100).toFixed(0)}%</span>}
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Demand & renewables forecast (MW)">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis
                yAxisId="d"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={44}
                domain={[(m: number) => Math.floor((m - 300) / 500) * 500, (m: number) => Math.ceil((m + 300) / 500) * 500]}
                tickFormatter={mw}
              />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} width={40} />
              <RTooltip {...chartTooltip} />
              <Legend {...legend} />
              <Area yAxisId="d" dataKey="demandBand" stroke="none" fill="#bae6fd88" isAnimationActive={false} legendType="none" />
              <Line yAxisId="d" dataKey="demand" name="Demand P50 (left)" stroke="#0284c7" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Area yAxisId="r" dataKey="reBand" stroke="none" fill="#d9f99d88" isAnimationActive={false} legendType="none" />
              <Line yAxisId="r" dataKey="re" name="Renewables P50 (right)" stroke="#65a30d" strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={`Recent behaviour — frequency & ACE (live, ${t.length} samples)`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={t}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40} />
              <YAxis yAxisId="f" domain={[49.75, 50.15]} tick={{ fontSize: 10, fill: '#94a3b8' }} width={40} />
              <YAxis yAxisId="a" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} width={40} />
              <ReferenceLine yAxisId="f" y={49.9} stroke="#fcd34d" strokeDasharray="3 3" />
              <RTooltip {...chartTooltip} />
              <Legend {...legend} />
              <Line yAxisId="f" dataKey="frequency" name="Frequency Hz (left)" stroke="#0ea5e9" dot={false} isAnimationActive={false} />
              <Line yAxisId="a" dataKey="ace" name="ACE MW (right)" stroke="#8b5cf6" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Drawal vs schedule & data confidence">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={t}>
              <CartesianGrid stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#94a3b8' }} minTickGap={40} />
              <YAxis
                yAxisId="d"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                width={44}
                domain={['dataMin - 200', 'dataMax + 200']}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`}
              />
              <YAxis yAxisId="c" orientation="right" domain={[0.6, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} width={34} />
              <RTooltip {...chartTooltip} formatter={(v, n) => (n === 'confidence' ? `${(Number(v) * 100).toFixed(0)}%` : fmtMW(Number(v)))} />
              <Legend {...legend} />
              <Line yAxisId="d" dataKey="drawal" name="Drawal" stroke="#f97316" dot={false} isAnimationActive={false} />
              <Line yAxisId="d" dataKey="schedule" name="Schedule" stroke="#94a3b8" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line yAxisId="c" dataKey="confidence" name="Data confidence (right)" stroke="#10b981" dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  )
}
