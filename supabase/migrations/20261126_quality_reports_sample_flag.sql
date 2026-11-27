-- Marks demonstration quality reports so they can be shown as "Sample" and deleted in one step.
alter table public.quality_reports add column if not exists is_sample boolean not null default false;
drop policy if exists quality_reports_anon_insert on public.quality_reports;
create policy quality_reports_anon_insert on public.quality_reports for insert to anon with check (not is_sample);
