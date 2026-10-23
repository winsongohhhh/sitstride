'use strict';
const DEFAULTS = Object.freeze({ sitMinutes: 60, standMinutes: 5, startAtLogin: false, reducedMotion: false, sound: true });
function validateSettings(input) {
  if (!input || typeof input !== 'object') throw new Error('Please enter your settings.');
  const sitMinutes = Number(input.sitMinutes), standMinutes = Number(input.standMinutes);
  if (!Number.isInteger(sitMinutes) || sitMinutes < 1 || sitMinutes > 240) throw new Error('Sitting time must be 1–240 whole minutes.');
  if (!Number.isInteger(standMinutes) || standMinutes < 1 || standMinutes > 60) throw new Error('Standing time must be 1–60 whole minutes.');
  return { sitMinutes, standMinutes, startAtLogin: input.startAtLogin === true, reducedMotion: input.reducedMotion === true, sound: input.sound === true };
}
class ReminderTimer {
  constructor(settings = DEFAULTS, now = () => Date.now()) {
    this.settings = validateSettings(settings); this.now = now; this.completedBreaks = 0; this.mode = 'sitting'; this.paused = false; this.due = false;
    this.totalMs = this.settings.sitMinutes * 60000; this.deadline = this.now() + this.totalMs; this.pausedRemaining = 0;
  }
  remaining() { return Math.max(0, this.paused ? this.pausedRemaining : this.deadline - this.now()); }
  snapshot() {
    if (!this.paused && this.remaining() === 0) this.due = true;
    return { mode: this.mode, due: this.due, paused: this.paused, remainingMs: this.remaining(), totalMs: this.totalMs, settings: { ...this.settings }, completedBreaks: this.completedBreaks };
  }
  start(mode) {
    this.mode = mode; this.paused = false; this.due = false;
    this.totalMs = this.settings[mode === 'sitting' ? 'sitMinutes' : 'standMinutes'] * 60000;
    this.deadline = this.now() + this.totalMs;
  }
  action(name) {
    this.snapshot();
    switch (name) {
      case 'stand': if (this.mode === 'sitting') this.start('standing'); break;
      case 'sit':
        if (this.mode === 'standing') { if (this.due) this.completedBreaks++; this.start('sitting'); } break;
      case 'pause': if (!this.paused) { this.pausedRemaining = this.remaining(); this.paused = true; } break;
      case 'resume': if (this.paused) { this.deadline = this.now() + this.pausedRemaining; this.paused = false; } break;
      case 'snooze': if (this.mode === 'sitting' && this.due) { this.due = false; this.paused = false; this.totalMs = 300000; this.deadline = this.now() + this.totalMs; } break;
      default: throw new Error('Unknown timer action.');
    }
    return this.snapshot();
  }
  updateSettings(input) { this.settings = validateSettings(input); return this.snapshot(); }
}
module.exports = { ReminderTimer, DEFAULTS, validateSettings };
