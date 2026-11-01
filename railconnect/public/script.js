// ========================================
// RAILCONNECT - FRONTEND
// ========================================
const API = location.protocol === 'file:' ? 'http://localhost:5000/api' : '/api';
const BERTHS = {
  SL: ['Lower', 'Middle', 'Upper', 'Side Lower', 'Side Upper'],
  '3A': ['Lower', 'Middle', 'Upper', 'Side Lower', 'Side Upper'],
  '2A': ['Lower', 'Upper', 'Side Lower', 'Side Upper'],
  '1A': ['Lower', 'Upper'],
  CC: ['Window', 'Aisle'], EC: ['Window', 'Aisle']
};
const POPULAR = [['New Delhi', 'Chandigarh', 'Delhi → Chandigarh'], ['New Delhi', 'Amritsar Jn', 'Delhi → Amritsar'], ['New Delhi', 'Mumbai Central', 'Delhi → Mumbai'], ['New Delhi', 'Howrah Jn', 'Delhi → Kolkata'], ['Chennai Central', 'KSR Bengaluru', 'Chennai → Bengaluru']];
const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const state = { token: localStorage.getItem('rc_token'), user: null, trains: [], sort: 'dep', search: null,
  booking: null, bookings: [], tab: 'upcoming', pending: null };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n).toLocaleString('en-IN');
const hhmm = (t) => (t ? String(t).slice(0, 5) : '-');
const dur = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const fdate = (d, opts = { day: '2-digit', month: 'short', year: 'numeric' }) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', opts);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ---------- UI helpers ----------
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}
const openModal = (id) => { $(id).hidden = false; document.body.style.overflow = 'hidden'; };
function closeModal(id) {
  $(id).hidden = true;
  if (document.querySelectorAll('.modal:not([hidden])').length === 0) document.body.style.overflow = '';
}
function busy(btn, on, text) {
  if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = text || 'Please wait...'; btn.disabled = true; }
  else { btn.innerHTML = btn.dataset.label || btn.innerHTML; btn.disabled = false; }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let res;
  try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('Cannot reach the server. Make sure it is running (npm start).'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { setSession(null); }
  if (!res.ok || data.success === false) throw new Error(data.message || 'Something went wrong.');
  return data;
}

// ---------- session ----------
function setSession(auth) {
  state.token = auth ? auth.token : null;
  state.user = auth ? auth.user : null;
  if (auth) localStorage.setItem('rc_token', auth.token); else localStorage.removeItem('rc_token');
  $('loginButton').textContent = state.user ? 'Logout' : 'Login';
  $('userChip').hidden = !state.user;
  $('userChip').textContent = state.user ? '👤 ' + state.user.name.split(' ')[0] : '';
  loadBookings();
}

async function restoreSession() {
  if (!state.token) return setSession(null);
  try { const d = await api('/auth/me'); state.user = d.user; setSession({ token: state.token, user: d.user }); }
  catch { setSession(null); }
}

function requireLogin(msg = 'Please log in to continue.') {
  toast(msg);
  showAuth('login');
  openModal('authModal');
}

function showAuth(tab) {
  document.querySelectorAll('[data-auth]').forEach((b) => b.classList.toggle('active', b.dataset.auth === tab));
  $('loginForm').hidden = tab !== 'login';
  $('registerForm').hidden = tab !== 'register';
}

async function submitLogin(e) {
  e.preventDefault();
  const btn = e.submitter; busy(btn, true, 'Logging in...');
  try {
    const d = await api('/auth/login', { method: 'POST', body: { email: $('loginEmail').value, password: $('loginPassword').value } });
    setSession(d); closeModal('authModal'); $('loginPassword').value = '';
    toast(`Welcome back, ${d.user.name.split(' ')[0]}!`, 'success');
    if (state.pending) { const p = state.pending; state.pending = null; p(); }
  } catch (err) { toast(err.message, 'error'); } finally { busy(btn, false); }
}

