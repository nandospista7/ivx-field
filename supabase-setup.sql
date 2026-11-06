-- =====================================================================
--  IV-X Field — Supabase setup
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run again later (it only adds what's missing).
-- =====================================================================

-- ---------- tables ----------
create table if not exists public.checkins (          -- latest status of each store visit
  id          text primary key,
  store_key   text,
  day         text,
  status      text,
  by_name     text,
  at          timestamptz,
  deleted     boolean not null default false,
  data        jsonb   not null,                      -- the full check-in, as the app saved it
  updated_at  timestamptz not null default now()
);

create table if not exists public.visits_log (        -- every save, never edited (history, reports)
  log_id      text primary key,
  checkin_id  text not null,
  store_key   text,
  day         text,
  status      text,
  by_name     text,
  at          timestamptz,
  deleted     boolean,
  data        jsonb not null,
  logged_at   timestamptz not null default now()
);
create index if not exists visits_log_store_idx on public.visits_log (store_key);
create index if not exists visits_log_at_idx    on public.visits_log (at);

create table if not exists public.app_config (        -- products, pitch kit, settings (edited in the app)
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.qr_scans (          -- one row per shelf-tag scan
  id          bigserial primary key,
  store_key   text not null,
  scanned_at  timestamptz not null default now()
);
create index if not exists qr_scans_store_idx on public.qr_scans (store_key);

-- ---------- every save also lands in the history log ----------
create or replace function public.log_checkin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.visits_log (log_id, checkin_id, store_key, day, status, by_name, at, deleted, data)
  values (new.id || '@' || coalesce(new.data->>'at', ''), new.id, new.store_key, new.day, new.status,
          new.by_name, new.at, new.deleted, new.data)
  on conflict (log_id) do nothing;
  return new;
end $$;

drop trigger if exists trg_log_checkin on public.checkins;
create trigger trg_log_checkin after insert or update on public.checkins
  for each row execute function public.log_checkin();

-- ---------- save a batch from a phone; the newest save always wins ----------
create or replace function public.save_checkins(rows jsonb) returns integer
language plpgsql security invoker set search_path = public as $$
declare r jsonb; n integer := 0;
begin
  for r in select * from jsonb_array_elements(rows) loop
    insert into public.checkins as c (id, store_key, day, status, by_name, at, deleted, data, updated_at)
    values (r->>'id', r->>'storeKey', r->>'day', nullif(r->>'status', ''), r->>'by',
            nullif(r->>'at', '')::timestamptz, coalesce((r->>'deleted')::boolean, false), r, now())
    on conflict (id) do update set
      store_key = excluded.store_key, day = excluded.day, status = excluded.status,
      by_name = excluded.by_name, at = excluded.at, deleted = excluded.deleted,
      data = excluded.data, updated_at = now()
    where c.at is null or excluded.at >= c.at;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.save_checkins(jsonb) from public, anon;
grant  execute on function public.save_checkins(jsonb) to authenticated;

-- ---------- QR shelf tags: anyone who scans can log a scan (nothing else) ----------
create or replace function public.log_scan(p_store text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_store is null or length(p_store) > 120 then return null; end if;
  insert into public.qr_scans (store_key) values (p_store);
  return (select value->>'qrUrl' from public.app_config where key = 'settings');
end $$;
revoke execute on function public.log_scan(text) from public;
grant  execute on function public.log_scan(text) to anon, authenticated;

-- ---------- security: only signed-in team members can see or change anything ----------
alter table public.checkins   enable row level security;
alter table public.visits_log enable row level security;
alter table public.app_config enable row level security;
alter table public.qr_scans   enable row level security;

drop policy if exists "team reads checkins"   on public.checkins;
drop policy if exists "team adds checkins"    on public.checkins;
drop policy if exists "team edits checkins"   on public.checkins;
drop policy if exists "team reads history"    on public.visits_log;
drop policy if exists "team reads config"     on public.app_config;
drop policy if exists "team adds config"      on public.app_config;
drop policy if exists "team edits config"     on public.app_config;
drop policy if exists "team reads scans"      on public.qr_scans;

create policy "team reads checkins" on public.checkins   for select to authenticated using (true);
create policy "team adds checkins"  on public.checkins   for insert to authenticated with check (true);
create policy "team edits checkins" on public.checkins   for update to authenticated using (true) with check (true);
create policy "team reads history"  on public.visits_log for select to authenticated using (true);
create policy "team reads config"   on public.app_config for select to authenticated using (true);
create policy "team adds config"    on public.app_config for insert to authenticated with check (true);
create policy "team edits config"   on public.app_config for update to authenticated using (true) with check (true);
create policy "team reads scans"    on public.qr_scans   for select to authenticated using (true);

-- ---------- live updates between phones ----------
do $$ begin
  alter publication supabase_realtime add table public.checkins;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------- shelf photos & signatures ----------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "team uploads photos" on storage.objects;
drop policy if exists "team replaces photos" on storage.objects;
create policy "team uploads photos"  on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "team replaces photos" on storage.objects for update to authenticated using (bucket_id = 'photos');

-- Done. Next: Authentication → Sign In / Providers → turn OFF "Allow new users to sign up",
-- then Authentication → Users → Add user → Create new user for each teammate (tick "Auto Confirm User").
