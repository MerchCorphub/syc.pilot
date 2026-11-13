// My Banana: Brand Education administration center (sign-in required)
// Brand directory, education content, pricing, contracts, manual billing, reports, access roles and audit.
// Nothing here touches the color reader or the plan-match rules.
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
  rel: { directory_only: 'Directory Only', prospect: 'Prospect', pilot_proposed: 'Pilot Proposed', pilot_active: 'Pilot Active', licensed_partner: 'Licensed Partner', expired: 'Expired', suspended: 'Suspended' },
  kind: { overview: 'Brand overview', article: 'Educational article', ripeness: 'Ripeness tip', storage: 'Storage tip', recipe: 'Recipe', video: 'Video', faq: 'FAQ', image: 'Approved image', resource: 'External resource', waste: 'Food waste tip', website: 'Official website link' },
  wf: { draft: 'Draft', pending_review: 'Pending Review', approved: 'Approved', published: 'Published', archived: 'Archived' },
  freq: { free: 'Free', one_time: 'One-time', monthly: 'Monthly', annual: 'Annual' },
  pkind: { free: 'Free listing', pilot: 'Pilot', license: 'License', campaign: 'Campaign', other: 'Other' },
  cstat: { draft: 'Draft', proposed: 'Proposed', signed: 'Signed', active: 'Active', expired: 'Expired', terminated: 'Terminated' },
  istat: { unpaid: 'Unpaid', partially_paid: 'Partially Paid', paid: 'Paid', overdue: 'Overdue', voided: 'Voided' },
  camp: { draft: 'Draft', active: 'Active', ended: 'Ended' },
  role: { owner: 'Platform Owner', admin: 'SYC Admin', content: 'Content Manager' },
};
const opts = (map) => Object.keys(map).map((k) => [k, map[k]]);
const chip = (text, tone) => el('span', { className: 'chip ' + (tone || ''), textContent: text });

// ---------- data ----------
async function load(table, order, asc) {
  const { data, error } = await db.from(table).select('*').order(order || 'created_at', { ascending: !!asc }).limit(5000);
  if (error) throw error;
  return data || [];
}
const liveContract = (c) => c.status === 'active' && (!c.effective_date || c.effective_date <= today()) && (!c.expiration_date || c.expiration_date >= today());
const campLive = (c) => c.status === 'active' && (!c.starts_on || c.starts_on <= today()) && (!c.ends_on || c.ends_on >= today());

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

