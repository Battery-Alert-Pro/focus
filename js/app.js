/* ==========================================================================
   app.js — UI wiring: tabs, duration controls, tags, timer, history,
   install prompt, service worker, wake lock and notifications.
   ========================================================================== */
(function (global) {
  'use strict';

  var FT = global.FT || (global.FT = {});
  var storage = FT.storage;
  var history = FT.history;
  var audio = FT.audio;

  /* ---------------- Element references ---------------- */

  function byId(id) {
    return document.getElementById(id);
  }

  var el = {
    html: document.documentElement,
    body: document.body,
    offlineBar: byId('offlineBar'),

    installBtn: byId('installBtn'),
    settingsBtn: byId('settingsBtn'),

    tabs: document.querySelector('.tabs'),
    tabsPill: byId('tabsPill'),
    tabButtons: Array.prototype.slice.call(document.querySelectorAll('.tabs__btn')),
    views: {
      timer: byId('panel-timer'),
      history: byId('panel-history')
    },

    dial: byId('dial'),
    dialProgress: byId('dialProgress'),
    display: byId('display'),
    status: byId('status'),
    activeTag: byId('activeTag'),
    activeTask: byId('activeTask'),

    startBtn: byId('startBtn'),
    startLabel: byId('startLabel'),
    pauseBtn: byId('pauseBtn'),
    stopBtn: byId('stopBtn'),

    taskInput: byId('taskInput'),
    tagSelect: byId('tagSelect'),
    customTagInput: byId('customTagInput'),
    editTagsBtn: byId('editTagsBtn'),

    presets: Array.prototype.slice.call(document.querySelectorAll('.preset')),
    minutesInput: byId('minutesInput'),
    rangeInput: byId('rangeInput'),
    decBtn: byId('decBtn'),
    incBtn: byId('incBtn'),

    soundToggle: byId('soundToggle'),
    vibrateToggle: byId('vibrateToggle'),
    notifyToggle: byId('notifyToggle'),
    testSoundBtn: byId('testSoundBtn'),
    wakeToggle: byId('wakeToggle'),
    wakeHint: byId('wakeHint'),
    brightnessInput: byId('brightnessInput'),
    brightnessValue: byId('brightnessValue'),
    brightnessHint: byId('brightnessHint'),
    dimmer: byId('dimmer'),

    statSessions: byId('statSessions'),
    statFocus: byId('statFocus'),
    statToday: byId('statToday'),
    historyList: byId('historyList'),
    historyEmpty: byId('historyEmpty'),
    clearHistoryBtn: byId('clearHistoryBtn'),
    filters: Array.prototype.slice.call(document.querySelectorAll('.filter')),

    tagDialog: byId('tagDialog'),
    tagList: byId('tagList'),
    newTagInput: byId('newTagInput'),
    addTagBtn: byId('addTagBtn'),

    settingsDialog: byId('settingsDialog'),
    themeButtons: Array.prototype.slice.call(document.querySelectorAll('[data-theme-choice]')),

    toast: byId('toast'),
    liveRegion: byId('liveRegion')
  };

  /* ---------------- Constants & state ---------------- */

  var CUSTOM_TAG = '__custom__';
  var MANAGE_TAGS = '__manage__';
  var RADIUS = 108;
  var CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  var state = {
    settings: storage.getSettings(),
    minutes: storage.getSettings().minutes,
    task: storage.getSettings().task,
    tag: storage.getSettings().tag,
    view: 'timer',
    historyFilter: 'all',
    lastTickSecond: null,
    clearArmed: false,
    clearTimer: null
  };

  var timer = new FT.Timer({
    onTick: handleTick,
    onComplete: handleComplete,
    onStateChange: handleStateChange
  });

  /* ---------------- Small utilities ---------------- */

  var toastTimer = null;

  function showToast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      el.toast.classList.remove('is-visible');
    }, 2600);
  }

  function announce(message) {
    if (el.liveRegion) el.liveRegion.textContent = message;
  }

  /* ---------------- Theme ---------------- */

  function effectiveTheme() {
    var attr = el.html.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    if (global.matchMedia && global.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    return 'dark';
  }

  function applyTheme(theme) {
    var explicit = (theme === 'light' || theme === 'dark');

    if (explicit) {
      el.html.setAttribute('data-theme', theme);
    } else {
      el.html.removeAttribute('data-theme');
    }

    // Keep the Android status bar in sync with the active theme.
    var color = effectiveTheme() === 'light' ? '#f4f5f9' : '#0a0c11';
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      if (explicit) metas[i].removeAttribute('media');
      metas[i].setAttribute('content', color);
    }
  }

  /* ---------------- Brightness ---------------- */

  /* The Screen Brightness API only exists on some Android browsers.
     Everywhere else we fall back to dimming the app itself. */
  function supportsBrightness() {
    return typeof navigator !== 'undefined' &&
      typeof navigator.setScreenBrightness === 'function' &&
      'screenBrightness' in navigator;
  }

  function applyBrightness(level) {
    var value = storage.clampBrightness(level);

    if (supportsBrightness()) {
      try {
        var result = navigator.setScreenBrightness(value);
        if (result && result.catch) result.catch(function () {});
      } catch (err) { /* not permitted */ }
    }

    // Fallback: a dimming scrim over the app.
    if (el.dimmer) {
      el.dimmer.style.opacity = String((1 - value) * 0.72);
    }
    return value;
  }

  function setBrightness(level, options) {
    options = options || {};
    var value = storage.clampBrightness(level);
    state.settings = storage.saveSettings({ brightness: value });
    applyBrightness(value);

    if (el.brightnessInput && !options.keepInput) {
      el.brightnessInput.value = String(Math.round(value * 100));
    }
    if (el.brightnessValue) {
      el.brightnessValue.textContent = Math.round(value * 100) + '%';
    }
    return value;
  }

  function updateBrightnessUI() {
    var value = storage.clampBrightness(state.settings.brightness);

    if (el.brightnessInput) el.brightnessInput.value = String(Math.round(value * 100));
    if (el.brightnessValue) el.brightnessValue.textContent = Math.round(value * 100) + '%';

    if (el.brightnessHint) {
      el.brightnessHint.textContent = supportsBrightness()
        ? 'Sets your device screen brightness while Focus is open.'
        : 'This device has no brightness API, so Focus dims its own display instead.';
    }
  }

  /* ---------------- Settings dialog ---------------- */

  function updateThemeButtons() {
    var theme = state.settings.theme || 'auto';
    for (var i = 0; i < el.themeButtons.length; i++) {
      var choice = el.themeButtons[i].getAttribute('data-theme-choice');
      el.themeButtons[i].classList.toggle('is-active', choice === theme);
    }
  }

  function openSettings() {
    updateThemeButtons();
    updateBrightnessUI();
    if (!el.settingsDialog) return;
    if (typeof el.settingsDialog.showModal === 'function') {
      if (!el.settingsDialog.open) el.settingsDialog.showModal();
    } else {
      el.settingsDialog.setAttribute('open', '');
    }
    global.setTimeout(updateSettingsScroll, 40);
  }

  /* Show a fade at the bottom of the dialog while more content is below. */
  function updateSettingsScroll() {
    if (!el.settingsDialog) return;
    var form = el.settingsDialog.querySelector('.dialog__form');
    if (!form) return;
    var atEnd = form.scrollTop + form.clientHeight >= form.scrollHeight - 4;
    el.settingsDialog.classList.toggle('has-more', !atEnd);
  }

  /* ---------------- Tabs ---------------- */

  function movePill() {
    if (!el.tabs || !el.tabsPill) return;
    var active = el.tabs.querySelector('.tabs__btn.is-active');
    if (!active) return;
    var navRect = el.tabs.getBoundingClientRect();
    var rect = active.getBoundingClientRect();
    el.tabsPill.style.width = rect.width + 'px';
    el.tabsPill.style.transform = 'translateX(' + (rect.left - navRect.left) + 'px)';
  }

  function selectView(view) {
    if (view !== 'timer' && view !== 'history') view = 'timer';
    state.view = view;

    for (var i = 0; i < el.tabButtons.length; i++) {
      var button = el.tabButtons[i];
      var active = button.getAttribute('data-view') === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    }

    el.views.timer.hidden = view !== 'timer';
    el.views.history.hidden = view !== 'history';

    movePill();
    if (view === 'history') renderHistory();
  }

  /* ---------------- Duration controls ---------------- */

  function clampMinutes(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = state.minutes;
    if (n < storage.MIN_MINUTES) n = storage.MIN_MINUTES;
    if (n > storage.MAX_MINUTES) n = storage.MAX_MINUTES;
    return n;
  }

  function setMinutes(value, options) {
    options = options || {};
    var minutes = clampMinutes(value);
    state.minutes = minutes;

    if (el.rangeInput) el.rangeInput.value = String(minutes);
    if (!options.keepInput && el.minutesInput) el.minutesInput.value = String(minutes);

    updatePresetStates();

    if (timer.state === 'done') {
      // A finished session returns to the ready state when the length changes.
      timer.stop();
    }
    if (timer.state === 'idle') {
      timer.setDuration(minutes * 60000);
      updateDial(minutes * 60000);
    }

    if (!options.skipSave) {
      state.settings = storage.saveSettings({ minutes: minutes });
    }
  }

  function updatePresetStates() {
    for (var i = 0; i < el.presets.length; i++) {
      var preset = el.presets[i];
      var value = parseInt(preset.getAttribute('data-min'), 10);
      preset.classList.toggle('is-active', value === state.minutes);
    }
  }

  /* ---------------- Tags ---------------- */

  function renderTagOptions(selectedTag) {
    var tags = storage.getTags();
    var current = selectedTag || state.tag;

    el.tagSelect.innerHTML = '';

    for (var i = 0; i < tags.length; i++) {
      var option = document.createElement('option');
      option.value = tags[i];
      option.textContent = tags[i];
      el.tagSelect.appendChild(option);
    }

    var customOption = document.createElement('option');
    customOption.value = CUSTOM_TAG;
    customOption.textContent = '+ Custom tag…';
    el.tagSelect.appendChild(customOption);

    var manageOption = document.createElement('option');
    manageOption.value = MANAGE_TAGS;
    manageOption.textContent = 'Manage tags…';
    el.tagSelect.appendChild(manageOption);

    var found = false;
    for (var j = 0; j < tags.length; j++) {
      if (tags[j] === current) { found = true; break; }
    }
    el.tagSelect.value = found ? current : (tags[0] || CUSTOM_TAG);
    if (el.tagSelect.value !== CUSTOM_TAG && el.tagSelect.value !== MANAGE_TAGS) {
      state.tag = el.tagSelect.value;
    }
  }

  function setTag(tag) {
    state.tag = tag;
    state.settings = storage.saveSettings({ tag: tag });
    updateActiveMeta();
  }

  function showCustomTagInput(show) {
    if (!el.customTagInput) return;
    el.customTagInput.hidden = !show;
    if (show) {
      el.customTagInput.value = '';
      if (global.setTimeout) global.setTimeout(function () { el.customTagInput.focus(); }, 30);
    }
  }

  function commitCustomTag() {
    var name = (el.customTagInput.value || '').trim();
    if (!name) {
      showCustomTagInput(false);
      renderTagOptions(state.tag);
      return;
    }
    var tag = storage.addTag(name);
    showCustomTagInput(false);
    renderTagOptions(tag);
    setTag(tag);
    showToast('Tag “' + tag + '” added');
  }

  function renderTagManager() {
    var tags = storage.getTags();
    el.tagList.innerHTML = '';

    for (var i = 0; i < tags.length; i++) {
      (function (tag) {
        var item = document.createElement('li');
        item.className = 'tag-list__item';

        var label = document.createElement('span');
        label.className = 'chip chip--tag';
        label.textContent = tag;

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tag-list__remove';
        remove.setAttribute('aria-label', 'Remove ' + tag);
        remove.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"></path></svg>';
        remove.addEventListener('click', function () {
          var remaining = storage.removeTag(tag);
          if (state.tag === tag) {
            state.tag = remaining[0] || '';
            if (state.tag) setTag(state.tag);
          }
          renderTagOptions(state.tag);
          renderTagManager();
        });

        item.appendChild(label);
        item.appendChild(remove);
        el.tagList.appendChild(item);
      })(tags[i]);
    }
  }

  function openTagDialog() {
    renderTagManager();
    if (!el.tagDialog) return;
    if (typeof el.tagDialog.showModal === 'function') {
      if (!el.tagDialog.open) el.tagDialog.showModal();
    } else {
      el.tagDialog.setAttribute('open', '');
    }
  }

  /* ---------------- Dial & status ---------------- */

  function updateDial(remainingMs) {
    var ms = remainingMs === undefined ? timer.remaining : remainingMs;
    el.display.textContent = history.formatClock(ms);

    var progress = timer.total ? Math.min(1, Math.max(0, ms / timer.total)) : 0;
    el.dialProgress.style.strokeDasharray = String(CIRCUMFERENCE);
    el.dialProgress.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - progress));
  }

  function statusText() {
    if (timer.state === 'running') return 'Running';
    if (timer.state === 'paused') return 'Paused';
    if (timer.state === 'done') return 'Done';
    return 'Ready';
  }

  function updateActiveMeta() {
    var task = (el.taskInput && el.taskInput.value) || '';
    var tag = state.tag;

    if (el.activeTask) {
      el.activeTask.textContent = task.trim() ? task.trim() : '';
    }
    if (el.activeTag) {
      el.activeTag.textContent = tag || '';
      el.activeTag.hidden = !tag;
    }
  }

  function setConfigEnabled(enabled) {
    var controls = [el.taskInput, el.tagSelect, el.editTagsBtn, el.minutesInput, el.rangeInput, el.decBtn, el.incBtn];
    for (var i = 0; i < controls.length; i++) {
      if (controls[i]) controls[i].disabled = !enabled;
    }
    for (var j = 0; j < el.presets.length; j++) {
      el.presets[j].disabled = !enabled;
    }
  }

  function handleStateChange() {
    var state_ = timer.state;

    el.status.textContent = statusText();
    el.status.setAttribute('data-state', state_ === 'done' ? 'done' : state_);
    el.dial.setAttribute('data-state', state_ === 'done' ? 'done' : state_);

    var running = state_ === 'running';
    var paused = state_ === 'paused';

    el.startBtn.disabled = running;
    el.pauseBtn.disabled = !running;
    el.stopBtn.disabled = !(running || paused);
    el.startLabel.textContent = paused ? 'Resume' : 'Start';

    setConfigEnabled(!(running || paused));

    if (running && state.settings.wakeLock) {
      acquireWakeLock();
    } else {
      releaseWakeLock();
    }

    announce(statusText());
  }

  /* ---------------- Timer handlers ---------------- */

  function handleTick(remainingMs) {
    updateDial(remainingMs);

    if (timer.state !== 'running') return;

    // Soft tick during the final three seconds.
    var seconds = Math.ceil(remainingMs / 1000);
    if (seconds <= 3 && seconds > 0 && seconds !== state.lastTickSecond) {
      state.lastTickSecond = seconds;
      if (state.settings.sound) audio.tick();
    }
  }

  function handleComplete(payload) {
    state.lastTickSecond = null;

    if (state.settings.sound) audio.chime();
    if (state.settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate([120, 70, 120]); } catch (err) { /* ignore */ }
    }

    var task = (el.taskInput && el.taskInput.value) || '';
    var session = {
      id: 's' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      task: task.trim(),
      tag: state.tag,
      durationMs: payload.total,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt
    };
    storage.addSession(session);
    renderHistory();

    showToast('Session complete — nice work!');
    announce('Session complete.');

    if (state.settings.notify) sendNotification('Focus session complete', session.tag || 'Timer finished');

    updateDial(0);
  }

  function startSession() {
    state.lastTickSecond = null;

    if (timer.state === 'paused') {
      timer.resume();
      if (state.settings.sound) audio.confirm();
      return;
    }
    var duration = state.minutes * 60000;
    timer.start(duration);
    if (state.settings.sound) audio.confirm();
    updateActiveMeta();
  }

  function pauseSession() {
    timer.pause();
    showToast('Paused');
  }

  function stopSession() {
    timer.stop();
    state.lastTickSecond = null;
    updateDial(timer.total);
    showToast('Session discarded');
  }

  /* ---------------- Wake lock ---------------- */

  var wakeLock = null;

  function wakeLockSupported() {
    return 'wakeLock' in navigator;
  }

  function acquireWakeLock() {
    if (!wakeLockSupported()) return;
    if (!state.settings.wakeLock) return;
    if (wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* user or browser refused */ });
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    var lock = wakeLock;
    wakeLock = null;
    try {
      var result = lock.release();
      if (result && result.catch) result.catch(function () {});
    } catch (err) { /* ignore */ }
  }

  /* ---------------- Notifications ---------------- */

  function sendNotification(title, body) {
    if (!('Notification' in global)) return;
    if (Notification.permission !== 'granted') return;

    var options = {
      body: body || '',
      tag: 'focus-session',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    };

    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (registration) {
        if (registration && registration.showNotification) {
          registration.showNotification(title, options);
        }
      }).catch(function () { /* ignore */ });
    } else {
      try {
        new Notification(title, options);
      } catch (err) { /* ignore */ }
    }
  }

  function requestNotifyPermission() {
    if (!('Notification' in global)) {
      showToast('Notifications are not supported on this device');
      return;
    }
    if (Notification.permission === 'granted') {
      state.settings = storage.saveSettings({ notify: true });
      el.notifyToggle.checked = true;
      showToast('Notifications enabled');
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Notifications are blocked in your browser settings');
      el.notifyToggle.checked = false;
      return;
    }
    if (typeof Notification.requestPermission === 'function') {
      Notification.requestPermission().then(function (result) {
        var granted = result === 'granted';
        el.notifyToggle.checked = granted;
        state.settings = storage.saveSettings({ notify: granted });
        showToast(granted ? 'Notifications enabled' : 'Notifications declined');
      }).catch(function () { /* ignore */ });
    }
  }

  /* ---------------- History rendering ---------------- */

  function renderHistory() {
    var sessions = storage.getHistory();
    var stats = history.computeStats(sessions);

    el.statSessions.textContent = String(stats.sessions);
    el.statFocus.textContent = history.formatCompact(stats.totalMs);
    el.statToday.textContent = history.formatCompact(stats.todayMs);

    var filtered = history.filterSessions(sessions, state.historyFilter);
    history.renderList(el.historyList, filtered);

    var isEmpty = filtered.length === 0;
    el.historyEmpty.hidden = !isEmpty;
    el.clearHistoryBtn.hidden = sessions.length === 0;

    if (!isEmpty && state.historyFilter !== 'all') {
      el.historyEmpty.querySelector('.empty__title').textContent = 'Nothing in this range';
      el.historyEmpty.querySelector('.empty__text').textContent = 'Try another filter to see your sessions.';
    } else {
      el.historyEmpty.querySelector('.empty__title').textContent = 'No sessions yet';
      el.historyEmpty.querySelector('.empty__text').textContent = 'Finish a countdown and it will show up here.';
    }
  }

  /* ---------------- Install prompt ---------------- */

  var deferredPrompt = null;

  function setupInstallPrompt() {
    global.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      el.installBtn.hidden = false;
    });

    el.installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      var choice = deferredPrompt.userChoice;
      deferredPrompt = null;
      el.installBtn.hidden = true;
      if (choice && choice.catch) {
        choice.then(function () {}).catch(function () {});
      }
    });

    global.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      el.installBtn.hidden = true;
      showToast('Installed — open Focus from your home screen');
    });
  }

  /* ---------------- Service worker ---------------- */

  function setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;

    global.addEventListener('load', function () {
      // Resolve the worker against the manifest's own directory. That keeps the
      // scope correct when the app is served from a sub-path such as
      // https://user.github.io/repo/, whatever the trailing slash of the
      // current URL happens to be.
      var scope = null;
      var manifestLink = document.querySelector('link[rel="manifest"]');
      if (manifestLink && manifestLink.href) {
        try {
          scope = new URL('.', manifestLink.href).href;
        } catch (err) {
          scope = null;
        }
      }

      var workerUrl = scope ? new URL('sw.js', scope).href : 'sw.js';
      var options = scope ? { scope: scope } : undefined;

      navigator.serviceWorker.register(workerUrl, options).then(function (registration) {
        registration.addEventListener('updatefound', function () {
          var worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', function () {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Update ready — reopen the app to apply');
            }
          });
        });
      }).catch(function () { /* offline first-run without SW */ });
    });
  }

  /* ---------------- Offline indicator ---------------- */

  function updateOnlineState() {
    var offline = navigator.onLine === false;
    el.offlineBar.hidden = !offline;
  }

  /* ---------------- Event wiring ---------------- */

  function wireEvents() {
    // Tabs
    for (var i = 0; i < el.tabButtons.length; i++) {
      el.tabButtons[i].addEventListener('click', function (event) {
        selectView(event.currentTarget.getAttribute('data-view'));
      });
    }

    el.tabs.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      var next = state.view === 'timer' ? 'history' : 'timer';
      selectView(next);
      var target = el.tabs.querySelector('.tabs__btn[data-view="' + next + '"]');
      if (target) target.focus();
    });

    global.addEventListener('resize', movePill);
    global.addEventListener('orientationchange', function () {
      global.setTimeout(movePill, 120);
    });

    // Settings
    el.settingsBtn.addEventListener('click', openSettings);

    if (el.settingsDialog) {
      var settingsForm = el.settingsDialog.querySelector('.dialog__form');
      if (settingsForm) settingsForm.addEventListener('scroll', updateSettingsScroll);
      el.settingsDialog.addEventListener('close', function () {
        el.settingsDialog.classList.remove('has-more');
      });
    }

    for (var t = 0; t < el.themeButtons.length; t++) {
      el.themeButtons[t].addEventListener('click', function (event) {
        var choice = event.currentTarget.getAttribute('data-theme-choice');
        applyTheme(choice);
        state.settings = storage.saveSettings({ theme: choice });
        updateThemeButtons();
      });
    }

    el.wakeToggle.addEventListener('change', function () {
      state.settings = storage.saveSettings({ wakeLock: el.wakeToggle.checked });
      if (el.wakeToggle.checked) {
        acquireWakeLock();
      } else {
        releaseWakeLock();
      }
    });

    el.brightnessInput.addEventListener('input', function () {
      setBrightness(parseInt(el.brightnessInput.value, 10) / 100, { keepInput: true });
    });
    el.brightnessInput.addEventListener('change', function () {
      setBrightness(parseInt(el.brightnessInput.value, 10) / 100);
    });

    // Timer controls
    el.startBtn.addEventListener('click', startSession);
    el.pauseBtn.addEventListener('click', pauseSession);
    el.stopBtn.addEventListener('click', stopSession);

    // Session fields
    el.taskInput.addEventListener('input', function () {
      state.task = el.taskInput.value;
      state.settings = storage.saveSettings({ task: state.task });
      updateActiveMeta();
    });

    el.tagSelect.addEventListener('change', function () {
      var value = el.tagSelect.value;
      if (value === CUSTOM_TAG) {
        showCustomTagInput(true);
        return;
      }
      if (value === MANAGE_TAGS) {
        openTagDialog();
        renderTagOptions(state.tag);
        return;
      }
      showCustomTagInput(false);
      setTag(value);
    });

    el.customTagInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitCustomTag();
      }
    });
    el.customTagInput.addEventListener('blur', function () {
      global.setTimeout(commitCustomTag, 120);
    });

    el.editTagsBtn.addEventListener('click', openTagDialog);

    // Duration
    for (var p = 0; p < el.presets.length; p++) {
      el.presets[p].addEventListener('click', function (event) {
        var minutes = parseInt(event.currentTarget.getAttribute('data-min'), 10);
        setMinutes(minutes);
      });
    }

    el.decBtn.addEventListener('click', function () { setMinutes(state.minutes - 1); });
    el.incBtn.addEventListener('click', function () { setMinutes(state.minutes + 1); });

    el.minutesInput.addEventListener('input', function () {
      var value = parseInt(el.minutesInput.value, 10);
      if (!isNaN(value)) setMinutes(value, { keepInput: true });
    });
    el.minutesInput.addEventListener('change', function () {
      var value = parseInt(el.minutesInput.value, 10);
      setMinutes(isNaN(value) ? state.minutes : value);
    });
    el.minutesInput.addEventListener('blur', function () {
      setMinutes(state.minutes);
    });

    el.rangeInput.addEventListener('input', function () {
      setMinutes(parseInt(el.rangeInput.value, 10), { skipSave: true });
    });
    el.rangeInput.addEventListener('change', function () {
      state.settings = storage.saveSettings({ minutes: state.minutes });
    });

    // Alerts
    el.soundToggle.addEventListener('change', function () {
      state.settings = storage.saveSettings({ sound: el.soundToggle.checked });
      if (el.soundToggle.checked) audio.unlock();
    });

    el.vibrateToggle.addEventListener('change', function () {
      state.settings = storage.saveSettings({ vibrate: el.vibrateToggle.checked });
      if (el.vibrateToggle.checked && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (err) { /* ignore */ }
      }
    });

    el.notifyToggle.addEventListener('change', function () {
      if (el.notifyToggle.checked) {
        requestNotifyPermission();
      } else {
        state.settings = storage.saveSettings({ notify: false });
      }
    });

    el.testSoundBtn.addEventListener('click', function () {
      audio.unlock();
      if (!audio.chime()) {
        showToast('Audio is not supported on this device');
      }
    });

    // History
    for (var f = 0; f < el.filters.length; f++) {
      el.filters[f].addEventListener('click', function (event) {
        var filter = event.currentTarget.getAttribute('data-filter');
        state.historyFilter = filter;
        for (var k = 0; k < el.filters.length; k++) {
          el.filters[k].classList.toggle('is-active', el.filters[k] === event.currentTarget);
        }
        renderHistory();
      });
    }

    el.clearHistoryBtn.addEventListener('click', function () {
      if (!state.clearArmed) {
        state.clearArmed = true;
        el.clearHistoryBtn.textContent = 'Tap again to clear';
        el.clearHistoryBtn.classList.add('btn--danger');
        if (state.clearTimer) global.clearTimeout(state.clearTimer);
        state.clearTimer = global.setTimeout(function () {
          state.clearArmed = false;
          el.clearHistoryBtn.textContent = 'Clear history';
        }, 3000);
        return;
      }
      storage.clearHistory();
      state.clearArmed = false;
      el.clearHistoryBtn.textContent = 'Clear history';
      renderHistory();
      showToast('History cleared');
    });

    // Tag manager
    el.addTagBtn.addEventListener('click', function () {
      var name = (el.newTagInput.value || '').trim();
      if (!name) return;
      var tag = storage.addTag(name);
      el.newTagInput.value = '';
      renderTagManager();
      renderTagOptions(tag);
      setTag(tag);
      showToast('Tag “' + tag + '” added');
    });

    el.newTagInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        el.addTagBtn.click();
      }
    });

    // Connectivity
    global.addEventListener('online', updateOnlineState);
    global.addEventListener('offline', updateOnlineState);

    // Keep the countdown accurate after the tab was hidden / restored.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        // The OS resets the screen brightness when the page is hidden.
        applyBrightness(state.settings.brightness);
        if (timer.state === 'running') {
          timer.tick();
          acquireWakeLock();
        }
      }
    });

    // Unlock audio on the first interaction (Android autoplay policy).
    var unlockOnce = function () {
      audio.unlock();
      document.removeEventListener('pointerdown', unlockOnce);
      document.removeEventListener('keydown', unlockOnce);
    };
    document.addEventListener('pointerdown', unlockOnce);
    document.addEventListener('keydown', unlockOnce);

    global.addEventListener('beforeunload', function () {
      releaseWakeLock();
      // Hand the screen brightness back to the system.
      if (supportsBrightness()) {
        try {
          var reset = navigator.setScreenBrightness(1);
          if (reset && reset.catch) reset.catch(function () {});
        } catch (err) { /* ignore */ }
      }
      if (el.dimmer) el.dimmer.style.opacity = '0';
    });
  }

  /* ---------------- Boot ---------------- */

  /* Manifest shortcuts launch the app with ?m=<minutes> */
  function minutesFromUrl() {
    var match = /[?&]m=(\d{1,3})/.exec(location.search || '');
    if (!match) return null;
    var value = parseInt(match[1], 10);
    if (isNaN(value)) return null;
    return clampMinutes(value);
  }

  function init() {
    state.settings = storage.getSettings();
    state.minutes = state.settings.minutes;
    state.task = state.settings.task;
    state.tag = state.settings.tag;

    applyTheme(state.settings.theme);

    // Controls
    el.taskInput.value = state.task;
    el.soundToggle.checked = state.settings.sound;
    el.vibrateToggle.checked = state.settings.vibrate;
    el.notifyToggle.checked = state.settings.notify;
    el.wakeToggle.checked = state.settings.wakeLock;
    el.wakeToggle.disabled = !wakeLockSupported();
    if (el.wakeHint) {
      el.wakeHint.textContent = wakeLockSupported()
        ? 'Keeps the display awake while a session runs'
        : 'Not supported on this device';
    }

    renderTagOptions(state.tag);

    var requested = minutesFromUrl();
    setMinutes(requested === null ? state.minutes : requested);
    updateActiveMeta();

    // Timer initial state
    timer.setDuration(state.minutes * 60000);
    handleStateChange();
    updateDial(timer.total);

    wireEvents();
    setupInstallPrompt();
    setupServiceWorker();
    updateOnlineState();
    renderHistory();
    selectView('timer');

    updateThemeButtons();
    updateBrightnessUI();
    applyBrightness(state.settings.brightness);

    // Position the tab indicator once fonts have settled.
    global.setTimeout(movePill, 60);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(movePill).catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Exposed for debugging in the console. */
  FT.app = {
    timer: timer,
    state: state,
    showToast: showToast,
    renderHistory: renderHistory
  };
})(window);
