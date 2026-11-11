// Scan Your Color pilot: admin pages (sign-in required)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PHOTO_BUCKET, STAGES, SCAN } from './config.js';
import { readSource } from './reader.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  [].concat(kids).forEach((k) => n.append(k));
  return n;
};
const view = $('view');
const stageName = (n) => { const s = STAGES.find((x) => x.num === n); return s ? 'Stage ' + n + ': ' + s.name : ''; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '0%');
const fmt = (iso, tz) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: tz || undefined }); }
  catch (e) { return new Date(iso).toLocaleString(); }
};
let toastTimer = null;
function toast(msg, good) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast note ' + (good ? 'ok' : 'err'); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

// ---------- sign in ----------
function authMsg(text) { const m = $('auth-msg'); m.textContent = text; m.hidden = !text; }
async function boot() {
  const { data } = await db.auth.getSession();
  if (!data.session) return showSignin('');
  const { data: ok, error } = await db.rpc('am_i_admin');
  if (error || ok !== true) {
    await db.auth.signOut();
    return showSignin('This account is not on the admin list, or its email is not confirmed yet.');
  }
  $('signin').hidden = true; $('tabs').hidden = false; view.hidden = false;
  openTab('data');
}
function showSignin(msg) { $('signin').hidden = false; $('tabs').hidden = true; view.hidden = true; authMsg(msg); }
$('do-signin').addEventListener('click', async () => {
  authMsg('');
  const { error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  if (error) return authMsg(/confirm/i.test(error.message) ? 'Confirm your email first: open the message we sent and press the link.' : 'Sign in failed. Check the email and password.');
  boot();
});
$('do-signup').addEventListener('click', async () => {
  authMsg('');
  if ($('password').value.length < 8) return authMsg('Choose a password with 8 or more characters.');
  const { data, error } = await db.auth.signUp({ email: $('email').value.trim(), password: $('password').value, options: { emailRedirectTo: location.href.split('#')[0] } });
  if (error) return authMsg('Could not create the account: ' + error.message);
  if (data.session) return boot();
  authMsg('Account created. Open the confirmation email, press the link, then come back and sign in.');
});
$('sign-out').addEventListener('click', async () => { await db.auth.signOut(); showSignin(''); });
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));
function openTab(tab) {
  document.querySelectorAll('[data-tab]').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  view.textContent = '';
  ({ data: dataTab, survey: surveyTab, library: libraryTab, stores: storesTab })[tab]();
}

// ---------- pilot data ----------
const filters = { range: 'all', store: 'all', log: 'all' };
let cache = null;

async function loadData() {
  let from = null;
  if (filters.range === '7') from = new Date(Date.now() - 7 * 86400000);
  if (filters.range === 'today') { from = new Date(); from.setHours(0, 0, 0, 0); }
  let q = db.from('scan_attempts').select(
    'id,created_at,phone_time,phone_timezone,result,failure_reason,try_anyway,device_id,shopper_id,store_id,store_name_typed,' +
    'devices(phone_model,os,browser),stores(name),' +
    'scans(id,stage,saved,shopper_match,shopper_stage,reader_version,color_values,scan_photos(id,storage_path,photo_deleted_at))'
  ).order('created_at', { ascending: false }).limit(5000);
  let a = db.from('survey_answers').select('id,question_id,question_text_asked,answer,scan_id,created_at').order('created_at', { ascending: false }).limit(10000);
  if (from) { q = q.gte('created_at', from.toISOString()); a = a.gte('created_at', from.toISOString()); }
  const [att, ans, shop, stores, weak] = await Promise.all([
    q, a,
    db.from('shoppers').select('id', { count: 'exact', head: true }),
    db.from('stores').select('id,name').order('name'),
    db.from('weak_camera_phones').select('phone_model'),
  ]);
  if (att.error) throw att.error;
  const rows = (att.data || []).map((r) => Object.assign(r, {
    scan: Array.isArray(r.scans) ? r.scans[0] || null : r.scans || null,
    storeLabel: (r.stores && r.stores.name) || r.store_name_typed || 'Not given',
  }));
  cache = { rows, answers: ans.data || [], shoppers: shop.count || 0, stores: stores.data || [], weak: (weak.data || []).map((x) => x.phone_model) };
}

