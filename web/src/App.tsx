import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AdminPage } from '@/pages/AdminPage'
import { AlarmsPage } from '@/pages/AlarmsPage'
import { AnalysisPage } from '@/pages/AnalysisPage'
import { CommandCenter } from '@/pages/CommandCenter'
import { DecisionsPage } from '@/pages/DecisionsPage'
import { LoginPage } from '@/pages/LoginPage'
import { OperationsPage } from '@/pages/OperationsPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { ResourcesPage } from '@/pages/ResourcesPage'
import { WhatIfPage } from '@/pages/WhatIfPage'
import { useAuth } from '@/store/useAuth'
import { useLive } from '@/store/useLive'
import { useUI } from '@/store/useUI'

export default function App() {
  const token = useAuth((s) => s.token)
  return <TooltipProvider>{token ? <Shell token={token} /> : <LoginPage />}</TooltipProvider>
}

function Shell({ token }: { token: string }) {
  const page = useUI((s) => s.page)
  const ready = useLive((s) => s.topologyReady)
  const loadTopology = useLive((s) => s.loadTopology)
  const connect = useLive((s) => s.connect)
  const disconnect = useLive((s) => s.disconnect)

  useEffect(() => {
    loadTopology().catch(() => undefined)
    connect(token)
    return () => disconnect()
  }, [token, loadTopology, connect, disconnect])

  if (!ready)
    return (
      <div className="grid h-full place-items-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Connecting to KSFP control platform…
        </span>
      </div>
    )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopNav />
      <main key={page} className="min-h-0 flex-1 overflow-hidden p-3 animate-in fade-in duration-200">
        {page === 'command' && <CommandCenter />}
        {page === 'operations' && <OperationsPage />}
        {page === 'decisions' && <DecisionsPage />}
        {page === 'alarms' && <AlarmsPage />}
        {page === 'analysis' && <AnalysisPage />}
        {page === 'whatif' && <WhatIfPage />}
        {page === 'resources' && <ResourcesPage />}
        {page === 'reports' && <ReportsPage />}
        {page === 'admin' && <AdminPage />}
      </main>
    </div>
  )
}
