import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "../../dist/web")
const catalogSource = join(import.meta.dir, "../../eikons")
const siteTitle = "𝝴ikon"
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#050505"/>
  <text x="50%" y="53%" fill="#fff" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="44" font-weight="700" text-anchor="middle" dominant-baseline="middle">𝝴</text>
</svg>
`

await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
await cp(catalogSource, join(root, "eikons"), { recursive: true })
await writeFile(join(root, "favicon.svg"), favicon)
await writeFile(join(root, "index.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${siteTitle}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <script type="module" src="/assets/main.js"></script>
  <link rel="stylesheet" href="/assets/main.css" />
</head>
<body>
  <div id="root"></div>
</body>
</html>
`)

await Bun.build({
  entrypoints: [join(import.meta.dir, "main.tsx")],
  outdir: join(root, "assets"),
  target: "browser",
  minify: true,
  splitting: true,
  naming: "[dir]/[name].[ext]",
})

console.log(root)
