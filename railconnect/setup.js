// Usage:  npm run setup            -> create database + tables + sample data (safe to re-run)
//         npm run setup -- --reset -> drop all RailConnect tables first, then recreate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { hashPassword } = require('./lib/auth');
const L = require('./lib/logic');

const DB = process.env.DB_NAME || 'railconnect';

const STATIONS = [
  ['NDLS', 'New Delhi', 'Delhi'], ['UMB', 'Ambala Cantt', 'Ambala'], ['CDG', 'Chandigarh', 'Chandigarh'],
  ['KLK', 'Kalka', 'Kalka'], ['LDH', 'Ludhiana Jn', 'Ludhiana'], ['JUC', 'Jalandhar City', 'Jalandhar'],
  ['ASR', 'Amritsar Jn', 'Amritsar'], ['RPAR', 'Rupnagar', 'Rupnagar'], ['UHL', 'Una Himachal', 'Una'],
  ['MB', 'Moradabad', 'Moradabad'], ['BE', 'Bareilly Jn', 'Bareilly'], ['LKO', 'Lucknow NR', 'Lucknow'],
  ['JP', 'Jaipur Jn', 'Jaipur'], ['AII', 'Ajmer Jn', 'Ajmer'], ['KOTA', 'Kota Jn', 'Kota'],
  ['BRC', 'Vadodara Jn', 'Vadodara'], ['ST', 'Surat', 'Surat'], ['BCT', 'Mumbai Central', 'Mumbai'],
  ['CNB', 'Kanpur Central', 'Kanpur'], ['PRYJ', 'Prayagraj Jn', 'Prayagraj'], ['DDU', 'Pt DD Upadhyaya Jn', 'Mughalsarai'],
  ['GAYA', 'Gaya Jn', 'Gaya'], ['DHN', 'Dhanbad Jn', 'Dhanbad'], ['HWH', 'Howrah Jn', 'Kolkata'],
  ['MAS', 'Chennai Central', 'Chennai'], ['KPD', 'Katpadi Jn', 'Vellore'], ['SBC', 'KSR Bengaluru', 'Bengaluru']
];

// stops: [station, km from origin, minutes after departure (arrival at that stop)]
// cls: coaches per class. rev: the return train. SAMPLE schedules - not real timetables.
const ROUTES = [
  { no: '12011', name: 'Delhi-Kalka Shatabdi', type: 'Shatabdi', mult: 1.3, dep: '07:40', cls: { CC: 3, EC: 1 },
    rev: { no: '12012', name: 'Kalka-Delhi Shatabdi', dep: '17:35' },
    stops: [['NDLS', 0, 0], ['UMB', 200, 145], ['CDG', 244, 207], ['KLK', 302, 305]] },
  { no: '12029', name: 'Amritsar Swarna Shatabdi', type: 'Shatabdi', mult: 1.3, dep: '07:20', cls: { CC: 3, EC: 1 },
    rev: { no: '12030', name: 'Delhi Swarna Shatabdi', dep: '17:00' },
    stops: [['NDLS', 0, 0], ['UMB', 200, 160], ['LDH', 313, 238], ['JUC', 365, 280], ['ASR', 449, 360]] },
  { no: '12497', name: 'Shan-e-Punjab Express', type: 'Superfast', mult: 1.1, dep: '15:10', cls: { SL: 5, '3A': 3, '2A': 2, CC: 1 },
    rev: { no: '12498', name: 'Shan-e-Punjab (Amritsar-Delhi)', dep: '22:50' },
    stops: [['NDLS', 0, 0], ['UMB', 200, 215], ['LDH', 313, 320], ['JUC', 365, 365], ['ASR', 449, 470]] },
  { no: '14553', name: 'Una Himachal Express', type: 'Express', mult: 1, dep: '15:15', cls: { SL: 4, '3A': 2, '2A': 1 },
    rev: { no: '14554', name: 'Himachal Express (Una-Delhi)', dep: '05:30' },
    stops: [['NDLS', 0, 0], ['UMB', 200, 210], ['CDG', 244, 265], ['RPAR', 289, 325], ['UHL', 369, 410]] },
  { no: '12951', name: 'Mumbai Rajdhani', type: 'Rajdhani', mult: 1.35, dep: '16:55', cls: { '1A': 1, '2A': 2, '3A': 5 },
    rev: { no: '12952', name: 'Delhi Rajdhani (from Mumbai)', dep: '17:00' },
    stops: [['NDLS', 0, 0], ['KOTA', 465, 330], ['BRC', 1030, 710], ['ST', 1170, 815], ['BCT', 1384, 950]] },
  { no: '12301', name: 'Howrah Rajdhani', type: 'Rajdhani', mult: 1.35, dep: '17:05', cls: { '1A': 1, '2A': 3, '3A': 6 },
    rev: { no: '12302', name: 'Delhi Rajdhani (from Howrah)', dep: '16:50' },
    stops: [['NDLS', 0, 0], ['CNB', 440, 265], ['PRYJ', 634, 395], ['DDU', 760, 475], ['GAYA', 990, 610], ['DHN', 1190, 745], ['HWH', 1450, 1030]] },
  { no: '12027', name: 'Chennai-Bengaluru Shatabdi', type: 'Shatabdi', mult: 1.3, dep: '05:50', cls: { CC: 3, EC: 1 },
    rev: { no: '12028', name: 'Bengaluru-Chennai Shatabdi', dep: '14:30' },
    stops: [['MAS', 0, 0], ['KPD', 132, 125], ['SBC', 358, 300]] },
  { no: '12015', name: 'Ajmer Shatabdi', type: 'Shatabdi', mult: 1.3, dep: '06:05', cls: { CC: 3, EC: 1 },
    rev: { no: '12016', name: 'Delhi Shatabdi (from Ajmer)', dep: '15:50' },
    stops: [['NDLS', 0, 0], ['JP', 303, 270], ['AII', 443, 395]] },
  { no: '12003', name: 'Lucknow Swarna Shatabdi', type: 'Shatabdi', mult: 1.3, dep: '06:10', cls: { CC: 3, EC: 1 },
    rev: { no: '12004', name: 'Delhi Swarna Shatabdi (from Lucknow)', dep: '15:25' },
    stops: [['NDLS', 0, 0], ['MB', 167, 150], ['BE', 252, 235], ['LKO', 511, 390]] }
];

