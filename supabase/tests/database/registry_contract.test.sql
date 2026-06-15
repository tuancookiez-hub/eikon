begin;
select plan(8);

select has_table('public', 'packages', 'packages table exists');
select has_table('public', 'package_versions', 'package_versions table exists');
select has_table('public', 'package_files', 'package_files table exists');
select has_table('public', 'package_stats', 'package_stats table exists');
select has_view('public', 'registry_catalog_entries', 'catalog view exists');
select has_view('public', 'registry_platform_metadata', 'platform metadata view exists');
select has_function('public', 'record_platform_event', array['uuid', 'text', 'text', 'text'], 'event RPC exists');
select has_function('public', 'request_package_delist', array['uuid', 'text'], 'delist RPC exists');

select * from finish();
rollback;
