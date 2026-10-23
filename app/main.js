'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, powerMonitor, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { ReminderTimer, DEFAULTS, validateSettings } = require('./timer');
let win, tray, timer, ticker, quitting = false, notified = false, currentMenuKey = '';
let pendingShow = false;
const smoke = process.argv.includes('--smoke-test');
const diagnostics = process.env.STANDUP_DIAGNOSTICS;
function record(event, data) {
  if (diagnostics) fs.appendFileSync(diagnostics, JSON.stringify({ event, data, at: Date.now() }) + '\n');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { pendingShow = true; if (win && !win.webContents.isLoading()) { showPopup(true); pendingShow = false; } });
  app.whenReady().then(init).catch(err => { console.error(err); app.quit(); });
}
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() {
  try { return validateSettings({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }); }
  catch { return { ...DEFAULTS }; }
}
function writeSettings(settings) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const temp = settingsPath() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, settingsPath());
}
function placePopup() {
  if (!win || win.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(320, area.width - 24), height = Math.min(480, area.height - 24);
  win.setBounds({ width, height, x: Math.round(area.x + area.width - width - 12), y: Math.round(area.y + area.height - height - 12) });
}
function showPopup(focus = false, settings = false) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  placePopup();
  if (focus) { win.show(); win.focus(); } else win.showInactive();
  if (settings) win.webContents.send('open-settings');
  publish();
}
function hidePopup() {
  win.webContents.send('close-dialog', false);
  win.hide();
}
function requestClose() {
  showPopup(true);
  win.webContents.send('close-dialog', true);
}
function applyAction(name) {
  timer.action(name); notified = false; publish();
}
function publish() {
  if (!timer) return;
  const s = timer.snapshot();
  if (win && !win.isDestroyed()) win.webContents.send('state', s);
  if (tray && !tray.isDestroyed()) {
    const seconds = Math.ceil(s.remainingMs / 1000);
    const minutes = Math.floor(seconds / 60), sec = String(seconds % 60).padStart(2, '0');
    tray.setToolTip(`SitStride · ${s.paused ? 'Paused' : s.due ? (s.mode === 'sitting' ? 'Time to stand' : 'Ready to sit') : `${s.mode === 'sitting' ? 'Sit' : 'Stand'} · ${minutes}:${sec}`}`);
    const key = `${s.mode}:${s.paused}:${s.due}`;
    if (key !== currentMenuKey) { currentMenuKey = key; rebuildMenu(s); }
  }
  if (s.due && !s.paused && !notified) {
    notified = true;
    showPopup(false);
    if (s.settings.sound) shell.beep();
    record('reminder', { mode: s.mode });
  }
}
function rebuildMenu(s) {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open SitStride', click: () => showPopup(true) },
    { type: 'separator' },
    { label: s.mode === 'sitting' ? 'Stand up now' : 'Back to sitting', click: () => { applyAction(s.mode === 'sitting' ? 'stand' : 'sit'); showPopup(true); } },
    { label: s.paused ? 'Resume timer' : 'Pause timer', click: () => applyAction(s.paused ? 'resume' : 'pause') },
    ...(s.mode === 'sitting' && s.due ? [{ label: 'Remind me in 5 minutes', click: () => { applyAction('snooze'); hidePopup(); } }] : []),
    { type: 'separator' },
    { label: 'Settings…', click: () => showPopup(true, true) },
    { label: 'Quit SitStride', click: () => app.quit() }
  ]));
}
async function init() {
  app.setName('SitStride');
  app.setPath('userData', path.join(app.getPath('appData'), 'StandUp'));
  app.setAppUserModelId('com.standup.desktop');
  timer = new ReminderTimer(readSettings());
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'));
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(trayIcon.resize({ width: 32, height: 32 }));
  tray.on('click', () => { if (win.isVisible()) hidePopup(); else showPopup(true); });
  const entry = path.join(__dirname, 'renderer', 'index.html');
  const entryURL = pathToFileURL(entry).href;
  win = new BrowserWindow({
    width: 320, height: 480, frame: false, resizable: false, maximizable: false, minimizable: true,
    show: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#1e291c', icon,
    title: 'SitStride', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged }
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== entryURL) event.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.on('console-message', (_event, ...args) => record('renderer-console', args));
  win.webContents.on('render-process-gone', (_event, details) => record('renderer-gone', details));
  win.on('close', event => { if (!quitting) { event.preventDefault(); requestClose(); } });
  win.on('minimize', event => { event.preventDefault(); hidePopup(); });
  ipcMain.handle('get-state', event => { verifySender(event, entryURL); return timer.snapshot(); });
  ipcMain.handle('action', async (event, name, payload) => {
    verifySender(event, entryURL);
    if (['stand', 'sit', 'pause', 'resume', 'snooze'].includes(name)) { applyAction(name); return timer.snapshot(); }
    if (name === 'request-close') { requestClose(); return timer.snapshot(); }
    if (name === 'minimize') { win.minimize(); return timer.snapshot(); }
    if (name === 'hide') { hidePopup(); return timer.snapshot(); }
    if (name === 'settings') { win.webContents.send('open-settings'); return timer.snapshot(); }
    if (name === 'quit') { app.quit(); return; }
    if (name === 'save-settings') {
      const settings = validateSettings(payload);
      const previousLogin = timer.settings.startAtLogin;
      if (process.platform === 'win32' && app.isPackaged) {
        app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, path: process.execPath, args: ['--background'] });
        const actual = app.getLoginItemSettings({ path: process.execPath, args: ['--background'] }).openAtLogin;
        if (actual !== settings.startAtLogin) throw new Error('Startup change failed. Check Windows Settings.');
      }
      try { writeSettings(settings); } catch {
        if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: previousLogin, path: process.execPath, args: ['--background'] });
        throw new Error('Settings not saved. Check disk space.');
      }
      timer.updateSettings(settings); publish(); return timer.snapshot();
    }
    throw new Error('Unsupported action.');
  });
  await win.loadFile(entry);
  placePopup(); publish();
  if (pendingShow || !process.argv.includes('--background')) showPopup(pendingShow);
  pendingShow = false;
  ticker = setInterval(publish, 1000);
  powerMonitor.on('resume', publish);
  screen.on('display-metrics-changed', placePopup);
  screen.on('display-removed', placePopup);
  record('ready', { tray: !tray.isDestroyed(), state: timer.snapshot(), bounds: win.getBounds() });
  if (smoke) setTimeout(async () => {
    try {
      const content = await win.webContents.executeJavaScript('({title: document.title, bridge: typeof window.standup, text: document.body.innerText})');
      record('smoke', content);
      if (process.env.STANDUP_SMOKE_SCREENSHOT) {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.STANDUP_SMOKE_SCREENSHOT, image.toPNG());
      }
    } catch (err) { record('smoke-error', err.message); }
    app.quit();
  }, 2500);
}
function verifySender(event, expected) {
  if (event.sender !== win.webContents || event.senderFrame?.url !== expected) throw new Error('Untrusted request.');
}
app.on('before-quit', () => { quitting = true; if (ticker) clearInterval(ticker); if (tray && !tray.isDestroyed()) tray.destroy(); });
app.on('window-all-closed', () => { /* The tray owns the application lifetime. */ });
