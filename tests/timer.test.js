'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReminderTimer, DEFAULTS, validateSettings } = require('../app/timer');
function fixture(settings = DEFAULTS) { let clock = 1000000; const timer = new ReminderTimer(settings, () => clock); return { timer, advance: ms => { clock += ms; } }; }
test('defaults are 60 minutes sitting and 5 minutes standing', () => {
  const { timer } = fixture(); const s = timer.snapshot();
  assert.equal(s.mode, 'sitting'); assert.equal(s.remainingMs, 3600000); assert.equal(s.settings.standMinutes, 5); assert.equal(s.due, false);
});
test('sitting deadline requires user action, even after a long sleep', () => {
  const { timer, advance } = fixture(); advance(7200000);
  assert.equal(timer.snapshot().due, true); assert.equal(timer.snapshot().remainingMs, 0); assert.equal(timer.snapshot().mode, 'sitting');
  timer.action('stand'); assert.equal(timer.snapshot().mode, 'standing'); assert.equal(timer.snapshot().remainingMs, 300000); assert.equal(timer.snapshot().due, false);
});
test('standing deadline waits for Back to sitting, then starts a fresh hour', () => {
  const { timer, advance } = fixture(); timer.action('stand'); advance(300000);
  assert.equal(timer.snapshot().mode, 'standing'); assert.equal(timer.snapshot().due, true);
  timer.action('sit'); assert.equal(timer.snapshot().remainingMs, 3600000); assert.equal(timer.snapshot().completedBreaks, 1);
});
test('early sitting is allowed without counting a completed break', () => {
  const { timer, advance } = fixture(); timer.action('stand'); advance(10000); timer.action('sit');
  assert.equal(timer.snapshot().completedBreaks, 0); assert.equal(timer.snapshot().mode, 'sitting');
});
test('pause preserves exact remaining time and resume continues it', () => {
  const { timer, advance } = fixture(); advance(50000); timer.action('pause'); const before = timer.snapshot().remainingMs;
  advance(10000000); assert.equal(timer.snapshot().remainingMs, before); assert.equal(timer.snapshot().due, false);
  timer.action('resume'); advance(1000); assert.equal(timer.snapshot().remainingMs, before - 1000);
});
test('snooze gives exactly five minutes only for a due sitting reminder', () => {
  const { timer, advance } = fixture(); timer.action('snooze'); assert.equal(timer.snapshot().remainingMs, 3600000);
  advance(3600000); timer.action('snooze'); assert.equal(timer.snapshot().remainingMs, 300000); assert.equal(timer.snapshot().due, false);
  advance(300000); assert.equal(timer.snapshot().due, true);
  timer.action('stand'); advance(300000); timer.action('snooze'); assert.equal(timer.snapshot().due, true); assert.equal(timer.snapshot().mode, 'standing');
});
test('settings do not silently reset an active phase, but apply next phase', () => {
  const { timer, advance } = fixture(); advance(60000); const remaining = timer.snapshot().remainingMs;
  timer.updateSettings({ ...DEFAULTS, sitMinutes: 30, standMinutes: 3 });
  assert.equal(timer.snapshot().remainingMs, remaining); timer.action('stand'); assert.equal(timer.snapshot().remainingMs, 180000);
  timer.action('sit'); assert.equal(timer.snapshot().remainingMs, 1800000);
});
test('duplicate action clicks cannot reset the current phase', () => {
  const { timer, advance } = fixture(); timer.action('stand'); advance(10000); timer.action('stand'); assert.equal(timer.snapshot().remainingMs, 290000);
  timer.action('sit'); advance(10000); timer.action('sit'); assert.equal(timer.snapshot().remainingMs, 3590000);
});
test('settings reject unsafe, missing, fractional and out-of-range values', () => {
  for (const settings of [null, {}, { ...DEFAULTS, sitMinutes: 0 }, { ...DEFAULTS, standMinutes: 61 }, { ...DEFAULTS, sitMinutes: 241 }, { ...DEFAULTS, standMinutes: 1.2 }, { ...DEFAULTS, sitMinutes: 'abc' }]) assert.throws(() => validateSettings(settings));
  assert.equal(validateSettings({ ...DEFAULTS, sitMinutes: '10' }).sitMinutes, 10);
  assert.equal(validateSettings({ ...DEFAULTS, startAtLogin: 'yes' }).startAtLogin, false);
});
test('snapshots cannot mutate stored settings', () => {
  const { timer } = fixture(); timer.snapshot().settings.sitMinutes = 1; assert.equal(timer.snapshot().settings.sitMinutes, 60);
});
test('new app launch starts a fresh seated countdown, startup is opt-in', () => {
  const { timer } = fixture(); assert.equal(timer.snapshot().settings.startAtLogin, false);
  timer.action('stand'); const next = fixture(timer.settings).timer; assert.equal(next.snapshot().mode, 'sitting'); assert.equal(next.snapshot().remainingMs, 3600000);
});
