create or replace function rescore_all() returns void
language sql as $$
  update players set unlocked = unlocked where steamid64 is not null;
$$;

revoke execute on function rescore_all() from public, anon, authenticated;
grant execute on function rescore_all() to service_role;
