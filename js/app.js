// Scan Your Color pilot: shopper app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PHOTO_BUCKET, READER_VERSION, STAGES, SCAN } from './config.js';
import { REFS, readSource, matchStage } from './reader.js';

// Shoppers are never signed in; keep this client separate from any admin session.
const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  [].concat(kids).forEach((k) => n.append(k));
  return n;
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const phoneClock = () => ({
  phone_time: new Date().toISOString(),
  phone_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
});
const r1 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 10) / 10 : null);

// ---- what this phone remembers ----
const KEY = 'syc.pilot.v1';
let state = { deviceId: uuid(), deviceSaved: false, shopperId: null, store: null, scans: [] };
try { state = Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };
save();

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

// ---- phone details ----
let phone = null;
async function deviceInfo() {
  if (phone) return phone;
  const ua = navigator.userAgent || '';
  let model = '', os = '', browser = '';
  try {
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues(['model', 'platform', 'platformVersion']);
      model = h.model || '';
      if (h.platform) os = (h.platform + ' ' + (h.platformVersion || '')).trim();
    }
  } catch (e) { /* not available */ }
  let m;
  if (!os) {
    if ((m = ua.match(/(?:iPhone|CPU) OS (\d+(?:_\d+)*)/))) os = 'iOS ' + m[1].replace(/_/g, '.');
    else if ((m = ua.match(/Android (\d+(?:\.\d+)*)/))) os = 'Android ' + m[1];
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
  }
  if (!model) {
    if (/iPhone/.test(ua)) model = 'iPhone';
    else if (/iPad/.test(ua)) model = 'iPad';
    else if ((m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/))) model = m[1].trim();
    else model = /Mobi/.test(ua) ? 'Phone' : 'Computer';
  }
  if ((m = ua.match(/SamsungBrowser\/(\d+)/))) browser = 'Samsung Internet ' + m[1];
  else if ((m = ua.match(/(?:EdgiOS|EdgA|Edg)\/(\d+)/))) browser = 'Edge ' + m[1];
  else if ((m = ua.match(/FxiOS\/(\d+)|Firefox\/(\d+)/))) browser = 'Firefox ' + (m[1] || m[2]);
  else if ((m = ua.match(/CriOS\/(\d+)|Chrome\/(\d+)/))) browser = 'Chrome ' + (m[1] || m[2]);
  else if ((m = ua.match(/Version\/(\d+).*Safari/))) browser = 'Safari ' + m[1];
  else browser = 'Other';
  phone = { phone_model: model, os, browser, user_agent: ua.slice(0, 300) };
  return phone;
}

async function ensureDevice() {
  if (state.deviceSaved) return;
  const info = await deviceInfo();
  const { error } = await db.from('devices').insert({ id: state.deviceId, ...info });
  if (error && error.code !== '23505') throw error;
  state.deviceSaved = true; save();
}

// ---- screens ----
let current = null;      // the scan now on the result screen
let justSaved = false;
let screen = null;
function go(name) {
  if (name === 'register' && state.shopperId) name = screen === 'store' ? 'welcome' : 'store';
  screen = name;
  document.querySelectorAll('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== name; });
  if (name !== 'scan') stopCamera();
  if (name === 'welcome') $('welcome-saved').hidden = !state.scans.length;
  if (name === 'store') showStores();
  if (name === 'scan') startScanScreen();
  if (name === 'survey') showSurvey();
  if (name === 'saved') showSaved();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});

// ---- register ----
$('reg-save').addEventListener('click', async () => {
  const first_name = $('reg-name').value.trim();
  const contact = $('reg-contact').value.trim();
  if (!first_name && !contact) { toast('Add your first name or a contact, or choose Skip.'); return; }
  const id = uuid();
  $('reg-save').disabled = true;
  const { error } = await db.from('shoppers').insert({ id, first_name: first_name || null, contact: contact || null, contact_ok: $('reg-ok').checked });
  $('reg-save').disabled = false;
  if (error) { toast('Could not register right now. Check your connection, or skip for now.'); return; }
  state.shopperId = id; save();
  go('store');
});

