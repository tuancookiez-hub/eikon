import { existsSync } from "node:fs"
import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "../../dist/web")
const catalog = join(import.meta.dir, "../../eikons")
const packages = join(import.meta.dir, "../../packages")
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#050505"/><text x="50%" y="53%" fill="#fff" font-family="monospace" font-size="44" font-weight="700" text-anchor="middle" dominant-baseline="middle">𝝴</text></svg>`

await rm(root, { recursive: true, force: true })
const proc = Bun.spawn(["bunx", "vite", "build", "--config", "vite.config.ts"], { cwd: join(import.meta.dir, "../.."), stdout: "inherit", stderr: "inherit" })
const code = await proc.exited
if (code !== 0) process.exit(code)
await mkdir(root, { recursive: true })
await cp(catalog, join(root, "eikons"), { recursive: true })
if (existsSync(packages)) await cp(packages, join(root, "packages"), { recursive: true })
await writeFile(join(root, "favicon.svg"), favicon)
console.log(root)
