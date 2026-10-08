import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LifecycleRail } from '@/components/layout/LifecycleRail'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { AuditPage } from '@/pages/AuditPage'
import { DecisionPage } from '@/pages/DecisionPage'
import { FlexibilityPage } from '@/pages/FlexibilityPage'
import { MonitorPage } from '@/pages/MonitorPage'
import { ScenarioPage } from '@/pages/ScenarioPage'
import { SettlementPage } from '@/pages/SettlementPage'
import { useGridStore } from '@/store/useGridStore'
import { useUIStore } from '@/store/useUIStore'

export default function App() {
  const page = useUIStore((s) => s.page)
  const tick = useGridStore((s) => s.tick)

  useEffect(() => {
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [tick])

  return (
    <TooltipProvider>
      <div className="flex h-full overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <LifecycleRail />
          <main key={page} className="min-h-0 flex-1 overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-300">
            {page === 'monitor' && <MonitorPage />}
            {page === 'decision' && <DecisionPage />}
            {page === 'scenario' && <ScenarioPage />}
            {page === 'flexibility' && <FlexibilityPage />}
            {page === 'settlement' && <SettlementPage />}
            {page === 'audit' && <AuditPage />}
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
