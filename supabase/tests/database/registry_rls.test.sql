begin;
select plan(8);

select policies_are('public', 'profiles', array['profiles_public_read', 'profiles_insert_self', 'profiles_update_self_safe']);
select policies_are('public', 'likes', array['likes_read_self', 'likes_insert_self_public_package', 'likes_delete_self']);
select policies_are('public', 'platform_events', array['events_insert_public_package']);
select isnt_empty($$select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'packages' and c.relrowsecurity$$, 'packages has RLS enabled');
select isnt_empty($$select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'upload_sessions' and c.relrowsecurity$$, 'upload_sessions has RLS enabled');
select isnt_empty($$select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'display_name'$$, 'authenticated can update safe profile columns');
select is_empty($$select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE' and column_name = 'github_user_id'$$, 'authenticated cannot update github_user_id');
select has_function('public', 'can_manage_package', array['uuid'], 'manage RPC exists');

select * from finish();
rollback;
