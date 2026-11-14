-- My Banana Consumer Insights & Rewards
-- Sponsored surveys with an optional one-time coupon code. Off until an admin turns it on.
-- A master switch (insights_settings.enabled) plus an on/off switch on every campaign.
-- Coupons are issued only when the campaign says a participating retailer has agreed to accept them.
-- Survey answers never affect the ripeness reading, and rewards never depend on positive answers.

-- ---------- tables ----------
create table if not exists public.insights_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  default_setup_fee numeric(10,2) not null default 500.00 check (default_setup_fee >= 0),
  default_price_per_survey numeric(10,2) not null default 2.50 check (default_price_per_survey >= 0),
  updated_at timestamptz not null default now()
);
insert into public.insights_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.insight_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sponsor_type text not null default 'producer' check (sponsor_type in ('producer','retailer')),
  sponsor_name text not null,
  brand_id uuid references public.brands(id) on delete set null,      -- the producer's brand, if any
  only_brand_shoppers boolean not null default false,                -- invite only shoppers who picked brand_id
  stores text[],                                                     -- participating store names; empty = every store
  active boolean not null default false,                             -- per-campaign switch
  starts_on date,
  ends_on date,
  intro text,                                                        -- one line shown on the invitation
  include_pilot_questions boolean not null default true,             -- also ask the pilot survey questions
  -- coupon
  coupon_enabled boolean not null default false,
  retailer_accepts_codes boolean not null default false,             -- must be true before any code is issued
  offer_text text,                                                   -- e.g. $2.00 off Chiquita bananas
  coupon_value numeric(10,2) check (coupon_value is null or coupon_value >= 0),
  eligible_products text,
  redemption_terms text,
  coupon_valid_days integer not null default 30 check (coupon_valid_days between 1 and 365),
  -- pricing and budget
  setup_fee numeric(10,2) not null default 500.00 check (setup_fee >= 0),
  price_per_survey numeric(10,2) not null default 2.50 check (price_per_survey >= 0),
  max_surveys integer check (max_surveys is null or max_surveys > 0),  -- campaign stops at this many accepted surveys
  processing_cost_per_redemption numeric(10,2) not null default 0 check (processing_cost_per_redemption >= 0),
  other_costs numeric(10,2) not null default 0 check (other_costs >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.insight_questions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.insight_campaigns(id) on delete cascade,
  position integer not null default 0,
  question_text text not null,
  answer_type text not null default 'pick_one' check (answer_type in ('pick_one','pick_many','yes_no','rating','text')),
  choices jsonb not null default '[]'::jsonb,
  required boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists insight_questions_campaign on public.insight_questions(campaign_id, position);

create table if not exists public.insight_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.insight_campaigns(id) on delete cascade,
  device_id uuid,
  session_id uuid,
  store_name text,
  brand_id uuid,
  accepted boolean,                       -- null = no answer yet, false = no thanks, true = took the survey
  created_at timestamptz not null default now()
);
create index if not exists insight_invites_campaign on public.insight_invites(campaign_id, created_at);

create table if not exists public.insight_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.insight_campaigns(id) on delete cascade,
  invite_id uuid references public.insight_invites(id) on delete set null,
  device_id uuid not null,
  session_id uuid,
  scan_id uuid references public.scans(id) on delete set null,
  store_name text,
  brand_id uuid,
  answers jsonb not null,                 -- [{question_id, question, answer}]
  accepted boolean not null default true, -- admin can reject a response; rejected ones are not billed
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (campaign_id, device_id)         -- one response, one reward, per phone per campaign
);

create table if not exists public.insight_coupons (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.insight_campaigns(id) on delete cascade,
  response_id uuid not null unique references public.insight_responses(id) on delete cascade,
  device_id uuid not null,
  code text not null unique,
  value numeric(10,2),
  offer_text text,
  issued_at timestamptz not null default now(),
  expires_on date not null,
  status text not null default 'issued' check (status in ('issued','redeemed','voided')),
  redeemed_at timestamptz,
  redeemed_store text,
  redeemed_by uuid,
  redeemed_by_email text,
  note text
);
create index if not exists insight_coupons_device on public.insight_coupons(device_id);
create index if not exists insight_coupons_campaign on public.insight_coupons(campaign_id);
create index if not exists insight_campaigns_brand on public.insight_campaigns(brand_id);
create index if not exists insight_responses_invite on public.insight_responses(invite_id);
create index if not exists insight_responses_scan on public.insight_responses(scan_id);

