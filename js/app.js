// Scan Your Color pilot: shopper app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY, PHOTO_BUCKET, READER_VERSION, STAGES, SCAN, SESSION_MS, DISTANCE, EATING } from './config.js';
import { readSource, knnReady, estimateDistance, peelProfile } from './reader.js';
import { classify, effectiveRefs, isDim } from './classify.js';

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
// ---- session: 5 minutes from when the app opens ----
let sessionStart = Date.now(), sessionId = uuid(), sessionSurveyDone = false, sessionNote = '';
const expired = () => !!sessionStart && Date.now() - sessionStart >= SESSION_MS;
function startSession() { sessionStart = Date.now(); sessionId = uuid(); sessionSurveyDone = false; sessionNote = ''; eatTime = null; }
function endSession(note) {
  stopCamera();
  sessionStart = null; sessionSurveyDone = false; current = null; sessionNote = note || ''; eatTime = null;
  go('welcome');
}
const STARTS_WORK = ['register', 'store', 'eat', 'scan'];

// ---- Ready When You Are: the shopper's eating plan, kept for this session only ----
let eatTime = null;         // desiredEatingTime: today | tomorrow | 2_3_days | later_this_week
let eatReturn = false;      // true when the shopper is changing the plan from a result

let screen = null;
function go(name) {
  if (STARTS_WORK.includes(name)) {
    if (!sessionStart) startSession();                       // tapping Start scan after a session ended opens a new one
    else if (expired() && !(name === 'eat' && eatReturn)) return endSession('Your 5-minute session has ended. Tap Start scan to begin a new one.');
  }
  if (name === 'saved' && justSaved && expired()) {           // they finished what they were on; now the session ends
    justSaved = false;
    return endSession('Your scan is saved. Your 5-minute session has ended. Tap Start scan to begin a new one.');
  }
  if (name === 'register' && state.shopperId) name = screen === 'store' ? 'welcome' : 'store';
  screen = name;
  document.querySelectorAll('[data-screen]').forEach((s) => { s.hidden = s.dataset.screen !== name; });
  if (name !== 'scan') stopCamera();
  if (name === 'welcome') { $('welcome-saved').hidden = !state.scans.length; $('session-note').textContent = sessionNote; $('session-note').hidden = !sessionNote; sessionNote = ''; }
  if (name === 'store') showStores();
  if (name === 'eat') showEat();
  if (name === 'scan') startScanScreen();
  if (name === 'survey') showSurvey();
  if (name === 'saved') showSaved();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) go(b.dataset.go);
});
setInterval(() => {
  if (!expired()) return;
  if (screen === 'welcome' || screen === 'install' || screen === 'bye') sessionStart = null;
  else if (screen === 'register' || screen === 'store' || (screen === 'eat' && !eatReturn)) endSession('Your 5-minute session has ended. Tap Start scan to begin a new one.');
  // on the scan, result, survey and saved screens the shopper finishes what they are on first
}, 5000);

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
  eatReturn = false;
  go('eat');
});

// ---- reference library (what the reader has learned) ----
let lib = null, libAt = 0;
async function loadLibrary() {
  if (lib && Date.now() - libAt < 10 * 60000) return;
  try {
    const { data, error } = await db.rpc('get_reference_library');
    if (error || !data) return;
    const samples = (data.samples || []).map((x) => ({
      stage: (STAGES.find((s) => s.num === Number(x.stage)) || {}).key,
      hue: +x.hue || 0, spot: +x.spot || 0, L: +x.L || 0, chroma: +x.chroma || 0, cct: +x.cct || 0, src: x.src || 'staff',
    })).filter((x) => x.stage);
    const settings = data.settings || {};
    lib = { samples, settings, eff: effectiveRefs(samples, settings), stats: data.stats || [], staff: samples.filter((x) => x.src === 'staff').length, shopper: samples.filter((x) => x.src !== 'staff').length };
    libAt = Date.now();
  } catch (e) { /* keep reading from the chart */ }
}
const learned = () => !!lib && knnReady(lib.samples, SCAN.knnMin);
const NO_LIB = { samples: [], settings: {}, eff: effectiveRefs([], {}) };
// Three checks vote: hue match (chart blended with staff pictures, or the learned library), color share, dark spots.
const matchNow = (r, profile) => classify(r, profile, lib || NO_LIB);
const profileOf = (source, w, h, still) => { try { return peelProfile(source, w, h, still); } catch (e) { return null; } };

