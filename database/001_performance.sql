-- Additive schema for use case 04. Does not change existing COW use cases.
-- Apply as project administrator. No operational records or credentials are included.
begin;

create table if not exists public.performance_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','analyst','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.performance_has_role(roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.performance_members m
    where m.user_id = (select auth.uid()) and m.active and m.role = any(roles));
$$;
revoke all on function public.performance_has_role(text[]) from public, anon;
grant execute on function public.performance_has_role(text[]) to authenticated, service_role;

create table if not exists public.performance_imports (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_sha256 text,
  record_count integer not null default 0 check (record_count >= 0),
  min_date date,
  max_date date,
  status text not null default 'pending' check(status in ('pending','complete','failed')),
  metadata jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  imported_by uuid default auth.uid() references auth.users(id)
);

create table if not exists public.performance_tickets (
  id text primary key,
  ticket_number text not null,
  site_id text,
  site_name text,
  region text not null,
  district text not null,
  city text,
  vendor text not null default 'Unknown',
  severity text not null default 'Unknown',
  service_impact text not null check(service_impact in ('Outage','Degraded','No impact','Unknown')),
  site_label text not null default 'Unknown',
  created_at timestamptz not null,
  created_date date not null,
  cleared_at timestamptz,
  referred_at timestamptz,
  impact_start timestamptz,
  impact_finish timestamptz,
  duration_minutes double precision check(duration_minutes >= 0),
  sla_minutes double precision check(sla_minutes >= 0),
  sla_breached boolean,
  sla_excluded boolean not null default false,
  exclusion_reason text,
  parent_tt text,
  root_cause text not null default 'Unknown',
  repair_details text,
  cleared_group text,
  source_row integer,
  quality_flags jsonb not null default '[]'::jsonb,
  import_id uuid references public.performance_imports(id),
  updated_at timestamptz not null default now(),
  constraint performance_stable_ticket_id check(id=ticket_number || '|' || coalesce(site_id,''))
);
create index if not exists performance_tickets_date_idx on public.performance_tickets(created_date);
create index if not exists performance_tickets_region_date_idx on public.performance_tickets(region,created_date);
create index if not exists performance_tickets_site_idx on public.performance_tickets(site_id);
create index if not exists performance_tickets_import_idx on public.performance_tickets(import_id);

create table if not exists public.performance_reviews (
  review_key text primary key,
  period date not null check(extract(day from period)=1),
  scope jsonb not null,
  commentary text not null default '',
  actions text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id)
);

alter table public.performance_members enable row level security;
alter table public.performance_imports enable row level security;
alter table public.performance_tickets enable row level security;
alter table public.performance_reviews enable row level security;

revoke all on public.performance_members, public.performance_imports, public.performance_tickets, public.performance_reviews from anon, authenticated;
grant select on public.performance_members to authenticated;
grant select, insert, update on public.performance_imports, public.performance_tickets, public.performance_reviews to authenticated;
grant all on public.performance_members, public.performance_imports, public.performance_tickets, public.performance_reviews to service_role;

drop policy if exists performance_members_self on public.performance_members;
create policy performance_members_self on public.performance_members for select to authenticated using(user_id=(select auth.uid()));

drop policy if exists performance_imports_read on public.performance_imports;
create policy performance_imports_read on public.performance_imports for select to authenticated using(public.performance_has_role(array['admin','analyst','viewer']));
drop policy if exists performance_imports_insert on public.performance_imports;
create policy performance_imports_insert on public.performance_imports for insert to authenticated with check(public.performance_has_role(array['admin','analyst']) and imported_by=(select auth.uid()));
drop policy if exists performance_imports_update on public.performance_imports;
create policy performance_imports_update on public.performance_imports for update to authenticated using(public.performance_has_role(array['admin','analyst'])) with check(public.performance_has_role(array['admin','analyst']));

drop policy if exists performance_tickets_read on public.performance_tickets;
create policy performance_tickets_read on public.performance_tickets for select to authenticated using(public.performance_has_role(array['admin','analyst','viewer']));
drop policy if exists performance_tickets_insert on public.performance_tickets;
create policy performance_tickets_insert on public.performance_tickets for insert to authenticated with check(public.performance_has_role(array['admin','analyst']));
drop policy if exists performance_tickets_update on public.performance_tickets;
create policy performance_tickets_update on public.performance_tickets for update to authenticated using(public.performance_has_role(array['admin','analyst'])) with check(public.performance_has_role(array['admin','analyst']));

drop policy if exists performance_reviews_read on public.performance_reviews;
create policy performance_reviews_read on public.performance_reviews for select to authenticated using(public.performance_has_role(array['admin','analyst','viewer']));
drop policy if exists performance_reviews_insert on public.performance_reviews;
create policy performance_reviews_insert on public.performance_reviews for insert to authenticated with check(public.performance_has_role(array['admin','analyst']) and updated_by=(select auth.uid()));
drop policy if exists performance_reviews_update on public.performance_reviews;
create policy performance_reviews_update on public.performance_reviews for update to authenticated using(public.performance_has_role(array['admin','analyst'])) with check(public.performance_has_role(array['admin','analyst']) and updated_by=(select auth.uid()));

-- Clients can call this only after every batch succeeds. It prevents partial
-- imports from being advertised as complete, including an initial backfill.
create or replace function public.performance_complete_import(batch_id uuid, expected_count integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare actual integer;
begin
  if current_user not in ('service_role','postgres') and not public.performance_has_role(array['admin','analyst']) then
    raise exception 'Performance analyst access is required';
  end if;
  select count(*) into actual from public.performance_tickets where import_id=batch_id;
  if actual <> expected_count then raise exception 'Import count mismatch: expected %, stored %',expected_count,actual; end if;
  update public.performance_imports set status='complete', record_count=actual where id=batch_id;
  return actual;
end;
$$;
revoke all on function public.performance_complete_import(uuid,integer) from public, anon;
grant execute on function public.performance_complete_import(uuid,integer) to authenticated, service_role;

commit;

-- Bootstrap an existing Auth user as administrator, replacing the email:
-- insert into public.performance_members(user_id,role)
-- select id,'admin' from auth.users where lower(email)=lower('YOUR_EMAIL')
-- on conflict(user_id) do update set role=excluded.role,active=true;
