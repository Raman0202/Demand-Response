import { useMemo, useState } from 'react'
import { ScrollText, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FitPager } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHistoryStore, verifyChain, type AuditKind } from '@/store/useHistoryStore'

const KIND_VARIANT: Record<AuditKind, 'info' | 'warning' | 'success' | 'destructive' | 'secondary'> = {
  EVENT: 'warning',
  ANALYSIS: 'secondary',
  TWIN: 'info',
  APPROVAL: 'success',
  COMMAND: 'destructive',
  ACK: 'success',
  MV: 'info',
  SETTLEMENT: 'success',
  SYSTEM: 'secondary',
}

export function AuditPage() {
  const audit = useHistoryStore((s) => s.audit)
  const clear = useHistoryStore((s) => s.clear)
  const [kind, setKind] = useState<string>('ALL')
  const rows = useMemo(() => audit.filter((a) => kind === 'ALL' || a.kind === kind), [audit, kind])
  const intact = useMemo(() => verifyChain(audit), [audit])

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ScrollText className="size-5 text-sky-600" /> Audit Log
          </h1>
          <p className="text-xs text-muted-foreground">
            Append-only, hash-chained trail of every analysis, twin verdict, approval, command and acknowledgement (CEA Cyber Security Guidelines).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={intact ? 'success' : 'destructive'} className="gap-1">
            <ShieldCheck /> {intact ? 'chain verified' : 'chain BROKEN'} · {audit.length} entries
          </Badge>
          <Button variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="size-4" /> Clear demo data
          </Button>
        </div>
      </div>
      <Tabs value={kind} onValueChange={setKind} className="shrink-0">
        <TabsList>
          {['ALL', 'EVENT', 'ANALYSIS', 'TWIN', 'COMMAND', 'ACK', 'MV', 'SETTLEMENT'].map((k) => (
            <TabsTrigger key={k} value={k}>
              {k}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Card className="min-h-0 flex-1 py-2">
        <CardContent className="h-full px-2">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No entries yet — open an event in the Decision Center.</div>
          ) : (
            <FitPager
              items={rows}
              rowHeight={37}
              render={(slice) => (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sim time</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Hash</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slice.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-xs">{a.sim}</TableCell>
                        <TableCell>
                          <Badge variant={KIND_VARIANT[a.kind]}>{a.kind}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{a.eventId ?? '—'}</TableCell>
                        <TableCell className="text-xs">{a.actor}</TableCell>
                        <TableCell className="max-w-[560px] truncate text-xs">{a.message}</TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{a.hash}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