// ---------- sign in and navigation ----------
let ME = null;          // { role, finance }
const isAdmin = () => ME && (ME.role === 'owner' || ME.role === 'admin');
const canFin = () => ME && ME.finance;
const SECTIONS = [
  ['overview', 'Overview', () => isAdmin(), overview],
  ['brands', 'Brand Directory', () => isAdmin(), brandsTab],
  ['content', 'Education Content', () => true, contentTab],
  ['pricing', 'Pricing & Packages', () => isAdmin(), pricingTab],
  ['contracts', 'Service Contracts', () => isAdmin(), contractsTab],
  ['billing', 'Billing Center', () => isAdmin(), billingTab],
  ['reports', 'Analytics & Reports', () => isAdmin(), reportsTab],
  ['settings', 'Settings & Audit', () => isAdmin(), settingsTab],
];
function authMsg(text) { const m = $('auth-msg'); m.textContent = text; m.hidden = !text; }
function showSignin(msg) { $('signin').hidden = false; $('app').hidden = true; $('top').hidden = true; authMsg(msg); }
async function boot() {
  const { data } = await db.auth.getSession();
  if (!data.session) return showSignin('');
  const { data: role, error } = await db.rpc('my_admin_role');
  if (error || !role || !role.role) { await db.auth.signOut(); return showSignin('This account is not an approved administrator, or its email is not confirmed yet.'); }
  ME = role;
  $('signin').hidden = true; $('app').hidden = false; $('top').hidden = false;
  $('pilot-link').hidden = !isAdmin();
  const side = $('side'); side.textContent = '';
  SECTIONS.filter((s) => s[2]()).forEach(([key, label]) => { const b = el('button', { className: 'btn', textContent: label }); b.dataset.sec = key; b.addEventListener('click', () => open(key)); side.append(b); });
  side.append(el('div', { className: 'small muted', textContent: 'Signed in as ' + LABELS.role[ME.role] + (ME.finance && ME.role !== 'owner' ? ' (finance)' : '') }));
  open((location.hash || '').slice(1) && SECTIONS.find((s) => s[0] === location.hash.slice(1) && s[2]()) ? location.hash.slice(1) : SECTIONS.find((s) => s[2]())[0]);
}
let opening = 0;
async function open(key, arg) {
  const sec = SECTIONS.find((s) => s[0] === key && s[2]()); if (!sec) return;
  const mine = ++opening;
  document.querySelectorAll('#side [data-sec]').forEach((b) => (b.dataset.sec === key ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  history.replaceState(null, '', '#' + key);
  view.textContent = ''; view.append(el('p', { className: 'muted', textContent: 'Loading…' }));
  try { const nodes = await sec[3](arg); if (mine !== opening) return; view.textContent = ''; nodes.forEach((n) => n && view.append(n)); }
  catch (e) { if (mine !== opening) return; view.textContent = ''; view.append(el('div', { className: 'note err', textContent: 'Could not load this page: ' + (e.message || e) })); }
}
$('do-signin').addEventListener('click', async () => {
  authMsg('');
  const { error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) return authMsg(/confirm/i.test(error.message) ? 'Confirm your email first: open the message we sent and press the link.' : 'Sign in failed. Check the email and password.');
  boot();
});
$('sign-out').addEventListener('click', async () => { await db.auth.signOut(); ME = null; showSignin(''); });

// ---------- 1. overview ----------
async function overview() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [brands, contracts, packages, campaigns, content, invoices, payments, audit, ev, att] = await Promise.all([
    load('brands', 'sort', true), load('partner_contracts'), load('service_packages', 'sort', true), load('education_campaigns'), load('brand_content', 'sort', true),
    load('invoices'), load('invoice_payments'),
    db.from('admin_audit_logs').select('at,actor_email,table_name,action,new_row,old_row').order('at', { ascending: false }).limit(12).then((r) => r.data || []),
    db.from('engagement_events').select('event,session_id,created_at').gte('created_at', new Date(Date.now() - 56 * 86400000).toISOString()).limit(20000).then((r) => r.data || []),
    db.from('scan_attempts').select('session_id,result,created_at').gte('created_at', new Date(Date.now() - 56 * 86400000).toISOString()).limit(20000).then((r) => r.data || []),
  ]);
  const pk = (id) => packages.find((p) => p.id === id) || {};
  const live = contracts.filter(liveContract);
  const ev30 = ev.filter((e) => e.created_at >= since), att30 = att.filter((a) => a.created_at >= since);
  const sessions = new Set(ev30.map((e) => e.session_id).concat(att30.map((a) => a.session_id)).filter(Boolean)).size;
  const paidOf = (inv) => sum(payments.filter((p) => p.invoice_id === inv.id), (p) => p.amount);
  const open_ = invoices.filter((i) => i.status !== 'voided' && paidOf(i) < Number(i.amount));
  const nodes = [head('Overview', 'Live counts from the database. Where there is no data yet, the card says so.', [])];
  nodes.push(el('div', { className: 'tiles' }, [
    tile('Total brands', brands.length),
    tile('Active paying partners', new Set(live.filter((c) => Number(c.negotiated_fee) > 0 && pk(c.package_id).kind !== 'pilot').map((c) => c.brand_id)).size),
    tile('Active pilot agreements', live.filter((c) => pk(c.package_id).kind === 'pilot').length),
    tile('Active education campaigns', campaigns.filter(campLive).length),
    tile('Sessions, last 30 days', sessions || 'None yet'),
    tile('Completed scans, last 30 days', att30.filter((a) => a.result === 'success').length || 'None yet'),
    tile('Education views, last 30 days', ev30.filter((e) => e.event === 'education_shown' || e.event === 'learn_more_opened').length || 'None yet'),
    tile('Contracted revenue', contracts.some((c) => c.status === 'signed' || c.status === 'active') ? money(sum(contracts.filter((c) => c.status === 'signed' || c.status === 'active'), (c) => c.negotiated_fee)) : 'None yet'),
  ]));
  const bn = (id) => (brands.find((b) => b.id === id) || {}).name || 'My Banana (general)';
  const pending = content.filter((c) => c.approval_status === 'pending_review');
  const expiring = contracts.filter((c) => ['signed', 'active'].includes(c.status)).map((c) => ({ c, d: [daysTo(c.expiration_date), daysTo(c.renewal_date)].filter((x) => x !== null && x <= 30).sort((a, b) => a - b)[0] })).filter((x) => x.d !== undefined);
  // weekly trend, last 8 weeks
  const weekOf = (iso) => { const d = new Date(iso); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const weeks = {}; att.forEach((a) => { if (a.result === 'success') { const w = weekOf(a.created_at); (weeks[w] = weeks[w] || { scans: 0, views: 0 }).scans++; } });
  ev.forEach((e) => { if (e.event === 'education_shown' || e.event === 'learn_more_opened') { const w = weekOf(e.created_at); (weeks[w] = weeks[w] || { scans: 0, views: 0 }).views++; } });
  nodes.push(el('div', { className: 'cols' }, [
    card('Pending content approvals', [table(['For', 'Type', 'Title'], pending.map((c) => [bn(c.brand_id), LABELS.kind[c.kind], c.title]), 'Nothing is waiting for review.'), pending.length ? act('Open Education Content', () => open('content')) : '']),
    card('Agreements nearing expiration or renewal', [table(['Brand', 'Package', 'In'], expiring.map((x) => [bn(x.c.brand_id), x.c.package_name_at_signing || 'None', x.d < 0 ? Math.abs(x.d) + ' days ago' : x.d + ' days']), 'No agreement expires or renews in the next 30 days.')]),
  ]));
  nodes.push(el('div', { className: 'cols' }, [
    card('Unpaid invoices', [table(['Invoice', 'Amount', 'Balance', 'Due'], open_.map((i) => [i.invoice_number, money(i.amount, i.currency), money(Number(i.amount) - paidOf(i), i.currency), day(i.due_date)]), 'No unpaid invoices.')]),
    card('Consumer engagement by week', [table(['Week starting', 'Completed scans', 'Education views'], Object.keys(weeks).sort().reverse().slice(0, 8).map((w) => [day(w), weeks[w].scans, weeks[w].views]), 'No scans or education views in the last 8 weeks.')]),
  ]));
  nodes.push(card('Recent activity', [table(['When', 'Who', 'What'], audit.map((a) => [when(a.at), a.actor_email || 'System', a.action + ' · ' + a.table_name.replace(/_/g, ' ') + ((a.new_row || a.old_row || {}).name ? ' · ' + (a.new_row || a.old_row).name : (a.new_row || a.old_row || {}).title ? ' · ' + (a.new_row || a.old_row).title : '')]), 'No admin changes recorded yet.')]));
  return nodes;
}

// ---------- 2. brand directory ----------
async function brandsTab() {
  const [brands, contracts] = await Promise.all([load('brands', 'sort', true), load('partner_contracts')]);
  const search = el('input', { type: 'search', placeholder: 'Search brands', id: 'b-search', style: 'min-height:44px' });
  const holder = el('div');
  const fields = [
    { key: 'name', label: 'Brand name (shown to shoppers)', required: true }, { key: 'company_name', label: 'Company name' }, { key: 'category', label: 'Category' },
    { key: 'relationship_status', label: 'Relationship status', type: 'select', options: opts(LABELS.rel) },
    { key: 'website', label: 'Website', https: true }, { key: 'contact_name', label: 'Authorized contact' }, { key: 'contact_email', label: 'Contact email' },
    { key: 'logo_url', label: 'Approved logo (https link)', https: true, help: 'Stored for later. Logos are not shown to shoppers yet.' },
    { key: 'active', label: 'Public listing: shoppers can pick this brand', type: 'checkbox' }, { key: 'logo_approved', label: 'Brand has authorized use of its logo', type: 'checkbox' },
    { key: 'description', label: 'Description', type: 'textarea' },
  ];
  const edit = (b) => showForm(form(b ? 'Edit ' + b.name : 'Add a brand', fields, b || { active: true, relationship_status: 'directory_only' }, async (v) => {
    const res = b ? await db.from('brands').update(v).eq('id', b.id) : await db.from('brands').insert(Object.assign(v, { sort: brands.length + 1 }));
    if (res.error) return fail(res.error, 'The brand did not save');
    toast('Brand saved.', true); open('brands');
  }, closeForm, 'Ending a paid sponsorship never removes the basic listing or turns off scanning. Sponsored display follows an active agreement, not a setting here.'));
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    holder.textContent = '';
    holder.append(table(['Brand', 'Public listing', 'Relationship', 'Sponsored now', 'Package', 'Contract expires', 'Updated', ''],
      brands.filter((b) => !q || [b.name, b.company_name, b.category].join(' ').toLowerCase().includes(q)).map((b) => {
        const mine = contracts.filter((c) => c.brand_id === b.id);
        const cur = mine.find(liveContract) || mine.find((c) => ['signed', 'proposed', 'draft'].includes(c.status)) || mine[0];
        return [el('div', {}, [el('strong', { textContent: b.name }), el('div', { className: 'small muted', textContent: b.company_name || '' })]),
          chip(b.active ? 'Public' : 'Hidden', b.active ? 'ok' : ''), LABELS.rel[b.relationship_status] || b.relationship_status,
          chip(mine.some(liveContract) ? 'Yes' : 'No', mine.some(liveContract) ? 'brass' : ''),
          cur ? (cur.package_name_at_signing || 'None') + ' · ' + LABELS.cstat[cur.status] : 'None', cur ? day(cur.expiration_date) : 'None', when(b.updated_at),
          acts([act('Edit', () => edit(b)), act(b.active ? 'Hide' : 'Show', async () => { const r = await db.from('brands').update({ active: !b.active }).eq('id', b.id); if (r.error) return fail(r.error); open('brands'); }),
            act('Content', () => open('content', { brand: b.id })), canFin() ? act('Agreement', () => open('contracts', { brand: b.id })) : null])];
      }), 'No brand matches.', 1000));
  };
  search.addEventListener('input', draw); draw();
  return [head('Brand Directory', 'Every brand shoppers can pick, with its profile, relationship status and current agreement.', [search, act('Add brand', () => edit(null), 'primary')]), holder];
}

// ---------- 3. education content ----------
async function contentTab(arg) {
  const [brands, content, campaigns, contracts] = await Promise.all([load('brands', 'sort', true), load('brand_content', 'sort', true), load('education_campaigns'), isAdmin() ? load('partner_contracts') : Promise.resolve([])]);
  const bn = (id) => (id ? (brands.find((b) => b.id === id) || {}).name || 'Unknown brand' : 'My Banana (general)');
  const state = { brand: (arg && arg.brand) || 'all', status: 'all' };
  const brandOpts = [['', 'My Banana (general tips)']].concat(brands.map((b) => [b.id, b.name]));
  const fields = [
    { key: 'brand_id', label: 'For', type: 'select', options: brandOpts }, { key: 'kind', label: 'Content type', type: 'select', options: opts(LABELS.kind) },
    { key: 'campaign_id', label: 'Campaign (optional)', type: 'select', options: [['', 'No campaign']].concat(campaigns.map((c) => [c.id, c.name + ' · ' + bn(c.brand_id)])) },
    { key: 'title', label: 'Title', required: true }, { key: 'url', label: 'Link (video, recipe, resource, website)', https: true }, { key: 'media_url', label: 'Image link (approved image)', https: true },
    { key: 'publish_from', label: 'Show from', type: 'date' }, { key: 'publish_until', label: 'Show until', type: 'date' },
    { key: 'sponsored_disclosure', label: 'Label as Sponsored', type: 'checkbox' },
    { key: 'body', label: 'Text', type: 'textarea' },
    { key: 'stages', label: 'Ripeness stages it applies to (none ticked = all)', type: 'checks', numeric: true, options: STAGES.map((s) => [s.num, 'Stage ' + s.num + ': ' + s.name]) },
    { key: 'eating_times', label: 'Eating timeframes it applies to (none ticked = all)', type: 'checks', options: EATING.options.map((o) => [o.key, o.label]) },
  ];
  const me = (await db.auth.getUser()).data.user || {};
  const edit = (c) => showForm(form(c ? 'Edit content' : 'Add content', fields, c || { kind: 'ripeness', brand_id: state.brand !== 'all' ? state.brand : '' }, async (v) => {
    v.brand_id = v.brand_id || null; v.campaign_id = v.campaign_id || null;
    if (v.brand_id) v.sponsored_disclosure = true;          // brand content is always labeled
    const res = c ? await db.from('brand_content').update(v).eq('id', c.id) : await db.from('brand_content').insert(Object.assign(v, { approval_status: 'draft', created_by_email: me.email || null, sort: content.length + 1 }));
    if (res.error) return fail(res.error, 'The content did not save');
    toast(c ? 'Content saved.' : 'Saved as a draft.', true); open('content', { brand: state.brand });
  }, closeForm, 'Use only material the brand has approved. Brand content is always labeled Sponsored. New content starts as a draft.'));
  const move = async (c, status) => {
    const patch = { approval_status: status };
    if (status === 'approved' || status === 'published') { patch.reviewed_by_email = me.email || null; patch.reviewed_at = new Date().toISOString(); }
    const r = await db.from('brand_content').update(patch).eq('id', c.id);
    if (r.error) return fail(r.error, 'The status did not change');
    open('content', { brand: state.brand });
  };
  const liveNote = (c) => {
    if (c.approval_status !== 'published') return ['No', 'not published'];
    if (c.publish_from && c.publish_from > today()) return ['No', 'starts ' + day(c.publish_from)];
    if (c.publish_until && c.publish_until < today()) return ['No', 'ended ' + day(c.publish_until)];
    const camp = campaigns.find((x) => x.id === c.campaign_id);
    if (c.campaign_id && !(camp && campLive(camp))) return ['No', 'campaign not active'];
    if (c.brand_id && isAdmin() && !contracts.some((k) => k.brand_id === c.brand_id && liveContract(k))) return ['No', 'brand has no active agreement'];
    return ['Yes', ''];
  };
  const holder = el('div');
  const draw = () => {
    holder.textContent = '';
    const rows = content.filter((c) => (state.brand === 'all' || (state.brand === 'general' ? !c.brand_id : c.brand_id === state.brand)) && (state.status === 'all' || c.approval_status === state.status));
    holder.append(table(['For', 'Type', 'Title', 'Applies to', 'Status', 'Shown to shoppers', 'Updated', ''], rows.map((c) => {
      const [live, why] = liveNote(c); const s = c.approval_status;
      return [bn(c.brand_id), LABELS.kind[c.kind] || c.kind, el('div', {}, [el('strong', { textContent: c.title }), el('div', { className: 'small muted', textContent: (c.body || '').slice(0, 90) })]),
        ((c.stages && c.stages.length ? 'Stage ' + c.stages.join(', ') : 'All stages') + ' · ' + (c.eating_times && c.eating_times.length ? c.eating_times.map((k) => (EATING.options.find((o) => o.key === k) || {}).label || k).join(', ') : 'All plans')),
        chip(LABELS.wf[s], s === 'published' ? 'ok' : s === 'pending_review' ? 'brass' : s === 'approved' ? 'navy' : ''),
        el('div', {}, [chip(live, live === 'Yes' ? 'ok' : ''), el('div', { className: 'small muted', textContent: why })]), when(c.updated_at),
        acts([(isAdmin() || ['draft', 'pending_review'].includes(s)) ? act('Edit', () => edit(c)) : null,
          s === 'draft' ? act('Submit for review', () => move(c, 'pending_review')) : null,
          s === 'pending_review' && isAdmin() ? act('Approve', () => move(c, 'approved')) : null,
          s === 'pending_review' ? act('Back to draft', () => move(c, 'draft')) : null,
          s === 'approved' && isAdmin() ? act('Publish', () => move(c, 'published'), 'primary') : null,
          s === 'published' && isAdmin() ? act('Archive', () => move(c, 'archived')) : null,
          s === 'archived' && isAdmin() ? act('Back to draft', () => move(c, 'draft')) : null,
          isAdmin() ? act('Delete', async () => { if (!window.confirm('Delete "' + c.title + '"?')) return; const r = await db.from('brand_content').delete().eq('id', c.id); if (r.error) return fail(r.error); open('content', { brand: state.brand }); }, 'danger') : null])];
    }), 'No content matches.', 1000));
  };
  const fb = el('select', { id: 'c-fb', style: 'min-height:44px' }, [['all', 'All brands'], ['general', 'My Banana (general)']].concat(brands.map((b) => [b.id, b.name])).map(([v, t]) => el('option', { value: v, textContent: t, selected: state.brand === v })));
  const fs = el('select', { id: 'c-fs', style: 'min-height:44px' }, [['all', 'All statuses']].concat(opts(LABELS.wf)).map(([v, t]) => el('option', { value: v, textContent: t })));
  fb.addEventListener('change', () => { state.brand = fb.value; draw(); }); fs.addEventListener('change', () => { state.status = fs.value; draw(); });
  draw();
  // campaigns
  const cfields = [{ key: 'name', label: 'Campaign name', required: true }, { key: 'brand_id', label: 'Brand', type: 'select', options: brandOpts }, { key: 'status', label: 'Status', type: 'select', options: opts(LABELS.camp) }, { key: 'starts_on', label: 'Starts', type: 'date' }, { key: 'ends_on', label: 'Ends', type: 'date' }];
  const cedit = (c) => showForm(form(c ? 'Edit campaign' : 'Add campaign', cfields, c || { status: 'draft' }, async (v) => { v.brand_id = v.brand_id || null; const r = c ? await db.from('education_campaigns').update(v).eq('id', c.id) : await db.from('education_campaigns').insert(v); if (r.error) return fail(r.error, 'The campaign did not save'); open('content', { brand: state.brand }); }, closeForm, 'Content tied to a campaign shows only while the campaign is Active and inside its dates.'));
  const campCard = card('Education campaigns', [table(['Campaign', 'Brand', 'Dates', 'Status', 'Content items', ''], campaigns.map((c) => [c.name, bn(c.brand_id), day(c.starts_on) + ' to ' + day(c.ends_on), chip(campLive(c) ? 'Active now' : LABELS.camp[c.status], campLive(c) ? 'ok' : ''), content.filter((x) => x.campaign_id === c.id).length, isAdmin() ? acts([act('Edit', () => cedit(c))]) : '']), 'No campaigns yet.'), isAdmin() ? act('Add campaign', () => cedit(null)) : '']);
  return [head('Education Content', 'Workflow: Draft, Pending Review, Approved, Published, Archived. Shoppers see an item only when it is Published, inside its dates, and, for brand content, while that brand has an active agreement. Otherwise they see My Banana\'s general tips.', [fb, fs, act('Add content', () => edit(null), 'primary')]), holder, campCard];
}

// ---------- 4. pricing & packages ----------
async function pricingTab() {
  const [packages, hist] = await Promise.all([load('service_packages', 'sort', true),
    db.from('admin_audit_logs').select('at,actor_email,row_id,action,old_row,new_row').eq('table_name', 'service_packages').order('at', { ascending: false }).limit(200).then((r) => r.data || [])]);
  const fields = [{ key: 'name', label: 'Package name', required: true }, { key: 'kind', label: 'Type', type: 'select', options: opts(LABELS.pkind) },
    { key: 'price', label: 'Fee amount', type: 'number', required: true }, { key: 'currency', label: 'Currency (3 letters)', required: true }, { key: 'frequency', label: 'Frequency', type: 'select', options: opts(LABELS.freq) },
    { key: 'effective_date', label: 'Effective date', type: 'date' }, { key: 'active', label: 'Active: offered for new agreements', type: 'checkbox' }, { key: 'inclusions', label: 'Included services', type: 'textarea' }];
  const edit = (p) => showForm(form(p ? 'Edit Price: ' + p.name : 'Add package', fields, p || { currency: 'USD', frequency: 'one_time', kind: 'other', active: true, effective_date: today() }, async (v) => {
    v.currency = String(v.currency || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(v.currency)) return toast('Currency must be three letters, such as USD.');
    v.effective_date = v.effective_date || today();
    const r = p ? await db.from('service_packages').update(v).eq('id', p.id) : await db.from('service_packages').insert(Object.assign(v, { sort: packages.length + 1 }));
    if (r.error) return fail(r.error, 'The price did not save');
    toast('Package saved. Existing contracts and invoices were not changed.', true); open('pricing');
  }, closeForm, 'This changes the standard price offered for future agreements only. Signed contracts keep their negotiated amounts, and no invoice is created or changed.'));
  const changes = hist.filter((h) => h.action === 'update' && h.old_row && h.new_row && (Number(h.old_row.price) !== Number(h.new_row.price) || h.old_row.frequency !== h.new_row.frequency))
    .map((h) => [when(h.at), h.actor_email || 'System', h.new_row.name, money(h.old_row.price, h.old_row.currency) + ' ' + LABELS.freq[h.old_row.frequency], money(h.new_row.price, h.new_row.currency) + ' ' + LABELS.freq[h.new_row.frequency]]);
  return [head('Pricing & Packages', 'Standard prices for new agreements. These are proposed rates you set, not confirmed or contracted market prices.', [canFin() ? act('Add package', () => edit(null), 'primary') : chip('View only: price edits need finance access')]),
    table(['Package', 'Standard price', 'Frequency', 'Included services', 'Status', 'Effective', ''], packages.map((p) => [el('strong', { textContent: p.name }), money(p.price, p.currency), LABELS.freq[p.frequency], p.inclusions || '', chip(p.active ? 'Active' : 'Inactive', p.active ? 'ok' : ''), day(p.effective_date), canFin() ? acts([act('Edit Price', () => edit(p))]) : '']), 'No packages yet.', 900),
    card('Price change history', [table(['When', 'Changed by', 'Package', 'Was', 'Now'], changes, 'No price changes yet.')])];
}

// ---------- 5. service contracts ----------
async function contractsTab(arg) {
  const [contracts, brands, packages, hist] = await Promise.all([load('partner_contracts'), load('brands', 'sort', true), load('service_packages', 'sort', true),
    db.from('admin_audit_logs').select('at,actor_email,row_id,old_row,new_row,action').eq('table_name', 'partner_contracts').order('at', { ascending: false }).limit(300).then((r) => r.data || [])]);
  const bn = (id) => (brands.find((b) => b.id === id) || {}).name || 'Unknown brand';
  const fields = [{ key: 'brand_id', label: 'Brand', type: 'select', options: brands.map((b) => [b.id, b.name]) },
    { key: 'package_id', label: 'Package', type: 'select', options: [['', 'No package']].concat(packages.map((p) => [p.id, p.name + ' · standard ' + money(p.price, p.currency)])) },
    { key: 'negotiated_fee', label: 'Negotiated fee', type: 'number', required: true }, { key: 'currency', label: 'Currency (3 letters)', required: true }, { key: 'billing_frequency', label: 'Billing frequency', type: 'select', options: opts(LABELS.freq) },
    { key: 'status', label: 'Status', type: 'select', options: opts(LABELS.cstat) }, { key: 'effective_date', label: 'Effective date', type: 'date' }, { key: 'expiration_date', label: 'Expiration date', type: 'date' }, { key: 'renewal_date', label: 'Renewal date', type: 'date' },
    { key: 'document_ref', label: 'Document reference' }, { key: 'terms', label: 'Terms', type: 'textarea' }, { key: 'notes', label: 'Notes', type: 'textarea' }];
  const edit = (c, preset) => {
    const node = form(c ? 'Edit agreement: ' + bn(c.brand_id) : 'New agreement', fields, c || Object.assign({ currency: 'USD', billing_frequency: 'one_time', status: 'draft', negotiated_fee: 0 }, preset || {}), async (v) => {
      v.package_id = v.package_id || null; v.currency = String(v.currency || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(v.currency)) return toast('Currency must be three letters, such as USD.');
      if (v.effective_date && v.expiration_date && v.expiration_date < v.effective_date) return toast('The expiration date is before the effective date.');
      const r = c ? await db.from('partner_contracts').update(v).eq('id', c.id) : await db.from('partner_contracts').insert(v);
      if (r.error) return fail(r.error, 'The agreement did not save');
      toast('Agreement saved.', true); open('contracts');
    }, closeForm, 'Choosing a package does not make an agreement signed: set the status yourself. The negotiated fee is stored on this agreement and is not changed by later edits to standard prices. A brand\'s content shows to shoppers only while an agreement is Active and inside its dates. When a founding pilot already covers onboarding, do not add a second setup fee.');
    showForm(node);
    if (!c) { const pkSel = node.querySelector('#f-package_id'); pkSel.addEventListener('change', () => { const p = packages.find((x) => x.id === pkSel.value); if (p) { node.querySelector('#f-negotiated_fee').value = p.price; node.querySelector('#f-billing_frequency').value = p.frequency; node.querySelector('#f-currency').value = p.currency; } }); }
  };
  const shown = (c) => (c.status === 'active' && c.expiration_date && c.expiration_date < today() ? 'Active (past its expiration date)' : LABELS.cstat[c.status]);
  const nodes = [head('Service Contracts', 'One record per agreement, with its own negotiated fee, dates and status.', [canFin() ? act('New agreement', () => edit(null), 'primary') : chip('View only: agreements need finance access')]),
    table(['Brand', 'Package', 'Standard price when set', 'Negotiated fee', 'Billing', 'Effective', 'Expires', 'Renewal', 'Status', ''], contracts.map((c) => [el('strong', { textContent: bn(c.brand_id) }), c.package_name_at_signing || 'None', c.standard_price_at_signing === null ? 'None' : money(c.standard_price_at_signing, c.currency), money(c.negotiated_fee, c.currency), LABELS.freq[c.billing_frequency], day(c.effective_date), day(c.expiration_date), day(c.renewal_date),
      chip(shown(c), liveContract(c) ? 'ok' : c.status === 'signed' ? 'navy' : ''), canFin() ? acts([act('Edit', () => edit(c))]) : '']), 'No agreements yet.', 1200),
    card('Negotiated fee history', [table(['When', 'Changed by', 'Brand', 'Was', 'Now'], hist.filter((h) => h.action === 'update' && h.old_row && h.new_row && Number(h.old_row.negotiated_fee) !== Number(h.new_row.negotiated_fee)).map((h) => [when(h.at), h.actor_email || 'System', bn(h.new_row.brand_id), money(h.old_row.negotiated_fee, h.old_row.currency), money(h.new_row.negotiated_fee, h.new_row.currency)]), 'No fee changes yet.')])];
  if (arg && arg.brand && canFin()) setTimeout(() => edit(null, { brand_id: arg.brand }), 0);
  return nodes;
}

// ---------- 6. billing center ----------
async function billingTab() {
  const [invoices, payments, contracts, brands] = await Promise.all([load('invoices'), load('invoice_payments', 'paid_on'), load('partner_contracts'), load('brands', 'sort', true)]);
  const con = (id) => contracts.find((c) => c.id === id) || {};
  const bn = (cid) => (brands.find((b) => b.id === con(cid).brand_id) || {}).name || 'Unknown brand';
  const paidOf = (i) => sum(payments.filter((p) => p.invoice_id === i.id), (p) => p.amount);
  const status = (i) => { const p = paidOf(i); if (i.status === 'voided') return 'voided'; if (p >= Number(i.amount)) return 'paid'; if (i.due_date && i.due_date < today()) return 'overdue'; return p > 0 ? 'partially_paid' : 'unpaid'; };
  const valid = invoices.filter((i) => i.status !== 'voided');
  const invoiced = sum(valid, (i) => i.amount), collected = sum(payments.filter((p) => valid.some((i) => i.id === p.invoice_id)), (p) => p.amount);
  const newInv = () => {
    const node = form('New invoice', [{ key: 'contract_id', label: 'Agreement', type: 'select', options: contracts.map((c) => [c.id, bn(c.id) + ' · ' + (c.package_name_at_signing || 'No package') + ' · ' + LABELS.cstat[c.status]]) },
      { key: 'amount', label: 'Billed amount', type: 'number', required: true }, { key: 'issue_date', label: 'Issue date', type: 'date' }, { key: 'due_date', label: 'Due date', type: 'date' }, { key: 'notes', label: 'Notes', type: 'textarea' }],
    { contract_id: (contracts[0] || {}).id, amount: (contracts[0] || {}).negotiated_fee, issue_date: today() }, async (v) => {
      if (!v.contract_id) return toast('Pick an agreement.'); if (!(v.amount > 0)) return toast('The billed amount must be more than zero.');
      v.issue_date = v.issue_date || today(); v.currency = con(v.contract_id).currency || 'USD';
      const r = await db.from('invoices').insert(v); if (r.error) return fail(r.error, 'The invoice did not save');
      toast('Invoice created.', true); open('billing');
    }, closeForm, 'Invoices are entered by hand. Nothing is charged automatically and no payment system is connected.');
    showForm(node);
    const sel = node.querySelector('#f-contract_id'); sel.addEventListener('change', () => { node.querySelector('#f-amount').value = con(sel.value).negotiated_fee || ''; });
  };
  const pay = (i) => showForm(form('Record a payment: ' + i.invoice_number, [{ key: 'amount', label: 'Amount received', type: 'number', required: true }, { key: 'paid_on', label: 'Date received', type: 'date' }, { key: 'method', label: 'Method (check, transfer, other)' }, { key: 'note', label: 'Note' }],
    { amount: (Number(i.amount) - paidOf(i)).toFixed(2), paid_on: today() }, async (v) => {
      if (!(v.amount > 0)) return toast('The amount must be more than zero.');
      const r = await db.from('invoice_payments').insert({ invoice_id: i.id, amount: v.amount, paid_on: v.paid_on || today(), method: v.method, note: v.note });
      if (r.error) return fail(r.error, 'The payment did not save'); toast('Payment recorded.', true); open('billing');
    }, closeForm, 'Balance due: ' + money(Number(i.amount) - paidOf(i), i.currency) + '. A payment cannot be more than the balance.'));
  const printInv = (i) => {
    const c = con(i.contract_id), area = $('print-area'); area.textContent = '';
    area.append(el('h1', { textContent: 'Invoice ' + i.invoice_number }), el('p', { textContent: 'Merch Corporation · My Banana Brand Education Service' }),
      el('p', { textContent: 'Billed to: ' + bn(i.contract_id) }), el('p', { textContent: 'Agreement: ' + (c.package_name_at_signing || 'No package') + (c.document_ref ? ' · Ref ' + c.document_ref : '') }),
      el('p', { textContent: 'Issue date: ' + day(i.issue_date) + '   Due date: ' + day(i.due_date) }),
      table(['Description', 'Amount'], [[(c.package_name_at_signing || 'Brand Education services') + (i.notes ? ' · ' + i.notes : ''), money(i.amount, i.currency)], ['Payments received', money(paidOf(i), i.currency)], ['Balance due', money(Number(i.amount) - paidOf(i), i.currency)]]),
      el('p', { textContent: 'Status: ' + LABELS.istat[status(i)] }));
    document.body.classList.add('print-invoice');
    const done = () => { document.body.classList.remove('print-invoice'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 1500);
  };
  return [head('Billing Center', 'Manual invoice records and payments. No payment gateway is connected.', [canFin() ? act('New invoice', newInv, 'primary') : chip('View only: billing needs finance access')]),
    el('div', { className: 'tiles' }, [tile('Contracted revenue (signed and active)', money(sum(contracts.filter((c) => c.status === 'signed' || c.status === 'active'), (c) => c.negotiated_fee))), tile('Invoiced', money(invoiced)), tile('Collected', money(collected)), tile('Outstanding receivables', money(invoiced - collected))]),
    table(['Invoice', 'Brand', 'Billed', 'Issued', 'Due', 'Paid', 'Balance', 'Status', ''], invoices.map((i) => { const s = status(i), p = paidOf(i);
      return [el('strong', { textContent: i.invoice_number }), bn(i.contract_id), money(i.amount, i.currency), day(i.issue_date), day(i.due_date), money(p, i.currency), money(i.status === 'voided' ? 0 : Number(i.amount) - p, i.currency),
        chip(LABELS.istat[s], s === 'paid' ? 'ok' : s === 'overdue' ? 'bad' : s === 'voided' ? '' : 'brass'),
        acts([canFin() && s !== 'paid' && s !== 'voided' ? act('Record payment', () => pay(i)) : null, act('Print', () => printInv(i)),
          canFin() && s !== 'voided' ? act('Void', async () => { if (!window.confirm('Void invoice ' + i.invoice_number + '? It stays on record but no longer counts as invoiced.')) return; const r = await db.from('invoices').update({ status: 'voided' }).eq('id', i.id); if (r.error) return fail(r.error); open('billing'); }, 'danger') : null])]; }), 'No invoices yet.', 1100),
    card('Payment records', [table(['Date', 'Invoice', 'Amount', 'Method', 'Note'], payments.map((p) => [day(p.paid_on), (invoices.find((i) => i.id === p.invoice_id) || {}).invoice_number || '', money(p.amount), p.method || '', p.note || '']), 'No payments recorded yet.')])];
}

// ---------- 7. analytics & reports ----------
const rep = { from: '', to: '', brand: 'all', store: 'all', campaign: 'all' };
async function reportsTab() {
  const [brands, stores, campaigns] = await Promise.all([load('brands', 'sort', true), db.from('stores').select('id,name').order('name').then((r) => r.data || []), load('education_campaigns')]);
  let aq = db.from('scan_attempts').select('session_id,result,brand_id,store_id,eating_time,created_at').order('created_at', { ascending: false }).limit(20000);
  let sq = db.from('scans').select('stage,match_category,eating_time,brand_id,store_id,created_at').order('created_at', { ascending: false }).limit(20000);
  let eq = db.from('engagement_events').select('event,session_id,brand_id,store_id,campaign_id,sponsored,created_at').order('created_at', { ascending: false }).limit(40000);
  if (rep.from) { const f = rep.from + 'T00:00:00'; aq = aq.gte('created_at', f); sq = sq.gte('created_at', f); eq = eq.gte('created_at', f); }
  if (rep.to) { const t = rep.to + 'T23:59:59'; aq = aq.lte('created_at', t); sq = sq.lte('created_at', t); eq = eq.lte('created_at', t); }
  const [a, s, e] = await Promise.all([aq, sq, eq]);
  if (a.error || s.error || e.error) throw (a.error || s.error || e.error);
  const keep = (r) => (rep.brand === 'all' || r.brand_id === rep.brand) && (rep.store === 'all' || r.store_id === rep.store);
  const att = a.data.filter(keep), scans = s.data.filter(keep), ev = e.data.filter((r) => keep(r) && (rep.campaign === 'all' || r.campaign_id === rep.campaign));
  const n = (name) => ev.filter((x) => x.event === name).length;
  const sessions = new Set(att.map((x) => x.session_id).concat(ev.map((x) => x.session_id)).filter(Boolean)).size;
  const views = n('education_shown'), clicks = n('learn_more_opened') + n('recipe_opened') + n('cta_clicked') + n('website_opened');
  const planned = scans.filter((x) => x.match_category), good = planned.filter((x) => x.match_category === 'good_match').length;
  const na = (v, has) => (has ? v : 'Not Available');
  const kpis = [['Sessions', na(sessions, sessions > 0)], ['Completed scans', scans.length], ['Brand selections', n('brand_selected')], ['Education views', views],
    ['Click engagement (clicks ÷ education views)', views ? clicks + ' of ' + views + ' · ' + pct(clicks, views) : 'Not Available'], ['Good Match rate (of scans with an eating plan)', planned.length ? good + ' of ' + planned.length + ' · ' + pct(good, planned.length) : 'Not Available'],
    ['Sponsored placement views', n('education_shown') ? ev.filter((x) => x.event === 'education_shown' && x.sponsored).length : 'Not Available'], ['Sponsored placement clicks', ev.filter((x) => x.sponsored && ['learn_more_opened', 'recipe_opened', 'cta_clicked', 'website_opened'].includes(x.event)).length]];
  const stagePairs = STAGES.map((st) => ['Stage ' + st.num + ': ' + st.name, scans.filter((x) => x.stage === st.num).length]);
  const timePairs = EATING.options.map((o) => [o.label, scans.filter((x) => x.eating_time === o.key).length]);
  const outPairs = Object.keys(EATING.categories).map((k) => [EATING.categories[k], planned.filter((x) => x.match_category === k).length]);
  const weekOf = (iso) => { const d = new Date(iso); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const weeks = {}; const bump = (iso, k) => { const w = weekOf(iso); (weeks[w] = weeks[w] || { scans: 0, views: 0, brands: 0 })[k]++; };
  scans.forEach((x) => bump(x.created_at, 'scans')); ev.forEach((x) => { if (x.event === 'education_shown') bump(x.created_at, 'views'); if (x.event === 'brand_selected') bump(x.created_at, 'brands'); });
  const weekRows = Object.keys(weeks).sort().reverse().map((w) => [day(w), weeks[w].scans, weeks[w].views, weeks[w].brands]);
  // insights: only what the counts support
  const insights = [], actions = [];
  if (!scans.length) insights.push('No completed scans in this period, so no findings can be drawn yet.');
  else {
    const topT = timePairs.slice().sort((x, y) => y[1] - x[1])[0], topS = stagePairs.slice().sort((x, y) => y[1] - x[1])[0];
    if (topT[1]) insights.push('Most chosen eating timeframe: ' + topT[0] + ' (' + topT[1] + ' of ' + scans.filter((x) => x.eating_time).length + ' scans with a plan).');
    insights.push('Most scanned stage: ' + topS[0] + ' (' + topS[1] + ' of ' + scans.length + ' scans).');
    if (planned.length) insights.push('Good Match rate: ' + good + ' of ' + planned.length + ' (' + pct(good, planned.length) + ').');
    if (views) insights.push('Education engagement: ' + clicks + (clicks === 1 ? ' click' : ' clicks') + ' from ' + views + ' views (' + pct(clicks, views) + ').');
    if (planned.length < 20) actions.push('There are fewer than 20 scans with an eating plan, which is too few to recommend a change. Keep collecting.');
    else {
      const early = planned.filter((x) => x.match_category === 'ready_earlier').length, late = planned.filter((x) => x.match_category === 'needs_more_time').length;
      if (early > late && early / planned.length >= 0.3) actions.push(early + ' of ' + planned.length + ' scanned bunches were riper than the shopper\'s plan. Review whether greener fruit is available on display.');
      if (late > early && late / planned.length >= 0.3) actions.push(late + ' of ' + planned.length + ' scanned bunches were greener than the shopper\'s plan. Review whether riper fruit is available on display.');
      if (views >= 20 && clicks / views < 0.1) actions.push('Fewer than 1 in 10 education views led to a click. Review the tips shown on the result screen.');
      if (!actions.length) actions.push('No change is indicated by these counts.');
    }
  }
  const sel = (id, pairs, cur, fn) => { const x = el('select', { id, style: 'min-height:44px' }, pairs.map(([v, t]) => el('option', { value: v, textContent: t, selected: cur === v }))); x.addEventListener('change', () => { fn(x.value); open('reports'); }); return x; };
  const dt = (id, cur, fn) => { const x = el('input', { id, type: 'date', value: cur, style: 'min-height:44px;width:auto' }); x.addEventListener('change', () => { fn(x.value); open('reports'); }); return x; };
  const csv = () => {
    const cell = (v) => { let t = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = [['My Banana Brand Education report'], ['Period', (rep.from || 'start') + ' to ' + (rep.to || 'today')], ['Brand', rep.brand === 'all' ? 'All' : (brands.find((b) => b.id === rep.brand) || {}).name], ['Store', rep.store === 'all' ? 'All' : (stores.find((x) => x.id === rep.store) || {}).name], [],
      ['Metric', 'Value']].concat(kpis).concat([[], ['Ripeness stage', 'Scans']]).concat(stagePairs).concat([[], ['Eating timeframe', 'Scans']]).concat(timePairs).concat([[], ['Outcome', 'Scans']]).concat(outPairs)
      .concat([[], ['Week starting', 'Completed scans', 'Education views', 'Brand selections']]).concat(weekRows).concat([[], ['Insights']]).concat(insights.map((x) => [x])).concat([[], ['Recommended actions']]).concat(actions.map((x) => [x]));
    const url = URL.createObjectURL(new Blob(['﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
    const link = el('a', { href: url, download: 'my-banana-brand-report-' + today() + '.csv' }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return [head('Analytics & Reports', 'Counts come from recorded scans and anonymous events. Where an event was not recorded, the metric reads Not Available. Purchases, unique customers and revenue attribution are not measured.', [
      el('label', { className: 'small muted', htmlFor: 'r-from', textContent: 'From' }), dt('r-from', rep.from, (v) => { rep.from = v; }), el('label', { className: 'small muted', htmlFor: 'r-to', textContent: 'To' }), dt('r-to', rep.to, (v) => { rep.to = v; }),
      sel('r-brand', [['all', 'All brands']].concat(brands.map((b) => [b.id, b.name])), rep.brand, (v) => { rep.brand = v; }), sel('r-store', [['all', 'All stores']].concat(stores.map((x) => [x.id, x.name])), rep.store, (v) => { rep.store = v; }),
      sel('r-camp', [['all', 'All campaigns']].concat(campaigns.map((c) => [c.id, c.name])), rep.campaign, (v) => { rep.campaign = v; }), act('Export CSV', csv, 'primary'), act('Print or save as PDF', () => window.print())]),
    el('div', { className: 'tiles' }, kpis.map(([k, v]) => tile(k, v))),
    el('div', { className: 'cols' }, [card('Ripeness stage', [scans.length ? bars(stagePairs, scans.length) : el('p', { className: 'muted', textContent: 'Not Available: no scans.' })]), card('Planned eating timeframe', [scans.some((x) => x.eating_time) ? bars(timePairs, scans.filter((x) => x.eating_time).length) : el('p', { className: 'muted', textContent: 'Not Available: no scans with a plan.' })]), card('Outcome', [planned.length ? bars(outPairs, planned.length) : el('p', { className: 'muted', textContent: 'Not Available: no scans with a plan.' })])]),
    card('Weekly trend', [table(['Week starting', 'Completed scans', 'Education views', 'Brand selections'], weekRows, 'No activity in this period.')]),
    el('div', { className: 'cols' }, [card('Executive insights', insights.map((x) => el('p', { textContent: x }))), card('Recommended actions', actions.length ? actions.map((x) => el('p', { textContent: x })) : [el('p', { className: 'muted', textContent: 'Not Available until there are scans.' })])]),
    el('p', { className: 'small muted', textContent: 'The campaign filter applies to education events only. Scan counts are not tied to a campaign.' })];
}

// ---------- 8. settings & audit ----------
async function settingsTab() {
  const nodes = [head('Settings & Audit', 'Who can do what, and a record of every change made in this admin center.', [])];
  if (ME.role === 'owner') {
    const { data: admins, error } = await db.rpc('admin_list');
    const setRole = (a) => showForm(form(a ? 'Change access: ' + a.email : 'Give someone access', [{ key: 'email', label: 'Email address', required: true }, { key: 'role', label: 'Role', type: 'select', options: opts(LABELS.role) }, { key: 'finance', label: 'May edit prices, agreements and invoices', type: 'checkbox' }], a || { role: 'content' }, async (v) => {
      const r = await db.rpc('admin_upsert', { p_email: v.email, p_role: v.role, p_finance: !!v.finance }); if (r.error) return fail(r.error, 'Access did not change'); toast('Access saved. The person signs up with that email on the Pilot admin page, confirms it, then signs in.', true); open('settings');
    }, closeForm, 'Platform Owner: everything. SYC Admin: brands, content, reports and pilot data; prices, agreements and invoices only if ticked. Content Manager: drafts and submits content only, and cannot approve, publish or see pilot data.'));
    nodes.push(card('Access roles', [error ? el('div', { className: 'note err', textContent: 'Could not load roles.' }) : table(['Email', 'Role', 'Finance', 'Added', ''], (admins || []).map((a) => [a.email, LABELS.role[a.role], a.finance ? 'Yes' : 'No', when(a.created_at),
      acts([act('Change', () => setRole(a)), act('Remove', async () => { if (!window.confirm('Remove access for ' + a.email + '?')) return; const r = await db.rpc('admin_remove', { p_email: a.email }); if (r.error) return fail(r.error, 'Access was not removed'); open('settings'); }, 'danger')])]), 'No one has access.'), act('Give someone access', () => setRole(null))]));
  } else nodes.push(card('Access roles', [el('p', { className: 'muted', textContent: 'Only the Platform Owner can view or change access roles.' })]));
  nodes.push(card('Platform controls', [el('p', { className: 'small', textContent: 'Sponsored brand content is shown to shoppers only while that brand has an Active agreement inside its dates. Ending an agreement returns the brand to My Banana\'s general tips and never removes its listing or turns off scanning. The color reader and the eating-plan rules are not controlled from this page.' })]));
  const { data: logs } = await db.from('admin_audit_logs').select('*').order('at', { ascending: false }).limit(200);
  const diff = (l) => { if (l.action === 'insert') return 'Added' + ((l.new_row || {}).name ? ': ' + l.new_row.name : (l.new_row || {}).title ? ': ' + l.new_row.title : ''); if (l.action === 'delete') return 'Deleted' + ((l.old_row || {}).name ? ': ' + l.old_row.name : (l.old_row || {}).title ? ': ' + l.old_row.title : ''); if (!l.old_row || !l.new_row) return l.action + (l.new_row ? ': ' + JSON.stringify(l.new_row) : '');
    return Object.keys(l.new_row).filter((k) => k !== 'updated_at' && JSON.stringify(l.old_row[k]) !== JSON.stringify(l.new_row[k])).map((k) => k.replace(/_/g, ' ') + ': ' + (l.old_row[k] === null ? 'blank' : JSON.stringify(l.old_row[k])) + ' → ' + (l.new_row[k] === null ? 'blank' : JSON.stringify(l.new_row[k]))).join('; ') || 'No field changed'; };
  nodes.push(card('Change history (latest 200)', [table(['When', 'Who', 'Area', 'Change'], (logs || []).map((l) => [when(l.at), l.actor_email || 'System', l.table_name.replace(/_/g, ' '), el('span', { className: 'small', textContent: diff(l).slice(0, 400) })]), 'No changes recorded yet.', 800)]));
  return nodes;
}

boot();