// ---- store ----
let stores = null;
async function showStores() {
  const list = $('store-list');
  if (!stores) {
    list.textContent = 'Loading stores…';
    const { data, error } = await db.from('stores').select('id,name,city,state,zip').eq('active', true).order('name');
    stores = error ? [] : (data || []);
  }
  drawStores();
}
function drawStores() {
  const q = $('store-search').value.trim().toLowerCase();
  const list = $('store-list');
  list.textContent = '';
  $('store-search-wrap').hidden = stores.length < 5;
  const picked = state.store || {};
  stores.filter((s) => !q || [s.name, s.city, s.state, s.zip].join(' ').toLowerCase().includes(q)).forEach((s) => {
    const input = el('input', { type: 'radio', name: 'store', value: s.id, checked: picked.id === s.id });
    const where = [s.city, s.state].filter(Boolean).join(', ') + (s.zip ? ' ' + s.zip : '');
    list.append(el('label', { className: 'opt' }, [input, el('span', {}, [
      el('strong', { textContent: s.name, style: 'display:block' }), el('span', { className: 'small muted', textContent: where })])]));
  });
  const other = el('input', { type: 'radio', name: 'store', value: 'other', checked: !picked.id && !!picked.typed || !stores.length });
  list.append(el('label', { className: 'opt' }, [other, el('strong', { textContent: stores.length ? 'My store is not listed' : 'Type my store' })]));
  if (picked.typed && !$('store-typed').value) $('store-typed').value = picked.typed;
  syncTyped();
}
function syncTyped() {
  const v = (document.querySelector('input[name=store]:checked') || {}).value;
  $('store-typed-wrap').hidden = v !== 'other';
}
$('store-list').addEventListener('change', syncTyped);
$('store-search').addEventListener('input', drawStores);
$('store-next').addEventListener('click', () => {
  const v = (document.querySelector('input[name=store]:checked') || {}).value;
  if (!v) { toast('Please pick your store.'); return; }
  if (v === 'other') {
    const typed = $('store-typed').value.trim();
    if (!typed) { toast('Please type the store name and city.'); return; }
    state.store = { id: null, name: typed, typed };
  } else {
    const s = stores.find((x) => x.id === v);
    state.store = { id: s.id, name: s.name, typed: null };
  }
  save();
  go('scan');
});

// ---- camera and scan ----
const video = $('video');
let stream = null, scanning = false, timer = null, tryAnyway = false, cameraFailLogged = false, weak = null;

function stopCamera() {
  scanning = false; clearTimeout(timer);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
}

async function startScanScreen() {
  if (!state.store) { go('store'); return; }
  $('scan-now').disabled = true;
  $('scan-meter').style.width = '0';
  $('cam-msg').textContent = 'Starting camera…';
  $('store-line').textContent = 'Store: ' + state.store.name;
  const info = await deviceInfo();
  $('phone-line').textContent = 'Phone detected: ' + [info.phone_model, info.os, info.browser].filter(Boolean).join(' · ');
  if (weak === null) {
    const { data } = await db.from('weak_camera_phones').select('phone_model');
    weak = (data || []).map((x) => (x.phone_model || '').toLowerCase());
  }
  const flagged = weak.includes((info.phone_model || '').toLowerCase());
  $('cam-warning').hidden = !flagged || tryAnyway;
  if (flagged && !tryAnyway) { $('cam-msg').textContent = 'Camera is off until you choose Try anyway.'; return; }
  startCamera();
}
$('try-anyway').addEventListener('click', () => { tryAnyway = true; $('cam-warning').hidden = true; startCamera(); });

async function startCamera() {
  stopCamera();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('no camera api'), { name: 'NotSupported' });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    $('cam-msg').textContent = 'Camera ready. Tap Scan now.';
    $('scan-now').disabled = false;
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    $('cam-msg').textContent = denied
      ? 'Camera permission is off. Allow the camera for this page, then reload.'
      : 'This phone could not start the camera.';
    if (!cameraFailLogged) {
      cameraFailLogged = true;
      logAttempt({ result: 'failed', failure_reason: 'camera_' + ((err && err.name) || 'error') }).catch(() => {});
    }
  }
}

