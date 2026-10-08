import { Bar as RBar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Receipt } from 'lucide-react'
import { FitPager, Kpi } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtMW, fmtRs } from '@/lib/geo'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useUIStore } from '@/store/useUIStore'
import { chartTooltip } from '@/lib/ui'

export function SettlementPage() {
  const events = useHistoryStore((s) => s.events)
  const setPage = useUIStore((s) => s.setPage)
  const live = events.filter((e) => e.mode !== 'SHADOW')
  const sum = (f: (e: (typeof events)[number]) => number) => live.reduce((a, e) => a + f(e), 0)
  const data = [...events].reverse().map((e) => ({
    id: e.id.slice(-6),
    avoided: +(e.avoidedDsmRs / 1e5).toFixed(2),
    paid: +(e.paymentsRs / 1e5).toFixed(2),
  }))

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="shrink-0">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Receipt className="size-5 text-sky-600" /> Settlement & Performance
        </h1>
        <p className="text-xs text-muted-foreground">
          Allocated vs delivered, performance-based payments, avoided DSM and the learning loop that updates each resource&apos;s reliability.
        </p>
      </div>

      {events.length === 0 ? (
        <Card className="flex-1 justify-center">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Receipt className="size-10 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">No settled events yet. Run an event through the Decision Center and close it to see settlement here.</div>
            <Button onClick={() => setPage('scenario')}>Open Scenario Lab</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid shrink-0 grid-cols-5 gap-2">
            <Kpi label="Events settled" value={events.length} sub={`${events.length - live.length} shadow`} />
            <Kpi
              label="Energy-weighted delivery"
              value={`${(
                (sum((e) => e.deliveredMW) /
                  Math.max(
                    1,
                    sum((e) => e.allocatedMW),
                  )) *
                100
              ).toFixed(0)}%`}
            />
            <Kpi label="DSM avoided" value={fmtRs(sum((e) => e.avoidedDsmRs))} tone="good" />
            <Kpi label="Payments to resources" value={fmtRs(sum((e) => e.paymentsRs))} />
            <Kpi label="Net benefit" value={fmtRs(sum((e) => e.netBenefitRs))} tone={sum((e) => e.netBenefitRs) >= 0 ? 'good' : 'warn'} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3">
            <Card className="min-h-0 gap-2">
              <CardHeader>
                <CardTitle className="text-sm">Avoided DSM vs payments per event (₹ lakh)</CardTitle>
              </CardHeader>
              <CardContent className="min-h-0 flex-1">
                <div className="h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                      <CartesianGrid stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="id" tick={{ fontSize: 10, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} width={40} />
                      <RTooltip {...chartTooltip} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <RBar dataKey="avoided" name="DSM avoided" fill="#86efac" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      <RBar dataKey="paid" name="Paid to resources" fill="#7dd3fc" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-0 py-2">
              <CardContent className="h-full px-2">
                <FitPager
                  items={events}
                  rowHeight={45}
                  render={(slice) => (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Event</TableHead>
                          <TableHead>Scenario</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Mode</TableHead>
                          <TableHead className="text-right">Requirement</TableHead>
                          <TableHead className="text-right">Delivered</TableHead>
                          <TableHead className="text-right">DSM if idle</TableHead>
                          <TableHead className="text-right">Paid</TableHead>
                          <TableHead className="text-right">Net benefit</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {slice.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell className="font-mono text-xs">
                              {e.id}
                              <span className="block text-[10px] text-muted-foreground">
                                {e.openedAt}–{e.closedAt}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs">{e.scenario}</TableCell>
                            <TableCell>
                              <Badge variant={e.severity === 'EMERGENCY' ? 'destructive' : e.severity === 'ALERT' ? 'warning' : 'success'}>{e.severity}</Badge>
                            </TableCell>
                            <TableCell className="text-xs">{e.mode}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {fmtMW(e.requirementMW)} {e.direction}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmtMW(e.deliveredMW)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmtRs(e.doNothingRs)}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{fmtRs(e.paymentsRs)}</TableCell>
                            <TableCell className={`text-right font-mono text-xs ${e.netBenefitRs >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{fmtRs(e.netBenefitRs)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
