import { useRef, useState } from 'react'
import { WorkerClient } from './imports'
import type { Translator } from './locales'
import type { Input, Result, Status, WorkerReply } from './types'

type Progress = { done: number; total: number; file: string; phase: 'scan' | 'parse'; active: number }
type Notice = string
  | { kind: 'batch'; done: number; duplicates: number; cancelled: boolean }
  | { kind: 'catalog'; records: number; icons: number }

export function formatNotice(notice: Exclude<Notice, string>, t: Translator) {
  if (notice.kind === 'catalog') return t('Catálogo local cargado · {records} registros · {icons} iconos.',
    { records: notice.records, icons: notice.icons })
  if (notice.cancelled) return t('Análisis cancelado. Se conservan los resultados de {count} archivos de este lote.', { count: notice.done })
  if (!notice.done) return t('Consulta Partidas para ver el resultado de la importación.')
  const complete = notice.done === 1 ? t('1 archivo procesado') : t('{count} archivos procesados', { count: notice.done })
  return notice.duplicates ? `${complete} · ${t('{count} duplicados excluidos', { count: notice.duplicates })}.` : `${complete}.`
}

type Task = Input & { entry?: number; sourceId?: string }
type Outcome = Exclude<WorkerReply, { entries: unknown }>
const base = new URL(import.meta.env.BASE_URL, window.location.href).href
export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
export const valid = (r: { status: Status }) => r.status === 'complete' || r.status === 'partial'

const isReport = (file: string) => /\.(csv|json)$/i.test(file)
 
function laneCount(files: number) {
  const cores = navigator.hardwareConcurrency || 2
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  const cap = memory === undefined || memory <= 4 ? 2 : 4
  return Math.min(files, cap, cores <= 2 ? cores : cores - 1)
}

export function useAnalysis() {
  const [results, setResults] = useState<Result[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [message, setMessage] = useState<Notice>('')
  const running = useRef<Set<WorkerClient> | null>(null)
  const cancelled = useRef(false)

  async function analyze(inputs: Input[]) {
    if (running.current) return
    if (!inputs.length) {
      setMessage('No se encontraron archivos .replay, ZIP, CSV o JSON. Para importar un RAR, extrae primero sus archivos.')
      return
    }
    setMessage('')
    setProgress({ done: 0, total: 0, file: '', phase: 'scan', active: 0 })
    const listing = new WorkerClient()
    const clients = new Set([listing])
    running.current = clients
    cancelled.current = false
    const hashes = new Set(results.filter(r => r.status !== 'error').flatMap(r => r.hash ? [r.hash] : []))
    const guids = new Set(results.filter(valid).flatMap(r => r.guid ? [r.guid.toLowerCase()] : []))
    const importKeys = new Set(results.filter(valid).flatMap(r => r.importKey ? [r.importKey] : []))
    const queued: Task[] = []
    const ready = new Map<number, Outcome>()
    const active = new Map<number, string>()
    let duplicates = 0
    let done = 0
    let cursor = 0
    let nextResult = 0
    const append = (result: Result) => setResults(old => [...old, result])
    const errorRow = (file: string, size: number, detail: string) =>
      append({ key: crypto.randomUUID(), file, size, detail, status: 'error', chests: [], items: [] })

    function commit(index: number, outcome: Outcome) {
      const input = queued[index]
      if ('error' in outcome) {
        errorRow(input.path, input.entry === undefined ? input.file.size : 0, outcome.error)
        return
      }
      if ('report' in outcome) {
        for (const match of outcome.report) {
          register({ ...match, key: crypto.randomUUID() })
        }
        return
      }
      const { result, hash, size } = outcome
      register({ ...result, key: crypto.randomUUID(), file: input.path, size, hash })
    }

    function register(entry: Result) {
      const guid = entry.guid?.toLowerCase()
      const copy = entry.hash && hashes.has(entry.hash) || entry.importKey && importKeys.has(entry.importKey)
      if (entry.status !== 'duplicate' && (copy || valid(entry) && guid && guids.has(guid))) {
        entry = { key: entry.key, file: entry.file, size: entry.size, source: entry.source, status: 'duplicate',
          detail: 'Esta partida ya está en el informe.', chests: [], items: [] }
      }
      if (entry.status !== 'error' && entry.hash) hashes.add(entry.hash)
      if (valid(entry) && guid) guids.add(guid)
      if (valid(entry) && entry.importKey) importKeys.add(entry.importKey)
      if (entry.status === 'duplicate') duplicates++
      append(entry)
    }

    function updateProgress() {
      if (cancelled.current) return
      setProgress({ done, total: queued.length, file: active.values().next().value ?? '', phase: 'parse', active: active.size })
    }

    async function work(client: WorkerClient) {
      while (!cancelled.current && cursor < queued.length) {
        const index = cursor++
        const input = queued[index]
        active.set(index, input.path)
        updateProgress()
        let outcome: Outcome
        try {
          const reply = await client.run(isReport(input.path) && input.entry === undefined
            ? { command: 'report', file: input.file }
            : { command: 'replay', file: input.file, entry: input.entry, sourceId: input.sourceId, knownHashes: [...hashes], base })
          outcome = 'entries' in reply ? { error: 'Respuesta inesperada del analizador.' } : reply
        } catch (error) {
          outcome = { error: errorText(error) }
        }
        active.delete(index)
        if (cancelled.current) return
        done++
        ready.set(index, outcome)
        // Dispatch in parallel, commit in input order so the original wins over any copies.
        while (ready.has(nextResult)) {
          commit(nextResult, ready.get(nextResult)!)
          ready.delete(nextResult++)
        }
        updateProgress()
      }
    }

    try {
      for (const input of inputs) {
        if (cancelled.current) break
        if (!/\.zip$/i.test(input.path)) { queued.push(input); continue }
        setProgress({ done: 0, total: 0, file: input.path, phase: 'scan', active: 1 })
        const sourceId = crypto.randomUUID()
        try {
          const reply = await listing.run({ command: 'list', file: input.file, sourceId })
          if (cancelled.current) break
          if ('error' in reply) throw new Error(reply.error)
          if (!('entries' in reply) || !reply.entries.length) throw new Error('El ZIP no contiene repeticiones.')
          for (const entry of reply.entries) queued.push({
            file: input.file, path: `${input.path} › ${entry.path}`, entry: entry.index, sourceId,
          })
        } catch (error) {
          if (!cancelled.current) errorRow(input.path, input.file.size, errorText(error))
        }
      }
      if (!cancelled.current && queued.length) {
        for (let i = 1; i < laneCount(queued.length); i++) clients.add(new WorkerClient())
        await Promise.all([...clients].map(work))
      }
      // A cancelled earlier file may have held already finished results behind it.
      for (const [index, outcome] of [...ready].sort(([a], [b]) => a - b)) commit(index, outcome)
    } finally {
      for (const client of clients) client.stop()
      running.current = null
      setProgress(null)
      setMessage({ kind: 'batch', done, duplicates, cancelled: cancelled.current })
    }
  }

  function cancel() {
    cancelled.current = true
    for (const client of running.current ?? []) client.stop()
  }
  return { results, progress, message, setMessage, analyze, cancel }
}