-- ---------- row level security: admins only; shoppers go through the functions below ----------
alter table public.insights_settings enable row level security;
alter table public.insight_campaigns enable row level security;
alter table public.insight_questions enable row level security;
alter table public.insight_invites enable row level security;
alter table public.insight_responses enable row level security;
alter table public.insight_coupons enable row level security;
create policy insights_settings_admin_all on public.insights_settings for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy insight_campaigns_admin_all on public.insight_campaigns for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy insight_questions_admin_all on public.insight_questions for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy insight_invites_admin_all on public.insight_invites for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy insight_responses_admin_all on public.insight_responses for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy insight_coupons_admin_all on public.insight_coupons for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------- touch and audit ----------
create trigger insights_settings_touch before update on public.insights_settings for each row execute function private.touch();
create trigger insight_campaigns_touch before update on public.insight_campaigns for each row execute function private.touch();
create trigger insights_settings_audit after update on public.insights_settings for each row execute function private.audit();
create trigger insight_campaigns_audit after insert or update or delete on public.insight_campaigns for each row execute function private.audit();
create trigger insight_questions_audit after insert or update or delete on public.insight_questions for each row execute function private.audit();
create trigger insight_coupons_audit after update or delete on public.insight_coupons for each row execute function private.audit();
create trigger insight_responses_audit after update or delete on public.insight_responses for each row execute function private.audit();

-- ---------- is a campaign live for shoppers right now? ----------
create or replace function private.insight_live(c public.insight_campaigns)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.insights_settings s where s.id = 1), false)
     and c.active
     and (c.starts_on is null or c.starts_on <= current_date)
     and (c.ends_on is null or c.ends_on >= current_date)
     and (c.max_surveys is null or
          (select count(*) from public.insight_responses r where r.campaign_id = c.id and r.accepted) < c.max_surveys)
     and exists (select 1 from public.insight_questions q where q.campaign_id = c.id);
$$;

-- ---------- shopper: is there a sponsored survey for me? ----------
create or replace function public.insights_offer(p_device uuid, p_session uuid, p_store text, p_brand uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.insight_campaigns; inv uuid; qs jsonb;
begin
  if p_device is null then return null; end if;
  select x.* into c from public.insight_campaigns x
   where private.insight_live(x)
     and (x.stores is null or cardinality(x.stores) = 0 or exists (
           select 1 from unnest(x.stores) s
            where length(trim(s)) > 0 and lower(coalesce(p_store, '')) like '%' || lower(trim(s)) || '%'))
     and (not x.only_brand_shoppers or (x.brand_id is not null and x.brand_id = p_brand))
     and not exists (select 1 from public.insight_responses r where r.campaign_id = x.id and r.device_id = p_device)
   order by x.created_at
   limit 1;
  if c.id is null then return null; end if;
  insert into public.insight_invites (campaign_id, device_id, session_id, store_name, brand_id)
  values (c.id, p_device, p_session, left(p_store, 200), p_brand) returning id into inv;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text, 'answer_type', q.answer_type,
                                               'choices', q.choices, 'required', q.required) order by q.position), '[]'::jsonb)
    into qs from public.insight_questions q where q.campaign_id = c.id;
  return jsonb_build_object(
    'invite_id', inv, 'campaign_id', c.id, 'sponsor_name', c.sponsor_name, 'intro', c.intro,
    'include_pilot_questions', c.include_pilot_questions,
    'reward', case when c.coupon_enabled and c.retailer_accepts_codes then jsonb_build_object(
        'offer_text', c.offer_text, 'value', c.coupon_value, 'eligible_products', c.eligible_products,
        'terms', c.redemption_terms, 'valid_days', c.coupon_valid_days,
        'stores', case when c.stores is null or cardinality(c.stores) = 0 then null else to_jsonb(c.stores) end) end,
    'questions', qs);
end $$;

-- ---------- shopper: no thanks ----------
create or replace function public.insights_decline(p_invite uuid, p_device uuid)
returns void language sql security definer set search_path = '' as $$
  update public.insight_invites set accepted = false
   where id = p_invite and device_id = p_device and accepted is null and created_at > now() - interval '1 hour';
$$;

