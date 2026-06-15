export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: { Row: { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; github_user_id: string | null; github_login: string | null; created_at: string; updated_at: string } }
      packages: { Row: { id: string; namespace: string; name: string; canonical_id: string; source_key: string; created_by: string | null; origin_kind: string; current_version_id: string | null; visibility: string; delisted_at: string | null } }
      package_versions: { Row: { id: string; package_id: string; version: string; manifest: Json; manifest_digest: string; runtime_digest: string; runtime_size: number; runtime_encoding: string | null; runtime_decoded_size: number | null; runtime_decoded_digest: string | null; poster: string | null; status: string } }
      package_files: { Row: { id: string; version_id: string; path: string; role: string; media_type: string; storage_bucket: string; storage_path: string; digest: string; size: number } }
      upload_sessions: { Row: { id: string; user_id: string; status: string; expires_at: string } }
      likes: { Row: { package_id: string; user_id: string; created_at: string } }
      platform_events: { Row: { id: string; package_id: string; version_id: string | null; user_id: string | null; event_type: string; source: string; created_at: string } }
      package_stats: { Row: { package_id: string; download_count: number; like_count: number; share_count: number; updated_at: string } }
    }
    Views: {
      registry_catalog_entries: { Row: { canonical_id: string; namespace: string; name: string; version: string; source_key: string; title: string | null; author: string | null; description: string | null; glyph: string | null; tags: Json | null; poster: string | null; package_path: string; package_index_path: string; runtime_path: string; trust: Json } }
      registry_platform_metadata: { Row: { catalog_id: string; source_key: string; origin_kind: string; submit_pr_url: string | null; downloads: number; likes: number; shares: number } }
    }
    Functions: {
      record_platform_event: { Args: { pid: string; kind: string; event_source?: string; event_rate_key?: string }; Returns: Database['public']['Tables']['package_stats']['Row'] }
      toggle_like: { Args: { pid: string }; Returns: Database['public']['Tables']['package_stats']['Row'] }
      request_package_delist: { Args: { pid: string; why?: string }; Returns: undefined }
      can_manage_package: { Args: { pid: string }; Returns: boolean }
    }
  }
}
