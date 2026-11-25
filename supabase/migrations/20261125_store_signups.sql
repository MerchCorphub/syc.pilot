-- Store sign-up requests from mybanana.app/join. Anyone can send one; only admins can read or change them.
create table if not exists public.store_signups (
  id uuid primary key default gen_random_uuid(),
  store_name text not null check (char_length(store_name) between 2 and 120),
  chain_name text check (chain_name is null or char_length(chain_name) <= 120),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  contact_role text check (contact_role is null or char_length(contact_role) <= 80),
  phone text check (phone is null or char_length(phone) <= 30),
  email text check (email is null or (char_length(email) <= 160 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  street text check (street is null or char_length(street) <= 160),
  city text not null check (char_length(city) between 2 and 80),
  state text check (state is null or char_length(state) <= 20),
  zip text check (zip is null or char_length(zip) <= 10),
  daily_transactions integer not null check (daily_transactions between 1 and 100000),
  plan text generated always as (case when daily_transactions < 800 then 'Neighborhood' when daily_transactions <= 1500 then 'Standard' else 'High-volume' end) stored,
  preferred_start date,
  notes text check (notes is null or char_length(notes) <= 1000),
  agreed_contact boolean not null check (agreed_contact),
  status text not null default 'new' check (status in ('new','contacted','signed','declined')),
  admin_notes text check (admin_notes is null or char_length(admin_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone is not null or email is not null)
);
create index if not exists store_signups_created on public.store_signups(created_at desc);
alter table public.store_signups enable row level security;
drop policy if exists store_signups_anon_insert on public.store_signups;
create policy store_signups_anon_insert on public.store_signups for insert to anon
  with check (status = 'new' and admin_notes is null);
drop policy if exists store_signups_admin_all on public.store_signups;
create policy store_signups_admin_all on public.store_signups for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
grant insert on public.store_signups to anon;
grant select, insert, update, delete on public.store_signups to authenticated;
