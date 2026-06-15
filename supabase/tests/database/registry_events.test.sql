begin;
select plan(4);

select has_function('public', 'toggle_like', array['uuid'], 'toggle_like exists');
select has_function('public', 'record_platform_event', array['uuid', 'text', 'text', 'text'], 'record_platform_event exists');
select col_is_pk('public', 'package_stats', 'package_id', 'package_stats keyed by package');
select col_is_pk('public', 'likes', array['package_id', 'user_id'], 'likes unique per package and user');

select * from finish();
rollback;
