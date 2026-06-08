import { expect, test } from "bun:test"
import { act } from "react"
import { testRender } from "@opentui/react/test-utils"
import { resolve } from "node:path"
import { Browser } from "../src/browse/Browser"
import { local } from "../src/browse/catalog"
import { parseRuntimeBytes as parseRuntimeBytesBrowser } from "../src/browser"
import { serializeLaunchStream, serializeRuntimeBytes, type LaunchStreamRecord } from "../src"

const dir = resolve(import.meta.dir, "../eikons")

const stream: LaunchStreamRecord[] = [
  {
    type: "header",
    eikon: 1,
    title: "Browser gzip",
    author: { name: "kaio" },
    size: { cols: 1, rows: 1 },
    defaultSignal: "state.idle",
    signals: { "state.idle": { clip: "idle" } },
  },
  { type: "clip", name: "idle", fps: 1, frameCount: 1 },
  { type: "frame", clip: "idle", index: 0, rows: ["A"] },
]

async function mount() {
  const calls: { name: string; raw: string }[] = []
  const setup = await testRender(
    <Browser catalog={local(dir)} onPick={(name, raw) => calls.push({ name, raw })} />,
    { width: 140, height: 40, exitOnCtrlC: false },
  )
  const settle = async () => {
    await act(async () => { await Promise.resolve() })
    await act(async () => { await setup.renderOnce() })
  }
  await settle(); await settle()
  return { ...setup, settle, calls, frame: setup.captureCharFrame }
}

const until = async (t: Awaited<ReturnType<typeof mount>>, p: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  await t.settle()
  while (!p()) {
    if (Date.now() > end) throw new Error(`until() timed out\n${t.frame()}`)
    await t.settle(); await Bun.sleep(5)
  }
}

test("browser runtime helper decodes gzip without host imports", async () => {
  const plain = new TextEncoder().encode(serializeLaunchStream(stream))
  const gzip = serializeRuntimeBytes(stream, { encoding: "gzip" })
  expect((await parseRuntimeBytesBrowser(plain)).meta.name).toBe("Browser gzip")
  expect((await parseRuntimeBytesBrowser(gzip)).clips.get("idle")?.frames[0]).toEqual(["A"])
  await expect(parseRuntimeBytesBrowser(gzip, { descriptor: { encoding: "identity" } })).rejects.toThrow(/descriptor says identity/)
  await expect(parseRuntimeBytesBrowser(gzip, { maxDecodedBytes: 8 })).rejects.toThrow(/decoded byte limit/)
})

test("Browser: lists catalog, cycles states, picks current entry", async () => {
  const t = await mount()
  await until(t, () => t.frame().includes("eikon.sh") && t.frame().includes("ares"))

  // state badge line present, idle highlighted initially
  await until(t, () => t.frame().includes("idle"))

  // step states manually
  await act(async () => { t.mockInput.pressArrow("right") })
  await until(t, () => /listening/.test(t.frame()))

  // pick
  await act(async () => { t.mockInput.pressEnter() })
  await t.settle()
  expect(t.calls.length).toBe(1)
  expect(t.calls[0]!.raw.startsWith("{")).toBe(true)

  // nav down changes selection (3 entries in catalog)
  const first = t.calls[0]!.name
  await act(async () => { t.mockInput.pressArrow("down") })
  await until(t, () => !t.frame().includes(`✓ ${first}`) || true)  // flash clears on cursor change? no — just wait load
  await until(t, () => t.frame().includes("idle"))
  await act(async () => { t.mockInput.pressEnter() })
  await t.settle()
  expect(t.calls.length).toBe(2)
  expect(t.calls[1]!.name).not.toBe(first)

  t.renderer.destroy()
})