async function submitRegister(e) {
  e.preventDefault();
  const btn = e.submitter; busy(btn, true, 'Creating account...');
  try {
    const d = await api('/auth/register', { method: 'POST', body: {
      name: $('regName').value, email: $('regEmail').value, phone: $('regPhone').value, password: $('regPassword').value } });
    setSession(d); closeModal('authModal'); e.target.reset();
    toast('Account created. You are logged in!', 'success');
    if (state.pending) { const p = state.pending; state.pending = null; p(); }
  } catch (err) { toast(err.message, 'error'); } finally { busy(btn, false); }
}

// ---------- search ----------
async function loadStations() {
  try {
    const d = await api('/stations');
    $('stationList').innerHTML = d.stations.map((s) => `<option value="${esc(s.name)} (${esc(s.code)})"></option>`).join('');
  } catch { /* datalist is optional */ }
}

async function doSearch(e) {
  if (e) e.preventDefault();
  const from = $('from').value.trim(), to = $('to').value.trim(), date = $('journeyDate').value, cls = $('classType').value;
  if (!from || !to) return toast('Please enter both stations.', 'error');
  if (from.toLowerCase() === to.toLowerCase()) return toast('Source and destination cannot be the same.', 'error');
  const btn = $('searchBtn'); busy(btn, true, 'Searching...');
  $('trainResults').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  $('results').scrollIntoView();
  try {
    const q = new URLSearchParams({ from, to, date, class: cls });
    const d = await api('/trains/search?' + q);
    state.search = { from: d.from, to: d.to, date: d.date };
    state.trains = d.trains;
    $('resultsTitle').textContent = `${d.from.name} → ${d.to.name}`;
    $('resultsSub').textContent = `${fdate(d.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${d.trains.length} train${d.trains.length === 1 ? '' : 's'} found`;
    renderTrains();
  } catch (err) {
    state.trains = []; $('sortBar').hidden = true;
    $('trainResults').innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><h3>Could not search</h3><p>${esc(err.message)}</p></div>`;
  } finally { busy(btn, false); }
}

function renderTrains() {
  const box = $('trainResults');
  $('sortBar').hidden = state.trains.length < 2;
  if (!state.trains.length) {
    box.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><h3>No trains found</h3><p>No train runs between these stations on this date. Try another date or class.</p></div>';
    return;
  }
  const minFare = (t) => Math.min(...t.classes.map((c) => c.fare));
  const sorters = { dep: (a, b) => a.from.time.localeCompare(b.from.time), dur: (a, b) => a.duration_min - b.duration_min, fare: (a, b) => minFare(a) - minFare(b) };
  const list = [...state.trains].sort(sorters[state.sort]);
  box.innerHTML = list.map((t) => {
    const dayDiff = Math.round((new Date(t.to.date) - new Date(t.from.date)) / 864e5);
    const runDow = t.run_days.split('').map((d, i) => `<i class="${d === '1' ? 'on' : ''}">${DAYS[i]}</i>`).join('');
    const classes = t.classes.map((c) => {
      const cls = c.available === 0 ? 'none' : c.available <= 10 ? 'low' : '';
      const label = c.available === 0 ? 'Sold out' : c.available <= 10 ? `Only ${c.available} left` : `${c.available} available`;
      return `<div class="class-card ${c.available === 0 ? 'soldout' : ''}">
        <strong>${esc(c.name)} (${esc(c.class_type)})</strong>
        <span class="fare">${money(c.fare)}</span>
        <span class="avail ${cls}">${label}</span>
        <button class="btn btn-primary btn-sm" type="button" ${c.available === 0 ? 'disabled' : ''} data-book="${t.id}|${esc(c.class_type)}">${c.available === 0 ? 'Sold out' : 'Book now'}</button>
      </div>`;
    }).join('');
    return `<article class="train-card">
      <div class="train-top"><h3>${esc(t.train_name)} <small>#${esc(t.train_number)}</small><span class="tag">${esc(t.train_type)}</span></h3>
        <div class="days" title="Runs on">${runDow}</div></div>
      <div class="timeline">
        <div class="stop"><b>${hhmm(t.from.time)}</b><span>${esc(t.from.name)}</span></div>
        <div class="line">${dur(t.duration_min)}<div></div>${t.distance_km} km</div>
        <div class="stop right"><b>${hhmm(t.to.time)}${dayDiff ? `<sup style="font-size:12px;color:#ea580c"> +${dayDiff}d</sup>` : ''}</b><span>${esc(t.to.name)}</span></div>
      </div>
      <div class="class-grid">${classes}</div>
      <div class="card-foot"><button class="link-btn" type="button" data-route="${t.id}">View route &amp; stops →</button></div>
    </article>`;
  }).join('');
}

async function showSchedule(id) {
  $('scheduleBody').innerHTML = '<div class="skeleton"></div>';
  openModal('scheduleModal');
  try {
    const d = await api(`/trains/${id}/schedule`);
    $('scheduleBody').innerHTML = `<h3 style="margin:0 40px 14px 0">${esc(d.train.train_name)} <small>#${esc(d.train.train_number)}</small></h3>
      <table class="pax"><thead><tr><th>Station</th><th>Arr</th><th>Dep</th><th>Day</th><th>Km</th></tr></thead><tbody>
      ${d.stops.map((s) => `<tr><td>${esc(s.name)} <small>(${esc(s.code)})</small></td><td>${hhmm(s.arrival_time)}</td><td>${hhmm(s.departure_time)}</td><td>${s.day_offset + 1}</td><td>${s.distance_km}</td></tr>`).join('')}
      </tbody></table>`;
  } catch (err) { $('scheduleBody').innerHTML = `<p>${esc(err.message)}</p>`; }
}

// ---------- booking flow ----------
function startBooking(trainId, classType) {
  if (!state.user) { state.pending = () => startBooking(trainId, classType); return requireLogin('Please log in to book your ticket.'); }
  const train = state.trains.find((t) => t.id === Number(trainId));
  const cls = train && train.classes.find((c) => c.class_type === classType);
  if (!cls) return;
  state.booking = { train, cls, passengers: [] };
  $('bookingSummary').innerHTML = `<h3>${esc(train.train_name)} <small>#${esc(train.train_number)}</small></h3>
    <p>${esc(train.from.name)} ${hhmm(train.from.time)} → ${esc(train.to.name)} ${hhmm(train.to.time)} · ${fdate(train.from.date)} · ${esc(cls.name)} (${esc(cls.class_type)}) · ${money(cls.fare)} per passenger</p>`;
  $('passengerList').innerHTML = '';
  addPassenger();
  gotoStep('passengers');
  openModal('bookingModal');
}

function gotoStep(step) {
  $('stepPassengers').hidden = step !== 'passengers';
  $('stepPayment').hidden = step !== 'payment';
  $('stepDone').hidden = step !== 'done';
  $('bookingSummary').hidden = step === 'done';
  const idx = { passengers: 0, payment: 1, done: 2 }[step];
  document.querySelectorAll('#steps span').forEach((s, i) => s.classList.toggle('on', i <= idx));
}

function addPassenger() {
  const list = $('passengerList');
  const n = list.children.length;
  if (n >= 6) return toast('You can book up to 6 passengers at once.');
  const { cls } = state.booking;
  if (n + 1 > cls.available) return toast(`Only ${cls.available} seat(s) available in this class.`);
  const opts = ['No Preference', ...(BERTHS[cls.class_type] || [])].map((b) => `<option>${b}</option>`).join('');
  const row = document.createElement('div');
  row.className = 'pax-row';
  row.innerHTML = `<header><span class="pax-no"></span><button type="button" data-remove>Remove</button></header>
    <div class="pax-grid">
      <div class="field"><label>Full name</label><input class="p-name" maxlength="50" placeholder="As on ID proof"></div>
      <div class="field"><label>Age</label><input class="p-age" type="number" min="1" max="120"></div>
      <div class="field"><label>Gender</label><select class="p-gender"><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></div>
      <div class="field"><label>Preference</label><select class="p-berth">${opts}</select></div>
    </div>`;
  list.appendChild(row);
  renumberPassengers();
}

function renumberPassengers() {
  const rows = [...$('passengerList').children];
  rows.forEach((r, i) => { r.querySelector('.pax-no').textContent = `Passenger ${i + 1}`; r.querySelector('[data-remove]').hidden = rows.length === 1; });
  $('totalFare').textContent = money(state.booking.cls.fare * rows.length);
}

function collectPassengers() {
  return [...$('passengerList').children].map((r) => ({
    name: r.querySelector('.p-name').value.trim(), age: Number(r.querySelector('.p-age').value),
    gender: r.querySelector('.p-gender').value, berth: r.querySelector('.p-berth').value }));
}

function toPayment() {
  const pax = collectPassengers();
  for (let i = 0; i < pax.length; i++) {
    const p = pax[i];
    if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(p.name)) return toast(`Passenger ${i + 1}: enter a valid name (letters only).`, 'error');
    if (!Number.isInteger(p.age) || p.age < 1 || p.age > 120) return toast(`Passenger ${i + 1}: enter a valid age.`, 'error');
    if (!p.gender) return toast(`Passenger ${i + 1}: select a gender.`, 'error');
  }
  state.booking.passengers = pax;
  $('payAmount').textContent = money(state.booking.cls.fare * pax.length);
  gotoStep('payment');
}

async function payNow() {
  const b = state.booking, btn = $('payNow');
  busy(btn, true, 'Processing payment...');
  try {
    const d = await api('/bookings', { method: 'POST', body: {
      train_id: b.train.id, class_type: b.cls.class_type, from: b.train.from.code, to: b.train.to.code,
      date: b.train.from.date, passengers: b.passengers, payment_method: document.querySelector('input[name=pay]:checked').value } });
    const bk = d.booking;
    $('stepDone').innerHTML = `<div class="success"><div class="tick">✓</div><h2>Booking confirmed!</h2>
      <p class="note">Your PNR is</p><h1 style="letter-spacing:3px;color:#2563eb">${esc(bk.pnr)}</h1>
      <p class="note">Amount paid ${money(bk.total_amount)} · ${bk.passengers.map((p) => esc(p.seat_label + ' ' + p.berth)).join(', ')}</p>
      <div class="row-gap"><button class="btn btn-ghost grow" data-close type="button">Close</button>
      <button class="btn btn-primary grow" id="viewNewTicket" type="button">View ticket</button></div></div>`;
    $('viewNewTicket').onclick = () => { closeModal('bookingModal'); showTicket(bk); };
    gotoStep('done');
    loadBookings();
    if (state.search) doSearchQuiet();
  } catch (err) { toast(err.message, 'error'); gotoStep('passengers'); doSearchQuiet(); } finally { busy(btn, false); }
}

// refresh availability after a booking without scrolling/skeletons
async function doSearchQuiet() {
  if (!state.search) return;
  try {
    const q = new URLSearchParams({ from: state.search.from.code, to: state.search.to.code, date: state.search.date, class: $('classType').value });
    state.trains = (await api('/trains/search?' + q)).trains; renderTrains();
  } catch { /* ignore */ }
}

// ---------- my bookings ----------
async function loadBookings() {
  const box = $('bookingsContainer');
  if (!state.user) {
    state.bookings = [];
    box.innerHTML = '<div class="empty"><div class="empty-icon">🎫</div><h3>Please log in</h3><p>Log in to see your tickets.</p><br><button class="btn btn-primary" id="loginPrompt" type="button">Login</button></div>';
    return;
  }
  try { state.bookings = (await api('/bookings')).bookings; renderBookings(); }
  catch (err) { box.innerHTML = `<div class="empty"><h3>Could not load bookings</h3><p>${esc(err.message)}</p></div>`; }
}

function renderBookings() {
  const today = ymd(new Date());
  const filters = {
    upcoming: (b) => b.status === 'Confirmed' && b.journey_date >= today,
    past: (b) => b.status === 'Confirmed' && b.journey_date < today,
    cancelled: (b) => b.status === 'Cancelled' };
  const list = state.bookings.filter(filters[state.tab]);
  if (!list.length) {
    $('bookingsContainer').innerHTML = `<div class="empty"><div class="empty-icon">🎫</div><h3>No ${state.tab} bookings</h3><p>${state.tab === 'upcoming' ? 'Search a train above and book your next journey.' : 'Nothing to show here.'}</p></div>`;
    return;
  }
  $('bookingsContainer').innerHTML = list.map((b) => `<article class="booking-card">
    <div class="booking-top"><div><h3>${esc(b.train_name)} <small>#${esc(b.train_number)}</small></h3>
      <p class="note">${esc(b.from_name)} → ${esc(b.to_name)}</p></div><span class="status ${b.status}">${b.status}</span></div>
    <div class="meta">
      <div><span>PNR</span><b>${esc(b.pnr)}</b></div>
      <div><span>Journey</span><b>${fdate(b.journey_date)}</b></div>
      <div><span>Departs</span><b>${hhmm(b.dep_time)}</b></div>
      <div><span>Class</span><b>${esc(b.class_type)}</b></div>
      <div><span>${b.status === 'Cancelled' ? 'Refund' : 'Paid'}</span><b>${money(b.status === 'Cancelled' ? b.refund_amount : b.total_amount)}</b></div>
    </div>
    <table class="pax"><thead><tr><th>Passenger</th><th>Age/Sex</th><th>Seat</th></tr></thead><tbody>
      ${b.passengers.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.age}/${esc(p.gender[0])}</td><td>${esc(p.seat_label)} · ${esc(p.berth)}</td></tr>`).join('')}</tbody></table>
    <div class="actions"><button class="btn btn-primary btn-sm" data-ticket="${b.id}" type="button">View ticket</button>
      ${b.status === 'Confirmed' && b.journey_date >= today ? `<button class="btn btn-ghost btn-sm" data-cancel="${b.id}" type="button">Cancel ticket</button>` : ''}</div>
  </article>`).join('');
}

