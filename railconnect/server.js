// ========================================
// RAILCONNECT - RAILWAY BOOKING BACKEND
// ========================================
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const L = require('./lib/logic');
const { HttpError, hashPassword, verifyPassword, createToken, requireAuth, loginGuard } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const PAYMENT_METHODS = ['UPI', 'Card', 'Net Banking', 'Wallet'];

app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

async function resolveStation(input) {
  const text = String(input || '').trim();
  if (!text) throw new HttpError(400, 'Please enter both stations.');
  const paren = /\(([A-Za-z]+)\)\s*$/.exec(text);
  const code = (paren ? paren[1] : text).toUpperCase();
  let [rows] = await pool.query('SELECT * FROM stations WHERE code = ?', [code]);
  if (!rows.length) [rows] = await pool.query('SELECT * FROM stations WHERE LOWER(name) = LOWER(?) OR LOWER(city) = LOWER(?)', [text, text]);
  if (!rows.length) [rows] = await pool.query('SELECT * FROM stations WHERE name LIKE ? OR city LIKE ? ORDER BY name LIMIT 1', [`%${text}%`, `%${text}%`]);
  if (!rows.length) throw new HttpError(404, `Station "${text}" not found. Pick one from the suggestions.`);
  return rows[0];
}

async function fetchBookings(where, params) {
  const [rows] = await pool.query(
    `SELECT b.*, t.train_number, t.train_name, t.train_type, f.name AS from_name, tt.name AS to_name,
            p.method AS payment_method, p.status AS payment_status, p.txn_id
       FROM bookings b
       JOIN trains t ON t.id = b.train_id
       JOIN stations f ON f.code = b.from_code
       JOIN stations tt ON tt.code = b.to_code
       LEFT JOIN payments p ON p.booking_id = b.id
      WHERE ${where} ORDER BY b.journey_date DESC, b.id DESC`, params);
  if (!rows.length) return [];
  const [pax] = await pool.query('SELECT * FROM passengers WHERE booking_id IN (?) ORDER BY id', [rows.map((r) => r.id)]);
  return rows.map((r) => ({
    ...r,
    class_name: L.CLASSES[r.class_type].name,
    arrival_date: L.addDays(r.journey_date, r.arr_day_diff),
    passengers: pax.filter((x) => x.booking_id === r.id)
  }));
}

// ---------- health ----------
app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ success: true, status: 'ok' });
});

// ---------- auth ----------
app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) throw new HttpError(400, 'Please enter your full name (letters only).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (phone && !/^[6-9]\d{9}$/.test(phone)) throw new HttpError(400, 'Phone must be a 10-digit Indian mobile number.');
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    throw new HttpError(400, 'Password must be at least 8 characters and include a letter and a number.');
  try {
    const [r] = await pool.query('INSERT INTO users (name,email,phone,password_hash) VALUES (?,?,?,?)',
      [name, email, phone || null, await hashPassword(password)]);
    const user = { id: r.insertId, name, email };
    res.status(201).json({ success: true, message: 'Account created.', token: createToken(user), user });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'An account with this email already exists.');
    throw e;
  }
});

async function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) throw new HttpError(400, 'Email and password are required.');
  const key = `${req.ip}|${email}`;
  loginGuard.check(key);
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  if (!rows.length || !(await verifyPassword(password, rows[0].password_hash))) {
    loginGuard.fail(key);
    throw new HttpError(401, 'Invalid email or password.');
  }
  loginGuard.clear(key);
  const user = publicUser(rows[0]);
  res.json({ success: true, message: 'Login successful.', token: createToken(user), user });
}
app.post('/api/auth/login', login);
app.post('/api/login', login); // old path kept so existing pages keep working

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ success: true, user: req.user }));

// ---------- stations ----------
app.get('/api/stations', async (req, res) => {
  const [rows] = await pool.query('SELECT code, name, city FROM stations ORDER BY name');
  res.json({ success: true, stations: rows });
});