// ---- Ready When You Are: screen, rules and result ----
function showEat() {
  const list = $('eat-list'); list.textContent = '';
  EATING.options.forEach((o) => {
    const input = el('input', { type: 'radio', name: 'eat', value: o.key, checked: eatTime === o.key });
    list.append(el('label', { className: 'opt' }, [input, el('span', { className: 'two-line' }, [el('strong', { textContent: o.label }), el('span', { className: 'small muted', textContent: o.line })])]));
  });
  $('eat-next').disabled = !eatTime;
  $('eat-next').textContent = eatReturn ? 'Update My Result' : 'Continue to Scan';
}
$('eat-list').addEventListener('change', () => { $('eat-next').disabled = !document.querySelector('input[name=eat]:checked'); });
$('eat-back').addEventListener('click', () => { if (eatReturn && current) { eatReturn = false; go('result'); } else go('store'); });
$('eat-next').addEventListener('click', async () => {
  const v = (document.querySelector('input[name=eat]:checked') || {}).value;
  if (!v) return;
  eatTime = v;
  if (eatReturn && current) {            // plan changed after a result: re-judge the same scan
    eatReturn = false;
    const m = planMatch(current.stage.num, eatTime);
    db.rpc('record_scan_plan', { p_scan_id: current.scanId, p_device_id: state.deviceId, p_eating_time: eatTime, p_match_category: m.category }).then(() => {}, () => {});
    drawPlan(); go('result');
    return;
  }
  go('scan');
});
// The rules layer: stage (1 to 4) + plan -> category and a short explanation. The color reader is not involved.
function planMatch(stageNum, plan) {
  const good = EATING.good[plan] || [];
  let category, why;
  if (good.includes(stageNum)) { category = 'good_match'; why = (plan === 'today' && stageNum === 4) ? EATING.explain.softer : EATING.explain.good_match[plan]; }
  else if (stageNum > Math.max(...good)) { category = 'ready_earlier'; why = EATING.explain.ready_earlier; }
  else { category = 'needs_more_time'; why = EATING.explain.needs_more_time; }
  return { category, label: EATING.categories[category], why: why + ' ' + EATING.explain.always };
}
function drawPlan() {
  if (!current || !eatTime) { $('res-plan').hidden = true; return; }
  const o = EATING.options.find((x) => x.key === eatTime), m = planMatch(current.stage.num, eatTime);
  $('res-plan').hidden = false;
  $('res-plan-text').textContent = o.plan;
  $('res-plan-chip').textContent = m.label;
  $('res-plan-chip').className = 'chip big ' + (m.category === 'good_match' ? 'ok' : 'brass');
  $('res-plan-why').textContent = m.why;
}

// ---- camera and scan ----
const video = $('video');
let stream = null, scanning = false, timer = null, tryAnyway = false, cameraFailLogged = false, weak = null, torchOn = false;

