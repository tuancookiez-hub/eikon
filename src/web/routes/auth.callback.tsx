/** @jsxImportSource react */
import { createRoute, redirect } from "@tanstack/react-router"
import { Route as root } from "./__root"

export const Route = createRoute({
  getParentRoute: () => root,
  path: "/auth/callback",
  beforeLoad: ({ location }) => {
    const to = typeof location.search === "object" && "redirectTo" in location.search && typeof location.search.redirectTo === "string" && location.search.redirectTo.startsWith("/") ? location.search.redirectTo : "/account"
    throw redirect({ to })
  },
})
