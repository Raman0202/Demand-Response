// Shared map-focus vocabulary (planned → sent → acked → delivering, or failed/excluded).
export type FocusStatus = 'planned' | 'sent' | 'acked' | 'delivering' | 'failed' | 'excluded'
export type Focus = Record<string, { mw: number; status: FocusStatus }>

export const STATUS_COLOR: Record<FocusStatus, string> = {
  planned: '#38bdf8',
  sent: '#f59e0b',
  acked: '#a3e635',
  delivering: '#22c55e',
  failed: '#ef4444',
  excluded: '#ef4444',
}
