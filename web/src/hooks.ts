import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useLive } from '@/store/useLive'

/** Fetch a REST resource and refresh it on live events (decision/alarm/command changes) and on an interval. */
export function useApi<T>(path: string | null, opts: { live?: boolean; intervalMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rev = useLive((s) => s.rev)
  const pathRef = useRef(path)
  pathRef.current = path
  const load = useCallback(async () => {
    if (!pathRef.current) return
    try {
      const d = await api<T>(pathRef.current)
      setData(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [path, load])
  useEffect(() => {
    if (opts.live !== false) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev])
  useEffect(() => {
    if (!opts.intervalMs) return
    const id = setInterval(load, opts.intervalMs)
    return () => clearInterval(id)
  }, [opts.intervalMs, load])
  return { data, error, reload: load }
}
