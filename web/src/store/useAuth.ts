import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { User } from '@/data/types'

interface AuthState {
  token: string | null
  user: User | null
  notice: string | null
  login: (username: string, password: string) => Promise<void>
  logout: (notice?: string) => void
  can: (perm: string) => boolean
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      notice: null,
      login: async (username, password) => {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        })
        if (!res.ok) throw new Error(res.status === 401 ? 'Invalid username or password' : `Sign-in failed (${res.status})`)
        const j = await res.json()
        set({ token: j.token, user: j.user, notice: null })
      },
      logout: (notice) => set({ token: null, user: null, notice: notice ?? null }),
      can: (perm) => !!get().user?.permissions.includes(perm),
    }),
    { name: 'ksfp-auth', storage: createJSONStorage(() => sessionStorage), partialize: (s) => ({ token: s.token, user: s.user }) },
  ),
)