const HALT = 2;
const pad = (n) => String(n).padStart(2, '0');
const clock = (mins) => ({ day: Math.floor(mins / 1440), time: `${pad(Math.floor((mins % 1440) / 60))}:${pad(mins % 60)}:00` });

function buildTrains() {
  const trains = [];
  for (const r of ROUTES) {
    const totalKm = r.stops[r.stops.length - 1][1];
    const totalMin = r.stops[r.stops.length - 1][2];
    const rev = r.stops.map(([c, km, m]) => [c, totalKm - km, totalMin - m]).reverse();
    trains.push({ ...r, stops: r.stops });
    trains.push({ ...r, no: r.rev.no, name: r.rev.name, dep: r.rev.dep, stops: rev });
  }
  return trains;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', multipleStatements: true
  });
  console.log(`Connected to MySQL. Using database "${DB}".`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${DB}\``);

  if (process.argv.includes('--reset')) {
    console.log('Dropping existing tables...');
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const t of ['payments', 'passengers', 'bookings', 'train_classes', 'train_stops', 'trains', 'stations', 'users'])
      await conn.query(`DROP TABLE IF EXISTS ${t}`);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
  }

  await conn.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Tables ready.');

  const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM trains');
  if (n === 0) {
    await conn.query('INSERT INTO stations (code,name,city) VALUES ?', [STATIONS]);
    for (const t of buildTrains()) {
      const [ins] = await conn.query('INSERT INTO trains (train_number,train_name,train_type,run_days) VALUES (?,?,?,?)',
        [t.no, t.name, t.type, '1111111']);
      const start = L.toMin(t.dep);
      const last = t.stops.length - 1;
      const stops = t.stops.map(([code, km, m], i) => {
        const arr = clock(start + m);
        const dep = clock(start + m + HALT);
        return [ins.insertId, i + 1, code,
          i === 0 ? null : arr.time, i === last ? null : (i === 0 ? clock(start).time : dep.time),
          arr.day, km];
      });
      await conn.query('INSERT INTO train_stops (train_id,seq,station_code,arrival_time,departure_time,day_offset,distance_km) VALUES ?', [stops]);
      const classes = Object.entries(t.cls).map(([c, coaches]) => [
        ins.insertId, c, coaches * L.CLASSES[c].perCoach, L.CLASSES[c].base, +(L.CLASSES[c].rate * t.mult).toFixed(3)
      ]);
      await conn.query('INSERT INTO train_classes (train_id,class_type,total_seats,base_fare,rate_per_km) VALUES ?', [classes]);
    }
    const [[{ c }]] = await conn.query('SELECT COUNT(*) c FROM trains');
    console.log(`Seeded ${STATIONS.length} stations and ${c} trains.`);
  } else {
    console.log('Train data already present - skipped seeding (use -- --reset to start fresh).');
  }

  const [[{ u }]] = await conn.query("SELECT COUNT(*) u FROM users WHERE email='demo@railconnect.com'");
  if (!u) {
    await conn.query('INSERT INTO users (name,email,phone,password_hash) VALUES (?,?,?,?)',
      ['Demo Traveller', 'demo@railconnect.com', '9876543210', await hashPassword('Demo@1234')]);
    console.log('Created demo account: demo@railconnect.com / Demo@1234');
  }
  await conn.end();
  console.log('\n✅ Setup complete. Start the app with:  npm start');
}

main().catch((e) => {
  console.error('\n❌ Setup failed:', e.message);
  if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('   Check DB_USER / DB_PASSWORD in your .env file.');
  if (e.code === 'ECONNREFUSED') console.error('   MySQL is not running. Start the MySQL service and try again.');
  process.exit(1);
});
