// My Banana: Consumer Insights & Rewards administration (sign-in required)
// Master on/off switch, sponsor survey campaigns with their own on/off switch, coupon codes and redemption,
// pricing and budgets, and sponsor reports. Nothing here touches the color reader or the ripeness result.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, STAGES, EATING } from './config.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  [].concat(kids).forEach((k) => n.append(k));
  return n;
};
const view = $('view');
const today = () => new Date().toISOString().slice(0, 10);
const money = (n, c) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(Number(n) || 0); } catch (e) { return (c || '') + ' ' + (Number(n) || 0).toFixed(2); } };
const day = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString([], { dateStyle: 'medium' }) : 'None');
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : 'Not Available');
const sum = (rows, f) => rows.reduce((t, r) => t + (Number(f(r)) || 0), 0);
const daysTo = (d) => (d ? Math.round((new Date(d + 'T12:00:00') - new Date(today() + 'T12:00:00')) / 86400000) : null);
let toastTimer = null;
function toast(msg, good) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast note ' + (good ? 'ok' : 'err'); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 7000);
}
const fail = (error, what) => toast((what || 'That did not save') + ': ' + ((error && error.message) || 'unknown error'));

const LABELS = {
  atype: { pick_one: 'Pick one', pick_many: 'Pick any', yes_no: 'Yes / No', rating: 'Rating 1 to 5', text: 'Written answer' },
  sponsor: { producer: 'Producer', retailer: 'Retailer' },
  cstat: { issued: 'Issued', redeemed: 'Redeemed', voided: 'Voided' },
};
const opts = (map) => Object.keys(map).map((k) => [k, map[k]]);
const chip = (text, tone) => el('span', { className: 'chip ' + (tone || ''), textContent: text });

// ---------- data ----------
async function load(table, order, asc) {
  const { data, error } = await db.from(table).select('*').order(order || 'created_at', { ascending: !!asc }).limit(5000);
  if (error) throw error;
  return data || [];
}

