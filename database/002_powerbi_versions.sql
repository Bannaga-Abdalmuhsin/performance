-- Retain complete cumulative snapshots. Pending uploads never replace live data.
begin;
alter table public.performance_imports add column if not exists completed_at timestamptz;
update public.performance_imports set completed_at=imported_at where status='complete' and completed_at is null;
create index if not exists performance_imports_completed_idx on public.performance_imports(completed_at desc) where status='complete';

alter table public.performance_tickets add column if not exists source_key text;
alter table public.performance_tickets add column if not exists restoration_days double precision check(restoration_days >= 0);
alter table public.performance_tickets add column if not exists duration_text text;
alter table public.performance_tickets add column if not exists duration_dax_minutes double precision;
alter table public.performance_tickets alter column import_id set not null;
alter table public.performance_tickets drop constraint performance_stable_ticket_id;
alter table public.performance_tickets add constraint performance_stable_ticket_id check(
  (source_key is not null and id='pbi:'||source_key) or
  (source_key is null and id=ticket_number||'|'||coalesce(site_id,'')));
alter table public.performance_tickets drop constraint performance_tickets_pkey;
alter table public.performance_tickets add primary key(import_id,id);

create or replace function public.performance_prepare_ticket()
returns trigger language plpgsql security invoker set search_path='' as $$
declare batch_status text;
begin
  select status into batch_status from public.performance_imports where id=new.import_id for share;
  if batch_status is distinct from 'pending' then
    raise exception 'Upload into a new pending batch; completed snapshots are immutable';
  end if;
  if tg_op='UPDATE' and old.import_id<>new.import_id then raise exception 'Import identity cannot change'; end if;
  if new.restoration_days is not null then new.duration_minutes=new.restoration_days*1440; end if;
  new.created_date=(new.created_at at time zone 'Asia/Riyadh')::date;
  new.updated_at=now();
  return new;
end; $$;
revoke all on function public.performance_prepare_ticket() from public, anon, authenticated;
create trigger performance_prepare_ticket before insert or update on public.performance_tickets
for each row execute function public.performance_prepare_ticket();

create or replace function public.performance_guard_import()
returns trigger language plpgsql security invoker set search_path='' as $$
declare actual integer; first_date date; last_date date;
begin
  if tg_op='INSERT' then
    if new.status<>'pending' then raise exception 'New imports must start pending'; end if;
  elsif old.status='complete' then
    raise exception 'Completed import metadata is immutable; upload a new snapshot';
  end if;
  if new.status='complete' then
    select count(*),min(created_date),max(created_date) into actual,first_date,last_date
      from public.performance_tickets where import_id=new.id;
    if actual=0 or actual<>new.record_count then raise exception 'Import count mismatch'; end if;
    new.min_date=first_date;new.max_date=last_date;new.completed_at=clock_timestamp();
    new.metadata=new.metadata||jsonb_build_object('record_count',actual,'min_date',first_date,'max_date',last_date);
  end if;
  return new;
end; $$;
revoke all on function public.performance_guard_import() from public, anon, authenticated;
create trigger performance_guard_import before insert or update on public.performance_imports
for each row execute function public.performance_guard_import();

create or replace function public.performance_complete_import(batch_id uuid,expected_count integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare actual integer; batch public.performance_imports%rowtype;
begin
  if current_user not in ('service_role','postgres') and not (select public.performance_has_role(array['admin','analyst'])) then
    raise exception 'Performance analyst access is required';
  end if;
  select * into batch from public.performance_imports where id=batch_id for update;
  if not found or batch.status<>'pending' then raise exception 'A pending import is required'; end if;
  select count(*) into actual from public.performance_tickets where import_id=batch_id;
  if actual<>expected_count or actual=0 then raise exception 'Import count mismatch: expected %, stored %',expected_count,actual; end if;
  update public.performance_imports set status='complete',record_count=actual where id=batch_id;
  return actual;
end; $$;
revoke all on function public.performance_complete_import(uuid,integer) from public,anon;
grant execute on function public.performance_complete_import(uuid,integer) to authenticated,service_role;

drop policy performance_tickets_read on public.performance_tickets;
create policy performance_tickets_read on public.performance_tickets for select to authenticated using(
  (select public.performance_has_role(array['admin','analyst','viewer'])) and import_id in
    (select id from public.performance_imports where status='complete' or
      (select public.performance_has_role(array['admin','analyst']))));
drop policy performance_tickets_insert on public.performance_tickets;
create policy performance_tickets_insert on public.performance_tickets for insert to authenticated with check(
  (select public.performance_has_role(array['admin','analyst'])) and import_id in
    (select id from public.performance_imports where status='pending'));
drop policy performance_tickets_update on public.performance_tickets;
create policy performance_tickets_update on public.performance_tickets for update to authenticated using(
  (select public.performance_has_role(array['admin','analyst'])) and import_id in
    (select id from public.performance_imports where status='pending')) with check(
  (select public.performance_has_role(array['admin','analyst'])) and import_id in
    (select id from public.performance_imports where status='pending'));
commit;