// ---- distance guide: keep the phone 12 to 24 inches from the bananas ----
let distTimer = null, distIn = null;
function distanceOf(source, w, h) {
  try { return estimateDistance(source, w, h, DISTANCE); } catch (e) { return { ok: false }; }
}
function showDistance(d) {
  const box = $('dist'); box.hidden = false;
  if (!d || !d.ok) { distIn = null; box.className = 'dist'; box.textContent = 'Point the camera at the bananas'; return; }
  distIn = distIn === null ? d.inches : distIn * 0.6 + d.inches * 0.4;      // steady the number
  const inches = Math.round(distIn);
  if (d.fills || distIn < DISTANCE.minIn) { box.className = 'dist move'; box.textContent = (d.fills ? 'Too close' : 'About ' + inches + ' in') + '. Move back.'; }
  else if (distIn > DISTANCE.maxIn) { box.className = 'dist move'; box.textContent = 'About ' + inches + ' in. Move closer.'; }
  else { box.className = 'dist good'; box.textContent = 'About ' + inches + ' in. Good distance.'; }
}
let lightHelp = false, lightTick = 0, dimCount = 0;
function checkLight() {
  if (scanning) return;
  let r = null;
  try { r = readSource(video, video.videoWidth, video.videoHeight, true); } catch (e) { return; }
  const dim = (r && r.ok) ? isDim(r, lib ? lib.settings : {}) : !!(r && r.light && r.light.klass === 'too dark');
  dimCount = dim ? Math.min(4, dimCount + 1) : Math.max(0, dimCount - 1);
  const helpFree = $('scan-help').hidden || lightHelp;            // never overwrite a failed-scan message
  if (dimCount >= 2 && helpFree) {
    lightHelp = true;
    scanHelp('The light is low, so colors can read greener than they are. ' + ($('torch').hidden ? 'Turn on a light or move to a brighter spot before you scan.' : (torchOn ? 'The phone light is on.' : 'Tap Turn on light before you scan.')));
  } else if (dimCount === 0 && lightHelp) { lightHelp = false; scanHelp(''); }
}
function startDistance() {
  clearInterval(distTimer); distIn = null; lightHelp = false; dimCount = 0;
  distTimer = setInterval(() => {
    if (!stream || !video.videoWidth) return;
    showDistance(distanceOf(video, video.videoWidth, video.videoHeight));
    if (++lightTick % 2 === 0) checkLight();
  }, DISTANCE.everyMs);
}

function stopCamera() {
  scanning = false; clearTimeout(timer); clearInterval(distTimer); distIn = null; $('dist').hidden = true;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null; torchOn = false;
}
function scanHelp(text, offerPhoto) {
  $('scan-help').textContent = text || ''; $('scan-help').hidden = !text;
  if (offerPhoto) $('photo-instead').hidden = false;
  $('scan-extras').hidden = $('photo-instead').hidden && $('torch').hidden;
}

async function startScanScreen() {
  if (!state.store) { go('store'); return; }
  if (!eatTime) { eatReturn = false; go('eat'); return; }
  $('scan-now').disabled = true;
  $('scan-meter').style.width = '0';
  $('cam-msg').textContent = 'Starting camera…';
  $('torch').hidden = true; $('photo-instead').hidden = true; scanHelp('');
  $('store-line').textContent = 'Store: ' + state.store.name;
  const info = await deviceInfo();
  $('phone-line').textContent = 'Phone detected: ' + [info.phone_model, info.os, info.browser].filter(Boolean).join(' · ');
  loadLibrary();
  if (weak === null) {
    const { data } = await db.from('weak_camera_phones').select('phone_model');
    weak = (data || []).map((x) => (x.phone_model || '').toLowerCase());
  }
  const flagged = weak.includes((info.phone_model || '').toLowerCase());
  $('cam-warning').hidden = !flagged || tryAnyway;
  if (flagged && !tryAnyway) { $('cam-msg').textContent = 'Camera is off until you choose Try anyway.'; scanHelp('', true); return; }
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
    startDistance();
    try {
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $('torch').hidden = !caps.torch; $('torch').textContent = 'Turn on light';
      $('scan-extras').hidden = $('photo-instead').hidden && $('torch').hidden;
    } catch (e) { /* no torch */ }
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    $('cam-msg').textContent = denied ? 'Camera permission is off.' : 'This phone could not start the live camera.';
    scanHelp(denied ? 'Allow the camera for this page and reload, or take a photo instead.' : 'You can still scan: take a photo instead.', true);
    if (!cameraFailLogged) {
      cameraFailLogged = true;
      logAttempt({ result: 'failed', failure_reason: 'camera_' + ((err && err.name) || 'error') }).catch(() => {});
    }
  }
}
$('torch').addEventListener('click', async () => {
  try {
    torchOn = !torchOn;
    await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: torchOn }] });
    $('torch').textContent = torchOn ? 'Turn off light' : 'Turn on light';
  } catch (e) { $('torch').hidden = true; }
});

