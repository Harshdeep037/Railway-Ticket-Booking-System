const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/logic');

test('berth allocation honours preference and never double-books', () => {
  const s = L.allocateSeats('3A', 64, [1], ['Lower', 'Lower', 'Upper']);
  const nums = s.map((x) => x.seat_no);
  assert.strictEqual(new Set(nums).size, 3);
  assert.ok(!nums.includes(1));
  assert.strictEqual(s[0].berth, 'Lower');
  assert.strictEqual(s[2].berth, 'Upper');
});
test('returns null when coach is full', () => {
  assert.strictEqual(L.allocateSeats('EC', 3, [1, 2], ['No Preference', 'No Preference']), null);
});
test('falls back to any seat if preferred berth is gone', () => {
  const s = L.allocateSeats('1A', 2, [1], ['Lower']);
  assert.strictEqual(s[0].seat_no, 2);
});
test('seat labels', () => {
  assert.strictEqual(L.seatInfo('SL', 73).label, 'S2-1');
  assert.strictEqual(L.seatInfo('SL', 7).berth, 'Side Lower');
});
test('fare is distance based', () => {
  assert.strictEqual(L.fareFor(40, 1.5, 100), 190);
});
test('overnight duration', () => {
  const a = { day_offset: 0, departure_time: '16:55:00' };
  const b = { day_offset: 1, arrival_time: '08:45:00' };
  const r = L.tripTimes(a, b);
  assert.strictEqual(r.duration, 950);
  assert.strictEqual(r.arrDayDiff, 1);
});
test('run days use the origin date', () => {
  assert.strictEqual(L.runsOn('1000000', '2026-11-02'), true); // Monday
  assert.strictEqual(L.runsOn('1000000', '2026-11-03'), false);
  assert.strictEqual(L.addDays('2026-11-03', -1), '2026-11-02');
});
test('refund slabs', () => {
  assert.strictEqual(L.refundPolicy(72).percent, 90);
  assert.strictEqual(L.refundPolicy(20).percent, 75);
  assert.strictEqual(L.refundPolicy(5).percent, 50);
  assert.strictEqual(L.refundPolicy(1).percent, 0);
});
test('date validation', () => {
  const now = new Date('2026-11-01T10:00:00');
  assert.ok(L.validateDate('2026-10-31', now));
  assert.strictEqual(L.validateDate('2026-11-01', now), null);
  assert.ok(L.validateDate('2027-06-01', now));
  assert.ok(L.validateDate('garbage', now));
});
test('passenger validation', () => {
  assert.ok(L.validatePassengers([]).error);
  assert.ok(L.validatePassengers([{ name: '1', age: 3, gender: 'Male' }]).error);
  assert.ok(L.validatePassengers([{ name: 'Asha Rao', age: 0, gender: 'Female' }]).error);
  assert.ok(L.validatePassengers([{ name: 'Asha Rao', age: 30, gender: 'Female' }]).list);
});
