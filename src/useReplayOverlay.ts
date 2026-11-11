import { useEffect, useRef, useState } from 'react'
import { compactOverlayResult, overlayStats } from './overlayStats'
import type { Result } from './types'
import { useAnalysis, valid } from './useAnalysis'

const route = '/__fortnite_chest_analyzer/overlay'
const headers = { 'X-Fortnite-Chest-Analyzer': 'overlay' }
type Batch = {
  generation: number; found: number; failed: boolean; waiting: number; startedAt: number; removed: string[]
  files: { id: string; path: string; size: number; writtenAt: number }[]
}

function counters(batch: Batch, results: Result[], present: Set<string>) {
  const latestByPath = new Map(results.filter(result => present.has(result.file.toLowerCase())).map(result => [result.file.toLowerCase(), result]))
  const current = [...latestByPath.values()]
  return {
    generation: batch.generation, found: batch.found, ...overlayStats(results, batch.startedAt),
    unread: batch.failed ? -1 : current.filter(result => !result.live && !valid(result) && result.status !== 'duplicate').length,
    live: current.filter(result => result.live).length + batch.waiting,
    copies: current.filter(result => result.status === 'duplicate').length,
  }
}

export function useReplayOverlay(language: string, onError: (message: string) => void, embeddedClient?: string) {
  const [available, setAvailable] = useState(false)
  const [active, setActive] = useState(false)
  const client = useRef<string | undefined>(embeddedClient)
  const session = useRef<AbortController | undefined>(undefined)
  const { analyze, cancel } = useAnalysis()

  function request(action: string, extra: Record<string, string> = {}, options: RequestInit = {}) {
    const params = new URLSearchParams({ action, client: client.current!, ...extra })
    return fetch(`${route}?${params}`, { ...options, method: 'POST', headers, cache: 'no-store' })
  }

  useEffect(() => {
    if (location.hostname !== '127.0.0.1') return
    const controller = new AbortController()
    void fetch(route, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      .then(response => setAvailable(response.status === 204 && response.headers.get('X-Fortnite-Chest-Analyzer') === 'overlay-worker'))
      .catch(() => { /* The static web build has no Windows overlay. */ })
    function leave() {
      if (session.current) void request('close', {}, { keepalive: true }).catch(() => {})
      session.current?.abort()
    }
    addEventListener('pagehide', leave)
    return () => {
      controller.abort()
      removeEventListener('pagehide', leave)
      leave()
    }
  }, [])

  async function watch(controller: AbortController) {
    const { signal } = controller
    let generation: number | undefined
    let results: Result[] = []
    const present = new Set<string>()
    while (!signal.aborted) {
      const response = await request('next', {}, { signal })
      if (response.status === 410) break
      if (response.status === 204) continue
      if (!response.ok) throw new Error('Overlay feed failed')
      const batch = await response.json() as Batch
      const first = generation === undefined
      const changedFolder = generation !== batch.generation
      generation = batch.generation
      if (changedFolder) present.clear()
      for (const path of batch.removed) present.delete(`${batch.generation}/${path.toLowerCase()}`)
      const inputs = batch.files.map(file => ({
        path: `${batch.generation}/${file.path}`, size: file.size, modifiedAt: file.writtenAt,
        load: async () => {
          if (file.size > 128 * 1024 ** 2) throw new Error('La repetición supera el límite de 128 MiB.')
          const response = await request('file', { id: file.id, generation: String(batch.generation) }, { signal })
          if (!response.ok) throw new Error('El archivo cambió antes de que terminara la lectura.')
          return new File([await response.blob()], file.path)
        },
      }))
      for (const input of inputs) present.add(input.path.toLowerCase())
      const before = counters(batch, results, present)
      const progress = (pending: number) =>
        request('update', { data: JSON.stringify({ ...before, pending }) }, { signal })
      let progressUpdate: Promise<unknown> = inputs.length ? progress(inputs.length).catch(() => {}) : Promise.resolve()
      if (inputs.length || first) results = await analyze(inputs, {
        reset: first, maxWorkers: changedFolder ? 2 : 1, completedOnly: true, compact: compactOverlayResult,
        onProgress: done => {
          if (done % 4 !== 0 || done === inputs.length) return
          progressUpdate = progressUpdate.then(() => progress(inputs.length - done)).catch(() => {})
        },
      }) ?? []
      await progressUpdate
      if (signal.aborted) break
      const updated = await request('update', { data: JSON.stringify(counters(batch, results, present)) }, { signal })
      if (updated.status === 410) break
      if (!updated.ok) throw new Error('Overlay update failed')
    }
  }

  async function open() {
    client.current ??= crypto.randomUUID()
    try {
      if (!embeddedClient) {
        const response = await request('open', { language })
        if (response.status === 409) {
          onError('El overlay ya está abierto en otra pestaña.')
          return
        }
        if (!response.ok) throw new Error('Overlay request failed')
      }
      if (session.current) return
      const controller = session.current = new AbortController()
      setActive(true)
      void watch(controller).catch(() => {
        if (!controller.signal.aborted) onError('Se interrumpió la conexión con el overlay.')
      }).finally(() => {
        session.current = undefined
        setActive(false)
      })
    } catch {
      onError('No se pudo abrir el overlay.')
    }
  }

  async function close() {
    try {
      await request('close')
      session.current?.abort()
      cancel()
    } catch {
      onError('Se interrumpió la conexión con el overlay.')
    }
  }

  return { available, active, open, close }
}
