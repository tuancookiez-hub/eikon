export function bytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), c => c.charCodeAt(0))
}

export async function sha256(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data)
  return `sha256:${Array.from(new Uint8Array(hash)).map(n => n.toString(16).padStart(2, "0")).join("")}`
}

export function hex(value: string) {
  return value.replace(/^sha256:/, "")
}
