'use strict';
// Pure business logic (no database) so it can be unit-tested.

const CLASSES = {
  '1A': { name: 'AC First Class', coach: 'H', perCoach: 24, rate: 4.0, base: 60, layout: 'first' },
  '2A': { name: 'AC 2 Tier', coach: 'A', perCoach: 46, rate: 2.3, base: 50, layout: 'two' },
  '3A': { name: 'AC 3 Tier', coach: 'B', perCoach: 64, rate: 1.6, base: 40, layout: 'sleeper' },
  SL: { name: 'Sleeper', coach: 'S', perCoach: 72, rate: 0.6, base: 20, layout: 'sleeper' },
  EC: { name: 'Executive Chair Car', coach: 'E', perCoach: 56, rate: 3.0, base: 60, layout: 'chair' },
  CC: { name: 'Chair Car', coach: 'C', perCoach: 78, rate: 1.5, base: 40, layout: 'chair' }
};

const LAYOUTS = {
  sleeper: ['Lower', 'Middle', 'Upper', 'Lower', 'Middle', 'Upper', 'Side Lower', 'Side Upper'],
  two: ['Lower', 'Upper', 'Lower', 'Upper', 'Side Lower', 'Side Upper'],
  first: ['Lower', 'Upper'],
  chair: ['Window', 'Middle', 'Aisle', 'Aisle', 'Window']
};

const GENDERS = ['Male', 'Female', 'Other'];
const MAX_PASSENGERS = 6;
const MAX_ADVANCE_DAYS = 120;

// ---- seats -------------------------------------------------------------
function seatInfo(cls, n) {
  const c = CLASSES[cls];
  const coachNo = Math.ceil(n / c.perCoach);
  const pos = (n - 1) % c.perCoach;
  const cycle = LAYOUTS[c.layout];
  return { berth: cycle[pos % cycle.length], label: `${c.coach}${coachNo}-${pos + 1}` };
}

// Returns [{seat_no, berth, label}] (one per preference) or null if not enough seats.
function allocateSeats(cls, total, taken, prefs) {
  const used = new Set(taken);
  const findFree = (berth) => {
    for (let n = 1; n <= total; n++) {
      if (used.has(n)) continue;
      if (!berth || seatInfo(cls, n).berth === berth) return n;
    }
    return null;
  };
  const out = [];
  for (const pref of prefs) {
    let n = pref && pref !== 'No Preference' ? findFree(pref) : null;
    if (n === null) n = findFree(null);
    if (n === null) return null;
    used.add(n);
    out.push({ seat_no: n, ...seatInfo(cls, n) });
  }
  return out;
}

// ---- fares -------------------------------------------------------------
const fareFor = (base, rate, km) => Math.round(Number(base) + Number(rate) * km);

// ---- time helpers ------------------------------------------------------
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };

// a = boarding stop, b = destination stop (rows from train_stops)
function tripTimes(a, b) {
  const dep = a.day_offset * 1440 + toMin(a.departure_time);
  const arr = b.day_offset * 1440 + toMin(b.arrival_time);
  return { duration: arr - dep, arrDayDiff: b.day_offset - a.day_offset };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function runsOn(runDays, dateStr) {
  const idx = (new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7; // Mon = 0
  return runDays[idx] === '1';
}

const pad = (n) => String(n).padStart(2, '0');
const todayStr = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const departureDate = (dateStr, timeStr) => new Date(`${dateStr}T${String(timeStr).slice(0, 5)}:00`);
const hasDeparted = (dateStr, timeStr, now = new Date()) => departureDate(dateStr, timeStr) <= now;
const hoursUntil = (dateStr, timeStr, now = new Date()) => (departureDate(dateStr, timeStr) - now) / 36e5;

// ---- cancellation ------------------------------------------------------
function refundPolicy(hours) {
  if (hours >= 48) return { percent: 90, label: '48 hours or more before departure' };
  if (hours >= 12) return { percent: 75, label: '12 to 48 hours before departure' };
  if (hours >= 4) return { percent: 50, label: '4 to 12 hours before departure' };
  return { percent: 0, label: 'less than 4 hours before departure' };
}

// ---- validation --------------------------------------------------------
function validateDate(dateStr, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return 'Please choose a valid journey date.';
  if (isNaN(new Date(dateStr + 'T00:00:00Z'))) return 'Please choose a valid journey date.';
  const today = todayStr(now);
  if (dateStr < today) return 'Journey date cannot be in the past.';
  if (dateStr > addDays(today, MAX_ADVANCE_DAYS)) return `Bookings open only ${MAX_ADVANCE_DAYS} days in advance.`;
  return null;
}

function validatePassengers(list) {
  if (!Array.isArray(list) || list.length < 1) return { error: 'Add at least one passenger.' };
  if (list.length > MAX_PASSENGERS) return { error: `You can book up to ${MAX_PASSENGERS} passengers at once.` };
  const clean = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    const name = String(p.name || '').trim().replace(/\s+/g, ' ');
    const age = Number(p.age);
    if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(name)) return { error: `Passenger ${i + 1}: enter a valid name (letters only).` };
    if (!Number.isInteger(age) || age < 1 || age > 120) return { error: `Passenger ${i + 1}: age must be between 1 and 120.` };
    if (!GENDERS.includes(p.gender)) return { error: `Passenger ${i + 1}: select a gender.` };
    clean.push({ name, age, gender: p.gender, berth: String(p.berth || 'No Preference') });
  }
  return { list: clean };
}

const maskName = (n) => String(n).split(' ').map((w) => w[0] + '*'.repeat(Math.max(w.length - 1, 1))).join(' ');

module.exports = {
  CLASSES, LAYOUTS, MAX_PASSENGERS, seatInfo, allocateSeats, fareFor, toMin, tripTimes, addDays,
  runsOn, todayStr, hasDeparted, hoursUntil, refundPolicy, validateDate, validatePassengers, maskName
};
