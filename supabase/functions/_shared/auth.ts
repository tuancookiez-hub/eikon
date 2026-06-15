// @ts-nocheck
import { admin } from "./db.ts"

export async function user(req: Request) {
  const raw = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!raw) return undefined
  const db = admin()
  const { data, error } = await db.auth.getUser(raw)
  if (error) throw new Error(error.message)
  return data.user ?? undefined
}
