/* ==========================================================================
   audio.js — synthesised alert sounds (Web Audio API)
   No audio files are needed, so the chime works offline out of the box.
   ========================================================================== */
(function (global) {
  'use strict';

  var FT = global.FT || (global.FT = {});

  var ctx = null;
  var master = null;

  function AudioContextCtor() {
    return global.AudioContext || global.webkitAudioContext || null;
  }

  /* Lazily create the context. Must be called from a user gesture on
     mobile browsers, otherwise the context starts suspended. */
  function getContext() {
    if (ctx) {
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    }
    var Ctor = AudioContextCtor();
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch (err) {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  /* A single bell voice: sine oscillator + exponential decay envelope. */
  function voice(context, freq, startAt, duration, peak) {
    var osc = context.createOscillator();
    var gain = context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(gain);
    gain.connect(master);

    osc.start(startAt);
    osc.stop(startAt + duration + 0.05);
  }

  /* Soft three-note chime used when a session finishes. */
  function chime() {
    var context = getContext();
    if (!context) return false;

    var now = context.currentTime + 0.02;
    var notes = [
      { freq: 523.25, offset: 0.0, duration: 1.5, peak: 0.22 },   // C5
      { freq: 659.25, offset: 0.13, duration: 1.4, peak: 0.19 },  // E5
      { freq: 987.77, offset: 0.26, duration: 1.9, peak: 0.16 }   // B5
    ];

    for (var i = 0; i < notes.length; i++) {
      voice(context, notes[i].freq, now + notes[i].offset, notes[i].duration, notes[i].peak);
    }
    return true;
  }

  /* Short, quiet click used for the final countdown seconds. */
  function tick() {
    var context = getContext();
    if (!context) return false;

    var now = context.currentTime + 0.01;
    var osc = context.createOscillator();
    var gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.06);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.14);
    return true;
  }

  /* Short two-note "start" confirmation. */
  function confirm() {
    var context = getContext();
    if (!context) return false;

    var now = context.currentTime + 0.01;
    voice(context, 587.33, now, 0.28, 0.12);
    voice(context, 880.0, now + 0.09, 0.32, 0.1);
    return true;
  }

  /* Unlock audio on the very first user interaction (Android requirement). */
  function unlock() {
    var context = getContext();
    if (!context) return;
    if (context.state === 'suspended' && context.resume) context.resume();
  }

  FT.audio = {
    chime: chime,
    tick: tick,
    confirm: confirm,
    unlock: unlock,
    isSupported: function () { return !!AudioContextCtor(); }
  };
})(window);
