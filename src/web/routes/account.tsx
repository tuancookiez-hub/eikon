/** @jsxImportSource react */
import { createRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { Route as root } from "./__root"
import { supabase } from "../lib/supabase"

export const Route = createRoute({
  getParentRoute: () => root,
  path: "/account",
  component: Account,
})

function Account() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState("")

  useEffect(() => {
    let live = true
    void supabase?.auth.getUser().then(res => { if (live) setUser(res.data.user ?? null) })
    const sub = supabase?.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => { live = false; sub?.data.subscription.unsubscribe() }
  }, [])

  const auth = async (mode: "sign-in" | "sign-up") => {
    if (!supabase) return setStatus("Supabase is not configured for this build.")
    const res = mode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    if (res.error) setStatus(res.error.message)
    else setStatus(mode === "sign-in" ? "signed in" : "signed up")
  }

  const out = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setStatus("signed out")
  }

  return (
    <main className="routePanel">
      <h1>account</h1>
      {user ? (
        <section className="authBox">
          <p>Signed in as {user.email ?? user.id}</p>
          <button type="button" onClick={() => void out()}>sign out</button>
        </section>
      ) : (
        <section className="authBox" aria-label="Sign in">
          <label>email<input value={email} onChange={event => setEmail(event.currentTarget.value)} /></label>
          <label>password<input type="password" value={password} onChange={event => setPassword(event.currentTarget.value)} /></label>
          <div className="actions"><button type="button" onClick={() => void auth("sign-in")}>sign in</button><button type="button" onClick={() => void auth("sign-up")}>sign up</button></div>
        </section>
      )}
      <p className={status.includes("error") ? "error" : "muted"}>{status || (supabase ? "Local Supabase auth ready." : "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable auth.")}</p>
    </main>
  )
}
