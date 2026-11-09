-- Preserve the RTTS distinction between a cleared fault and a closed ticket.
create or replace function public.performance_closed_date(public.performance_tickets)
returns text
language sql immutable strict security invoker set search_path = ''
as $$ select nullif(btrim($1.source_data->>'Closed Date'), '') $$;
revoke all on function public.performance_closed_date(public.performance_tickets) from public,anon;
grant execute on function public.performance_closed_date(public.performance_tickets) to authenticated,service_role;
notify pgrst, 'reload schema';
