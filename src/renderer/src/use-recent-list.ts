import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecentList<T> {
  items: T[]
  loading: boolean
  error: string
  reload(): void
}

// `load` and `subscribe` must be stable references, such as module-level functions.
export function useRecentList<T>(load: () => Promise<T[]>, subscribe: (callback: (items: T[]) => void) => () => void, failure: string): RecentList<T> {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const request = useRef(0)

  const reload = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    setError('')
    try {
      const next = await load()
      if (current === request.current) setItems(next)
    } catch {
      if (current === request.current) setError(failure)
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [load, failure])

  useEffect(() => {
    const unsubscribe = subscribe((next) => {
      request.current++
      setItems(next)
      setLoading(false)
      setError('')
    })
    void reload()
    return () => { request.current++; unsubscribe() }
  }, [reload, subscribe])

  return { items, loading, error, reload: () => { void reload() } }
}
