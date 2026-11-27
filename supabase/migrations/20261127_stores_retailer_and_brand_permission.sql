-- Retailer grouping for store reports, and the store's permission for producers to see its name.
alter table public.stores add column if not exists retailer text check (retailer is null or char_length(retailer) <= 80);
alter table public.stores add column if not exists brands_may_see boolean not null default false;
