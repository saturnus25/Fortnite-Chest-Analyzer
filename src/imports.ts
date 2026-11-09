import type { Input, Job, WorkerReply } from './types'

type Directory = { name: string; values(): AsyncIterable<Directory | FileHandle> }
type FileHandle = { name: string; getFile(): Promise<File> }
export const isImport = (name: string) => /\.(replay|zip|json|csv)$/i.test(name)

export function directoryPicker() {
  const picker = (window as Window & { showDirectoryPicker?: (opts: { mode: 'read' }) => Promise<Directory> }).showDirectoryPicker
  return picker?.call(window, { mode: 'read' })
}

export async function walk(directory: Directory, prefix = directory.name): Promise<Input[]> {
  const found: Input[] = []
  async function visit(current: Directory, path: string) {
    for await (const handle of current.values()) {
      const child = `${path}/${handle.name}`
      if ('values' in handle) await visit(handle, child)
      else if (isImport(handle.name)) found.push({ file: await handle.getFile(), path: child })
    }
  }
  await visit(directory, prefix)
  return found
}

export class WorkerClient {
  private worker?: Worker
  private pending?: (error: Error) => void
  private cancelled = false

  run(job: Job): Promise<WorkerReply> {
    if (this.cancelled) return Promise.reject(new Error('Análisis cancelado.'))
    const worker = this.worker ??= new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' })
    return new Promise((resolve, reject) => {
      const clear = () => {
        clearTimeout(timeout)
        this.pending = undefined
        worker.onmessage = null
        worker.onerror = null
      }
      const fail = (error: Error) => {
        clear()
        worker.terminate()
        this.worker = undefined
        reject(error)
      }
      const timeout = window.setTimeout(() => fail(new Error('Se alcanzó el tiempo máximo por archivo.')), 160_000)
      this.pending = fail
      worker.onmessage = (event: MessageEvent<WorkerReply>) => { clear(); resolve(event.data) }
      worker.onerror = () => fail(new Error('El motor se detuvo al procesar este archivo.'))
      worker.postMessage(job)
    })
  }

  stop() {
    this.cancelled = true
    this.pending?.(new Error('Análisis cancelado.'))
    this.worker?.terminate()
    this.worker = undefined
  }
}


