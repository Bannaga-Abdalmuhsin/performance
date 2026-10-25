alter table public.performance_tickets add column exceeded_time text;
comment on column public.performance_tickets.exceeded_time is 'Original Exceeded TIME cell: NOT EXCEED means within SLA; positive Excel-day durations exceed SLA. Blank or invalid cells are unrecorded.';

create or replace function public.performance_prepare_ticket()
returns trigger language plpgsql set search_path to ''
as $function$
declare batch_status text;
begin
  select status into batch_status from public.performance_imports where id=new.import_id for share;
  if batch_status is distinct from 'pending' then
    raise exception 'Upload into a new pending batch; completed snapshots are immutable';
  end if;
  if tg_op='UPDATE' and old.import_id<>new.import_id then raise exception 'Import identity cannot change'; end if;
  if new.restoration_days is not null then new.duration_minutes=new.restoration_days*1440; end if;
  if new.source_data ? 'Exceeded TIME' then
    new.exceeded_time=new.source_data->>'Exceeded TIME';
  elsif new.source_data ? 'exceeded_time' then
    new.exceeded_time=new.source_data->>'exceeded_time';
  end if;
  new.created_date=(new.created_at at time zone 'Asia/Riyadh')::date;
  new.updated_at=now();
  return new;
end; $function$;

create or replace view public.performance_current_tickets with (security_invoker=true) as
select t.* from public.performance_tickets t
where t.import_id=(select i.id from public.performance_imports i where i.status='complete' order by i.completed_at desc,i.id desc limit 1);

notify pgrst, 'reload schema';
