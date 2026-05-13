#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve as path } from "node:path"
import { Browser } from "./Browser"
import { resolve } from "./catalog"
import { emit } from "./ipc"

const dir = path(process.argv[2] ?? path(import.meta.dir, "../../catalog"))
const catalog = resolve(dir)

const renderer = await createCliRenderer({ exitOnCtrlC: true })
createRoot(renderer).render(<Browser catalog={catalog} onPick={emit(process.stderr)} />)