async function dataTab() {
  view.append(el('p', { className: 'muted', textContent: 'Loading pilot data…' }));
  try { await loadData(); } catch (e) { view.textContent = ''; view.append(el('div', { className: 'note err', textContent: 'Could not load pilot data: ' + (e.message || e) })); return; }
  drawData();
}

function filteredRows() {
  return cache.rows.filter((r) => filters.store === 'all' || (filters.store === 'typed' ? !r.store_id && r.store_name_typed : r.store_id === filters.store));
}

function drawData() {
  view.textContent = '';
  const rows = filteredRows();
  const scanIds = new Set(rows.filter((r) => r.scan).map((r) => r.scan.id));
  const answers = filters.store === 'all' ? cache.answers : cache.answers.filter((a) => scanIds.has(a.scan_id));
  const ok = rows.filter((r) => r.result === 'success');
  const savedRows = rows.filter((r) => r.scan && r.scan.saved);

  // header + filters
  const range = el('select', { id: 'f-range' }, [['all', 'Whole pilot'], ['7', 'Last 7 days'], ['today', 'Today']].map(([v, t]) => el('option', { value: v, textContent: t, selected: filters.range === v })));
  range.addEventListener('change', () => { filters.range = range.value; view.textContent = ''; dataTab(); });
  const store = el('select', { id: 'f-store' }, [el('option', { value: 'all', textContent: 'All stores' })]
    .concat(cache.stores.map((s) => el('option', { value: s.id, textContent: s.name, selected: filters.store === s.id })))
    .concat([el('option', { value: 'typed', textContent: 'Typed by shopper', selected: filters.store === 'typed' })]));
  store.addEventListener('change', () => { filters.store = store.value; drawData(); });
  const exportAll = el('button', { className: 'btn primary small', textContent: 'Export scan log (CSV)' });
  exportAll.addEventListener('click', () => exportCsv(logRows(rows)));
  view.append(el('div', { className: 'head' }, [
    el('div', { className: 'stack', style: 'flex:1 1 420px' }, [el('h1', { textContent: 'Pilot data' }),
      el('p', { className: 'muted', textContent: 'Scan attempts, saved scans, phone details, registrations and survey answers stored in Supabase.' })]),
    el('div', { className: 'tools' }, [el('label', { className: 'small muted', htmlFor: 'f-range', textContent: 'Date range' }), range,
      el('label', { className: 'small muted', htmlFor: 'f-store', textContent: 'Store' }), store, exportAll])]));

  // totals
  const tile = (label, value) => el('div', { className: 'tile' }, [el('div', { className: 'label', textContent: label }), el('div', { className: 'fig', textContent: String(value) })]);
  view.append(el('div', { className: 'tiles' }, [
    tile('Scan attempts', rows.length), tile('Successful scans', ok.length), tile('Saved scans', savedRows.length),
    tile('Registered shoppers', cache.shoppers), tile('Surveys completed', new Set(answers.map((a) => a.scan_id || a.id)).size)]));

  // usage
  const perPhone = {}; const days = new Set();
  rows.forEach((r) => { perPhone[r.device_id] = (perPhone[r.device_id] || 0) + 1; days.add((r.phone_time || r.created_at).slice(0, 10)); });
  const phones = Object.values(perPhone);
  const mini = (label, value) => el('div', { className: 'tile', style: 'padding:12px' }, [el('div', { className: 'small muted', textContent: label }), el('div', { className: 'fig', textContent: String(value) })]);
  view.append(el('div', { className: 'card stack' }, [el('h2', { textContent: 'How often shoppers use it' }), el('div', { className: 'tiles' }, [
    mini('Scans per active day', days.size ? (rows.length / days.size).toFixed(1) : '0'),
    mini('Phones that scanned once', phones.filter((n) => n === 1).length),
    mini('Phones that came back', phones.filter((n) => n > 1).length),
    mini('Average scans per phone', phones.length ? (rows.length / phones.length).toFixed(1) : '0')])]));

  // stage spread + phones
  const bars = el('div', { className: 'bars' });
  STAGES.forEach((s) => {
    const n = ok.filter((r) => r.scan && r.scan.stage === s.num).length;
    bars.append(el('div', { textContent: 'Stage ' + s.num }), el('div', { className: 'track' }, [el('div', { style: 'width:' + pct(n, ok.length) })]), el('div', { className: 'val', textContent: n + ' · ' + pct(n, ok.length) }));
  });
  const checked = ok.filter((r) => r.scan && r.scan.shopper_match !== null);
  const agreed = checked.filter((r) => r.scan.shopper_match).length;
  const stageCard = el('div', { className: 'card stack' }, [el('h2', { textContent: 'Color stages scanned' }), bars,
    el('p', { className: 'small muted', textContent: checked.length ? 'Shoppers agreed with the result on ' + agreed + ' of ' + checked.length + ' checked scans (' + pct(agreed, checked.length) + ').' : 'No shopper checks yet.' })]);

  const groups = {};
  rows.forEach((r) => {
    const d = r.devices || {}; const k = [d.phone_model || 'Unknown', d.os || '', d.browser || ''].join('|');
    groups[k] = groups[k] || { model: d.phone_model || 'Unknown', sys: [d.os, d.browser].filter(Boolean).join(' · '), n: 0, ok: 0 };
    groups[k].n++; if (r.result === 'success') groups[k].ok++;
  });
  const ptable = el('table', {}, [el('thead', {}, [el('tr', {}, ['Phone model', 'System · browser', 'Attempts', 'Succeeded', 'Camera warning'].map((t) => el('th', { textContent: t })))])]);
  const pbody = el('tbody'); ptable.append(pbody);
  Object.values(groups).sort((a, b) => b.n - a.n).forEach((g) => {
    const on = cache.weak.includes(g.model);
    const b = el('button', { className: 'btn small', textContent: on ? 'Stop warning' : 'Warn shoppers' });
    b.addEventListener('click', async () => {
      const res = on ? await db.from('weak_camera_phones').delete().eq('phone_model', g.model) : await db.from('weak_camera_phones').insert({ phone_model: g.model });
      if (res.error) return toast('Could not change the warning.');
      cache.weak = on ? cache.weak.filter((m) => m !== g.model) : cache.weak.concat(g.model); drawData();
    });
    pbody.append(el('tr', {}, [el('td', { textContent: g.model }), el('td', { textContent: g.sys }), el('td', { textContent: g.n }), el('td', { textContent: pct(g.ok, g.n) }), el('td', {}, [b])]));
  });
  if (!rows.length) pbody.append(el('tr', {}, [el('td', { colSpan: 5, className: 'muted', textContent: 'No scans yet.' })]));
  view.append(el('div', { className: 'cols' }, [stageCard, el('div', { className: 'card stack' }, [el('h2', { textContent: 'Phones: which ones scan well' }), el('div', { className: 'scroll' }, [ptable])])]));

  // scan log
  const logFilter = (v, t) => { const b = el('button', { className: 'btn small', textContent: t }); if (filters.log === v) b.style.cssText = 'background:var(--navy-tint);border-color:var(--navy)'; b.addEventListener('click', () => { filters.log = v; drawData(); }); return b; };
  const shown = logRows(rows);
  const exp = el('button', { className: 'btn primary small', textContent: 'Export scan log (CSV)' }); exp.addEventListener('click', () => exportCsv(shown));
  const del = el('button', { className: 'btn danger small', textContent: 'Delete selected' }); del.addEventListener('click', () => deleteSelected());
  const table = el('table', { style: 'min-width:1200px' }, [el('thead', {}, [el('tr', {}, ['Select', 'Phone date · time', 'Store', 'Result', 'Stage', 'Photo', 'Shopper check', 'Phone', 'Shopper', 'Saved', 'Survey'].map((t) => el('th', { textContent: t })))])]);
  const body = el('tbody'); table.append(body);
  const answered = new Set(cache.answers.map((a) => a.scan_id));
  shown.slice(0, 500).forEach((r) => {
    const s = r.scan; const d = r.devices || {};
    const photos = s ? (s.scan_photos || []).filter((p) => !p.photo_deleted_at) : [];
    const photoCell = el('td');
    if (photos.length) photos.forEach((p, i) => { const b = el('button', { className: 'btn link', style: 'min-height:24px;padding:0 6px 0 0', textContent: 'View ' + (i + 1) }); b.addEventListener('click', () => openPhoto(p.storage_path)); photoCell.append(b); });
    else photoCell.textContent = s && (s.scan_photos || []).length ? 'Deleted' : 'None';
    body.append(el('tr', {}, [
      el('td', {}, [el('input', { type: 'checkbox', className: 'pick', value: r.id, ariaLabel: 'Select this scan' })]),
      el('td', { textContent: fmt(r.phone_time || r.created_at, r.phone_timezone) }),
      el('td', { textContent: r.storeLabel }),
      el('td', {}, [el('span', { className: 'chip ' + (r.result === 'success' ? 'ok' : 'bad'), textContent: r.result === 'success' ? 'Success' : 'Failed' }), r.failure_reason ? el('div', { className: 'small muted', textContent: r.failure_reason }) : '']),
      el('td', { textContent: s ? stageName(s.stage) : 'None' }),
      photoCell,
      el('td', { textContent: !s || s.shopper_match === null ? 'None' : s.shopper_match ? 'Agreed' : 'Said stage ' + (s.shopper_stage || '?') }),
      el('td', { textContent: [d.phone_model, d.os, d.browser].filter(Boolean).join(' · ') }),
      el('td', { textContent: r.shopper_id ? 'Registered' : 'Not registered' }),
      el('td', { textContent: s && s.saved ? 'Yes' : 'No' }),
      el('td', { textContent: s && answered.has(s.id) ? 'Done' : 'None' })]));
  });
  if (!shown.length) body.append(el('tr', {}, [el('td', { colSpan: 11, className: 'muted', textContent: 'No scans match.' })]));
  view.append(el('div', { className: 'card stack' }, [
    el('div', { className: 'q-head' }, [el('h2', { textContent: 'Scan log' }), el('div', { className: 'tools' }, [logFilter('all', 'All attempts'), logFilter('saved', 'Saved only'), logFilter('failed', 'Failed only'), exp, del])]),
    el('p', { className: 'small muted', textContent: 'Photos are deleted automatically after 120 to 150 days. Records stay until you delete them here.' + (shown.length > 500 ? ' Showing the newest 500 of ' + shown.length + '; the export has all of them.' : '') }),
    el('div', { className: 'scroll' }, [table])]));

  // survey answers
  const byQ = {};
  answers.forEach((a) => { (byQ[a.question_text_asked] = byQ[a.question_text_asked] || []).push(a.answer); });
  const qCards = Object.keys(byQ).map((text) => {
    const list = byQ[text]; const counts = {}; const typed = [];
    list.forEach((v) => (Array.isArray(v) ? v : [v]).forEach((x) => { const s = String(x); if (s.length > 40) typed.push(s); else counts[s] = (counts[s] || 0) + 1; }));
    const b = el('div', { className: 'bars' });
    Object.keys(counts).sort((x, y) => counts[y] - counts[x]).forEach((k) => b.append(el('div', { textContent: k }), el('div', { className: 'track' }, [el('div', { style: 'width:' + pct(counts[k], list.length) })]), el('div', { className: 'val', textContent: counts[k] + ' · ' + pct(counts[k], list.length) })));
    const card = el('div', { className: 'card stack' }, [el('strong', { textContent: text }), el('div', { className: 'small muted', textContent: list.length + ' answers' }), b]);
    typed.slice(0, 8).forEach((t) => card.append(el('p', { className: 'small', textContent: '“' + t + '”' })));
    return card;
  });
  view.append(el('div', { className: 'stack' }, [el('h2', { textContent: 'Survey answers by question' }),
    qCards.length ? el('div', { className: 'cols' }, qCards) : el('p', { className: 'muted', textContent: 'No survey answers yet.' })]));
}