// ---------- train search ----------
app.get('/api/trains/search', async (req, res) => {
  const date = String(req.query.date || '');
  const wantClass = String(req.query.class || '').toUpperCase();
  const dateErr = L.validateDate(date);
  if (dateErr) throw new HttpError(400, dateErr);
  const [from, to] = await Promise.all([resolveStation(req.query.from), resolveStation(req.query.to)]);
  if (from.code === to.code) throw new HttpError(400, 'Source and destination cannot be the same.');

  const [rows] = await pool.query(
    `SELECT t.id, t.train_number, t.train_name, t.train_type, t.run_days,
            a.departure_time AS dep, a.day_offset AS a_day, a.distance_km AS a_km,
            b.arrival_time AS arr, b.day_offset AS b_day, b.distance_km AS b_km
       FROM trains t
       JOIN train_stops a ON a.train_id = t.id AND a.station_code = ?
       JOIN train_stops b ON b.train_id = t.id AND b.station_code = ? AND b.seq > a.seq
      ORDER BY a.day_offset, a.departure_time`, [from.code, to.code]);

  const running = rows.filter((r) => L.runsOn(r.run_days, L.addDays(date, -r.a_day)) && !L.hasDeparted(date, r.dep));
  let trains = [];
  if (running.length) {
    const ids = running.map((r) => r.id);
    const runDates = [...new Set(running.map((r) => L.addDays(date, -r.a_day)))];
    const [classes] = await pool.query('SELECT * FROM train_classes WHERE train_id IN (?)', [ids]);
    const [booked] = await pool.query(
      `SELECT b.train_id, b.class_type, b.run_date, COUNT(*) AS n
         FROM passengers p JOIN bookings b ON b.id = p.booking_id
        WHERE b.status = 'Confirmed' AND p.status = 'Confirmed' AND b.train_id IN (?) AND b.run_date IN (?)
        GROUP BY b.train_id, b.class_type, b.run_date`, [ids, runDates]);

    trains = running.map((r) => {
      const runDate = L.addDays(date, -r.a_day);
      const km = r.b_km - r.a_km;
      const cls = classes.filter((c) => c.train_id === r.id && (!wantClass || c.class_type === wantClass))
        .map((c) => {
          const used = booked.find((x) => x.train_id === r.id && x.class_type === c.class_type && x.run_date === runDate);
          return {
            class_type: c.class_type, name: L.CLASSES[c.class_type].name,
            fare: L.fareFor(c.base_fare, c.rate_per_km, km),
            available: Math.max(c.total_seats - (used ? Number(used.n) : 0), 0), total: c.total_seats
          };
        }).sort((x, y) => x.fare - y.fare);
      const { duration, arrDayDiff } = L.tripTimes({ day_offset: r.a_day, departure_time: r.dep }, { day_offset: r.b_day, arrival_time: r.arr });
      return {
        id: r.id, train_number: r.train_number, train_name: r.train_name, train_type: r.train_type, run_days: r.run_days,
        from: { code: from.code, name: from.name, time: r.dep.slice(0, 5), date },
        to: { code: to.code, name: to.name, time: r.arr.slice(0, 5), date: L.addDays(date, arrDayDiff) },
        duration_min: duration, distance_km: km, classes: cls
      };
    }).filter((t) => t.classes.length);
  }
  res.json({ success: true, from, to, date, trains });
});

