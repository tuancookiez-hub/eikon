// Install side-channel. The renderer owns stdout; stderr passes through
// both a direct spawn and an ssh channel unchanged, so picks ride that.
//
//   \x1e{"pick":"<name>","size":N}\n<N raw bytes>
//
// \x1e (ASCII RS) prefixes the header so a parent scanning plain text
// ignores it until the marker appears. The raw bytes are the .eikon body
// so the parent can install without a second fetch.

export const MARK = "\x1e"

export type Pick = { name: string; raw: string }

export const emit = (out: NodeJS.WritableStream) => (name: string, raw: string) =>
  out.write(MARK + JSON.stringify({ pick: name, size: Buffer.byteLength(raw) }) + "\n" + raw)

/** Consume RS-framed pick messages from a stream. Non-RS data is discarded. */
export async function* picks(stream: AsyncIterable<Uint8Array>): AsyncGenerator<Pick> {
  let buf = Buffer.alloc(0)
  let want: { name: string; size: number } | null = null

  for await (const chunk of stream) {
    buf = Buffer.concat([buf, Buffer.from(chunk)])
    for (;;) {
      if (want) {
        if (buf.length < want.size) break
        yield { name: want.name, raw: buf.subarray(0, want.size).toString("utf8") }
        buf = buf.subarray(want.size)
        want = null
        continue
      }
      const at = buf.indexOf(0x1e)
      if (at < 0) { buf = Buffer.alloc(0); break }
      const nl = buf.indexOf(0x0a, at + 1)
      if (nl < 0) { buf = buf.subarray(at); break }
      const head = JSON.parse(buf.subarray(at + 1, nl).toString("utf8")) as { pick: string; size: number }
      want = { name: head.pick, size: head.size }
      buf = buf.subarray(nl + 1)
    }
  }
}
