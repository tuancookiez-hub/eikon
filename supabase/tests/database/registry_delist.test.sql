begin;
select plan(4);

select has_table('public', 'delist_audit', 'delist audit table exists');
select has_column('public', 'packages', 'delisted_at', 'packages track delisted_at');
select has_column('public', 'packages', 'github_user_id', 'packages track immutable GitHub submitter id');
select has_function('public', 'request_package_delist', array['uuid', 'text'], 'request_package_delist exists');

select * from finish();
rollback;
