import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gzipSync, gunzipSync } from "node:zlib"
import type { RuntimeEncoding, LaunchStreamRecord } from "../contract/shape"
import { parseLaunchStream, serializeLaunchStream, type ParsedLaunchStream } from "./parse"
import {
  DEFAULT_RUNTIME_MAX_DECODED_BYTES,
  assertBytes,
  assertDecoded,
  runtimeEncoding,
  runtimeError,
  textBytes,
  utf8,
  type RuntimeByteInfo,
  type RuntimeOptions,
} from "./runtime"

type GzipOptions = Parameters<typeof gzipSync>[1] & { mtime: number }

export type RuntimeWriteOptions = {
  encoding?: RuntimeEncoding
  level?: number
}

export function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function assertDigest(bytes: Uint8Array, expected: string | undefined, label: string): void {
  if (expected && sha256Bytes(bytes) !== expected) runtimeError(`runtime ${label} digest mismatch`)
}

export function decodeRuntimeBytes(bytes: Uint8Array, opts: RuntimeOptions = {}): string {
  assertBytes(bytes, opts)
  assertDigest(bytes, opts.descriptor?.digest, "stored")
  const enc = runtimeEncoding(bytes, opts.descriptor)
  const decoded = enc === "gzip"
    ? gunzip(bytes, opts.maxDecodedBytes ?? DEFAULT_RUNTIME_MAX_DECODED_BYTES)
    : bytes
  assertDecoded(decoded, opts)
  assertDigest(decoded, opts.descriptor?.decodedDigest, "decoded")
  return utf8(decoded)
}

function gunzip(bytes: Uint8Array, max: number): Uint8Array {
  try {
    return gunzipSync(bytes, { maxOutputLength: max })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/larger than|maxOutputLength|unexpected end|incorrect header|invalid/.test(msg)) runtimeError(`runtime gzip decode failed: ${msg}`)
    runtimeError(`runtime gzip decode failed: ${msg}`)
  }
}

export function parseRuntimeBytes(bytes: Uint8Array, opts: RuntimeOptions = {}): ParsedLaunchStream {
  return parseLaunchStream(decodeRuntimeBytes(bytes, opts))
}

export function decodeRuntimeFile(path: string, opts: RuntimeOptions = {}): string {
  return decodeRuntimeBytes(readFileSync(path), opts)
}

export function parseRuntimeFile(path: string, opts: RuntimeOptions = {}): ParsedLaunchStream {
  return parseRuntimeBytes(readFileSync(path), opts)
}

export function serializeRuntimeBytes(records: readonly LaunchStreamRecord[], opts: RuntimeWriteOptions = {}): Uint8Array {
  return encodeRuntimeText(serializeLaunchStream(records), opts)
}

export function encodeRuntimeText(text: string, opts: RuntimeWriteOptions = {}): Uint8Array {
  const bytes = textBytes(text)
  if ((opts.encoding ?? "identity") === "identity") return bytes
  if (opts.encoding === "gzip") {
    const cfg: GzipOptions = { level: opts.level ?? 9, mtime: 0 }
    return gzipSync(bytes, cfg)
  }
  runtimeError(`unsupported runtime encoding: ${String(opts.encoding)}`)
}

export function writeRuntimeFile(path: string, text: string, opts: RuntimeWriteOptions = {}): void {
  writeFileSync(path, encodeRuntimeText(text, opts))
}

export function runtimeByteInfo(text: string, opts: RuntimeWriteOptions = {}): RuntimeByteInfo {
  const decoded = textBytes(text)
  const encoding = opts.encoding ?? "identity"
  const stored = encodeRuntimeText(text, opts)
  return {
    encoding,
    size: stored.length,
    digest: sha256Bytes(stored),
    decodedSize: decoded.length,
    decodedDigest: sha256Bytes(decoded),
  }
}

export function runtimeDescriptor(text: string, opts: RuntimeWriteOptions = {}): RuntimeByteInfo & { bytes: Uint8Array } {
  const decoded = textBytes(text)
  const encoding = opts.encoding ?? "identity"
  const bytes = encodeRuntimeText(text, opts)
  return {
    bytes,
    encoding,
    size: bytes.length,
    digest: sha256Bytes(bytes),
    decodedSize: decoded.length,
    decodedDigest: sha256Bytes(decoded),
  }
}