app.get('/api/trains/:id/schedule', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.seq, s.station_code AS code, st.name, s.arrival_time, s.departure_time, s.day_offset, s.distance_km
       FROM train_stops s JOIN stations st ON st.code = s.station_code
      WHERE s.train_id = ? ORDER BY s.seq`, [req.params.id]);
  if (!rows.length) throw new HttpError(404, 'Train not found.');
  const [[train]] = await pool.query('SELECT train_number, train_name, train_type, run_days FROM trains WHERE id = ?', [req.params.id]);
  res.json({ success: true, train, stops: rows.map((r) => ({ ...r, arrival_time: r.arrival_time && r.arrival_time.slice(0, 5), departure_time: r.departure_time && r.departure_time.slice(0, 5) })) });
});

// ---------- bookings ----------
app.post('/api/bookings', requireAuth, async (req, res) => {
  const { train_id, class_type, from, to, date, passengers, payment_method } = req.body || {};
  const cls = String(class_type || '').toUpperCase();
  if (!L.CLASSES[cls]) throw new HttpError(400, 'Invalid travel class.');
  const dateErr = L.validateDate(date);
  if (dateErr) throw new HttpError(400, dateErr);
  const { list, error } = L.validatePassengers(passengers);
  if (error) throw new HttpError(400, error);
  if (!PAYMENT_METHODS.includes(payment_method)) throw new HttpError(400, 'Please choose a payment method.');
  const [fromSt, toSt] = await Promise.all([resolveStation(from), resolveStation(to)]);

  const conn = await pool.getConnection();
  let pnr;
  try {
    await conn.beginTransaction();
    // Lock this class row so two people can never grab the same last seat.
    const [[tc]] = await conn.query('SELECT * FROM train_classes WHERE train_id = ? AND class_type = ? FOR UPDATE', [train_id, cls]);
    if (!tc) throw new HttpError(404, 'This class is not available on the selected train.');
    const [[train]] = await conn.query('SELECT * FROM trains WHERE id = ?', [train_id]);
    const [stops] = await conn.query('SELECT * FROM train_stops WHERE train_id = ? AND station_code IN (?, ?)', [train_id, fromSt.code, toSt.code]);
    const a = stops.find((s) => s.station_code === fromSt.code);
    const b = stops.find((s) => s.station_code === toSt.code);
    if (!a || !b || a.seq >= b.seq) throw new HttpError(400, 'This train does not run between the selected stations.');

    const runDate = L.addDays(date, -a.day_offset);
    if (!L.runsOn(train.run_days, runDate)) throw new HttpError(409, 'This train does not run on the selected date.');
    if (L.hasDeparted(date, a.departure_time)) throw new HttpError(409, 'This train has already departed.');

    const [takenRows] = await conn.query(
      `SELECT p.seat_no FROM passengers p JOIN bookings b ON b.id = p.booking_id
        WHERE b.train_id = ? AND b.class_type = ? AND b.run_date = ? AND b.status = 'Confirmed' AND p.status = 'Confirmed'`,
      [train_id, cls, runDate]);
    const taken = takenRows.map((r) => r.seat_no);
    const seats = L.allocateSeats(cls, tc.total_seats, taken, list.map((p) => p.berth));
    if (!seats) {
      const left = tc.total_seats - taken.length;
      throw new HttpError(409, left > 0 ? `Only ${left} seat(s) left in ${cls}.` : `No seats left in ${cls}.`);
    }

    const km = b.distance_km - a.distance_km;
    const perFare = L.fareFor(tc.base_fare, tc.rate_per_km, km);
    const total = perFare * list.length;
    const { duration, arrDayDiff } = L.tripTimes(a, b);

    do { // 10-digit PNR, retried on the (very unlikely) collision
      pnr = String(crypto.randomInt(1000000000, 9999999999));
    } while ((await conn.query('SELECT 1 FROM bookings WHERE pnr = ?', [pnr]))[0].length);

    const [ins] = await conn.query('INSERT INTO bookings SET ?', [{
      pnr, user_id: req.user.id, train_id, class_type: cls, from_code: fromSt.code, to_code: toSt.code,
      journey_date: date, run_date: runDate, dep_time: a.departure_time, arr_time: b.arrival_time,
      arr_day_diff: arrDayDiff, duration_min: duration, distance_km: km, total_amount: total
    }]);
    await conn.query('INSERT INTO passengers (booking_id,name,age,gender,seat_no,seat_label,berth,fare) VALUES ?',
      [list.map((p, i) => [ins.insertId, p.name, p.age, p.gender, seats[i].seat_no, seats[i].label, seats[i].berth, perFare])]);
    await conn.query('INSERT INTO payments (booking_id,amount,method,status,txn_id) VALUES (?,?,?,?,?)',
      [ins.insertId, total, payment_method, 'Success', 'TXN' + crypto.randomBytes(7).toString('hex').toUpperCase()]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const [booking] = await fetchBookings('b.pnr = ?', [pnr]);
  res.status(201).json({ success: true, message: 'Ticket booked successfully.', booking });
});

app.get('/api/bookings', requireAuth, async (req, res) => {
  res.json({ success: true, bookings: await fetchBookings('b.user_id = ?', [req.user.id]) });
});

async function quoteRefund(booking) {
  if (booking.status === 'Cancelled') throw new HttpError(400, 'This booking is already cancelled.');
  if (L.hasDeparted(booking.journey_date, booking.dep_time)) throw new HttpError(400, 'The train has already departed - this ticket cannot be cancelled.');
  const policy = L.refundPolicy(L.hoursUntil(booking.journey_date, booking.dep_time));
  return { ...policy, refund: Math.round(Number(booking.total_amount) * policy.percent) / 100 };
}

app.get('/api/bookings/:id/refund-quote', requireAuth, async (req, res) => {
  const [b] = await pool.query('SELECT * FROM bookings WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!b.length) throw new HttpError(404, 'Booking not found.');
  res.json({ success: true, ...(await quoteRefund(b[0])), amount: Number(b[0].total_amount) });
});

app.post('/api/bookings/:id/cancel', requireAuth, async (req, res) => {
  const conn = await pool.getConnection();
  let q;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM bookings WHERE id = ? AND user_id = ? FOR UPDATE', [req.params.id, req.user.id]);
    if (!rows.length) throw new HttpError(404, 'Booking not found.');
    q = await quoteRefund(rows[0]);
    await conn.query("UPDATE bookings SET status='Cancelled', refund_amount=?, cancelled_at=NOW() WHERE id=?", [q.refund, rows[0].id]);
    await conn.query("UPDATE passengers SET status='Cancelled' WHERE booking_id=?", [rows[0].id]); // frees the seats
    await conn.query('UPDATE payments SET status=? WHERE booking_id=?', [q.refund > 0 ? 'Refund Initiated' : 'No Refund', rows[0].id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  res.json({ success: true, message: 'Booking cancelled.', refund: q.refund, percent: q.percent });
});

// ---------- public PNR status ----------
app.get('/api/pnr/:pnr', async (req, res) => {
  if (!/^\d{10}$/.test(req.params.pnr)) throw new HttpError(400, 'PNR must be a 10-digit number.');
  const [b] = await fetchBookings('b.pnr = ?', [req.params.pnr]);
  if (!b) throw new HttpError(404, 'PNR not found. Please check the number.');
  res.json({
    success: true,
    booking: {
      pnr: b.pnr, status: b.status, train_number: b.train_number, train_name: b.train_name,
      from_name: b.from_name, to_name: b.to_name, journey_date: b.journey_date, dep_time: b.dep_time,
      arr_time: b.arr_time, arrival_date: b.arrival_date, class_type: b.class_type, class_name: b.class_name,
      passengers: b.passengers.map((p) => ({ name: L.maskName(p.name), seat_label: p.seat_label, berth: p.berth, status: p.status }))
    }
  });
});

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'API route not found.' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ success: false, message: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid request body.' });
  console.error('SERVER ERROR:', err);
  const hint = err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_DB_ERROR' ? ' Database is not set up - run "npm run setup".' : '';
  res.status(500).json({ success: false, message: 'Something went wrong on the server.' + hint });
});

if (require.main === module) {
  app.listen(PORT, async () => {
    require('./lib/auth').secretWarning();
    console.log(`🚆 RailConnect running at http://localhost:${PORT}`);
    try { await pool.query('SELECT 1'); console.log('✅ MySQL connected'); }
    catch (e) { console.error(`❌ MySQL connection failed: ${e.message}\n   Check your .env file, then run "npm run setup".`); }
  });
}

module.exports = app;