// ---------- small UI builders ----------
function table(heads, rows, empty, minWidth) {
  const t = el('table', minWidth ? { style: 'min-width:' + minWidth + 'px' } : {}, [el('thead', {}, [el('tr', {}, heads.map((h) => el('th', { textContent: h })))])]);
  const b = el('tbody'); t.append(b);
  rows.forEach((cells) => b.append(el('tr', {}, cells.map((c) => (c instanceof Node ? el('td', {}, [c]) : el('td', { textContent: c === null || c === undefined ? '' : String(c) }))))));
  if (!rows.length) b.append(el('tr', {}, [el('td', { colSpan: heads.length, className: 'muted', textContent: empty || 'Nothing here yet.' })]));
  return el('div', { className: 'scroll' }, [t]);
}
const act = (label, fn, tone) => { const b = el('button', { className: 'btn ' + (tone || ''), textContent: label }); b.addEventListener('click', fn); return b; };
const acts = (list) => el('div', { className: 'acts' }, list.filter(Boolean));
const card = (title, kids) => el('div', { className: 'card stack' }, [el('h2', { textContent: title })].concat(kids));
const head = (title, text, tools) => el('div', { className: 'head' }, [el('div', { className: 'stack', style: 'flex:1 1 420px' }, [el('h1', { textContent: title }), el('p', { className: 'muted', textContent: text })]), el('div', { className: 'tools' }, tools || [])]);
const tile = (label, value) => el('div', { className: 'tile' }, [el('div', { className: 'label', textContent: label }), el('div', { className: 'fig', textContent: String(value) })]);
function bars(pairs, total) {
  const b = el('div', { className: 'bars' });
  pairs.forEach(([label, n]) => b.append(el('div', { textContent: label }), el('div', { className: 'track' }, [el('div', { style: 'width:' + (total ? Math.round((n / total) * 100) : 0) + '%' })]), el('div', { className: 'val', textContent: n + ' · ' + pct(n, total) })));
  return b;
}
// A form card. fields: { key, label, type, options, help }. Returns the element; calls onSave(values).
function form(title, fields, values, onSave, onCancel, note) {
  const inputs = {};
  const grid = el('div', { className: 'form-grid' });
  const wide = [];
  fields.forEach((f) => {
    const v = values[f.key];
    const id = 'f-' + f.key;
    let input, holder;
    if (f.type === 'select') {
      input = el('select', { id }, f.options.map(([val, text]) => el('option', { value: val, textContent: text, selected: String(v === null || v === undefined ? '' : v) === String(val) })));
    } else if (f.type === 'textarea') {
      input = el('textarea', { id, rows: 3, value: v || '', maxLength: 4000 });
    } else if (f.type === 'checkbox') {
      input = el('input', { id, type: 'checkbox', checked: !!v });
    } else if (f.type === 'checks') {
      input = el('div', { className: 'checks' }, f.options.map(([val, text]) => el('label', {}, [el('input', { type: 'checkbox', value: val, checked: Array.isArray(v) && v.map(String).includes(String(val)) }), text])));
    } else {
      input = el('input', { id, type: f.type === 'date' ? 'date' : 'text', value: v === null || v === undefined ? '' : String(v), maxLength: 400 });
      if (f.type === 'number') input.inputMode = 'decimal';
    }
    inputs[f.key] = input;
    if (f.type === 'checkbox') holder = el('label', { className: 'opt', htmlFor: id }, [input, el('span', { textContent: f.label })]);
    else if (f.type === 'checks') holder = el('fieldset', {}, [el('legend', { className: 'label', textContent: f.label }), input]);
    else holder = el('div', { className: 'field' }, [el('label', { className: 'label', htmlFor: id, textContent: f.label }), input]);
    if (f.help) holder.append(el('div', { className: 'small muted', textContent: f.help }));
    (f.type === 'textarea' || f.type === 'checks' ? wide : null) ? wide.push(holder) : grid.append(holder);
  });
  const save = act('Save', async () => {
    const out = {};
    try {
      fields.forEach((f) => {
        const i = inputs[f.key];
        if (f.type === 'checkbox') out[f.key] = i.checked;
        else if (f.type === 'checks') { const picked = [...i.querySelectorAll('input:checked')].map((c) => (f.numeric ? Number(c.value) : c.value)); out[f.key] = picked.length ? picked : null; }
        else if (f.type === 'number') { const t = i.value.trim(); if (!t) { if (f.required) throw new Error(f.label + ' is required.'); out[f.key] = null; } else { const n = Number(t.replace(/[$,]/g, '')); if (!isFinite(n) || n < 0) throw new Error(f.label + ' must be a number, zero or more.'); out[f.key] = n; } }
        else { const t = String(i.value).trim(); if (!t && f.required) throw new Error(f.label + ' is required.'); if (t && f.https && !/^https:\/\//i.test(t)) throw new Error(f.label + ' must start with https://'); out[f.key] = t || null; }
      });
    } catch (e) { return toast(e.message); }
    save.disabled = true;
    await onSave(out);
    save.disabled = false;
  }, 'primary');
  const c = card(title, [note ? el('p', { className: 'small muted', textContent: note }) : '', grid].concat(wide).concat([el('div', { className: 'acts' }, [save, act('Cancel', onCancel)])]));
  c.id = 'the-form';
  return c;
}
function showForm(node) { const old = $('the-form'); if (old) old.remove(); view.prepend(node); node.scrollIntoView({ block: 'start' }); }
const closeForm = () => { const old = $('the-form'); if (old) old.remove(); };

// ---------- data helpers ----------
const ALL = async () => {
  const [settings, campaigns, questions, invites, responses, coupons, brands] = await Promise.all([
    db.from('insights_settings').select('*').eq('id', 1).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data || { enabled: false, default_setup_fee: 500, default_price_per_survey: 2.5 }; }),
    load('insight_campaigns', 'created_at', true), load('insight_questions', 'position', true), load('insight_invites'),
    load('insight_responses'), load('insight_coupons', 'issued_at'), load('brands', 'sort', true),
  ]);
  return { settings, campaigns, questions, invites, responses, coupons, brands };
};
const inWindow = (c) => (!c.starts_on || c.starts_on <= today()) && (!c.ends_on || c.ends_on >= today());
// Why a campaign is or is not reaching shoppers right now
function liveState(c, d) {
  const accepted = d.responses.filter((r) => r.campaign_id === c.id && r.accepted).length;
  if (!d.settings.enabled) return ['Off: service switched off', ''];
  if (!c.active) return ['Off', ''];
  if (!d.questions.some((q) => q.campaign_id === c.id)) return ['Needs questions', 'bad'];
  if (c.starts_on && c.starts_on > today()) return ['Starts ' + day(c.starts_on), ''];
  if (c.ends_on && c.ends_on < today()) return ['Ended', ''];
  if (c.max_surveys && accepted >= c.max_surveys) return ['Survey limit reached', ''];
  return ['Live', 'ok'];
}
function money2(c, d) {   // campaign economics
  const acc = d.responses.filter((r) => r.campaign_id === c.id && r.accepted).length;
  const mine = d.coupons.filter((k) => k.campaign_id === c.id && k.status !== 'voided');
  const red = mine.filter((k) => k.status === 'redeemed');
  const service = Number(c.setup_fee) + acc * Number(c.price_per_survey);
  const issuedFace = sum(mine, (k) => k.value), redeemedFace = sum(red, (k) => k.value);
  const processing = red.length * Number(c.processing_cost_per_redemption);
  const budget = c.max_surveys ? Number(c.setup_fee) + c.max_surveys * Number(c.price_per_survey) + (c.coupon_enabled ? c.max_surveys * Number(c.coupon_value || 0) : 0) : null;
  return { acc, issued: mine.length, redeemed: red.length, service, issuedFace, redeemedFace, processing, other: Number(c.other_costs), contribution: service - Number(c.other_costs), budget };
}