function logRows(rows) {
  return rows.filter((r) => filters.log === 'all' || (filters.log === 'failed' ? r.result === 'failed' : r.scan && r.scan.saved));
}

async function openPhoto(path) {
  const w = window.open('about:blank');
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(path, 300);
  if (error || !data) { if (w) w.close(); return toast('Could not open the photo.'); }
  if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
}

function exportCsv(rows) {
  const answered = new Set(cache.answers.map((a) => a.scan_id));
  const head = ['phone_date_time', 'phone_timezone', 'server_time_utc', 'attempt_id', 'scan_id', 'store', 'result', 'failure_reason', 'stage', 'stage_name',
    'saved', 'shopper_check', 'shopper_stage', 'confidence', 'hue', 'phone_model', 'system', 'browser', 'registered', 'try_anyway', 'survey_done', 'photo_paths'];
  const cell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const lines = [head.join(',')].concat(rows.map((r) => {
    const s = r.scan || {}; const d = r.devices || {}; const cv = s.color_values || {};
    const st = STAGES.find((x) => x.num === s.stage);
    return [fmt(r.phone_time || r.created_at, r.phone_timezone), r.phone_timezone, r.created_at, r.id, s.id, r.storeLabel, r.result, r.failure_reason, s.stage, st ? st.name : '',
      s.id ? (s.saved ? 'yes' : 'no') : '', s.shopper_match === null || s.shopper_match === undefined ? '' : s.shopper_match ? 'agreed' : 'disagreed', s.shopper_stage, cv.confidence, cv.hue,
      d.phone_model, d.os, d.browser, r.shopper_id ? 'yes' : 'no', r.try_anyway ? 'yes' : 'no', s.id && answered.has(s.id) ? 'yes' : 'no',
      (s.scan_photos || []).filter((p) => !p.photo_deleted_at).map((p) => p.storage_path).join(' ')].map(cell).join(',');
  }));
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  const a = el('a', { href: url, download: 'syc-scan-log-' + new Date().toISOString().slice(0, 10) + '.csv' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deleteSelected() {
  const ids = [...document.querySelectorAll('.pick:checked')].map((c) => c.value);
  if (!ids.length) return toast('Tick the scans you want to delete first.');
  if (!window.confirm('Delete ' + ids.length + ' scan record' + (ids.length > 1 ? 's' : '') + ', with their photos and survey answers? This cannot be undone.')) return;
  const picked = cache.rows.filter((r) => ids.includes(r.id));
  const scanIds = picked.filter((r) => r.scan).map((r) => r.scan.id);
  const paths = picked.flatMap((r) => (r.scan ? (r.scan.scan_photos || []).filter((p) => !p.photo_deleted_at).map((p) => p.storage_path) : []));
  if (paths.length) { const rm = await db.storage.from(PHOTO_BUCKET).remove(paths); if (rm.error) return toast('Could not delete the photos, so nothing was deleted.'); }
  if (scanIds.length) { const a = await db.from('survey_answers').delete().in('scan_id', scanIds); if (a.error) return toast('Could not delete the survey answers.'); }
  const d = await db.from('scan_attempts').delete().in('id', ids);
  if (d.error) return toast('Could not delete the scan records.');
  toast(ids.length + ' deleted.', true);
  view.textContent = ''; dataTab();
}

// ---------- survey builder ----------
const TYPES = [['pick_one', 'Pick one'], ['pick_many', 'Pick many'], ['yes_no', 'Yes / No'], ['rating', 'Rating 1 to 5'], ['text', 'Typed answer']];
let qs = [], qsOriginal = '', removed = [];
const snapshot = () => JSON.stringify(qs.map((q) => [q.id, q.question_text, q.answer_type, q.choices, q.required, q.active]));

async function surveyTab() {
  view.append(el('p', { className: 'muted', textContent: 'Loading questions…' }));
  const { data, error } = await db.from('survey_questions').select('*').order('position');
  if (error) { view.textContent = ''; view.append(el('div', { className: 'note err', textContent: 'Could not load the questions.' })); return; }
  qs = data || []; removed = []; qsOriginal = snapshot();
  drawSurvey();
}
function drawSurvey() {
  view.textContent = '';
  const dirty = snapshot() !== qsOriginal || removed.length > 0;
  const publish = el('button', { className: 'btn brass small', textContent: 'Publish changes', disabled: !dirty });
  publish.addEventListener('click', publishSurvey);
  view.append(el('div', { className: 'head' }, [
    el('div', { className: 'stack', style: 'flex:1 1 420px' }, [el('h1', { textContent: 'Survey questions' }),
      el('p', { className: 'muted', textContent: 'Add, change, reorder or turn off questions. Shoppers see the published set right after they save a scan. Answers already collected keep the wording they were asked.' })]),
    el('div', { className: 'tools' }, [dirty ? el('span', { className: 'chip brass', textContent: 'Unpublished changes' }) : el('span', { className: 'chip ok', textContent: 'Published' }), publish])]));

  qs.forEach((q, i) => {
    const text = el('input', { type: 'text', value: q.question_text, maxLength: 300, id: 'qt' + i });
    text.addEventListener('input', () => { q.question_text = text.value; publish.disabled = false; });
    const type = el('select', { id: 'qy' + i }, TYPES.map(([v, t]) => el('option', { value: v, textContent: t, selected: q.answer_type === v })));
    type.addEventListener('change', () => { q.answer_type = type.value; drawSurvey(); });
    const needsChoices = q.answer_type === 'pick_one' || q.answer_type === 'pick_many';
    const choices = el('textarea', { rows: 4, id: 'qc' + i, value: (q.choices || []).join('\n') });
    choices.addEventListener('input', () => { q.choices = choices.value.split('\n').map((s) => s.trim()).filter(Boolean); publish.disabled = false; });
    const flag = (label, key) => { const c = el('input', { type: 'checkbox', checked: !!q[key] }); c.addEventListener('change', () => { q[key] = c.checked; drawSurvey(); }); return el('label', {}, [c, label]); };
    const move = (label, by) => { const b = el('button', { className: 'btn small', textContent: label, ariaLabel: 'Move question ' + (i + 1) + ' ' + label.toLowerCase(), disabled: i + by < 0 || i + by >= qs.length }); b.addEventListener('click', () => { qs.splice(i + by, 0, qs.splice(i, 1)[0]); drawSurvey(); }); return b; };
    const del = el('button', { className: 'btn danger small', textContent: 'Delete' });
    del.addEventListener('click', () => {
      if (q.id && !window.confirm('Delete this question? Its collected answers are deleted too. To keep the answers, turn off "Shown to shoppers" instead.')) return;
      if (q.id) removed.push(q.id); qs.splice(i, 1); drawSurvey();
    });
    view.append(el('div', { className: 'card q' }, [
      el('div', { className: 'q-head' }, [el('h2', { textContent: 'Question ' + (i + 1) }), el('div', { className: 'tools' }, [move('Up', -1), move('Down', 1), del])]),
      el('div', { className: 'field' }, [el('label', { className: 'label', htmlFor: 'qt' + i, textContent: 'Question text' }), text]),
      el('div', { className: 'cols' }, [
        el('div', { className: 'field', style: 'flex:1 1 200px' }, [el('label', { className: 'label', htmlFor: 'qy' + i, textContent: 'Answer type' }), type]),
        needsChoices ? el('div', { className: 'field', style: 'flex:2 1 320px' }, [el('label', { className: 'label', htmlFor: 'qc' + i, textContent: 'Answer choices (one per line)' }), choices]) : el('div')]),
      el('div', { className: 'inline' }, [flag('Required', 'required'), flag('Shown to shoppers', 'active')])]));
  });
  const add = el('button', { className: 'btn', style: 'border-style:dashed', textContent: '+ Add question' });
  add.addEventListener('click', () => { qs.push({ id: null, question_text: '', answer_type: 'pick_one', choices: [], required: false, active: true, version: 1 }); drawSurvey(); });
  view.append(add);
}
async function publishSurvey() {
  for (const q of qs) {
    if (!q.question_text.trim()) return toast('Every question needs text.');
    if ((q.answer_type === 'pick_one' || q.answer_type === 'pick_many') && (q.choices || []).length < 2) return toast('"' + q.question_text + '" needs at least two answer choices.');
  }
  const before = JSON.parse(qsOriginal);
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const row = { position: i + 1, question_text: q.question_text.trim(), answer_type: q.answer_type, choices: q.choices || [], required: !!q.required, active: !!q.active };
    let res;
    if (!q.id) res = await db.from('survey_questions').insert(row);
    else {
      const old = before.find((b) => b[0] === q.id);
      const changed = !old || JSON.stringify(old) !== JSON.stringify([q.id, q.question_text, q.answer_type, q.choices, q.required, q.active]);
      res = await db.from('survey_questions').update(Object.assign(row, changed ? { version: (q.version || 1) + 1, updated_at: new Date().toISOString() } : {})).eq('id', q.id);
    }
    if (res.error) return toast('Could not publish: ' + res.error.message);
  }
  if (removed.length) { const d = await db.from('survey_questions').delete().in('id', removed); if (d.error) return toast('Could not delete a question: ' + d.error.message); }
  toast('Survey published.', true);
  view.textContent = ''; surveyTab();
}

// ---------- reference pictures (what the reader learns from) ----------
async function libraryTab() {
  view.append(el('p', { className: 'muted', textContent: 'Loading reference pictures…' }));
  const [own, all] = await Promise.all([
    db.from('reference_samples').select('id,stage,hue,spot,photo_path,created_at').order('created_at', { ascending: false }).limit(2000),
    db.rpc('get_reference_library'),
  ]);
  view.textContent = '';
  if (own.error) { view.append(el('div', { className: 'note err', textContent: 'Could not load the reference pictures.' })); return; }
  const samples = (all.data && all.data.samples) || [];
  const count = (n, src) => samples.filter((x) => Number(x.stage) === n && (src === 'staff' ? x.src === 'staff' : x.src !== 'staff')).length;
  const ready = STAGES.every((s) => count(s.num, 'staff') + count(s.num, 'shopper') >= SCAN.knnMin);
  view.append(el('div', { className: 'head' }, [
    el('div', { className: 'stack', style: 'flex:1 1 420px' }, [el('h1', { textContent: 'Reference pictures' }),
      el('p', { className: 'muted', textContent: 'Staff pictures teach the reader what each stage looks like. Shopper scans the shopper agreed with are added automatically, at a lower weight. Once every stage has ' + SCAN.knnMin + ' or more pictures, new scans are matched against these pictures instead of the fixed color chart.' })]),
    el('span', { className: 'chip ' + (ready ? 'ok' : 'brass'), textContent: ready ? 'Learned matching is on' : 'Using the color chart' })]));

  const cards = STAGES.map((s) => {
    const staff = count(s.num, 'staff'), shopper = count(s.num, 'shopper'), total = staff + shopper;
    const input = el('input', { type: 'file', accept: 'image/*', multiple: true, id: 'ref-' + s.num, style: 'min-height:44px' });
    input.addEventListener('change', () => addSamples(s, input));
    return el('div', { className: 'card stack' }, [
      el('div', { className: 'result' }, [el('div', { className: 'swatch', style: 'width:48px;height:48px;background:' + s.fill }), el('div', {}, [el('h2', { textContent: 'Stage ' + s.num + ': ' + s.name }), el('div', { className: 'small muted', textContent: s.desc })])]),
      el('div', { className: 'fig', textContent: String(total) }),
      el('div', { className: 'small muted', textContent: staff + ' staff · ' + shopper + ' shopper-agreed' + (total < SCAN.knnMin ? ' · needs ' + (SCAN.knnMin - total) + ' more' : '') }),
      el('div', { className: 'field' }, [el('label', { className: 'label', htmlFor: 'ref-' + s.num, textContent: 'Add staff pictures of this stage' }), input])]);
  });
  view.append(el('div', { className: 'cols' }, cards));
  view.append(el('p', { className: 'small muted', id: 'ref-msg', textContent: 'Tip: on a phone, the picture button opens the camera. Fill the frame with the bananas, in the store\'s normal light.' }));

  const table = el('table', {}, [el('thead', {}, [el('tr', {}, ['Stage', 'Added', 'Hue', 'Spots', 'Photo', ''].map((t) => el('th', { textContent: t })))])]);
  const body = el('tbody'); table.append(body);
  (own.data || []).forEach((r) => {
    const v = el('button', { className: 'btn link', style: 'min-height:24px;padding:0', textContent: r.photo_path ? 'View' : 'None', disabled: !r.photo_path });
    v.addEventListener('click', () => openPhoto(r.photo_path));
    const d = el('button', { className: 'btn danger small', textContent: 'Delete' });
    d.addEventListener('click', async () => {
      if (!window.confirm('Delete this reference picture? The reader stops learning from it.')) return;
      if (r.photo_path) await db.storage.from(PHOTO_BUCKET).remove([r.photo_path]);
      const { error } = await db.from('reference_samples').delete().eq('id', r.id);
      if (error) return toast('Could not delete the picture.');
      view.textContent = ''; libraryTab();
    });
    body.append(el('tr', {}, [el('td', { textContent: stageName(r.stage) }), el('td', { textContent: fmt(r.created_at) }), el('td', { textContent: Number(r.hue).toFixed(1) }), el('td', { textContent: Number(r.spot).toFixed(1) }), el('td', {}, [v]), el('td', {}, [d])]));
  });
  if (!(own.data || []).length) body.append(el('tr', {}, [el('td', { colSpan: 6, className: 'muted', textContent: 'No staff pictures yet.' })]));
  view.append(el('div', { className: 'card stack' }, [el('h2', { textContent: 'Staff pictures' }), el('div', { className: 'scroll' }, [table])]));
}

async function addSamples(stage, input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const msg = document.getElementById('ref-msg');
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    if (msg) msg.textContent = 'Measuring picture ' + (i + 1) + ' of ' + files.length + '…';
    try {
      const url = URL.createObjectURL(files[i]);
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      const r = readSource(img, w, h, true, true);
      if (!r || !r.ok) { URL.revokeObjectURL(url); continue; }
      const sc = Math.min(1, SCAN.photoMaxSide / Math.max(w, h));
      const cv = el('canvas', { width: Math.round(w * sc), height: Math.round(h * sc) });
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise((res) => cv.toBlob((b) => res(b), 'image/jpeg', 0.8));
      const id = crypto.randomUUID(), path = 'reference/' + id + '.jpg';
      const up = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      const { error } = await db.from('reference_samples').insert({
        id, stage: stage.num, hue: r.hue, spot: r.spot || 0, l: r.L || 0, chroma: r.chroma || 0,
        cct: (r.light && r.light.cct) || 0, photo_path: up.error ? null : path });
      if (!error) ok++;
    } catch (e) { /* skip unreadable file */ }
  }
  toast(ok + ' of ' + files.length + ' added to ' + stage.name + (ok < files.length ? '. The rest had no clear banana in the picture.' : '.'), ok > 0);
  view.textContent = ''; libraryTab();
}

// ---------- stores ----------
async function storesTab() {
  view.append(el('p', { className: 'muted', textContent: 'Loading stores…' }));
  const { data, error } = await db.from('stores').select('*').order('name');
  view.textContent = '';
  if (error) { view.append(el('div', { className: 'note err', textContent: 'Could not load the stores.' })); return; }
  view.append(el('div', { className: 'stack' }, [el('h1', { textContent: 'Pilot stores' }),
    el('p', { className: 'muted', textContent: 'Shoppers pick from this list before they scan. Stores that are turned off are hidden from shoppers.' })]));
  const f = { name: el('input', { type: 'text', id: 's-name', maxLength: 120 }), city: el('input', { type: 'text', id: 's-city', maxLength: 80 }), state: el('input', { type: 'text', id: 's-state', maxLength: 20 }), zip: el('input', { type: 'text', id: 's-zip', maxLength: 10 }) };
  const add = el('button', { className: 'btn primary', textContent: 'Add store' });
  add.addEventListener('click', async () => {
    if (!f.name.value.trim()) return toast('The store needs a name.');
    const { error: e } = await db.from('stores').insert({ name: f.name.value.trim(), city: f.city.value.trim() || null, state: f.state.value.trim() || null, zip: f.zip.value.trim() || null });
    if (e) return toast('Could not add the store.');
    view.textContent = ''; storesTab();
  });
  const fld = (label, input) => el('div', { className: 'field' }, [el('label', { className: 'label', htmlFor: input.id, textContent: label }), input]);
  view.append(el('div', { className: 'card stack' }, [el('h2', { textContent: 'Add a store' }), el('div', { className: 'grid-form' }, [fld('Store name', f.name), fld('City', f.city), fld('State', f.state), fld('ZIP', f.zip), add])]));
  const table = el('table', {}, [el('thead', {}, [el('tr', {}, ['Store', 'City', 'State', 'ZIP', 'Shown to shoppers', ''].map((t) => el('th', { textContent: t })))])]);
  const body = el('tbody'); table.append(body);
  (data || []).forEach((s) => {
    const on = el('input', { type: 'checkbox', checked: s.active, ariaLabel: 'Show ' + s.name + ' to shoppers' });
    on.addEventListener('change', async () => { const { error: e } = await db.from('stores').update({ active: on.checked }).eq('id', s.id); if (e) { on.checked = !on.checked; toast('Could not change the store.'); } });
    const del = el('button', { className: 'btn danger small', textContent: 'Delete' });
    del.addEventListener('click', async () => {
      if (!window.confirm('Delete ' + s.name + '? Scans already taken there stay in the log but lose the store name. To keep the name, turn the store off instead.')) return;
      const { error: e } = await db.from('stores').delete().eq('id', s.id);
      if (e) return toast('Could not delete the store.');
      view.textContent = ''; storesTab();
    });
    body.append(el('tr', {}, [el('td', { textContent: s.name }), el('td', { textContent: s.city || '' }), el('td', { textContent: s.state || '' }), el('td', { textContent: s.zip || '' }), el('td', {}, [on]), el('td', {}, [del])]));
  });
  if (!(data || []).length) body.append(el('tr', {}, [el('td', { colSpan: 6, className: 'muted', textContent: 'No stores yet. Until you add one, shoppers type their store name.' })]));
  view.append(el('div', { className: 'card' }, [el('div', { className: 'scroll' }, [table])]));
}

boot();
