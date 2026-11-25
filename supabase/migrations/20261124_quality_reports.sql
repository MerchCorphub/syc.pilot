-- Shopper quality reports: "Tell us what you see" on the result screen.
-- Opinions with a photo, not inspections. The app never says who caused a problem.
-- Shoppers (anon) can only add a report; only admins can read, export or delete them.
create table if not exists public.quality_reports (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  device_id uuid,
  session_id text,
  store_id uuid references public.stores(id) on delete set null,
  store_name_typed text check (store_name_typed is null or char_length(store_name_typed) <= 120),
  brand_id uuid references public.brands(id) on delete set null,
  stage smallint check (stage between 1 and 4),
  issues text[] not null check (
    cardinality(issues) between 1 and 6
    and issues <@ array['bruising','too_many_spots','split_peel','color_off','stem_damage','other']::text[]),
  note text check (note is null or char_length(note) <= 300),
  phone_time timestamptz,
  phone_timezone text check (phone_timezone is null or char_length(phone_timezone) <= 64),
  created_at timestamptz not null default now()
);
create unique index if not exists quality_reports_one_per_scan on public.quality_reports(scan_id);
create index if not exists quality_reports_created on public.quality_reports(created_at desc);
create index if not exists quality_reports_store on public.quality_reports(store_id);
create index if not exists quality_reports_brand on public.quality_reports(brand_id);

alter table public.quality_reports enable row level security;
drop policy if exists quality_reports_anon_insert on public.quality_reports;
create policy quality_reports_anon_insert on public.quality_reports for insert to anon with check (true);
drop policy if exists quality_reports_admin_all on public.quality_reports;
create policy quality_reports_admin_all on public.quality_reports for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
grant insert on public.quality_reports to anon;
grant select, insert, update, delete on public.quality_reports to authenticated;
