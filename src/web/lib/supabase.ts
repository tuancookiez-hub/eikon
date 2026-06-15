import { client } from "../../registry/supabase"

export const supabase = client()

export async function token() {
  const session = await supabase?.auth.getSession()
  return session?.data.session?.access_token
}
