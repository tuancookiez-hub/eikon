import { EikonValidationError } from "../contract/errors"
import type { RuntimeEncoding } from "../contract/shape"

export const DEFAULT_RUNTIME_MAX_BYTES = 32 * 1024 * 1024
export const DEFAULT_RUNTIME_MAX_DECODED_BYTES = 32 * 1024 * 1024

export type RuntimeDescriptor = {
  encoding?: RuntimeEncoding | string
  size?: number
  digest?: string
  decodedSize?: number
  decodedDigest?: string
}

export type RuntimeOptions = {
  descriptor?: RuntimeDescriptor
  maxBytes?: number
  maxDecodedBytes?: number
}

export type RuntimeByteInfo = {
  encoding: RuntimeEncoding
  size: number
  digest: string
  decodedSize: number
  decodedDigest: string
}

export function runtimeError(message: string): never {
  throw new EikonValidationError([{ code: "runtime", path: "runtime", message }])
}

export function isGzipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export function runtimeEncoding(bytes: Uint8Array, desc?: RuntimeDescriptor): RuntimeEncoding {
  const packed = desc !== undefined
  const raw = desc?.encoding ?? (packed ? "identity" : isGzipBytes(bytes) ? "gzip" : "identity")
  if (raw !== "identity" && raw !== "gzip") runtimeError(`unsupported runtime encoding: ${String(raw)}`)
  const gzip = isGzipBytes(bytes)
  if (packed && raw === "gzip" && !gzip) runtimeError("runtime encoding mismatch: descriptor says gzip but bytes are not gzip")
  if (packed && raw === "identity" && gzip) runtimeError("runtime encoding mismatch: descriptor says identity but bytes are gzip")
  return raw
}

export function assertBytes(bytes: Uint8Array, opts: RuntimeOptions = {}): void {
  const max = opts.maxBytes ?? DEFAULT_RUNTIME_MAX_BYTES
  if (bytes.length > max) runtimeError(`runtime stored byte limit exceeded: ${bytes.length} > ${max}`)
  const size = opts.descriptor?.size
  if (size != null && bytes.length !== size) runtimeError(`runtime stored size mismatch: ${bytes.length} !== ${size}`)
}

export function assertDecoded(bytes: Uint8Array, opts: RuntimeOptions = {}): void {
  const max = opts.maxDecodedBytes ?? DEFAULT_RUNTIME_MAX_DECODED_BYTES
  if (bytes.length > max) runtimeError(`runtime decoded byte limit exceeded: ${bytes.length} > ${max}`)
  const size = opts.descriptor?.decodedSize
  if (size != null && bytes.length !== size) runtimeError(`runtime decoded size mismatch: ${bytes.length} !== ${size}`)
}

export function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (err) {
    runtimeError(`runtime UTF-8 decode failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
