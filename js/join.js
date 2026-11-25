// Store sign-up form: saves a request that admins see under "Store sign-ups".
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const PLANS = [
  { name: 'Neighborhood', max: 799, price: '$75' },
  { name: 'Standard', max: 1500, price: '$125' },
  { name: 'High-volume', max: Infinity, price: '$200' },
];
const planFor = (n) => PLANS.find((p) => n <= p.max);
let toastTimer = null;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}
function showPlan() {
  const n = Number($('daily').value);
  document.querySelectorAll('tr[data-plan]').forEach((r) => r.removeAttribute('style'));
  if (!n || n < 1) { $('plan-out').textContent = ''; return; }
  const p = planFor(n);
  $('plan-out').textContent = 'Your plan after the free 60 days: ' + p.name + ', ' + p.price + ' a month.';
  const row = document.querySelector('tr[data-plan="' + p.name + '"]');
  if (row) row.style.background = 'var(--brass-soft, #f6ecc9)';
}
$('daily').addEventListener('input', showPlan);

const val = (id) => { const v = $(id).value.trim(); return v || null; };
$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('website').value) return;               // filled only by bots
  const row = {
    store_name: val('store_name'), chain_name: val('chain_name'), contact_name: val('contact_name'), contact_role: val('contact_role'),
    phone: val('phone'), email: val('email'), street: val('street'), city: val('city'), state: val('state'), zip: val('zip'),
    daily_transactions: Math.round(Number($('daily').value)) || null, preferred_start: val('start'), notes: val('notes'),
    agreed_contact: $('agree').checked,
  };
  if (!row.store_name || row.store_name.length < 2) return toast('Please enter the store name.');
  if (!row.contact_name || row.contact_name.length < 2) return toast('Please enter your name.');
  if (!row.phone && !row.email) return toast('Please give a phone number or an email.');
  if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return toast('Please check the email address.');
  if (!row.city || row.city.length < 2) return toast('Please enter the city.');
  if (!row.daily_transactions || row.daily_transactions < 1 || row.daily_transactions > 100000) return toast('Please enter about how many customer transactions a day.');
  if (!row.agreed_contact) return toast('Please tick the box so we can contact you.');
  $('send').disabled = true;
  const { error } = await db.from('store_signups').insert(row);
  $('send').disabled = false;
  if (error) return toast('Could not send. Check your connection and try again.');
  $('join-form').hidden = true;
  const p = planFor(row.daily_transactions);
  $('done-text').textContent = 'We received your request for ' + row.store_name + ' (' + p.name + ' plan). We will contact you to confirm your plan and a start date.';
  $('done').hidden = false;
  $('done').scrollIntoView({ block: 'start' });
});