function grabPhoto() {
  const vw = video.videoWidth, vh = video.videoHeight;
  const sc = Math.min(1, SCAN.photoMaxSide / Math.max(vw, vh));
  const cv = el('canvas', { width: Math.round(vw * sc), height: Math.round(vh * sc) });
  cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/jpeg', 0.8));
}

async function logAttempt(fields) {
  await ensureDevice();
  const id = uuid();
  const { error } = await db.from('scan_attempts').insert({
    id, device_id: state.deviceId, shopper_id: state.shopperId,
    store_id: state.store ? state.store.id : null, store_name_typed: state.store ? state.store.typed : null,
    try_anyway: tryAnyway, ...phoneClock(), ...fields,
  });
  if (error) throw error;
  return id;
}

$('scan-now').addEventListener('click', runScan);
async function runScan() {
  if (scanning || !stream || !video.videoWidth) return;
  scanning = true;
  $('scan-now').disabled = true;
  const t0 = performance.now();
  const readings = [], photos = [];
  let sm = null, hold = 0, lastPhoto = 0, locked = null, readerError = null;

  await new Promise((resolve) => {
    const tick = () => {
      if (!scanning) return resolve();
      const now = performance.now(), gone = now - t0;
      $('scan-meter').style.width = Math.min(100, Math.round((gone / SCAN.maxMs) * 100)) + '%';
      let r = null;
      try { r = readSource(video, video.videoWidth, video.videoHeight, true); } catch (e) { readerError = e; }
      if (r && r.ok) {
        sm = sm ? Object.assign({}, r, { hue: sm.hue * 0.45 + r.hue * 0.55, spot: sm.spot * 0.45 + r.spot * 0.55 }) : r;
        const m = matchStage(sm, REFS, sm.light, null);
        readings.push({ m, sm });
        hold = m.conf >= SCAN.lockConfidence ? hold + 1 : 0;
        $('cam-msg').textContent = 'Reading color… hold steady';
        if (photos.length < SCAN.photos && now - lastPhoto > 700) { photos.push(grabPhoto()); lastPhoto = now; }
        if (hold >= SCAN.lockFrames) { locked = { m, sm }; return resolve(); }
      } else {
        hold = 0;
        $('cam-msg').textContent = 'Looking for bananas… fit them inside the box';
      }
      if (gone >= SCAN.maxMs) return resolve();
      timer = setTimeout(tick, SCAN.readEveryMs);
    };
    tick();
  });
  if (!scanning) return;           // left the screen
  scanning = false;
  $('scan-meter').style.width = '100%';

  // Decide the result from the whole range of readings, not one picture.
  let pick = locked;
  if (!pick && readings.length >= SCAN.minReadings) {
    const counts = {};
    readings.forEach((x) => { counts[x.m.key] = (counts[x.m.key] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const same = readings.filter((x) => x.m.key === top);
    pick = same[same.length - 1];
    pick = { sm: pick.sm, m: Object.assign({}, pick.m, { conf: same.reduce((t, x) => t + x.m.conf, 0) / same.length }) };
  }

  try {
    if (!pick) {
      const reason = readerError ? 'reader_error' : (readings.length ? 'unclear_reading' : 'no_banana_found');
      await logAttempt({ result: 'failed', failure_reason: reason });
      $('cam-msg').textContent = 'We could not read a clear color. Move closer, add light, and try again.';
      $('scan-now').disabled = false;
      return;
    }
    $('cam-msg').textContent = 'Saving your scan…';
    const stage = STAGES.find((s) => s.key === pick.m.key);
    const hues = readings.map((x) => x.sm.hue);
    const light = pick.sm.light || {};
    const attemptId = await logAttempt({ result: 'success' });
    const scanId = uuid();
    const { error } = await db.from('scans').insert({
      id: scanId, attempt_id: attemptId, device_id: state.deviceId, shopper_id: state.shopperId,
      store_id: state.store.id, store_name_typed: state.store.typed,
      stage: stage.num, reader_version: READER_VERSION, ...phoneClock(),
      color_values: {
        hue: r1(pick.sm.hue), chroma: r1(pick.sm.chroma), L: r1(pick.sm.L), spot: r1(pick.sm.spot),
        peel_share: r1(pick.sm.peelShare), hex: pick.sm.hex || null,
        confidence: Math.round(pick.m.conf * 100) / 100, second: pick.m.second || null, locked: !!locked,
        readings: readings.length, hue_min: r1(Math.min(...hues)), hue_max: r1(Math.max(...hues)),
        light: { cct: r1(light.cct), klass: light.klass || null, conf: r1(light.conf) },
      },
    });
    if (error) throw error;
    uploadPhotos(scanId, photos);        // runs in the background
    current = { scanId, stage, store: state.store.name };
    showResult();
  } catch (e) {
    $('cam-msg').textContent = 'Could not save this scan. Check your connection and try again.';
    toast('Could not save this scan. Check your connection and try again.');
    $('scan-now').disabled = false;
  }
}

async function uploadPhotos(scanId, photos) {
  for (let i = 0; i < photos.length; i++) {
    try {
      const blob = await photos[i];
      if (!blob) continue;
      const path = scanId + '/' + (i + 1) + '.jpg';
      const up = await db.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) continue;
      await db.from('scan_photos').insert({ scan_id: scanId, storage_path: path });
    } catch (e) { /* a missed photo never blocks the shopper */ }
  }
}

// ---- result ----
function showResult() {
  const s = current.stage;
  $('res-swatch').style.background = s.fill;
  $('res-num').textContent = 'Stage ' + s.num;
  $('res-name').textContent = s.name;
  $('res-desc').textContent = s.desc;
  $('res-store').textContent = current.store;
  const ladder = $('res-ladder'); ladder.textContent = '';
  STAGES.forEach((x) => {
    ladder.append(el('div', { className: x.num === s.num ? 'on' : '' }, [
      el('i', { style: 'background:' + x.fill }), el('span', { textContent: x.num === s.num ? 'Your scan' : 'Stage ' + x.num })]));
  });
  const sel = $('match-stage'); sel.textContent = '';
  STAGES.filter((x) => x.num !== s.num).forEach((x) => sel.append(el('option', { value: x.num, textContent: 'Stage ' + x.num + ': ' + x.name })));
  document.querySelectorAll('input[name=match]').forEach((i) => { i.checked = false; });
  $('match-stage-wrap').hidden = true;
  go('result');
}
document.querySelectorAll('input[name=match]').forEach((i) => i.addEventListener('change', () => {
  $('match-stage-wrap').hidden = (document.querySelector('input[name=match]:checked') || {}).value !== 'no';
}));

async function sendFeedback(saved) {
  const v = (document.querySelector('input[name=match]:checked') || {}).value;
  const match = v === 'yes' ? true : v === 'no' ? false : null;
  const { error } = await db.rpc('record_scan_feedback', {
    p_scan_id: current.scanId, p_device_id: state.deviceId, p_saved: saved, p_match: match,
    p_shopper_stage: match === false ? Number($('match-stage').value) : null,
  });
  return !error;
}
$('save-scan').addEventListener('click', async () => {
  if (!current) return;
  $('save-scan').disabled = true;
  const ok = await sendFeedback(true);
  $('save-scan').disabled = false;
  if (!ok) { toast('Could not save. Check your connection and try again.'); return; }
  state.scans.unshift({ id: current.scanId, stage: current.stage.num, store: current.store, at: Date.now(), survey: false });
  state.scans = state.scans.slice(0, 50); save();
  justSaved = true;
  go('survey');
});
$('scan-again').addEventListener('click', async () => {
  if (current && document.querySelector('input[name=match]:checked')) await sendFeedback(false);
  go('scan');
});

// ---- survey ----
let questions = [];
async function showSurvey() {
  const form = $('survey-form');
  form.textContent = 'Loading…';
  const { data, error } = await db.from('survey_questions')
    .select('id,position,question_text,answer_type,choices,required,version').eq('active', true).order('position');
  questions = error ? [] : (data || []);
  if (!questions.length) { go('saved'); return; }
  $('survey-title').textContent = 'Scan saved. ' + (questions.length === 1 ? 'One quick question' : questions.length + ' quick questions');
  form.textContent = '';
  questions.forEach((q, i) => {
    const title = (i + 1) + '. ' + q.question_text + (q.required ? '' : ' (optional)');
    const name = 'q_' + q.id;
    let choices = Array.isArray(q.choices) ? q.choices.map(String) : [];
    if (q.answer_type === 'yes_no') choices = ['Yes', 'No'];
    if (q.answer_type === 'rating') choices = ['1', '2', '3', '4', '5'];
    if (q.answer_type === 'text') {
      form.append(el('div', { className: 'card field' }, [
        el('label', { htmlFor: name, textContent: title, style: 'font-weight:600' }),
        el('textarea', { id: name, name, rows: 3, maxLength: 1000 })]));
      return;
    }
    const type = q.answer_type === 'pick_many' ? 'checkbox' : 'radio';
    const opts = el('div', { className: 'opts' + (choices.length <= 5 && choices.every((c) => c.length < 12) ? ' two' : '') });
    choices.forEach((c) => opts.append(el('label', { className: 'opt' }, [el('input', { type, name, value: c }), el('span', { textContent: c })])));
    form.append(el('fieldset', { className: 'card' }, [el('legend', { textContent: title }), opts]));
  });
}
$('survey-send').addEventListener('click', async () => {
  const scanId = current ? current.scanId : null;
  const rows = [];
  for (const q of questions) {
    const name = 'q_' + q.id;
    let answer = null;
    if (q.answer_type === 'text') answer = ($(name).value || '').trim() || null;
    else if (q.answer_type === 'pick_many') {
      const v = [...document.querySelectorAll('input[name="' + name + '"]:checked')].map((i) => i.value);
      answer = v.length ? v : null;
    } else answer = (document.querySelector('input[name="' + name + '"]:checked') || {}).value || null;
    if (answer === null && q.required) { toast('Please answer: ' + q.question_text); return; }
    if (answer !== null) rows.push({
      question_id: q.id, question_version: q.version, question_text_asked: q.question_text,
      scan_id: scanId, device_id: state.deviceId, shopper_id: state.shopperId, answer, ...phoneClock(),
    });
  }
  if (rows.length) {
    $('survey-send').disabled = true;
    const { error } = await db.from('survey_answers').insert(rows);
    $('survey-send').disabled = false;
    if (error) { toast('Could not send your answers. Check your connection and try again.'); return; }
    const mine = state.scans.find((s) => s.id === scanId);
    if (mine) { mine.survey = true; save(); }
  }
  go('saved');
});

// ---- saved scans ----
function showSaved() {
  $('saved-thanks').hidden = !justSaved; justSaved = false;
  const list = $('saved-list'); list.textContent = '';
  if (!state.scans.length) { list.append(el('p', { className: 'muted', textContent: 'No saved scans yet.' })); return; }
  state.scans.forEach((s) => {
    const st = STAGES.find((x) => x.num === s.stage) || STAGES[0];
    list.append(el('div', { className: 'list-item' }, [
      el('i', { style: 'background:' + st.fill }),
      el('div', { style: 'flex:1' }, [
        el('div', { textContent: 'Stage ' + st.num + ': ' + st.name, style: 'font-weight:600' }),
        el('div', { className: 'small muted', textContent: new Date(s.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) + (s.store ? ' · ' + s.store : '') })]),
      el('span', { className: 'chip' + (s.survey ? ' ok' : ''), textContent: s.survey ? 'Survey done' : 'No survey' })]));
  });
}

// ---- save to home screen ----
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('install-now').hidden = false; });
$('install-now').addEventListener('click', async () => { if (installEvent) { installEvent.prompt(); installEvent = null; $('install-now').hidden = true; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

go('welcome');
