import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "../../dist/web")
const catalogSource = join(import.meta.dir, "../../eikons")

await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
await cp(catalogSource, join(root, "eikons"), { recursive: true })
await writeFile(join(root, "index.html"), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>eikon</title>
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
