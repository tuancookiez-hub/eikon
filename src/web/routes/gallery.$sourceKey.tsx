/** @jsxImportSource react */
import { createRoute, useParams } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Route as root } from "./__root"
import { catalogOptions, entryKey } from "../lib/catalog"
import { browserInstructions } from "../player"

export const Route = createRoute({
  getParentRoute: () => root,
  path: "/gallery/$sourceKey",
  component: Detail,
})

function Detail() {
  const params = useParams({ from: "/gallery/$sourceKey" })
  const catalog = useQuery(catalogOptions())
  const key = decodeURIComponent(params.sourceKey)
  const entry = catalog.data?.find(item => entryKey(item) === key)
  if (catalog.isLoading) return <main><p className="notice">Loading catalog…</p></main>
  if (!entry) return <main><p className="notice error">No catalog entry matches this source identity.</p></main>
  const install = browserInstructions(entry)
  return (
    <main className="routePanel">
      <h1>{entry.glyph ?? "⬡"} {entry.title ?? entry.name}</h1>
      <p>{entry.description ?? "Terminal avatar artifact."}</p>
      <dl className="facts">
        <div><dt>identity</dt><dd>{entry.sourceKey}</dd></div>
        <div><dt>author</dt><dd>{entry.author ?? "unknown"}</dd></div>
        <div><dt>version</dt><dd>{entry.version ?? "unknown"}</dd></div>
      </dl>
      <span className="command">{install.command}</span>
    </main>
  )
}
