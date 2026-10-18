-- Run after the migration, as project administrator. Rolls back all test writes.
-- This checks anonymous and nonmember access; additionally test actual viewer
-- and analyst accounts in the application after granting membership.
begin;
do $$
declare missing integer;
begin
  select count(*) into missing from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('performance_members','performance_imports','performance_tickets','performance_reviews') and c.relrowsecurity;
  if missing <> 4 then raise exception 'All four performance tables must have RLS enabled'; end if;
end $$;
set local role anon;
do $$ begin
  if has_table_privilege('public.performance_tickets','SELECT') then raise exception 'Anonymous SELECT privilege must be revoked'; end if;
  if has_table_privilege('public.performance_tickets','INSERT') then raise exception 'Anonymous INSERT privilege must be revoked'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{}',true);
do $$ declare visible integer; begin
  if public.performance_has_role(array['admin','analyst','viewer']) then raise exception 'A nonmember must not have access'; end if;
  select count(*) into visible from public.performance_tickets;
  if visible <> 0 then raise exception 'A nonmember must not see ticket data'; end if;
  begin
    insert into public.performance_tickets(id,ticket_number,region,district,service_impact,created_at,created_date)
    values('__access_test__|','__access_test__','Central','Test','Outage',now(),current_date);
    raise exception 'Nonmember INSERT unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
