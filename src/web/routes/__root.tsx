/** @jsxImportSource react */
import { createRootRoute, Outlet, Link } from "@tanstack/react-router"

export const Route = createRootRoute({
  component: Root,
})

function Root() {
  return (
    <>
      <nav className="siteNav" aria-label="Eikon site">
        <Link to="/" activeProps={{ className: "active" }}>gallery</Link>
        <Link to="/upload" activeProps={{ className: "active" }}>upload</Link>
        <Link to="/account" activeProps={{ className: "active" }}>account</Link>
      </nav>
      <Outlet />
    </>
  )
}