function showTicket(b) {
  $('ticketBody').innerHTML = `<div class="ticket">
    <div class="ticket-head"><div><small>E-TICKET · ${esc(b.status).toUpperCase()}</small><br><b>PNR ${esc(b.pnr)}</b></div><div style="text-align:right"><b>${esc(b.train_name)}</b><br><small>Train ${esc(b.train_number)} · ${esc(b.class_name)}</small></div></div>
    <div class="ticket-body">
      <div class="route"><div><b>${hhmm(b.dep_time)}</b><span>${esc(b.from_name)}<br>${fdate(b.journey_date)}</span></div>
        <div class="note" style="text-align:center">${dur(b.duration_min)}<br>${b.distance_km} km</div>
        <div style="text-align:right"><b>${hhmm(b.arr_time)}</b><span>${esc(b.to_name)}<br>${fdate(b.arrival_date)}</span></div></div>
      <table class="pax"><thead><tr><th>#</th><th>Passenger</th><th>Age/Sex</th><th>Seat</th><th>Status</th></tr></thead><tbody>
        ${b.passengers.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.age}/${esc(p.gender[0])}</td><td>${esc(p.seat_label)} · ${esc(p.berth)}</td><td>${esc(p.status)}</td></tr>`).join('')}</tbody></table>
      <div class="total-row"><span>Total fare (${esc(b.payment_method || '')})</span><strong>${money(b.total_amount)}</strong></div>
      <p class="note">Carry a valid photo ID. Booked on ${esc(String(b.created_at).slice(0, 16))}. Transaction ${esc(b.txn_id || '')}.</p>
    </div></div>`;
  openModal('ticketModal');
}

async function askCancel(id) {
  try {
    const q = await api(`/bookings/${id}/refund-quote`);
    $('confirmBody').innerHTML = `<h3 style="margin-right:20px">Cancel this ticket?</h3>
      <p class="note" style="margin:10px 0">Cancelling ${esc(q.label)} refunds <b>${q.percent}%</b> of the fare.</p>
      <div class="total-row"><span>Refund amount</span><strong>${money(q.refund)}</strong></div>`;
    $('confirmYes').onclick = () => doCancel(id);
    openModal('confirmModal');
  } catch (err) { toast(err.message, 'error'); }
}

async function doCancel(id) {
  const btn = $('confirmYes'); busy(btn, true, 'Cancelling...');
  try {
    const d = await api(`/bookings/${id}/cancel`, { method: 'POST' });
    closeModal('confirmModal');
    toast(`Ticket cancelled. Refund: ${money(d.refund)}`, 'success');
    await loadBookings(); doSearchQuiet();
  } catch (err) { toast(err.message, 'error'); } finally { busy(btn, false); }
}

// ---------- PNR ----------
async function checkPNR(e) {
  e.preventDefault();
  const box = $('pnrResult'), pnr = $('pnrNumber').value.trim();
  if (!/^\d{10}$/.test(pnr)) return toast('PNR must be a 10-digit number.', 'error');
  try {
    const b = (await api('/pnr/' + pnr)).booking;
    box.innerHTML = `<article class="booking-card"><div class="booking-top"><div><h3>${esc(b.train_name)} <small>#${esc(b.train_number)}</small></h3>
      <p class="note">${esc(b.from_name)} → ${esc(b.to_name)} · ${fdate(b.journey_date)} · ${hhmm(b.dep_time)}</p></div><span class="status ${b.status}">${b.status}</span></div>
      <table class="pax" style="margin-top:14px"><thead><tr><th>Passenger</th><th>Seat</th><th>Status</th></tr></thead><tbody>
      ${b.passengers.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.seat_label)} · ${esc(p.berth)}</td><td>${esc(p.status)}</td></tr>`).join('')}</tbody></table></article>`;
  } catch (err) { box.innerHTML = `<div class="empty"><div class="empty-icon">🔎</div><h3>PNR not found</h3><p>${esc(err.message)}</p></div>`; }
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', () => {
  const today = new Date(), max = new Date(), tomorrow = new Date();
  max.setDate(max.getDate() + 120); tomorrow.setDate(tomorrow.getDate() + 1);
  const dateEl = $('journeyDate');
  dateEl.min = ymd(today); dateEl.max = ymd(max); dateEl.value = ymd(tomorrow);

  $('popularRoutes').insertAdjacentHTML('beforeend', POPULAR.map(([a, b, label]) => `<button type="button" data-route-fill="${esc(a)}|${esc(b)}">${esc(label)}</button>`).join(''));

  $('searchForm').addEventListener('submit', doSearch);
  $('swapBtn').onclick = () => { const f = $('from').value; $('from').value = $('to').value; $('to').value = f; };
  $('loginForm').addEventListener('submit', submitLogin);
  $('registerForm').addEventListener('submit', submitRegister);
  $('demoFill').onclick = () => { $('loginEmail').value = 'demo@railconnect.com'; $('loginPassword').value = 'Demo@1234'; };
  $('addPassenger').onclick = addPassenger;
  $('toPayment').onclick = toPayment;
  $('backToPassengers').onclick = () => gotoStep('passengers');
  $('payNow').onclick = payNow;
  $('printTicket').onclick = () => window.print();
  $('pnrForm').addEventListener('submit', checkPNR);
  $('menuBtn').onclick = () => $('navLinks').classList.toggle('open');
  $('navLinks').onclick = () => $('navLinks').classList.remove('open');
  $('loginButton').onclick = () => {
    if (state.user) { setSession(null); toast('Logged out.'); } else { showAuth('login'); openModal('authModal'); }
  };

  // one delegated click handler for all dynamic buttons
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, .modal');
    if (!t) return;
    if (t.classList.contains('modal')) { if (e.target === t && t.id !== 'bookingModal') closeModal(t.id); return; }
    if (t.hasAttribute('data-close')) return closeModal(t.closest('.modal').id);
    if (t.dataset.auth) return showAuth(t.dataset.auth);
    if (t.dataset.book) { const [id, c] = t.dataset.book.split('|'); return startBooking(id, c); }
    if (t.dataset.route) return showSchedule(t.dataset.route);
    if (t.dataset.sort) { state.sort = t.dataset.sort; document.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('active', b === t)); return renderTrains(); }
    if (t.dataset.tab) { state.tab = t.dataset.tab; document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === t)); return renderBookings(); }
    if (t.dataset.ticket) return showTicket(state.bookings.find((b) => b.id === Number(t.dataset.ticket)));
    if (t.dataset.cancel) return askCancel(t.dataset.cancel);
    if (t.hasAttribute('data-remove')) { t.closest('.pax-row').remove(); return renumberPassengers(); }
    if (t.id === 'loginPrompt') { showAuth('login'); return openModal('authModal'); }
    if (t.dataset.routeFill) { const [a, b] = t.dataset.routeFill.split('|'); $('from').value = a; $('to').value = b; return doSearch(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach((m) => closeModal(m.id));
  });

  loadStations();
  restoreSession();
});
