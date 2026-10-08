// Persistent audit trail, event history and learned reliability (localStorage).
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { OperatingMode, Severity } from '@/engine/types'

export type AuditKind = 'EVENT' | 'ANALYSIS' | 'TWIN' | 'APPROVAL' | 'COMMAND' | 'ACK' | 'MV' | 'SETTLEMENT' | 'SYSTEM'

export interface AuditEntry {
  id: string
  at: string // ISO wall-clock
  sim: string // sim clock
  eventId?: string
  kind: AuditKind
  actor: string
  message: string
  prev: string
  hash: string
}

export interface EventRecord {
  id: string
  openedAt: string
  closedAt: string
  scenario: string
  severity: Severity
  direction: 'UP' | 'DOWN'
  requirementMW: number
  allocatedMW: number
  deliveredMW: number
  doNothingRs: number
  paymentsRs: number
  avoidedDsmRs: number
  netBenefitRs: number
  mode: OperatingMode
  assets: number
}

interface HistoryState {
  audit: AuditEntry[]
  events: EventRecord[]
  learned: Record<string, number>
  log: (e: Omit<AuditEntry, 'id' | 'at' | 'hash' | 'prev'>) => void
  addEvent: (e: EventRecord) => void
  learn: (r: Record<string, number>) => void
  clear: () => void
}

// chained digest so tampering with an earlier entry breaks every later hash (immutable-log demo)
export function digest(prev: string, msg: string) {
  let h = 2166136261
  const s = prev + '|' + msg
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Recompute the chain oldest → newest; returns false if any entry was altered. */
export function verifyChain(audit: AuditEntry[]) {
  let prev = '00000000'
  for (let i = audit.length - 1; i >= 0; i--) {
    const e = audit[i]
    if (i === audit.length - 1) prev = e.prev // oldest retained entry anchors the chain
    if (e.prev !== prev || digest(prev, `${e.kind}:${e.message}`) !== e.hash) return false
    prev = e.hash
  }
  return true
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      audit: [],
      events: [],
      learned: {},
      log: (e) =>
        set((st) => {
          const prev = st.audit[0]?.hash ?? '00000000'
          const entry: AuditEntry = {
            ...e,
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            prev,
            hash: digest(prev, `${e.kind}:${e.message}`),
          }
          return { audit: [entry, ...st.audit].slice(0, 500) }
        }),
      addEvent: (e) => set((st) => ({ events: [e, ...st.events].slice(0, 100) })),
      learn: (r) => set((st) => ({ learned: { ...st.learned, ...r } })),
      clear: () => set({ audit: [], events: [], learned: {} }),
    }),
    { name: 'ksfp-history', storage: createJSONStorage(() => localStorage) },
  ),
)
