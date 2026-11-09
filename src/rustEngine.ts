import type { Analysis } from './types'

type WasmExports = {
  memory: WebAssembly.Memory
  prepare_input(size: number): number
  analyze_replay(): bigint
}

export async function loadRustEngine(base: string) {
  const url = new URL('engine/fortnite-replay.wasm', base)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`No se pudo cargar el motor Rust (HTTP ${response.status}).`)
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer())
  const wasm = instance.exports as unknown as WasmExports
  const decode = new TextDecoder()
  return (input: Uint8Array): Analysis => {
    const pointer = wasm.prepare_input(input.length)
    if (!pointer) throw new Error('El tamaño de la repetición supera el límite del motor.')
    new Uint8Array(wasm.memory.buffer, pointer >>> 0, input.length).set(input)
    const packed = wasm.analyze_replay()
    const start = Number(packed & 0xffff_ffffn)
    const size = Number(packed >> 32n)
    return JSON.parse(decode.decode(new Uint8Array(wasm.memory.buffer, start, size))) as Analysis
  }
}