// ---------- sign in and navigation ----------
let ME = null;
const isAdmin = () => ME && (ME.role === 'owner' || ME.role === 'admin');
const SECTIONS = [
  ['overview', 'Switch & Overview', overview],
  ['campaigns', 'Survey Campaigns', campaignsTab],
  ['questions', 'Campaign Questions', questionsTab],
  ['coupons', 'Coupons & Redemption', couponsTab],
  ['reports', 'Sponsor Reports', reportsTab],
];
function authMsg(text) { const m = $('auth-msg'); m.textContent = text; m.hidden = !text; }
function showSignin(msg) { $('signin').hidden = false; $('app').hidden = true; $('top').hidden = true; authMsg(msg); }
async function boot() {
  const { data } = await db.auth.getSession();
  if (!data.session) return showSignin('');
  const { data: role, error } = await db.rpc('my_admin_role');
  if (error || !role || !role.role || !(role.role === 'owner' || role.role === 'admin')) { await db.auth.signOut(); return showSignin('This page is for My Banana platform owners and admins only, and the email must be confirmed.'); }
  ME = role;
  $('signin').hidden = true; $('app').hidden = false; $('top').hidden = false;
  const side = $('side'); side.textContent = '';
  SECTIONS.forEach(([key, label]) => { const b = el('button', { className: 'btn', textContent: label }); b.dataset.sec = key; b.addEventListener('click', () => open(key)); side.append(b); });
  const h = (location.hash || '').slice(1);
  open(SECTIONS.find((s) => s[0] === h) ? h : 'overview');
}
let opening = 0;
async function open(key, arg) {
  const sec = SECTIONS.find((s) => s[0] === key); if (!sec) return;
  const mine = ++opening;
  document.querySelectorAll('#side [data-sec]').forEach((b) => (b.dataset.sec === key ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  history.replaceState(null, '', '#' + key);
  view.textContent = ''; view.append(el('p', { className: 'muted', textContent: 'Loading…' }));
  try { const nodes = await sec[2](arg); if (mine !== opening) return; view.textContent = ''; nodes.forEach((n) => n && view.append(n)); }
  catch (e) { if (mine !== opening) return; view.textContent = ''; view.append(el('div', { className: 'note err', textContent: 'Could not load this page: ' + (e.message || e) })); }
}
$('do-signin').addEventListener('click', async () => {
  authMsg('');
  const { error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) return authMsg(/confirm/i.test(error.message) ? 'Confirm your email first: open the message we sent and press the link.' : 'Sign in failed. Check the email and password.');
  boot();
});
$('sign-out').addEventListener('click', async () => { await db.auth.signOut(); ME = null; showSignin(''); });

// ---------- 1. switch and overview ----------
async function overview() {
  const d = await ALL();
  const on = !!d.settings.enabled;
  const live = d.campaigns.filter((c) => liveState(c, d)[0] === 'Live');
  const flip = act(on ? 'Turn the service OFF' : 'Turn the service ON', async () => {
    const msg = on
      ? 'Turn Consumer Insights & Rewards OFF? Shoppers stop seeing sponsor surveys right away and get the pilot survey instead. Codes already issued stay valid.'
      : 'Turn Consumer Insights & Rewards ON? Every campaign that is switched on, in its dates and under its survey limit will start inviting shoppers. Coupon codes are issued only by campaigns marked "retailer has agreed to accept these codes".';
    if (!window.confirm(msg)) return;
    const r = await db.from('insights_settings').update({ enabled: !on }).eq('id', 1);
    if (r.error) return fail(r.error, 'The switch did not change');
    toast('Consumer Insights & Rewards is now ' + (!on ? 'ON' : 'OFF') + '.', true); open('overview');
  }, on ? 'danger' : 'primary');
  const sw = el('div', { className: 'card stack' + (on ? ' switch-on' : '') }, [
    el('div', { className: 'head' }, [
      el('div', { className: 'stack' }, [el('h2', { textContent: 'Master switch' }), el('p', { className: 'muted', textContent: on ? 'ON. Shoppers can be invited to sponsor surveys by campaigns that are switched on.' : 'OFF. Shoppers see only the regular pilot survey. Nothing sponsored is shown.' })]),
      el('div', { className: 'tools' }, [chip(on ? 'Service ON' : 'Service OFF', on ? 'ok big' : 'big'), flip])]),
    el('p', { className: 'small muted', textContent: 'Each campaign also has its own on/off switch on the Survey Campaigns page. A shopper is invited only when this switch AND the campaign switch are on, the campaign is inside its dates, has questions, matches the shopper’s store (and brand, if set), and has not reached its survey limit. One response and one code per phone per campaign.' }),
  ]);
  const tot = (f) => sum(d.campaigns, (c) => f(money2(c, d)));
  const nodes = [head('Consumer Insights & Rewards', 'Sponsor-funded shopper surveys with an optional one-time coupon code. The ripeness result is never affected by a sponsor or by survey answers.', []), sw];
  nodes.push(el('div', { className: 'tiles' }, [
    tile('Live campaigns', live.length),
    tile('Survey invitations', d.invites.length || 'None yet'),
    tile('Completed surveys', d.responses.length || 'None yet'),
    tile('Accepted (billable)', d.responses.filter((r) => r.accepted).length || 'None yet'),
    tile('Codes issued', d.coupons.filter((k) => k.status !== 'voided').length || 'None yet'),
    tile('Codes redeemed', d.coupons.filter((k) => k.status === 'redeemed').length || 'None yet'),
    tile('Service revenue to date', d.campaigns.length ? money(tot((m) => m.service)) : 'None yet'),
    tile('Coupon face value redeemed', d.coupons.some((k) => k.status === 'redeemed') ? money(tot((m) => m.redeemedFace)) : 'None yet'),
  ]));
  const fields = [
    { key: 'default_setup_fee', label: 'Default campaign setup fee ($)', type: 'number', required: true },
    { key: 'default_price_per_survey', label: 'Default price per accepted survey ($)', type: 'number', required: true },
  ];
  nodes.push(form('Default pricing for new campaigns', fields, d.settings, async (v) => {
    const r = await db.from('insights_settings').update(v).eq('id', 1);
    if (r.error) return fail(r.error, 'Pricing did not save');
    toast('Default pricing saved. Existing campaigns keep their own prices.', true); open('overview');
  }, () => open('overview'), 'Proposed commercial targets, subject to negotiation. Each campaign can carry its own contract price.'));
  nodes.push(card('Before a coupon campaign goes live', [el('ol', { className: 'small' }, [
    'A producer or retailer sponsor has signed a survey campaign and funding agreement.',
    'Survey questions and what counts as a complete response are agreed.',
    'Coupon value, eligible products and the campaign budget are confirmed.',
    'The participating retailer has agreed to accept My Banana codes at checkout, and staff know how to mark a code used.',
    'Consumer disclosures, privacy terms and reporting are approved.',
  ].map((t) => el('li', { textContent: t }))), el('p', { className: 'small muted', textContent: 'A campaign issues codes only when "Retailer has agreed to accept these codes" is ticked. Until then it can still run as a survey without a reward.' })]));
  return nodes;
}

// ---------- 2. campaigns ----------
const splitList = (t) => (t ? t.split(',').map((x) => x.trim()).filter(Boolean) : null);
async function campaignsTab() {
  const d = await ALL();
  const bn = (id) => (d.brands.find((b) => b.id === id) || {}).name || '';
  const fields = [
    { key: 'name', label: 'Campaign name (admin only)', required: true },
    { key: 'sponsor_type', label: 'Sponsor type', type: 'select', options: opts(LABELS.sponsor) },
    { key: 'sponsor_name', label: 'Sponsor name (shown to shoppers)', required: true },
    { key: 'brand_id', label: 'Producer brand (optional)', type: 'select', options: [['', 'None']].concat(d.brands.map((b) => [b.id, b.name])) },
    { key: 'only_brand_shoppers', label: 'Invite only shoppers who picked this brand', type: 'checkbox' },
    { key: 'stores_text', label: 'Participating stores (comma separated; blank = every store)', help: 'Matched against the store name the shopper types. "Publix" matches "Publix #1234".' },
    { key: 'starts_on', label: 'Starts', type: 'date' }, { key: 'ends_on', label: 'Ends', type: 'date' },
    { key: 'include_pilot_questions', label: 'Also ask the regular pilot questions', type: 'checkbox' },
    { key: 'coupon_enabled', label: 'Give a one-time coupon code for a completed survey', type: 'checkbox' },
    { key: 'retailer_accepts_codes', label: 'Retailer has agreed to accept these codes at checkout', type: 'checkbox', help: 'No code is issued until this is ticked.' },
    { key: 'offer_text', label: 'Offer shown to shoppers', help: 'For example: $2.00 off Chiquita bananas' },
    { key: 'coupon_value', label: 'Coupon value ($)', type: 'number' },
    { key: 'eligible_products', label: 'Eligible products' },
    { key: 'coupon_valid_days', label: 'Code good for (days)', type: 'number', required: true },
    { key: 'setup_fee', label: 'Setup fee ($)', type: 'number', required: true },
    { key: 'price_per_survey', label: 'Price per accepted survey ($)', type: 'number', required: true },
    { key: 'max_surveys', label: 'Survey limit (campaign stops here)', type: 'number' },
    { key: 'processing_cost_per_redemption', label: 'Processing cost per redeemed code ($)', type: 'number' },
    { key: 'other_costs', label: 'Other campaign costs ($)', type: 'number' },
    { key: 'intro', label: 'Invitation line shown to shoppers', type: 'textarea' },
    { key: 'redemption_terms', label: 'Coupon terms shown to shoppers', type: 'textarea' },
    { key: 'notes', label: 'Admin notes', type: 'textarea' },
  ];
  const edit = (c) => showForm(form(c ? 'Edit ' + c.name : 'New survey campaign', fields,
    c ? Object.assign({}, c, { stores_text: (c.stores || []).join(', ') })
      : { sponsor_type: 'producer', include_pilot_questions: true, coupon_valid_days: 30, setup_fee: d.settings.default_setup_fee, price_per_survey: d.settings.default_price_per_survey, processing_cost_per_redemption: 0, other_costs: 0 },
    async (v) => {
      v.stores = splitList(v.stores_text); delete v.stores_text;
      v.brand_id = v.brand_id || null;
      ['processing_cost_per_redemption', 'other_costs'].forEach((k) => { if (v[k] === null) v[k] = 0; });
      if (v.max_surveys !== null) v.max_surveys = Math.round(v.max_surveys) || null;
      v.coupon_valid_days = Math.max(1, Math.min(365, Math.round(v.coupon_valid_days)));
      if (v.only_brand_shoppers && !v.brand_id) return toast('Pick the producer brand, or untick "Invite only shoppers who picked this brand".');
      if (v.coupon_enabled && (!v.offer_text || !v.coupon_value)) return toast('A coupon needs the offer shown to shoppers and a coupon value.');
      if (v.starts_on && v.ends_on && v.ends_on < v.starts_on) return toast('The end date is before the start date.');
      const r = c ? await db.from('insight_campaigns').update(v).eq('id', c.id) : await db.from('insight_campaigns').insert(Object.assign(v, { active: false }));
      if (r.error) return fail(r.error, 'The campaign did not save');
      toast(c ? 'Campaign saved.' : 'Campaign saved. It starts switched OFF: add questions, then switch it on.', true); open('campaigns');
    }, closeForm, 'Shoppers are told the reward does not depend on their answers, that taking part is optional, and that the sponsor sees combined answers only.'));
  const rows = d.campaigns.map((c) => {
    const [st, tone] = liveState(c, d); const m = money2(c, d);
    const reward = c.coupon_enabled ? (c.retailer_accepts_codes ? (c.offer_text || money(c.coupon_value)) : 'Coupon waiting on retailer') : 'No coupon';
    return [el('div', {}, [el('strong', { textContent: c.name }), el('div', { className: 'small muted', textContent: LABELS.sponsor[c.sponsor_type] + ' · ' + c.sponsor_name + (c.brand_id ? ' · ' + bn(c.brand_id) : '') })]),
      chip(st, tone), (c.stores && c.stores.length ? c.stores.join(', ') : 'Every store'), (c.starts_on || c.ends_on ? day(c.starts_on) + ' to ' + day(c.ends_on) : 'No dates'),
      reward, m.acc + (c.max_surveys ? ' of ' + c.max_surveys : ''), m.issued + ' / ' + m.redeemed,
      acts([act(c.active ? 'Switch off' : 'Switch on', async () => {
        if (!c.active && !d.questions.some((q) => q.campaign_id === c.id)) return toast('Add at least one question before switching this campaign on.');
        const r = await db.from('insight_campaigns').update({ active: !c.active }).eq('id', c.id);
        if (r.error) return fail(r.error); toast(c.name + ' is switched ' + (!c.active ? 'on' : 'off') + (!c.active && !d.settings.enabled ? '. The master switch is still OFF, so shoppers will not see it yet.' : '.'), true); open('campaigns');
      }, c.active ? 'danger' : 'primary'), act('Edit', () => edit(c)), act('Questions', () => open('questions', { campaign: c.id })), act('Report', () => open('reports', { campaign: c.id }))])];
  });
  return [head('Survey Campaigns', d.settings.enabled ? 'Master switch is ON.' : 'Master switch is OFF: no campaign reaches shoppers until it is turned on.', [act('New campaign', () => edit(null), 'primary')]),
    table(['Campaign', 'Status', 'Stores', 'Dates', 'Reward', 'Accepted surveys', 'Codes issued / used', ''], rows, 'No campaigns yet. Press New campaign.', 1100)];
}

// ---------- 3. questions ----------
async function questionsTab(arg) {
  const d = await ALL();
  if (!d.campaigns.length) return [head('Campaign Questions', 'Create a campaign first.', [act('Survey Campaigns', () => open('campaigns'))])];
  const cid = (arg && arg.campaign) || d.campaigns[0].id;
  const c = d.campaigns.find((x) => x.id === cid) || d.campaigns[0];
  const qs = d.questions.filter((q) => q.campaign_id === c.id);
  const answered = d.responses.some((r) => r.campaign_id === c.id);
  const pick = el('select', {}, d.campaigns.map((x) => el('option', { value: x.id, textContent: x.name, selected: x.id === c.id })));
  pick.addEventListener('change', () => open('questions', { campaign: pick.value }));
  const fields = [
    { key: 'question_text', label: 'Question', required: true },
    { key: 'answer_type', label: 'Answer type', type: 'select', options: opts(LABELS.atype) },
    { key: 'choices_text', label: 'Choices (one per line; for Pick one or Pick any)', type: 'textarea' },
    { key: 'required', label: 'Required for a complete response', type: 'checkbox' },
  ];
  const edit = (q) => showForm(form(q ? 'Edit question' : 'Add a question to ' + c.name, fields,
    q ? Object.assign({}, q, { choices_text: (q.choices || []).join('\n') }) : { answer_type: 'pick_one', required: true },
    async (v) => {
      const choices = (v.choices_text || '').split('\n').map((x) => x.trim()).filter(Boolean); delete v.choices_text;
      if ((v.answer_type === 'pick_one' || v.answer_type === 'pick_many') && choices.length < 2) return toast('Add at least two choices, one per line.');
      v.choices = (v.answer_type === 'pick_one' || v.answer_type === 'pick_many') ? choices : [];
      const r = q ? await db.from('insight_questions').update(v).eq('id', q.id) : await db.from('insight_questions').insert(Object.assign(v, { campaign_id: c.id, position: qs.length + 1 }));
      if (r.error) return fail(r.error, 'The question did not save');
      toast('Question saved.', true); open('questions', { campaign: c.id });
    }, closeForm, answered ? 'Shoppers have already answered this campaign. Each response keeps the question text it was asked with, so editing is safe, but new wording will make reports harder to compare.' : ''));
  const move = async (q, dir) => {
    const i = qs.indexOf(q), j = i + dir; if (j < 0 || j >= qs.length) return;
    const a = qs[i], b = qs[j];
    const r1 = await db.from('insight_questions').update({ position: b.position === a.position ? j + 1 : b.position }).eq('id', a.id);
    const r2 = await db.from('insight_questions').update({ position: b.position === a.position ? i + 1 : a.position }).eq('id', b.id);
    if (r1.error || r2.error) return fail(r1.error || r2.error); open('questions', { campaign: c.id });
  };
  return [head('Campaign Questions', 'Questions shown to shoppers who accept ' + c.sponsor_name + '’s invitation. Rewards never depend on the answers, so never ask for a positive answer.', [pick, act('Add question', () => edit(null), 'primary')]),
    table(['#', 'Question', 'Answer type', 'Choices', 'Required', ''], qs.map((q, i) => [i + 1, q.question_text, LABELS.atype[q.answer_type], (q.choices || []).join(' · '), q.required ? 'Yes' : 'No',
      acts([act('Up', () => move(q, -1)), act('Down', () => move(q, 1)), act('Edit', () => edit(q)), act('Delete', async () => {
        if (!window.confirm('Delete "' + q.question_text + '"? Answers already given are kept in their responses.')) return;
        const r = await db.from('insight_questions').delete().eq('id', q.id); if (r.error) return fail(r.error); open('questions', { campaign: c.id });
      }, 'danger')])]), 'No questions yet. A campaign needs at least one before it can be switched on.', 900),
    c.include_pilot_questions ? el('p', { className: 'small muted', textContent: 'The regular pilot survey questions are asked after these (set on the campaign).' }) : ''];
}

// ---------- 4. coupons ----------
async function couponsTab() {
  const d = await ALL();
  const cn = (id) => (d.campaigns.find((c) => c.id === id) || {}).name || '';
  const code = el('input', { type: 'text', placeholder: 'MB-XXXX-XXXX', maxLength: 20, style: 'min-height:44px;text-transform:uppercase' });
  const store = el('input', { type: 'text', placeholder: 'Store where it was used', maxLength: 200, style: 'min-height:44px' });
  const out = el('div', { className: 'note', hidden: true });
  const redeem = act('Mark code used', async () => {
    if (!code.value.trim()) return toast('Type the code from the shopper’s phone.');
    redeem.disabled = true;
    const { data, error } = await db.rpc('insights_redeem', { p_code: code.value, p_store: store.value });
    redeem.disabled = false;
    if (error) return fail(error, 'Could not check the code');
    out.hidden = false; out.className = 'note ' + (data.ok ? 'ok' : 'err'); out.textContent = data.message;
    if (data.ok) { code.value = ''; setTimeout(() => open('coupons'), 1500); }
  }, 'primary');
  const filter = el('select', {}, [['all', 'All codes'], ['issued', 'Issued, not used'], ['redeemed', 'Redeemed'], ['voided', 'Voided']].map(([v, t]) => el('option', { value: v, textContent: t })));
  const holder = el('div');
  const draw = () => {
    holder.textContent = '';
    const list = d.coupons.filter((k) => filter.value === 'all' || k.status === filter.value);
    holder.append(table(['Code', 'Campaign', 'Offer', 'Issued', 'Good through', 'Status', 'Used at', ''], list.map((k) => [
      el('span', { className: 'code', textContent: k.code }), cn(k.campaign_id), k.offer_text || money(k.value), when(k.issued_at), day(k.expires_on),
      chip(LABELS.cstat[k.status] + (k.status === 'issued' && k.expires_on < today() ? ' (expired)' : ''), k.status === 'redeemed' ? 'ok' : k.status === 'voided' ? 'bad' : ''),
      k.redeemed_at ? when(k.redeemed_at) + (k.redeemed_store ? ' · ' + k.redeemed_store : '') + (k.redeemed_by_email ? ' · ' + k.redeemed_by_email : '') : '',
      k.status === 'issued' ? acts([act('Void', async () => {
        const why = window.prompt('Why is ' + k.code + ' being voided?'); if (why === null) return;
        const r = await db.from('insight_coupons').update({ status: 'voided', note: why || null }).eq('id', k.id); if (r.error) return fail(r.error); open('coupons');
      }, 'danger')]) : (k.note || '')]), 'No codes match.', 1100));
  };
  filter.addEventListener('change', draw); draw();
  return [head('Coupons & Redemption', 'Each code works once. A code counts as redeemed only when it is marked used here at checkout.', []),
    card('Mark a code used at checkout', [el('div', { className: 'form-grid' }, [code, store]), el('div', { className: 'acts' }, [redeem]), out,
      el('p', { className: 'small muted', textContent: 'The code is checked first: wrong, already used, voided or expired codes are refused. Store staff need a My Banana admin sign-in to use this page.' })]),
    el('div', { className: 'head' }, [el('h2', { textContent: 'All codes' }), el('div', { className: 'tools' }, [filter])]), holder];
}

// ---------- 5. reports ----------
async function reportsTab(arg) {
  const d = await ALL();
  if (!d.campaigns.length) return [head('Sponsor Reports', 'No campaigns yet.', [])];
  const c = d.campaigns.find((x) => x.id === (arg && arg.campaign)) || d.campaigns[0];
  const pick = el('select', {}, d.campaigns.map((x) => el('option', { value: x.id, textContent: x.name, selected: x.id === c.id })));
  pick.addEventListener('change', () => open('reports', { campaign: pick.value }));
  const inv = d.invites.filter((i) => i.campaign_id === c.id);
  const resp = d.responses.filter((r) => r.campaign_id === c.id);
  const acc = resp.filter((r) => r.accepted);
  const m = money2(c, d);
  const scanIds = acc.map((r) => r.scan_id).filter(Boolean);
  let scans = [];
  if (scanIds.length) { const r = await db.from('scans').select('id,stage,eating_time').in('id', scanIds.slice(0, 1000)); scans = r.data || []; }
  const stagePairs = STAGES.map((s) => ['Stage ' + s.num + ' ' + s.name, scans.filter((x) => x.stage === s.num).length]);
  const eatPairs = EATING.options.map((o) => [o.label, scans.filter((x) => x.eating_time === o.key).length]);
  const nodes = [head('Sponsor Report: ' + c.name, c.sponsor_name + ' · combined answers only. No names, contacts or phone IDs are included.', [pick, act('Download CSV', () => csv(c, acc)), act('Print', () => window.print())])];
  nodes.push(el('div', { className: 'tiles' }, [
    tile('Invitations', inv.length), tile('Said no thanks', inv.filter((i) => i.accepted === false).length),
    tile('Completed surveys', resp.length), tile('Completion rate', pct(resp.length, inv.length)),
    tile('Accepted (billable)', acc.length + (c.max_surveys ? ' of ' + c.max_surveys : '')),
    tile('Codes issued', m.issued), tile('Codes redeemed', m.redeemed), tile('Redemption rate', pct(m.redeemed, m.issued)),
  ]));
  nodes.push(el('div', { className: 'cols' }, [
    card('Ripeness stage scanned (accepted surveys)', [scans.length ? bars(stagePairs, scans.length) : el('p', { className: 'muted', textContent: 'No linked scans yet.' })]),
    card('When shoppers plan to eat them', [scans.length ? bars(eatPairs, scans.length) : el('p', { className: 'muted', textContent: 'No linked scans yet.' })]),
  ]));
  // answer summaries, by the question text each shopper was asked
  const byQ = {};
  acc.forEach((r) => (r.answers || []).forEach((a) => { (byQ[a.question] = byQ[a.question] || []).push(a.answer); }));
  const sums = Object.keys(byQ).map((qt) => {
    const ans = byQ[qt]; const counts = {}; let written = [];
    ans.forEach((a) => { if (Array.isArray(a)) a.forEach((x) => { counts[x] = (counts[x] || 0) + 1; }); else if (String(a).length > 40) written.push(String(a)); else counts[a] = (counts[a] || 0) + 1; });
    const pairs = Object.keys(counts).sort((x, y) => counts[y] - counts[x]).map((k) => [k, counts[k]]);
    return card(qt, [pairs.length ? bars(pairs, ans.length) : '', written.length ? el('ul', { className: 'small' }, written.slice(0, 20).map((w) => el('li', { textContent: w }))) : '', el('p', { className: 'small muted', textContent: ans.length + ' answers' })]);
  });
  nodes.push(el('h2', { textContent: 'Survey answers' }));
  nodes.push(...(sums.length ? sums : [el('p', { className: 'muted', textContent: 'No accepted answers yet.' })]));
  nodes.push(card('Campaign costs and revenue', [table(['Item', 'Amount'], [
    ['Setup fee', money(c.setup_fee)], [acc.length + ' accepted surveys × ' + money(c.price_per_survey), money(acc.length * Number(c.price_per_survey))],
    ['My Banana service revenue', money(m.service)],
    ['Coupon face value issued (sponsor-funded, separate)', money(m.issuedFace)], ['Coupon face value redeemed (sponsor-funded, separate)', money(m.redeemedFace)],
    ['Redemption processing (' + m.redeemed + ' × ' + money(c.processing_cost_per_redemption) + ', per agreement)', money(m.processing)],
    ['Other campaign costs', money(m.other)], ['Contribution (service revenue less other costs)', money(m.contribution)],
    ['Maximum sponsor budget at the survey limit', m.budget === null ? 'No survey limit set' : money(m.budget)],
  ], '')]));
  // response review
  nodes.push(card('Responses', [table(['When', 'Store', 'Answers', 'Status', ''], resp.slice(0, 300).map((r) => [when(r.created_at), r.store_name || '',
    (r.answers || []).map((a) => a.question + ': ' + (Array.isArray(a.answer) ? a.answer.join(', ') : a.answer)).join(' | '),
    chip(r.accepted ? 'Accepted' : 'Rejected' + (r.reject_reason ? ': ' + r.reject_reason : ''), r.accepted ? 'ok' : 'bad'),
    acts([act(r.accepted ? 'Reject' : 'Accept', async () => {
      let reason = null;
      if (r.accepted) { reason = window.prompt('Why reject this response? Rejected responses are not billed. Any code already issued stays valid unless you void it.'); if (reason === null) return; }
      const x = await db.from('insight_responses').update({ accepted: !r.accepted, reject_reason: r.accepted ? (reason || 'Rejected') : null }).eq('id', r.id);
      if (x.error) return fail(x.error); open('reports', { campaign: c.id });
    })])]), 'No responses yet.', 900)]));
  nodes.push(el('p', { className: 'small muted', textContent: 'A scan or a survey answer is not counted as a banana purchase. Redemptions count only codes marked used at checkout.' }));
  return nodes;
}
function csv(c, acc) {
  const qs = [...new Set(acc.flatMap((r) => (r.answers || []).map((a) => a.question)))];
  const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Date', 'Store'].concat(qs).map(esc).join(',')];
  acc.forEach((r) => lines.push([r.created_at.slice(0, 10), r.store_name || ''].concat(qs.map((q) => { const a = (r.answers || []).find((x) => x.question === q); return a ? (Array.isArray(a.answer) ? a.answer.join('; ') : a.answer) : ''; })).map(esc).join(',')));
  const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: (c.name || 'campaign').replace(/[^a-z0-9]+/gi, '-') + '-answers.csv' });
  document.body.append(a); a.click(); a.remove();
}

db.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') showSignin(''); });
boot();
