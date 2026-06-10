const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])

export function privateIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function mappedIpv4Private(host: string): boolean {
  const dotted = host.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (dotted) return privateIpv4(Number(dotted[1]), Number(dotted[2]))

  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return false
  const n = Number.parseInt(hex[1]!, 16) * 0x10000 + Number.parseInt(hex[2]!, 16)
  return privateIpv4(Math.floor(n / 0x1000000), Math.floor(n / 0x10000) & 0xff)
}

export function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (PRIVATE_HOSTS.has(h)) return true
  if (h.endsWith(".localhost")) return true
  const ip = h.match(/^(\d+)\.(\d+)\./)
  if (ip && privateIpv4(Number(ip[1]), Number(ip[2]))) return true
  if (h.startsWith("fe80:")) return true
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true
  return mappedIpv4Private(h)
}

export function pathParts(raw: string): string[] {
  const path = raw.split(/[?#]/, 1)[0] ?? raw
  const decoded = (() => { try { return decodeURIComponent(path) } catch { return path } })()
  return [path, decoded]
}

export function pathEscape(raw: string): boolean {
  return pathParts(raw).some(value => /%5c/i.test(value) || value.split(/[\\/]/).some(part => part === ".."))
}
