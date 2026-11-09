create table public.performance_availability_inputs (
  kind text primary key check (kind in ('approvals','sites','schedule')),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  updated_at timestamptz not null default now()
);
comment on table public.performance_availability_inputs is 'Verified STC approval credits, COW classification and scheduled service coverage for SA availability.';
alter table public.performance_availability_inputs enable row level security;
revoke all on public.performance_availability_inputs from public,anon,authenticated;
grant select on public.performance_availability_inputs to authenticated;
grant select,insert,update on public.performance_availability_inputs to service_role;
create policy performance_availability_members_read
on public.performance_availability_inputs for select to authenticated
using ((select public.performance_has_role(array['admin','analyst','viewer'])));

-- Read the source classification without returning unrelated source columns.
create or replace function public.performance_node_classification(public.performance_tickets)
returns text
language sql immutable strict security invoker set search_path = ''
as $$ select nullif(btrim($1.source_data->>'Node Classification'), '') $$;
revoke all on function public.performance_node_classification(public.performance_tickets) from public,anon;
grant execute on function public.performance_node_classification(public.performance_tickets) to authenticated,service_role;
