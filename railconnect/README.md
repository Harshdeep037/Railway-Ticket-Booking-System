# 🚆 RailConnect - Railway Ticket Booking

Node.js + Express + MySQL backend with a responsive vanilla-JS front end (served by the same server).

## Quick start

1. **Install Node.js 18+ and MySQL 8+**, make sure MySQL is running.
2. In this folder run: `npm install`
3. Copy `.env.example` to `.env` and put your MySQL password in it (`DB_PASSWORD=...`). Also set `JWT_SECRET` to any long random text.
4. Create the database, tables and sample trains: `npm run setup`
5. Start the app: `npm start`  → open **http://localhost:5000**

Demo login: `demo@railconnect.com` / `Demo@1234`  (or register your own account).

> Open the site through `http://localhost:5000`, not by double-clicking `index.html`.
> `npm run setup -- --reset` wipes and re-creates the RailConnect tables. `npm test` runs the unit tests.

## What was fixed from the original project

| Problem | Fix |
|---|---|
| No `/api/register` route (Register button only showed an alert) | Full register + login + session (`/api/auth/*`) |
| Passwords stored and compared in plain text | Passwords hashed with scrypt; signed 7-day login tokens |
| Anyone could book/cancel for any `user_id` | User comes from the token; cancel/list only your own bookings |
| Search needed exact station text; date ignored | Station names/codes/cities all work, date and weekday checked, trains between **any** two stops of a route |
| Seats not tracked per date, random seat numbers, two people could get the same seat | Per-date availability, real coach/berth allocation, row-locked transaction |
| Booking row saved before the seat check (orphan bookings on failure) | Everything (booking, passengers, payment) in one transaction - all or nothing |
| Duration never shown | Duration, distance, overnight "+1d" arrival calculated |
| `package.json` main = `script.js`, no start script | `npm start`, `npm run setup`, `npm test` |
| DB password in source code | Moved to `.env` (git-ignored) |
| `innerHTML` with raw data (XSS) | All dynamic text escaped |
| `Index.html` capital I (breaks on Linux hosting) | `public/index.html` |

## New features
Multi-passenger booking (up to 6 per PNR), berth/window preference, distance-based fares, sort by departure/duration/fare, route & stops viewer, payment step (demo), printable e-ticket, refund quote before cancelling (90% / 75% / 50% / 0% by time left), upcoming/past/cancelled tabs, public PNR status with masked names, login brute-force guard, toasts, mobile layout.

## Project layout
```
server.js        API routes            setup.js    DB + sample data
db.js            MySQL pool            schema.sql  tables
lib/logic.js     fares, seats, refunds (unit-tested)
lib/auth.js      hashing + tokens
public/          index.html, style.css, script.js
```

## Notes
- Train timetables, fares and payments are **sample/demo data**, not real Indian Railways data.
- Times use the server's clock - if you host outside India set `TZ=Asia/Kolkata`.
- Seats are held for the whole route (a seat freed mid-journey is not resold) - a deliberate simplification.
- **Change your MySQL password** if the old one (`db.js`) was ever shared or uploaded.
