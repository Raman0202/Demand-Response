// DR notifications: turns the raw live event stream into the few moments an operator must notice
// (new event, approval needed, dispatch started/failed, settled, critical alarm). Inbox + transient toasts.
import { create } from 'zustand'
import type { Alarm, DecisionSummary } from '@/data/types'
import { api } from '@/lib/api'
import { fmtMW, fmtRs } from '@/lib/geo'

export type NotifyKind = 'event' | 'approval' | 'dispatch' | 'failure' | 'settled' | 'closed' | 'alarm'

export interface Notice {
  id: string
  ts: number
  kind: NotifyKind
  tone: 'info' | 'warn' | 'bad' | 'good'
  title: string
  body: string
  decisionId?: string
  read: boolean
  /** toast stays until dismissed (operator action required) */
  sticky?: boolean
}

interface NotifyState {
  items: Notice[]
  toasts: Notice[]
  known: Record<string, string> // decision id → last state seen
  seeded: boolean
  seed: () => Promise<void>
  onDecision: (d: DecisionSummary) => void
  onCommandFailed: (c: { asset_name: string; note?: string; decision_id?: string }) => void
  onAlarm: (a: Alarm) => void
  dismiss: (id: string) => void
  markAllRead: () => void
  markRead: (id: string) => void
}

const MAX = 80

const approvalBody = (d: DecisionSummary) =>
  `${fmtMW(d.awaiting_mw)} awaiting approval${d.needs_dual ? ' (dual authorisation)' : ''} for ${fmtMW(d.requirement_mw)} ${d.direction === 'UP' ? 'load reduction' : 'load increase'}.`
let n = 0

function push(set: (fn: (s: NotifyState) => Partial<NotifyState>) => void, x: Omit<Notice, 'id' | 'ts' | 'read'>) {
  const notice: Notice = { ...x, id: `n${Date.now()}-${n++}`, ts: Date.now(), read: false }
  set((s) => ({
    items: [notice, ...s.items].slice(0, MAX),
    // one toast per decision at a time: a newer state replaces the older toast
    toasts: [notice, ...s.toasts.filter((t) => !(x.decisionId && t.decisionId === x.decisionId))].slice(0, 4),
  }))
  if (!x.sticky) setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== notice.id) })), 7000)
}

export const useNotify = create<NotifyState>((set, get) => ({
  items: [],
  toasts: [],
  known: {},
  seeded: false,

  // learn existing events silently so a page load doesn't replay history; surface only what needs action now
  seed: async () => {
    if (get().seeded) return
    try {
      const { items } = await api<{ items: DecisionSummary[] }>('/decisions?limit=60')
      const known: Record<string, string> = {}
      const waiting = items.filter((d) => d.state === 'AWAITING_APPROVAL')
      for (const d of items) if (d.state !== 'AWAITING_APPROVAL') known[d.id] = d.state
      set({ known, seeded: true })
      waiting.forEach((d) => get().onDecision(d))
    } catch {
      set({ seeded: true })
    }
  },

  onDecision: (d) => {
    const prev = get().known[d.id]
    if (!get().seeded) {
      // stream raced ahead of the initial load: just remember the state
      set((s) => ({ known: { ...s.known, [d.id]: d.state } }))
      return
    }
    if (prev === d.state) {
      // the plan is revised every block: keep an open approval notice in step with the latest MW figures
      if (d.state === 'AWAITING_APPROVAL') {
        const body = approvalBody(d)
        const upd = (x: Notice) => (x.decisionId === d.id && x.kind === 'approval' ? { ...x, body } : x)
        set((s) => ({ items: s.items.map(upd), toasts: s.toasts.map(upd) }))
      }
      return
    }
    set((s) => ({ known: { ...s.known, [d.id]: d.state } }))
    const need = `${fmtMW(d.requirement_mw)} ${d.direction === 'UP' ? 'load reduction' : 'load increase'}`
    if (!prev && d.state !== 'AWAITING_APPROVAL')
      push(set, { kind: 'event', tone: 'info', title: `New DR event ${d.id}`, body: `${need} needed (${d.severity}). Plan ${fmtMW(d.planned_mw)}.`, decisionId: d.id })
    switch (d.state) {
      case 'AWAITING_APPROVAL':
        push(set, {
          kind: 'approval',
          tone: 'warn',
          title: `Approval needed · ${d.id}`,
          body: approvalBody(d),
          decisionId: d.id,
          sticky: true,
        })
        break
      case 'EXECUTING':
        push(set, {
          kind: 'dispatch',
          tone: 'info',
          title: `Dispatching · ${d.id}`,
          body: `${fmtMW(d.planned_mw)} released to participants${d.approvals.length ? ` (approved by ${d.approvals.map((a) => a.user).join(', ')})` : ' automatically'}.`,
          decisionId: d.id,
        })
        break
      case 'COMPLETED':
        push(set, {
          kind: 'settled',
          tone: 'good',
          title: `Event settled · ${d.id}`,
          body: d.net_benefit_rs != null ? `Net benefit ${fmtRs(d.net_benefit_rs)}. ${d.closed_reason}` : d.closed_reason || 'Resources released.',
          decisionId: d.id,
        })
        break
      case 'REJECTED':
      case 'ABORTED':
        push(set, { kind: 'closed', tone: 'bad', title: `Event ${d.state.toLowerCase()} · ${d.id}`, body: d.closed_reason || 'Closed by operator.', decisionId: d.id })
        break
    }
  },

  onCommandFailed: (c) =>
    push(set, {
      kind: 'failure',
      tone: 'bad',
      title: `Dispatch failed · ${c.asset_name}`,
      body: c.note || 'No acknowledgement from the participant gateway.',
      decisionId: c.decision_id,
    }),

  onAlarm: (a) => {
    if (a.priority !== 1) return
    push(set, { kind: 'alarm', tone: 'bad', title: `Critical alarm: ${a.title}`, body: a.detail })
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id), items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)) })),
  markRead: (id) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)) })),
  markAllRead: () => set((s) => ({ items: s.items.map((x) => ({ ...x, read: true })), toasts: [] })),
}))