function toJpeg(source, w, h) {
  const sc = Math.min(1, SCAN.photoMaxSide / Math.max(w, h));
  const cv = el('canvas', { width: Math.max(1, Math.round(w * sc)), height: Math.max(1, Math.round(h * sc)) });
  cv.getContext('2d').drawImage(source, 0, 0, cv.width, cv.height);
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/jpeg', 0.8));
}
const grabPhoto = () => toJpeg(video, video.videoWidth, video.videoHeight);

async function logAttempt(fields) {
  await ensureDevice();
  const id = uuid();
  const { error } = await db.from('scan_attempts').insert({
    id, device_id: state.deviceId, shopper_id: state.shopperId,
    store_id: state.store ? state.store.id : null, store_name_typed: state.store ? state.store.typed : null,
    try_anyway: tryAnyway, session_id: sessionId, eating_time: eatTime, ...phoneClock(), ...fields,
  });
  if (error) throw error;
  return id;
}

// One whole-picture reading. More forgiving than the live box: it finds the fruit anywhere in the frame.
function readStill(source, w, h) {
  try {
    const r = readSource(source, w, h, true, true);
    if (r && r.ok) return { sm: r, m: matchNow(r, profileOf(source, w, h, true)), light: r.light };
    return { light: r && r.light };
  } catch (e) { return {}; }
}

// The leading stage across all readings so far. A 50/50 scan leans to the leader instead of failing.
function leader(readings) {
  const counts = {};
  readings.forEach((x) => { counts[x.m.key] = (counts[x.m.key] || 0) + 1; });
  const ranked = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const top = ranked[0], share = counts[top] / readings.length;
  const same = readings.filter((x) => x.m.key === top), last = same[same.length - 1];
  const second = ranked[1] || (last.m.second !== top ? last.m.second : null);
  return { share, pick: { sm: last.sm, m: Object.assign({}, last.m, {
    conf: same.reduce((t, x) => t + x.m.conf, 0) / same.length, second, between: share < 0.7 || !!last.m.between }) } };
}

const lightTip = (light) => {
  const k = light && light.klass;
  if (k === 'too dark') return 'It is too dark here. Move toward more light' + ($('torch').hidden ? '' : ' or turn on the light') + ', then try again.';
  if (k === 'glare') return 'There is too much glare. Tilt the phone a little, then try again.';
  if (distIn !== null && distIn < DISTANCE.minIn) return 'You are too close. Move back to 12 to 24 inches, then try again.';
  return 'Move closer, to 12 to 24 inches, so the bananas fill the box, then try again.';
};

$('scan-now').addEventListener('click', runScan);
async function runScan() {
  if (scanning || !stream || !video.videoWidth) return;
  scanning = true;
  $('scan-now').disabled = true; scanHelp(''); lightHelp = false;
  const t0 = performance.now();
  const readings = [], photos = [];
  let sm = null, hold = 0, lastPhoto = 0, pick = null, how = null, lastLight = null;

  await new Promise((resolve) => {
    const tick = () => {
      if (!scanning) return resolve();
      const now = performance.now(), gone = now - t0;
      $('scan-meter').style.width = Math.min(100, Math.round((gone / SCAN.maxMs) * 100)) + '%';
      let r = null;
      try { r = readSource(video, video.videoWidth, video.videoHeight, true); } catch (e) { /* skip this frame */ }
      if (r && r.light) lastLight = r.light;
      if (r && r.ok) {
        sm = sm ? Object.assign({}, r, { hue: sm.hue * 0.45 + r.hue * 0.55, spot: sm.spot * 0.45 + r.spot * 0.55 }) : r;
        const m = matchNow(sm, profileOf(video, video.videoWidth, video.videoHeight, false));
        readings.push({ m, sm });
        hold = m.conf >= SCAN.lockConfidence ? hold + 1 : 0;
        $('cam-msg').textContent = m.dim ? 'Low light. Reading color… a light will help' : 'Reading color… hold steady';
        if (photos.length < SCAN.photos && now - lastPhoto > 500) { photos.push(grabPhoto()); lastPhoto = now; }
        if (hold >= SCAN.lockFrames) { pick = { m: Object.assign({}, m), sm }; how = 'locked'; return resolve(); }
        if (readings.length >= SCAN.quickReadings) {
          const lead = leader(readings);
          if (lead.share >= SCAN.quickShare) { pick = lead.pick; how = 'quick'; return resolve(); }
        }
      } else {
        hold = 0;
        const k = r && r.light && r.light.klass;
        $('cam-msg').textContent = k === 'too dark' ? 'Too dark. Move toward more light.' : k === 'glare' ? 'Too much glare. Tilt the phone a little.' : 'Looking for bananas… fit them inside the box';
      }
      if (gone >= SCAN.maxMs || (gone >= SCAN.giveUpMs && !readings.length)) return resolve();
      timer = setTimeout(tick, SCAN.readEveryMs);
    };
    tick();
  });
  if (!scanning) return;           // left the screen
  scanning = false;
  $('scan-meter').style.width = '100%';

  // Never just time out: lean to the leading stage, then try one whole-picture reading.
  if (!pick && readings.length >= SCAN.minReadings) { pick = leader(readings).pick; how = 'leaned'; }
  if (!pick) {
    const still = readStill(video, video.videoWidth, video.videoHeight);
    if (still.light) lastLight = still.light;
    if (still.sm) { pick = { sm: still.sm, m: still.m }; how = 'still'; if (!photos.length) photos.push(grabPhoto()); }
  }
  if (!pick) return failScan(readings.length ? 'unclear_reading' : 'no_banana_found', lastLight);
  finishScan(pick, photos, readings, how);
}

