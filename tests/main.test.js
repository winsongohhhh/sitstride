'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const packageRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const mainPath = path.resolve(packageRoot, packageJson.main);
const rendererURL = pathToFileURL(path.join(path.dirname(mainPath), 'renderer', 'index.html')).href;

test('main-process harness loads this package’s actual main source', () => {
  assert.equal(packageJson.name, 'sitstride-desktop');
  assert.equal(packageJson.main, 'app/main.js');
  assert.equal(fs.realpathSync(mainPath), fs.realpathSync(path.join(packageRoot, 'app', 'main.js')));
  assert.equal(require.resolve(packageRoot), mainPath);
});

class FakeTimer {
  constructor() {
    this.settings = { sitMinutes: 60, standMinutes: 5, sound: false, startAtLogin: false, reducedMotion: false };
    this.mode = 'sitting'; this.paused = false; this.due = false;
    this.remainingMs = 60000; this.totalMs = 60000;
  }
  snapshot() {
    if (!this.paused && this.remainingMs > 0) this.remainingMs -= 1000;
    if (!this.paused && this.remainingMs === 0) this.due = true;
    return { mode: this.mode, paused: this.paused, due: this.due, remainingMs: this.remainingMs, totalMs: this.totalMs, settings: { ...this.settings }, completedBreaks: 0 };
  }
  action(name) {
    if (name === 'pause') this.paused = true;
    if (name === 'resume') this.paused = false;
    if (name === 'snooze') this.due = false;
    return this.snapshot();
  }
  updateSettings(settings) { this.settings = settings; return this.snapshot(); }
}

async function loadMain() {
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    quit: () => { app.quitCalls++; app.emit('before-quit'); }, quitCalls: 0,
    getPath: name => name === 'appData' ? '/tmp' : '/tmp/standup-main-test',
    setPath() {}, setName() {},
    whenReady: () => Promise.resolve(),
    setAppUserModelId() {},
  });
  const ipcMain = { handlers: new Map(), handle(name, fn) { this.handlers.set(name, fn); } };
  const screen = new EventEmitter();
  screen.getPrimaryDisplay = () => ({ workArea: { x: 0, y: 0, width: 1200, height: 800 } });
  const shell = { beepCalls: 0, beep() { this.beepCalls++; } };
  let tickerCallback, tickerCleared = false;
  let windowInstance, trayInstance;

  class FakeWebContents extends EventEmitter {
    constructor() { super(); this.sent = []; this.session = { setPermissionRequestHandler() {} }; }
    send(channel, value) { this.sent.push({ channel, value }); }
    setWindowOpenHandler() {}
    executeJavaScript() { return Promise.resolve({}); }
    capturePage() { return Promise.resolve({ toPNG: () => Buffer.from('') }); }
    isLoading() { return false; }
  }
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new FakeWebContents(); this.visible = false; this.minimized = false;
      this.bounds = {}; this.destroyed = false; this.calls = { show: 0, showInactive: 0, focus: 0, hide: 0, minimize: 0, restore: 0 };
      windowInstance = this;
    }
    setMenu() {}
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds; }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    show() { this.calls.show++; this.visible = true; }
    showInactive() { this.calls.showInactive++; this.visible = true; }
    focus() { this.calls.focus++; }
    hide() { this.calls.hide++; this.visible = false; }
    minimize() { this.calls.minimize++; this.minimized = true; this.emit('minimize', { preventDefault: () => {} }); }
    restore() { this.calls.restore++; this.minimized = false; }
    loadFile() { return Promise.resolve(); }
  }
  class FakeTray extends EventEmitter {
    constructor() { super(); this.destroyed = false; this.menu = null; trayInstance = this; }
    isDestroyed() { return this.destroyed; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(menu) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const Menu = { buildFromTemplate: template => template };
  const nativeImage = { createFromPath: () => ({ resize: () => ({}) }) };
  const context = {
    require(request) {
      if (request === 'electron') return { app, BrowserWindow: FakeWindow, Tray: FakeTray, Menu, ipcMain, screen, nativeImage, powerMonitor: new EventEmitter(), shell };
      if (request === './timer') return { ReminderTimer: FakeTimer, DEFAULTS: { sitMinutes: 60, standMinutes: 5, startAtLogin: false, reducedMotion: false, sound: false }, validateSettings: value => value };
      return require(request);
    },
    module: { exports: {} }, exports: {}, __dirname: path.dirname(mainPath), __filename: mainPath,
    process: { ...process, argv: ['node', 'main.js'], env: { ...process.env, STANDUP_DIAGNOSTICS: '' } },
    setInterval: callback => { tickerCallback = callback; return 1; }, clearInterval() { tickerCleared = true; }, console,
  };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), context, { filename: mainPath });
  await new Promise(resolve => setImmediate(resolve));
  return { app, ipcMain, screen, shell, win: windowInstance, tray: trayInstance, tick: () => tickerCallback(), tickerCleared: () => tickerCleared };
}

test('main process supports minimize-to-tray without pausing the timer', async () => {
  const h = await loadMain();
  const action = h.ipcMain.handlers.get('action');
  const event = { sender: h.win.webContents, senderFrame: { url: rendererURL } };
  const before = h.win.webContents.sent.length;
  const beforeBeep = h.shell.beepCalls;
  const beforeReminder = h.win.calls.showInactive;
  await action(event, 'minimize');
  assert.equal(h.win.calls.minimize, 1);
  assert.equal(h.win.calls.hide, 1);
  assert.equal(h.app.quitCalls, 0);
  assert.equal(h.shell.beepCalls, beforeBeep);
  assert.equal(h.win.options.minimizable, true);
  assert.equal(h.win.options.webPreferences.backgroundThrottling, false);
  assert.equal(h.win.webContents.sent.slice(before).some(x => x.channel === 'close-dialog' && x.value === true), false);
  const state = await h.ipcMain.handlers.get('get-state')(event);
  assert.equal(state.remainingMs < 60000, true);
  assert.equal(h.win.webContents.sent.slice(before).some(x => x.channel === 'close-dialog' && x.value === true), false);
  assert.equal(state.paused, false);
  assert.equal(h.tickerCleared(), false);
  for (let i = 0; i < 70; i++) h.tick();
  assert.equal(h.win.isVisible(), true);
  assert.equal(h.win.calls.showInactive, beforeReminder + 1);
  assert.equal(h.shell.beepCalls, beforeBeep);
  assert.equal(h.app.quitCalls, 0);
});

