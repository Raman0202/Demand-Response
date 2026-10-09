// Replays a DR event on the map: who had a setpoint, whether it was sent / acknowledged / delivering, at any moment.
import { useMemo } from 'react'
import type { Focus, FocusStatus } from '@/components/three/focus'
import type { WaveTarget, DispatchPhase } from '@/components/three/Effects'
import type { MapOverlay } from '@/components/three/TerritoryMap'
import { ASSET_BY_ID } from '@/data/topology'
import type { Command, DecisionSummary } from '@/data/types'
import { useApi } from '@/hooks'
import { useLive } from '@/store/useLive'

export interface TimelinePoint {
  t: number
  target: number
  dispatched: number
  expected: number
  delivered: number
  ace: number
}

export interface EventDetail extends DecisionSummary {
  timeline?: TimelinePoint[]
  commands: (Command & { history?: [number, string][]; closed_at?: number | null })[]
  narrative: Record<string, unknown>
  current?: { allocations?: { id: string; short: string; mw: number; type: string }[]; plan?: { bindings?: { line?: string; label: string }[] } }
  approval_history: { user: string; role: string; ts: number; mw: number; revision: number }[]
}

export interface Marker {
  t: number
  kind: 'open' | 'approval' | 'dispatch' | 'release' | 'failed' | 'close'
  label: string
}

export interface Playback {
  detail: EventDetail | null
  start: number
  end: number
  /** effective time shown (playhead clamped into range, or live end) */
  at: number
  live: boolean
  point: TimelinePoint | null
  markers: Marker[]
  overlay: MapOverlay
  participants: string[]
  activeCount: number
}

function stateAt(c: EventDetail['commands'][number], t: number): string | null {
  if (c.created > t) return null
  let st = 'PENDING'
  for (const [ts, s] of c.history ?? []) if (ts <= t) st = s
  if (!c.history?.length) {
    if (c.acked_at && c.acked_at <= t) st = 'ACKED'
    else if (c.sent_at && c.sent_at <= t) st = 'SENT'
  }
  return st
}

export function useEventPlayback(id: string | null, playhead: number | null): Playback {
  const { data } = useApi<EventDetail>(id ? `/decisions/${id}` : null, { intervalMs: 4000 })
  const now = useLive((s) => s.frame?.ts ?? Date.now() / 1000)
  const detail = data && data.id === id ? data : null

  return useMemo(() => {
    const empty: Playback = { detail: null, start: now - 1, end: now, at: now, live: true, point: null, markers: [], overlay: {}, participants: [], activeCount: 0 }
    if (!detail) return empty
    const start = detail.opened_at
    const end = Math.max(start + 1, detail.closed_at ?? now)
    const live = playhead == null || playhead >= end - 0.5
    const at = live ? end : Math.max(start, Math.min(end, playhead))

    // aggregate curve at the playhead
    const tl = detail.timeline ?? []
    let point: TimelinePoint | null = null
    for (const p of tl) if (p.t <= at) point = p
    point ??= tl[0] ?? null

    // per-participant status at the playhead: the latest dispatch/release command that existed then
    const latest = new Map<string, EventDetail['commands'][number]>()
    for (const c of [...detail.commands].sort((a, b) => a.created - b.created)) {
      if (c.asset_id === 'RTM' || c.created > at) continue
      latest.set(c.asset_id, c)
    }
    const focus: Focus = {}
    const recent: WaveTarget[] = []
    let sending = false
    const window = Math.max(45, (end - start) * 0.035)
    for (const [aid, c] of latest) {
      const st = stateAt(c, at)
      if (!st) continue
      const released = c.kind === 'RELEASE' || c.setpoint <= 0.5
      let status: FocusStatus | null = null
      if (st === 'FAILED') status = 'failed'
      else if (released) status = null
      else if (st === 'ACKED' || st === 'EXECUTING' || st === 'COMPLETED') status = 'delivering'
      else if (st === 'SENT') status = 'sent'
      else if (st === 'PENDING' || st === 'AWAITING_APPROVAL' || st === 'READY') status = 'planned'
      if (status) focus[aid] = { mw: c.setpoint, status }
      const a = ASSET_BY_ID[aid]
      const sentAt = c.sent_at ?? c.created
      if (a && sentAt <= at && at - sentAt <= window) {
        recent.push({ id: aid, lon: a.lon, lat: a.lat, ok: st !== 'FAILED' })
        if (st === 'SENT') sending = true
      }
    }
    // when nothing was sent recently, keep faint links to everyone delivering so the dispatch tree stays visible
    const targets: WaveTarget[] = recent.length
      ? recent
      : Object.entries(focus)
          .filter(([, f]) => f.status === 'delivering' || f.status === 'failed')
          .map(([aid, f]) => ({ id: aid, lon: ASSET_BY_ID[aid]?.lon ?? 0, lat: ASSET_BY_ID[aid]?.lat ?? 0, ok: f.status !== 'failed' }))
          .filter((t) => ASSET_BY_ID[t.id])
    const phase: DispatchPhase = !targets.length ? 'idle' : sending ? 'sending' : recent.length ? 'acking' : 'done'

    const markers: Marker[] = [{ t: start, kind: 'open', label: 'Event opened' }]
    for (const a of detail.approval_history ?? []) markers.push({ t: a.ts, kind: 'approval', label: `Approved by ${a.user}` })
    // collapse command batches into one marker per send burst
    let lastBurst = -Infinity
    for (const c of [...detail.commands].sort((a, b) => (a.sent_at ?? a.created) - (b.sent_at ?? b.created))) {
      const t = c.sent_at ?? c.created
      if (c.state === 'FAILED') markers.push({ t: c.closed_at ?? t, kind: 'failed', label: `No ack: ${c.asset_name}` })
      if (t - lastBurst > window) {
        markers.push({ t, kind: c.kind === 'RELEASE' ? 'release' : 'dispatch', label: c.kind === 'RELEASE' ? 'Release sent' : 'Dispatch sent' })
        lastBurst = t
      }
    }
    if (detail.closed_at) markers.push({ t: detail.closed_at, kind: 'close', label: detail.closed_reason || 'Event closed' })

    const bindingLines = (detail.current?.plan?.bindings ?? []).map((b) => b.line).filter((x): x is string => !!x)
    const participants = [...new Set([...(detail.current?.allocations ?? []).map((a) => a.id), ...detail.commands.map((c) => c.asset_id)])].filter((x) => x !== 'RTM')
    return {
      detail,
      start,
      end,
      at,
      live,
      point,
      markers,
      overlay: { focus, wave: { targets, phase }, highlightLines: bindingLines },
      participants,
      activeCount: Object.values(focus).filter((f) => f.status !== 'failed').length,
    }
  }, [detail, playhead, now])
}