async function failScan(reason, light) {
  const klass = light && light.klass ? ':' + light.klass : '';
  try { await logAttempt({ result: 'failed', failure_reason: reason + klass }); } catch (e) { /* offline */ }
  $('cam-msg').textContent = 'We could not read a clear color.';
  scanHelp(lightTip(light) + ' Or take a photo instead.', true);
  $('scan-now').disabled = !stream;
}

async function finishScan(pick, photos, readings, how, photoDistance) {
  const dist = photoDistance !== undefined ? photoDistance : distIn;
  try {
    $('cam-msg').textContent = 'Saving your scan…';
    const stage = STAGES.find((s) => s.key === pick.m.key);
    const second = STAGES.find((s) => s.key === pick.m.second && s.key !== pick.m.key) || null;
    const hues = readings.length ? readings.map((x) => x.sm.hue) : [pick.sm.hue];
    const light = pick.sm.light || {};
    const usedLearned = !!pick.m.knn;
    const attemptId = await logAttempt({ result: 'success' });
    const scanId = uuid();
    const { error } = await db.from('scans').insert({
      id: scanId, attempt_id: attemptId, device_id: state.deviceId, shopper_id: state.shopperId,
      store_id: state.store.id, store_name_typed: state.store.typed,
      eating_time: eatTime, match_category: planMatch(stage.num, eatTime).category,
      stage: stage.num, reader_version: usedLearned ? READER_VERSION.learned : READER_VERSION.chart, ...phoneClock(),
      color_values: {
        hue: r1(pick.sm.hue), chroma: r1(pick.sm.chroma), L: r1(pick.sm.L), spot: r1(pick.sm.spot),
        peel_share: r1(pick.sm.peelShare), hex: pick.sm.hex || null,
        confidence: Math.round(pick.m.conf * 100) / 100, second: pick.m.second || null, between: !!pick.m.between,
        decided: how, locked: how === 'locked', method: usedLearned ? 'vote+learned' : 'vote+chart',
        checks: pick.m.methods || null, checks_agree: pick.m.agree || null, checks_run: pick.m.voters || null,
        shares: pick.m.shares || null, low_light: !!pick.m.dim, spot_adjusted: pick.m.spotAdj === undefined ? null : pick.m.spotAdj,
        votes: usedLearned ? pick.m.votes : null, neighbours: usedLearned ? pick.m.k : null,
        library_staff: lib ? lib.staff : 0, library_shopper: lib ? lib.shopper : 0,
        distance_in: dist === null || dist === undefined ? null : Math.round(dist),
        distance_ok: dist === null || dist === undefined ? null : dist >= DISTANCE.minIn && dist <= DISTANCE.maxIn,
        readings: readings.length, hue_min: r1(Math.min(...hues)), hue_max: r1(Math.max(...hues)),
        light: { cct: r1(light.cct), klass: light.klass || null, conf: r1(light.conf) },
      },
    });
    if (error) throw error;
    uploadPhotos(scanId, photos);        // runs in the background
    current = { scanId, stage, second, between: !!pick.m.between && !!second, store: state.store.name,
      learned: usedLearned, votes: pick.m.votes, neighbours: pick.m.k, agree: pick.m.agree, voters: pick.m.voters, dim: !!pick.m.dim };
    showResult();
  } catch (e) {
    $('cam-msg').textContent = 'Could not save this scan. Check your connection and try again.';
    toast('Could not save this scan. Check your connection and try again.');
    $('scan-now').disabled = !stream;
  }
}