test('due countdown restores a minimized window and shows the popup once', async () => {
  const h = await loadMain();
  const initialShows = h.win.calls.showInactive;
  h.win.minimized = true; h.win.visible = false;
  const action = h.ipcMain.handlers.get('action');
  const event = { sender: h.win.webContents, senderFrame: { url: rendererURL } };
  h.tick();
  h.tick();
  assert.equal(h.win.calls.restore, 0);
  // Force the timer due through its published state, then let the ticker publish it.
  h.win.webContents.sent.length = 0;
  await action(event, 'pause');
  h.win.minimized = true; h.win.visible = false;
  await action(event, 'resume');
  h.win.minimized = true; h.win.visible = false;
  // The VM timer reaches due when its remaining time is zero.
  for (let i = 0; i < 70; i++) h.tick();
  h.tick();
  assert.equal(h.win.calls.restore, 1);
  assert.equal(h.win.calls.showInactive, initialShows + 1);
  h.tick();
  assert.equal(h.win.calls.showInactive, initialShows + 1);
});

test('native close requests a choice without hiding, pausing, or quitting', async () => {
  const h = await loadMain();
  let prevented = false;
  h.win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.win.calls.hide, 0);
  assert.equal(h.app.quitCalls, 0);
  assert.equal(h.win.webContents.sent.at(-1).channel, 'close-dialog');
  assert.equal(h.win.webContents.sent.at(-1).value, true);
  assert.equal(h.win.webContents.sent.filter(x => x.channel === 'state').at(-1).value.paused, false);
});

test('X IPC requests the dialog and Keep hides while timer and reminders continue', async () => {
  const h = await loadMain();
  const action = h.ipcMain.handlers.get('action');
  const event = { sender: h.win.webContents, senderFrame: { url: rendererURL } };
  await action(event, 'request-close');
  assert.equal(h.win.webContents.sent.at(-1).value, true);
  const before = await h.ipcMain.handlers.get('get-state')(event);
  await action(event, 'hide');
  assert.equal(h.win.isVisible(), false);
  assert.equal(h.win.webContents.sent.at(-1).value, false);
  assert.equal(h.app.quitCalls, 0);
  assert.equal(h.tickerCleared(), false);
  h.tick();
  const after = await h.ipcMain.handlers.get('get-state')(event);
  assert.equal(after.paused, false);
  assert(after.remainingMs < before.remainingMs);
  const reminderShowsBeforeDue = h.win.calls.showInactive;
  for (let i = 0; i < 70; i++) h.tick();
  assert.equal(h.win.isVisible(), true, 'due reminder returns after Keep');
  assert.equal(h.win.calls.showInactive, reminderShowsBeforeDue + 1);
  assert.equal(h.win.webContents.sent.filter(x => x.channel === 'state').at(-1).value.due, true);
  assert.equal(h.app.quitCalls, 0);
});

test('Quit action stops ticker and destroys tray; shutdown is not intercepted', async () => {
  const h = await loadMain();
  const event = { sender: h.win.webContents, senderFrame: { url: rendererURL } };
  await h.ipcMain.handlers.get('action')(event, 'quit');
  assert.equal(h.app.quitCalls, 1);
  assert.equal(h.tray.isDestroyed(), true);
  assert.equal(h.tickerCleared(), true);
  let prevented = false;
  h.win.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('tray Quit menu item requests the same clean shutdown', async () => {
  const h = await loadMain();
  const quitItem = h.tray.menu.find(item => item.label === 'Quit SitStride');
  assert.equal(typeof quitItem?.click, 'function');
  quitItem.click();
  assert.equal(h.app.quitCalls, 1);
  assert.equal(h.tickerCleared(), true);
  assert.equal(h.tray.isDestroyed(), true);
});

test('tray click hides and reopens without a close prompt', async () => {
  const h = await loadMain();
  h.tray.emit('click');
  assert.equal(h.win.isVisible(), false);
  assert.equal(h.win.webContents.sent.some(x => x.channel === 'close-dialog' && x.value === true), false);
  h.tray.emit('click');
  assert.equal(h.win.isVisible(), true);
});

test('new close and quit IPC reject an untrusted sender', async () => {
  const h = await loadMain();
  for (const name of ['request-close', 'hide', 'quit']) {
    await assert.rejects(h.ipcMain.handlers.get('action')({ sender: {}, senderFrame: {url: rendererURL} }, name), /Untrusted request/);
    await assert.rejects(h.ipcMain.handlers.get('action')({ sender: h.win.webContents, senderFrame: {url: 'https://untrusted.example'} }, name), /Untrusted request/);
  }
  assert.equal(h.app.quitCalls, 0);
});

test('background ticker publishes countdown updates while hidden', async () => {
  const h = await loadMain();
  h.win.hide();
  const before = h.win.webContents.sent.filter(message => message.channel === 'state').at(-1).value.remainingMs;
  h.tick();
  const after = h.win.webContents.sent.filter(message => message.channel === 'state').at(-1).value.remainingMs;
  assert.equal(after < before, true);
});
