/** @jsxImportSource react */
import { RouterProvider, createRouter } from "@tanstack/react-router"
import { QueryClientProvider } from "@tanstack/react-query"
import { query } from "./lib/query"
import { routeTree } from "./routeTree.gen"

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  context: { query },
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

export function RouterApp() {
  return <QueryClientProvider client={query}><RouterProvider router={router} /></QueryClientProvider>
}
