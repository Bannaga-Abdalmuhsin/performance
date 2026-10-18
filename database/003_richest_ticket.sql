-- Preserve original source fields and the duplicate-selection audit.
-- Historical complete snapshots remain immutable and available for rollback.
begin;
alter table public.performance_tickets add column if not exists source_data jsonb;
alter table public.performance_tickets add column if not exists deduplication jsonb;

create or replace function public.performance_guard_import()
returns trigger language plpgsql security invoker set search_path='' as $$
declare actual integer; distinct_tickets integer; first_date date; last_date date;
begin
  if tg_op='INSERT' then
    if new.status<>'pending' then raise exception 'New imports must start pending'; end if;
  elsif old.status='complete' then
    raise exception 'Completed import metadata is immutable; upload a new snapshot';
  end if;
  if new.status='complete' then
    select count(*),count(distinct ticket_number),min(created_date),max(created_date)
      into actual,distinct_tickets,first_date,last_date
      from public.performance_tickets where import_id=new.id;
    if actual=0 or actual<>new.record_count then raise exception 'Import count mismatch'; end if;
    if actual<>distinct_tickets then raise exception 'Duplicate ticket numbers remain in the pending import'; end if;
    if exists(select 1 from public.performance_tickets where import_id=new.id and
      (ticket_number !~ '^(PR|PMR|TT)[0-9]+$' or id<>'pbi:'||ticket_number or source_key is distinct from ticket_number)) then
      raise exception 'Each ticket requires a normalized PR/PMR/TT number and a ticket-only identity';
    end if;
    new.min_date=first_date;new.max_date=last_date;new.completed_at=clock_timestamp();
    new.metadata=new.metadata||jsonb_build_object('record_count',actual,'min_date',first_date,'max_date',last_date,
      'grain','Ticket Number','deduplication_policy','ticket-richest-v1');
  end if;
  return new;
end; $$;
revoke all on function public.performance_guard_import() from public,anon,authenticated;
comment on column public.performance_tickets.source_data is 'Original retained source row, including columns not used by the dashboard. Same RLS as the ticket.';
comment on column public.performance_tickets.deduplication is 'Richness scores and retained/removed source row numbers. Whole original rows are selected, never merged.';
commit;