// Photo fallback: for phones whose live camera freezes, and for bad light.
$('photo-instead').addEventListener('click', () => $('photo-file').click());
$('photo-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('cam-msg').textContent = 'Reading your photo…'; scanHelp('');
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const still = readStill(img, w, h);
    const pd = distanceOf(img, w, h);
    const photo = toJpeg(img, w, h);
    URL.revokeObjectURL(url);
    if (!still.sm) return failScan('photo_no_banana_found', still.light);
    finishScan({ sm: still.sm, m: still.m }, [photo], [], 'photo', pd.ok ? pd.inches : null);
  } catch (err) { failScan('photo_unreadable', null); }
});

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
  drawPlan();
  // more about this color
  $('res-between').hidden = !current.between;
  if (current.between) $('res-between').textContent = 'Your bananas are between Stage ' + Math.min(s.num, current.second.num) + ' and Stage ' + Math.max(s.num, current.second.num) + '. They lean toward Stage ' + s.num + ': ' + s.name + '.';
  $('res-uses').textContent = (s.uses || []).join(' · ');
  $('res-match').textContent = current.learned
    ? current.votes + ' of the ' + current.neighbours + ' closest reference pictures are ' + s.name + ' (from ' + (lib.staff + lib.shopper) + ' pictures in the library).'
    : (lib && lib.staff ? 'Matched against the color chart and ' + lib.staff + ' staff picture' + (lib.staff === 1 ? '' : 's') + '.' : 'Matched against the color chart.');
  if (current.voters > 1) $('res-match').textContent += ' ' + current.agree + ' of ' + current.voters + ' color checks agree.';
  if (current.dim) $('res-match').textContent += ' The light was low, so this reading is less certain.';
  const st = lib && (lib.stats || []).find((x) => Number(x.stage) === s.num);
  $('res-agree').hidden = !(st && st.checked >= 5);
  if (st && st.checked >= 5) $('res-agree').textContent = st.agreed + ' of ' + st.checked + ' shoppers who got ' + s.name + ' said it matched what they saw.';
  const sel = $('match-stage'); sel.textContent = '';
  STAGES.filter((x) => x.num !== s.num).forEach((x) => sel.append(el('option', { value: x.num, textContent: 'Stage ' + x.num + ': ' + x.name, selected: !!current.second && current.second.num === x.num })));
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
  go(sessionSurveyDone ? 'saved' : 'survey');     // one survey per session
});
$('change-plan').addEventListener('click', () => { eatReturn = true; go('eat'); });
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
    sessionSurveyDone = true;
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

// ---- exit ----
$('exit-app').addEventListener('click', () => {
  stopCamera();
  sessionStart = null; sessionSurveyDone = false; current = null; justSaved = false; eatTime = null;
  go('bye');
  try { window.close(); } catch (e) { /* browsers only let a page close itself in some cases */ }
});
$('bye-restart').addEventListener('click', () => go('welcome'));

// ---- save to home screen ----
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; $('install-now').hidden = false; });
$('install-now').addEventListener('click', async () => { if (installEvent) { installEvent.prompt(); installEvent = null; $('install-now').hidden = true; } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

go('welcome');
