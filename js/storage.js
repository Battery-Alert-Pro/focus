/* ==========================================================================
   storage.js — persistent settings, tags and session history
   All data lives in localStorage so the app works fully offline.
   ========================================================================== */
(function (global) {
  'use strict';

  var FT = global.FT || (global.FT = {});

  var KEYS = {
    settings: 'focus.settings.v1',
    history: 'focus.history.v1',
    tags: 'focus.tags.v1'
  };

  var DEFAULT_TAGS = [
    'DEEP WORK',
    'SHALLOW TASK',
    '10 MIN BREAK',
    'MEETING PREP',
    'REVIEW',
    'CREATIVE'
  ];

  var DEFAULT_SETTINGS = {
    minutes: 10,
    task: '',
    tag: 'DEEP WORK',
    sound: true,
    vibrate: true,
    notify: false,
    wakeLock: true,
    brightness: 1,
    theme: 'auto'
  };

  var MIN_MINUTES = 1;
  var MAX_MINUTES = 180;

  function readRaw(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      return false;
    }
  }

  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (raw === null) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    return writeRaw(key, JSON.stringify(value));
  }

  function clampMinutes(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = DEFAULT_SETTINGS.minutes;
    if (n < MIN_MINUTES) n = MIN_MINUTES;
    if (n > MAX_MINUTES) n = MAX_MINUTES;
    return n;
  }

  /* Brightness is a 0.2 – 1.0 fraction of the screen's maximum. */
  function clampBrightness(value) {
    var n = Number(value);
    if (!isFinite(n)) n = 1;
    if (n < 0.2) n = 0.2;
    if (n > 1) n = 1;
    return Math.round(n * 100) / 100;
  }

  /* ---------------- Settings ---------------- */

  function getSettings() {
    var stored = readJSON(KEYS.settings, {});
    var settings = {};
    var key;
    for (key in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
        settings[key] = DEFAULT_SETTINGS[key];
      }
    }
    for (key in stored) {
      if (Object.prototype.hasOwnProperty.call(stored, key)) {
        settings[key] = stored[key];
      }
    }
    settings.minutes = clampMinutes(settings.minutes);
    settings.task = typeof settings.task === 'string' ? settings.task.slice(0, 120) : '';
    settings.tag = typeof settings.tag === 'string' ? settings.tag : DEFAULT_SETTINGS.tag;
    settings.sound = !!settings.sound;
    settings.vibrate = !!settings.vibrate;
    settings.notify = !!settings.notify;
    settings.wakeLock = settings.wakeLock !== false;
    settings.brightness = clampBrightness(settings.brightness);
    if (['auto', 'light', 'dark'].indexOf(settings.theme) === -1) settings.theme = 'auto';
    return settings;
  }

  function saveSettings(patch) {
    var current = getSettings();
    var key;
    for (key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        current[key] = patch[key];
      }
    }
    current.minutes = clampMinutes(current.minutes);
    writeJSON(KEYS.settings, current);
    return current;
  }

  /* ---------------- Tags ---------------- */

  function normaliseTag(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  }

  function getTags() {
    var stored = readJSON(KEYS.tags, null);
    if (!Array.isArray(stored)) {
      writeJSON(KEYS.tags, DEFAULT_TAGS);
      return DEFAULT_TAGS.slice();
    }
    var seen = {};
    var tags = [];
    for (var i = 0; i < stored.length; i++) {
      var tag = normaliseTag(stored[i]);
      var key = tag.toLowerCase();
      if (!tag || seen[key]) continue;
      seen[key] = true;
      tags.push(tag.toUpperCase());
    }
    if (!tags.length) {
      writeJSON(KEYS.tags, DEFAULT_TAGS);
      return DEFAULT_TAGS.slice();
    }
    return tags;
  }

  function saveTags(tags) {
    var seen = {};
    var clean = [];
    if (Array.isArray(tags)) {
      for (var i = 0; i < tags.length; i++) {
        var tag = normaliseTag(tags[i]);
        var key = tag.toLowerCase();
        if (!tag || seen[key]) continue;
        seen[key] = true;
        clean.push(tag.toUpperCase());
      }
    }
    writeJSON(KEYS.tags, clean);
    return clean;
  }

  function addTag(name) {
    var tag = normaliseTag(name).toUpperCase();
    if (!tag) return null;
    var tags = getTags();
    for (var i = 0; i < tags.length; i++) {
      if (tags[i].toLowerCase() === tag.toLowerCase()) return tags[i];
    }
    tags.push(tag);
    saveTags(tags);
    return tag;
  }

  function removeTag(name) {
    var tag = normaliseTag(name).toLowerCase();
    var tags = getTags().filter(function (item) {
      return item.toLowerCase() !== tag;
    });
    saveTags(tags);
    return tags;
  }

  /* ---------------- History ---------------- */

  function getHistory() {
    var stored = readJSON(KEYS.history, []);
    return Array.isArray(stored) ? stored : [];
  }

  function saveHistory(list) {
    return writeJSON(KEYS.history, list);
  }

  function addSession(session) {
    var list = getHistory();
    list.unshift(session);
    // Keep the log bounded so localStorage never fills up.
    if (list.length > 500) list = list.slice(0, 500);
    saveHistory(list);
    return list;
  }

  function clearHistory() {
    saveHistory([]);
    return [];
  }

  /* ---------------- Public API ---------------- */

  FT.storage = {
    KEYS: KEYS,
    MIN_MINUTES: MIN_MINUTES,
    MAX_MINUTES: MAX_MINUTES,
    DEFAULT_TAGS: DEFAULT_TAGS,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getTags: getTags,
    saveTags: saveTags,
    addTag: addTag,
    removeTag: removeTag,
    getHistory: getHistory,
    addSession: addSession,
    clearHistory: clearHistory,
    clampMinutes: clampMinutes,
    clampBrightness: clampBrightness
  };
})(window);
