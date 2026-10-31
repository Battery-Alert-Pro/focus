/* ==========================================================================
   timer.js — countdown engine
   Timing is derived from wall-clock timestamps rather than tick counting,
   so the countdown stays accurate even when the browser throttles a
   background tab (common on Android).
   ========================================================================== */
(function (global) {
  'use strict';

  var FT = global.FT || (global.FT = {});

  var TICK_MS = 200;

  function Timer(options) {
    options = options || {};
    this.onTick = options.onTick || null;
    this.onComplete = options.onComplete || null;
    this.onStateChange = options.onStateChange || null;

    this.state = 'idle';        // idle | running | paused | done
    this.total = 0;             // planned duration in ms
    this.remaining = 0;         // remaining ms
    this.endAt = 0;             // timestamp (ms) at which the session ends
    this.startedAt = 0;         // timestamp (ms) the current run began
    this._interval = null;
  }

  Timer.prototype._emit = function (name, payload) {
    var fn = this[name];
    if (typeof fn === 'function') fn(payload);
  };

  Timer.prototype._setState = function (state) {
    if (this.state === state) return;
    this.state = state;
    this._emit('onStateChange', state);
  };

  Timer.prototype._startTicking = function () {
    var self = this;
    if (this._interval !== null) return;
    this._interval = global.setInterval(function () {
      self.tick();
    }, TICK_MS);
  };

  Timer.prototype._stopTicking = function () {
    if (this._interval === null) return;
    global.clearInterval(this._interval);
    this._interval = null;
  };

  /* Begin a new session of the given duration (ms). */
  Timer.prototype.start = function (durationMs) {
    var duration = Number(durationMs);
    if (!isFinite(duration) || duration <= 0) return false;

    this.total = duration;
    this.remaining = duration;
    this.startedAt = Date.now();
    this.endAt = this.startedAt + duration;
    this._setState('running');
    this._startTicking();
    this.tick();
    return true;
  };

  /* Freeze the countdown where it stands. */
  Timer.prototype.pause = function () {
    if (this.state !== 'running') return false;
    this.remaining = Math.max(0, this.endAt - Date.now());
    this._stopTicking();
    this._setState('paused');
    this._emit('onTick', this.remaining);
    return true;
  };

  /* Continue a paused session. */
  Timer.prototype.resume = function () {
    if (this.state !== 'paused') return false;
    this.endAt = Date.now() + this.remaining;
    this._setState('running');
    this._startTicking();
    this.tick();
    return true;
  };

  /* Abort the session and return to the idle state. */
  Timer.prototype.stop = function () {
    this._stopTicking();
    this.remaining = this.total;
    this.endAt = 0;
    this.startedAt = 0;
    this._setState('idle');
    this._emit('onTick', this.remaining);
    return true;
  };

  /* Change the planned duration (only while idle). */
  Timer.prototype.setDuration = function (durationMs) {
    var duration = Number(durationMs);
    if (!isFinite(duration) || duration <= 0) return false;
    if (this.state === 'running' || this.state === 'paused') return false;
    this.total = duration;
    this.remaining = duration;
    this._emit('onTick', this.remaining);
    return true;
  };

  /* Recalculate the remaining time; completes the session at zero. */
  Timer.prototype.tick = function () {
    if (this.state !== 'running') return;

    var remaining = Math.max(0, this.endAt - Date.now());
    this.remaining = remaining;

    if (remaining <= 0) {
      this._stopTicking();
      this.remaining = 0;
      this._setState('done');
      this._emit('onTick', 0);
      this._emit('onComplete', {
        total: this.total,
        startedAt: this.startedAt,
        endedAt: Date.now()
      });
      return;
    }

    this._emit('onTick', remaining);
  };

  /* Fraction of the session still remaining (1 → 0). */
  Timer.prototype.progress = function () {
    if (!this.total) return 0;
    var value = this.remaining / this.total;
    if (!isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  };

  Timer.prototype.isActive = function () {
    return this.state === 'running' || this.state === 'paused';
  };

  FT.Timer = Timer;
})(window);