-- ---------- shopper: send answers, get the reward ----------
create or replace function public.insights_submit(p_invite uuid, p_device uuid, p_scan uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.insight_invites; c public.insight_campaigns; q record; a jsonb; out jsonb := '[]'::jsonb;
        resp uuid; code text; tries int := 0; cp public.insight_coupons;
begin
  select * into i from public.insight_invites where id = p_invite and device_id = p_device and created_at > now() - interval '1 hour';
  if i.id is null then return jsonb_build_object('status', 'expired'); end if;
  select * into c from public.insight_campaigns where id = i.campaign_id;
  if c.id is null or not private.insight_live(c) then return jsonb_build_object('status', 'closed'); end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then return jsonb_build_object('status', 'invalid'); end if;
  for q in select * from public.insight_questions where campaign_id = c.id order by position loop
    a := p_answers -> q.id::text;
    if a is null or a = 'null'::jsonb or a = '""'::jsonb or a = '[]'::jsonb then
      if q.required then return jsonb_build_object('status', 'incomplete', 'question', q.question_text); end if;
      continue;
    end if;
    if jsonb_typeof(a) = 'string' then a := to_jsonb(left(a #>> '{}', 1000)); end if;
    out := out || jsonb_build_array(jsonb_build_object('question_id', q.id, 'question', q.question_text, 'answer', a));
  end loop;
  insert into public.insight_responses (campaign_id, invite_id, device_id, session_id, scan_id, store_name, brand_id, answers)
  values (c.id, i.id, p_device, i.session_id,
          (select s.id from public.scans s where s.id = p_scan and s.device_id = p_device),
          i.store_name, i.brand_id, out)
  on conflict (campaign_id, device_id) do nothing
  returning id into resp;
  if resp is null then return jsonb_build_object('status', 'already'); end if;
  update public.insight_invites set accepted = true where id = i.id;
  if not (c.coupon_enabled and c.retailer_accepts_codes) then return jsonb_build_object('status', 'thanks'); end if;
  loop
    tries := tries + 1;
    code := 'MB-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    begin
      insert into public.insight_coupons (campaign_id, response_id, device_id, code, value, offer_text, expires_on)
      values (c.id, resp, p_device, code, c.coupon_value, c.offer_text,
              current_date + c.coupon_valid_days)
      returning * into cp;
      exit;
    exception when unique_violation then
      if tries >= 5 then return jsonb_build_object('status', 'thanks'); end if;
    end;
  end loop;
  return jsonb_build_object('status', 'coupon', 'code', cp.code, 'value', cp.value, 'offer_text', cp.offer_text,
    'expires_on', cp.expires_on, 'sponsor_name', c.sponsor_name, 'terms', c.redemption_terms,
    'eligible_products', c.eligible_products,
    'stores', case when c.stores is null or cardinality(c.stores) = 0 then null else to_jsonb(c.stores) end);
end $$;

-- ---------- shopper: my coupons on this phone ----------
create or replace function public.insights_my_coupons(p_device uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', k.code, 'status', k.status, 'expires_on', k.expires_on,
           'offer_text', k.offer_text, 'value', k.value, 'sponsor_name', c.sponsor_name, 'terms', c.redemption_terms)
           order by k.issued_at desc), '[]'::jsonb)
    from public.insight_coupons k join public.insight_campaigns c on c.id = k.campaign_id
   where p_device is not null and k.device_id = p_device;
$$;

-- ---------- admin: mark a code used at checkout ----------
create or replace function public.insights_redeem(p_code text, p_store text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.insight_coupons; em text;
begin
  if not (select private.is_admin()) then return jsonb_build_object('ok', false, 'message', 'Only My Banana administrators can mark codes used.'); end if;
  select * into k from public.insight_coupons where code = upper(trim(p_code)) for update;
  if k.id is null then return jsonb_build_object('ok', false, 'message', 'No coupon has that code.'); end if;
  if k.status = 'redeemed' then return jsonb_build_object('ok', false, 'message', 'Already used on ' || to_char(k.redeemed_at at time zone 'America/New_York', 'Mon DD, YYYY HH12:MI AM') || coalesce(' at ' || k.redeemed_store, '') || '.'); end if;
  if k.status = 'voided' then return jsonb_build_object('ok', false, 'message', 'This code was voided and cannot be used.'); end if;
  if k.expires_on < current_date then return jsonb_build_object('ok', false, 'message', 'This code expired on ' || to_char(k.expires_on, 'Mon DD, YYYY') || '.'); end if;
  select u.email into em from auth.users u where u.id = auth.uid();
  update public.insight_coupons set status = 'redeemed', redeemed_at = now(), redeemed_store = nullif(left(trim(p_store), 200), ''),
         redeemed_by = auth.uid(), redeemed_by_email = em
   where id = k.id;
  return jsonb_build_object('ok', true, 'message', k.code || ' marked used. ' || coalesce(k.offer_text, ''));
end $$;

revoke all on function public.insights_offer(uuid, uuid, text, uuid) from public;
revoke all on function public.insights_decline(uuid, uuid) from public;
revoke all on function public.insights_submit(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.insights_my_coupons(uuid) from public;
revoke all on function public.insights_redeem(text, text) from public, anon;
grant execute on function public.insights_offer(uuid, uuid, text, uuid) to anon, authenticated;
grant execute on function public.insights_decline(uuid, uuid) to anon, authenticated;
grant execute on function public.insights_submit(uuid, uuid, uuid, jsonb) to anon, authenticated;
grant execute on function public.insights_my_coupons(uuid) to anon, authenticated;
grant execute on function public.insights_redeem(text, text) to authenticated;
revoke all on function private.insight_live(public.insight_campaigns) from public, anon;
