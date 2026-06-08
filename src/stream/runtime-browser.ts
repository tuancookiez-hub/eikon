import { parseLaunchStream, type ParsedLaunchStream } from "./parse"
import {
  DEFAULT_RUNTIME_MAX_DECODED_BYTES,
  assertBytes,
  assertDecoded,
  runtimeEncoding,
  runtimeError,
  textBytes,
  utf8,
  type RuntimeOptions,
} from "./runtime"

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const out = await globalThis.crypto.subtle.digest("SHA-256", buffer(bytes))
  return `sha256:${[...new Uint8Array(out)].map(n => n.toString(16).padStart(2, "0")).join("")}`
}

async function assertDigest(bytes: Uint8Array, expected: string | undefined, label: string): Promise<void> {
  if (expected && await sha256Bytes(bytes) !== expected) runtimeError(`runtime ${label} digest mismatch`)
}

export async function decodeRuntimeBytes(bytes: Uint8Array, opts: RuntimeOptions = {}): Promise<string> {
  assertBytes(bytes, opts)
  await assertDigest(bytes, opts.descriptor?.digest, "stored")
  const enc = runtimeEncoding(bytes, opts.descriptor)
  const decoded = enc === "gzip"
    ? await gunzip(bytes, opts.maxDecodedBytes ?? DEFAULT_RUNTIME_MAX_DECODED_BYTES)
    : bytes
  assertDecoded(decoded, opts)
  await assertDigest(decoded, opts.descriptor?.decodedDigest, "decoded")
  return utf8(decoded)
}

async function gunzip(bytes: Uint8Array, max: number): Promise<Uint8Array> {
  const ctor = globalThis.DecompressionStream
  if (!ctor) runtimeError("runtime gzip decode unsupported in this browser")
  try {
    const source = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array(buffer(bytes)))
        ctrl.close()
      },
    })
    const gzip = new ctor("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>
    const reader = source.pipeThrough(gzip).getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.length
      if (size > max) {
        await reader.cancel()
        runtimeError(`runtime decoded byte limit exceeded: ${size} > ${max}`)
      }
      chunks.push(item.value)
    }
    const out = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) {
      out.set(chunk, at)
      at += chunk.length
    }
    return out
  } catch (err) {
    if (err instanceof Error && err.message.includes("runtime decoded byte limit")) throw err
    runtimeError(`runtime gzip decode failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function parseRuntimeBytes(bytes: Uint8Array, opts: RuntimeOptions = {}): Promise<ParsedLaunchStream> {
  return parseLaunchStream(await decodeRuntimeBytes(bytes, opts))
}

export function encodeRuntimeText(text: string): Uint8Array {
  return textBytes(text)
}
