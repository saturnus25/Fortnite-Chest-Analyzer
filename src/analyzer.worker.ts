import { ecb } from '@noble/ciphers/aes.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { BlobReader, ZipReader, configure } from '@zip.js/zip.js'
import type { FileEntry } from '@zip.js/zip.js'
import type { Analysis, Job, WorkerReply, ZipEntry } from './types'
import { loadRustEngine } from './rustEngine'
import { importReport } from './reportImport'

const MAX_FILE = 128 * 1024 ** 2
const MAX_ZIP = 8 * 1024 ** 3
const MAX_ENTRIES = 10000
configure({ useWebWorkers: false })

type Engine = {
  getConfig(): { mainAssemblyName: string }
  setModuleImports(name: string, imports: Record<string, unknown>): void
  getAssemblyExports(name: string): Promise<{ ReplayAnalyzer: { Program: { Analyze(bytes: Uint8Array): string } } }>
}
let rust: ReturnType<typeof loadRustEngine> | undefined
let legacy: Promise<(bytes: Uint8Array) => string> | undefined
let archive: { sourceId: string; reader: ZipReader<Blob>; entries: FileEntry[] } | undefined

async function loadLegacyEngine(base: string) {
  const url = new URL('engine/dotnet.js', base).href
  const { dotnet } = await import(/* @vite-ignore */ url) as { dotnet: { create(): Promise<Engine> } }
  const runtime = await dotnet.create()
  runtime.setModuleImports('replayCrypto', {
    accountKey: (id: string) => bytesToHex(sha256(utf8ToBytes(id))),
    decrypt: (key: Uint8Array, data: Uint8Array) => ecb(key).decrypt(data),
  })
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)
  return exports.ReplayAnalyzer.Program.Analyze
}

async function list(file: File, sourceId: string): Promise<ZipEntry[]> {
  if (file.size > MAX_ZIP) throw new Error('El ZIP supera el límite de 8 GiB.')
  await archive?.reader.close()
  archive = undefined
  const reader = new ZipReader(new BlobReader(file))
  const entries: FileEntry[] = []
  try {
    let scanned = 0
    for await (const entry of reader.getEntriesGenerator()) {
      if (++scanned > MAX_ENTRIES) throw new Error('El ZIP tiene más de 10.000 entradas.')
      if (!entry.directory && /\.replay$/i.test(entry.filename)) entries.push(entry)
    }
  } catch (error) {
    await reader.close()
    throw error
  }
  archive = { sourceId, reader, entries }
  return entries.map((entry, index) => ({ index, path: entry.filename }))
}

async function read(job: Extract<Job, { command: 'replay' }>) {
  if (job.entry === undefined) {
    if (job.file.size > MAX_FILE) throw new Error('La repetición supera el límite de 128 MiB.')
    return new Uint8Array(await job.file.arrayBuffer())
  }

  if (!archive || archive.sourceId !== job.sourceId) await list(job.file, job.sourceId!)
  const entry = archive?.entries[job.entry]
  if (!entry || entry.encrypted || entry.uncompressedSize > MAX_FILE)
    throw new Error('Entrada de ZIP inválida, cifrada o superior a 128 MiB.')
  const bytes = new Uint8Array(entry.uncompressedSize)
  let offset = 0
  await entry.getData(new WritableStream<Uint8Array>({
    write(chunk) {
      if (offset + chunk.length > bytes.length) throw new Error('La entrada de ZIP supera el tamaño declarado.')
      bytes.set(chunk, offset)
      offset += chunk.length
    },
  }), { checkSignature: true })
  if (offset !== bytes.length) throw new Error('El tamaño real de la entrada de ZIP no coincide.')
  return bytes
}

async function process(job: Job): Promise<WorkerReply> {
  if (job.command === 'report') return { report: await importReport(job.file) }
  if (job.command === 'list') return { entries: await list(job.file, job.sourceId) }
  const bytes = await read(job)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (job.knownHashes.includes(hash)) return {
    hash, size: bytes.length, result: { status: 'duplicate', detail: 'Copia idéntica de una repetición ya importada.', chests: [], items: [] },
  }
  rust ??= loadRustEngine(job.base).catch(error => {
    rust = undefined
    throw error
  })
  let result: Analysis
  try {
    result = (await rust)(bytes)
  } catch (error) {
    // A trap invalidates this Wasm instance. The worker can take the next file with a new instance.
    rust = undefined
    if (error instanceof WebAssembly.RuntimeError) throw new Error('El motor Rust detuvo la lectura de esta repetición.')
    throw error
  }
  if (result.legacyRequired) {
    legacy ??= loadLegacyEngine(job.base).catch(error => {
      legacy = undefined
      throw error
    })
    result = JSON.parse((await legacy)(bytes)) as Analysis
    result.engine = 'legacy'
  } else {
    result.engine = 'rust'
  }
  return { result, hash, size: bytes.length }
}

// Mono uses onmessage to detect its own pthread workers. Keep our listener separate.
self.addEventListener("message", async (event: MessageEvent<Job>) => {
  try {
    self.postMessage(await process(event.data))
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies WorkerReply)
  }
})



