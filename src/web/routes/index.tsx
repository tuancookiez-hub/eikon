/** @jsxImportSource react */
import { createRoute } from "@tanstack/react-router"
import { App } from "../App"
import { Route as root } from "./__root"

export const Route = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: App,
})
