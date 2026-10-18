-- One current, deduplicated dataset for SQL/Table Editor consumers.
begin;
create or replace view public.performance_current_tickets
with (security_invoker=true) as
select t.* from public.performance_tickets t
where t.import_id=(
  select i.id from public.performance_imports i where i.status='complete'
  order by i.completed_at desc,i.id desc limit 1
);
revoke all on public.performance_current_tickets from public,anon;
grant select on public.performance_current_tickets to authenticated,service_role;
comment on view public.performance_current_tickets is 'The latest completed cumulative snapshot. Older versions remain available in the base table for audit. Underlying RLS is enforced.';
commit;
