(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bridge = window.standup;
  let state = { mode: 'sitting', due: false, paused: false, remainingMs: 3600000, totalMs: 3600000, completedBreaks: 0,
    settings: { sitMinutes: 60, standMinutes: 5, startAtLogin: false, reducedMotion: false, sound: true } };
  let lastUpdate = performance.now();
  let currentPose = 0, velocity = 0, targetPose = 0, lastFrame = performance.now(), frame;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const elements = { home: $('home-view'), settings: $('settings-view'), heading: $('primary-heading'), detail: $('status-detail'), countdown: $('countdown'), bar: $('progress-bar'), primary: $('primary-action'), pause: $('pause-action'), snooze: $('snooze-action'), error: $('error-banner'), form: $('settings-form') };
  let errorTimeout;
  function showError(message) {
    clearTimeout(errorTimeout); elements.error.textContent = message; elements.error.hidden = false;
    errorTimeout = setTimeout(() => { elements.error.hidden = true; }, 7000);
  }
  function format(ms) {
    let seconds = Math.ceil(Math.max(0, ms) / 1000);
    const hours = Math.floor(seconds / 3600); seconds %= 3600;
    const minutes = Math.floor(seconds / 60); seconds %= 60;
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  function displayCountdown(now = performance.now()) {
    const remaining = Math.max(0, state.remainingMs - (state.paused ? 0 : now - lastUpdate));
    elements.countdown.textContent = format(remaining);
    const ratio = state.totalMs > 0 ? Math.max(0, Math.min(1, remaining / state.totalMs)) : 0;
    elements.bar.style.width = `${ratio * 100}%`;
  }
  function acceptState(next) {
    if (!next || typeof next !== 'object') return;
    const reminderStarted = next.due === true && !next.paused && (!state.due || state.paused || next.mode !== state.mode);
    state = { ...state, ...next, settings: { ...state.settings, ...next.settings } };
    if (reminderStarted) { elements.settings.hidden = true; elements.home.hidden = false; }
    lastUpdate = performance.now(); render();
  }
  function syncMotionPreference() {
    // One effective preference drives both CSS and the mascot, including live OS changes.
    document.documentElement.dataset.reducedMotion = String(state.settings.reducedMotion || reducedMotion.matches);
  }
  function render() {
    syncMotionPreference();
    const sitting = state.mode === 'sitting';
    targetPose = sitting ? 0 : 1;
    elements.heading.textContent = state.paused ? 'Take your time' : sitting ? (state.due ? 'Time to stand up' : 'Stay seated') : (state.due ? 'Nice work' : 'Standing break');
    elements.detail.textContent = state.paused ? 'Timer paused.' : sitting ? (state.due ? 'Stand up and walk 250 steps.' : 'Break time is coming up.') : (state.due ? 'Break done. Sit when ready.' : 'Walk 250 steps, then stretch.');
    elements.primary.textContent = sitting ? 'Stand up' : 'Back to sitting';
    elements.pause.textContent = state.paused ? 'Resume' : 'Pause';
    elements.snooze.hidden = !(sitting && state.due);
    elements.bar.style.background = state.due ? 'var(--cream)' : 'var(--emerald)';
    $('person').dataset.mode = state.mode;
    displayCountdown(); startAnimation();
  }
  function previewAction(name, payload) {
    const remaining = Math.max(0, state.remainingMs - (state.paused ? 0 : performance.now() - lastUpdate));
    let next = { ...state, remainingMs: remaining };
    if (name === 'stand' || name === 'sit') {
      const sitting = name === 'sit';
      next = { ...state, mode: sitting ? 'sitting' : 'standing', due: false, paused: false, remainingMs: state.settings[sitting ? 'sitMinutes' : 'standMinutes'] * 60000, totalMs: state.settings[sitting ? 'sitMinutes' : 'standMinutes'] * 60000 };
    } else if (name === 'pause' || name === 'resume') next.paused = name === 'pause';
    else if (name === 'snooze') Object.assign(next, { due: false, paused: false, remainingMs: 300000, totalMs: 300000 });
    else if (name === 'save-settings') next.settings = { ...payload };
    acceptState(next); return next;
  }
  async function action(name, payload) {
    try {
      const next = bridge?.action ? await bridge.action(name, payload) : previewAction(name, payload);
      if (next) acceptState(next);
      return true;
    } catch (error) {
      showError(error?.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || 'Please try again.');
      return false;
    }
  }
  let closeDialogFocus, closeDialogTimeout, closeDialogRevision = 0;
  const closeDialog = $('close-dialog');
  const modalBackground = [...document.querySelector('.app-shell').children].filter(el => el !== closeDialog);
  function transitionTime(element) {
    const style = getComputedStyle(element);
    const parse = value => value.trim().endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
    const durations = style.transitionDuration.split(',').map(parse);
    const delays = style.transitionDelay.split(',').map(parse);
    return Math.max(0, ...durations.map((duration, i) => duration + delays[i % delays.length]));
  }
  function setCloseDialog(visible) {
    if (visible) {
      if (closeDialog.classList.contains('is-open')) return;
      clearTimeout(closeDialogTimeout); closeDialogRevision++;
      if (closeDialog.hidden) {
        closeDialogFocus = document.activeElement;
        closeDialog.classList.remove('is-open', 'is-closing');
        closeDialog.hidden = false;
        // Commit the starting styles only for a fresh reveal, never on reversal.
        void closeDialog.offsetWidth;
      }
      closeDialog.removeAttribute('aria-hidden');
      closeDialog.classList.remove('is-closing');
      closeDialog.classList.add('is-open');
      modalBackground.forEach(el => { el.inert = true; });
      $('keep-tray-button').focus();
    } else {
      if (closeDialog.hidden || closeDialog.classList.contains('is-closing')) return;
      const revision = ++closeDialogRevision;
      closeDialog.classList.remove('is-open');
      closeDialog.classList.add('is-closing');
      closeDialog.setAttribute('aria-hidden', 'true');
      modalBackground.forEach(el => { el.inert = false; });
      if (closeDialogFocus?.isConnected) closeDialogFocus.focus();
      const duration = Math.max(transitionTime(closeDialog), transitionTime(closeDialog.querySelector('.confirm-dialog')));
      clearTimeout(closeDialogTimeout);
      closeDialogTimeout = setTimeout(() => {
        if (revision !== closeDialogRevision || closeDialog.classList.contains('is-open')) return;
        closeDialog.hidden = true;
        closeDialog.classList.remove('is-closing');
      }, duration + 34);
    }
  }
  function openSettings() {
    setCloseDialog(false);
    const s = state.settings;
    $('sit-minutes').value = s.sitMinutes; $('stand-minutes').value = s.standMinutes;
    $('start-at-login').checked = s.startAtLogin; $('reduced-motion').checked = s.reducedMotion; $('sound').checked = s.sound;
    elements.home.hidden = true; elements.settings.hidden = false; $('sit-minutes').focus();
  }
  function closeSettings() { elements.settings.hidden = true; elements.home.hidden = false; $('settings-action').focus(); }
  // The same joints are interpolated in both directions: no sprite swap or pose jump.
  // Ankles and feet stay planted while the hip moves forward and up from the chair.
  const seated = { head: [105, 91], shoulder: [111, 131], hip: [123, 178], knee: [184, 178], ankle: [184, 229], toe: [205, 229], elbow: [136, 162], hand: [165, 168] };
  const standing = { head: [175, 39], shoulder: [177, 79], hip: [179, 149], knee: [182, 190], ankle: [184, 229], toe: [205, 229], elbow: [190, 119], hand: [191, 156] };
  function drawPose(progress) {
    const joints = {};
    for (const key of Object.keys(seated)) joints[key] = seated[key].map((value, i) => value + (standing[key][i] - value) * progress);
    const p = key => joints[key].map(value => value.toFixed(2)).join(' ');
    $('mascot-head').setAttribute('cx', joints.head[0]); $('mascot-head').setAttribute('cy', joints.head[1]);
    $('mascot-torso').setAttribute('d', `M${p('shoulder')} L${p('hip')}`);
    $('mascot-leg').setAttribute('d', `M${p('hip')} L${p('knee')} L${p('ankle')} L${p('toe')}`);
    $('mascot-arm').setAttribute('d', `M${p('shoulder')} L${p('elbow')} L${p('hand')}`);
    $('mascot-desc').textContent = state.mode === 'sitting' ? 'A green figure seated sideways with bent knees on a chair.' : 'The same figure standing upright beside the chair.';
  }
  function animate(now) {
    frame = null;
    const dt = Math.min(0.032, Math.max(0.001, (now - lastFrame) / 1000)); lastFrame = now;
    if (state.settings.reducedMotion || reducedMotion.matches) { currentPose = targetPose; velocity = 0; }
    else {
      // Critically damped spring, retargeted from live position and velocity.
      velocity += ((targetPose - currentPose) * 110 - velocity * 21) * dt;
      currentPose += velocity * dt;
      if (Math.abs(targetPose - currentPose) < 0.0003 && Math.abs(velocity) < 0.002) { currentPose = targetPose; velocity = 0; }
    }
    drawPose(currentPose);
    if (currentPose !== targetPose || velocity !== 0) frame = requestAnimationFrame(animate);
  }
  function startAnimation() { if (frame == null) { lastFrame = performance.now(); frame = requestAnimationFrame(animate); } }
  $('minimize-button').addEventListener('click', () => action('minimize'));
  $('hide-button').addEventListener('click', () => {
    if (bridge?.action) action('request-close'); else setCloseDialog(true);
  });
  $('keep-tray-button').addEventListener('click', async () => {
    setCloseDialog(false);
    if (!await action('hide')) setCloseDialog(true);
  });
  $('quit-sitstride-button').addEventListener('click', () => action('quit'));
  elements.primary.addEventListener('click', () => action(state.mode === 'sitting' ? 'stand' : 'sit'));
  elements.pause.addEventListener('click', () => action(state.paused ? 'resume' : 'pause'));
  elements.snooze.addEventListener('click', () => action('snooze'));
  $('settings-action').addEventListener('click', openSettings);
  $('cancel-settings').addEventListener('click', closeSettings);
  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!elements.form.reportValidity()) return;
    const settings = { sitMinutes: Number($('sit-minutes').value), standMinutes: Number($('stand-minutes').value), startAtLogin: $('start-at-login').checked, reducedMotion: $('reduced-motion').checked, sound: $('sound').checked };
    if (await action('save-settings', settings)) closeSettings();
  });
  document.addEventListener('keydown', event => {
    if (closeDialog.classList.contains('is-open')) {
      if (event.key === 'Escape') { event.preventDefault(); setCloseDialog(false); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const next = document.activeElement === $('keep-tray-button') ? $('quit-sitstride-button') : $('keep-tray-button');
        next.focus();
      }
      return;
    }
    if (event.key === 'Escape') { if (!elements.settings.hidden) closeSettings(); else action('hide'); }
  });
  reducedMotion.addEventListener('change', () => { syncMotionPreference(); startAnimation(); });
  if (bridge) {
    bridge.onCloseDialog?.(setCloseDialog);
    bridge.onState(acceptState); bridge.onOpenSettings?.(openSettings);
    bridge.getState().then(acceptState).catch(() => showError('Can’t load status. Reopen SitStride.'));
  }
  drawPose(currentPose); render();
  // Countdown updates do not rerender the settings form or run a perpetual animation.
  setInterval(() => { if (!document.hidden) displayCountdown(); }, 200);
})();
