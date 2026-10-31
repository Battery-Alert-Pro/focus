# Focus — Countdown Timer & Session Tracker

A fast, offline-first Progressive Web App. A countdown timer with a progress dial,
configurable session metadata, tag management, sound/notification alerts, and a
session history — installable on desktop and Android.

No build step, no dependencies, no framework. Plain HTML, CSS and JavaScript.

---

## Run it

Service workers and `localStorage` require a real origin, so serve the folder
over HTTP (opening `index.html` directly with `file://` will not register the SW):

```bash
cd pwa_app
python3 -m http.server 8080
# → http://localhost:8080
```

Any static server works (`npx serve`, `php -S localhost:8080`, nginx…).

### Install it

* **Android / Chrome** — ⋮ menu → *Install app*, or the download icon in the toolbar.
* **Desktop Chrome / Edge** — the install icon in the address bar.
* **iOS Safari** — Share → *Add to Home Screen*.

Once installed it launches standalone (no browser chrome), works fully offline,
and keeps its data in `localStorage`.

---

## Features

| Area | Details |
| --- | --- |
| **Tabs** | Timer ⇄ History, with a sliding indicator and arrow-key support |
| **Timer display** | Large `MM:SS` dial (`H:MM:SS` past an hour), SVG progress ring, status pill (Ready / Running / Paused / Done) |
| **Controls** | Start · Pause · Stop, with contextual enable/disable and a *Resume* label |
| **Session name** | "What are you focusing on?" text field, persisted as you type |
| **Tags** | Dropdown of saved tags + `+ Custom tag…` and a **Manage tags** editor (add/remove) |
| **Quick presets** | One tap: 5 · 10 · 15 · 20 min, with the active preset highlighted |
| **Custom adjuster** | Number field (1–180 min) with − / + buttons and a slider |
| **Settings dialog** | Gear button in the app bar — see below |
| **History** | Grouped-by-day log of completed sessions, timestamps, tags and durations, plus All / Today / Week filters and summary stats |

### Settings (gear icon in the app bar)

| Group | Option | Behaviour |
| --- | --- | --- |
| Alerts | Play a chime when the session ends | Soft three-note bell at the end of a session |
| Alerts | Vibrate on finish | Android vibration pulse on completion |
| Alerts | Send a notification on finish | System notification, useful while backgrounded |
| Alerts | Test sound | Previews the alert immediately |
| Screen | **Always on screen** | Keeps the display awake while a session runs (Screen Wake Lock) |
| Screen | **Brightness** | 20–100 % screen brightness slider |
| Appearance | Auto / Light / Dark | Theme choice, remembered between visits |

**Always on screen** uses the Screen Wake Lock API. It is on by default and is
re-acquired automatically when the app returns to the foreground (the browser
releases the lock whenever the page is hidden).

**Brightness** uses the Screen Brightness API (`navigator.setScreenBrightness`),
which is available on Android Chrome. The OS resets it when the page is hidden,
so it is re-applied on `visibilitychange`, and the original brightness is
restored when the app closes. On devices without the API (desktop browsers),
Focus falls back to dimming its own display with a scrim — the hint text under
the slider tells you which mode is active.

### Android-specific behaviour

* Wake Lock keeps the screen on while a session runs (toggle: *Always on screen*).
* Vibration fires on completion (respecting the toggle).
* Notifications fire on completion when the app is backgrounded.
* Screen brightness is driven directly through the Android Screen Brightness API.
* `viewport-fit=cover` + `env(safe-area-inset-*)` for gesture-nav / notch safe areas.
* 44 px minimum touch targets and no tap highlight flash.
* Standalone display mode with a themed status bar.

### Design

* CSS custom properties with a dark **and** light palette; follows the OS by
  default and can be overridden from Settings → Appearance (choice is remembered).
* `prefers-reduced-motion` and `prefers-contrast` are respected.
* Fluid layout from 320 px to desktop, with no horizontal overflow.

---

## Files

```
pwa_app/
├── index.html              # Markup + all views
├── manifest.json           # PWA manifest (icons, shortcuts, display mode)
├── sw.js                   # Service worker: precache + offline shell
├── css/
│   └── styles.css          # Tokens, layout, components
├── js/
│   ├── storage.js          # localStorage: settings, tags, history
│   ├── audio.js            # Web Audio chime / tick / confirm (no audio files)
│   ├── timer.js            # Countdown engine
│   ├── history.js          # Formatting, grouping, stats, rendering
│   └── app.js              # UI wiring, PWA plumbing, event handlers
├── icons/
│   ├── icon-192.png  icon-512.png                    # "any" purpose
│   ├── icon-maskable-192.png  icon-maskable-512.png  # Android adaptive
│   ├── apple-touch-icon.png
│   └── favicon.svg
└── tools/
    ├── make_icons.py       # Regenerates the PNG icons
    └── smoke_test.py       # Automated browser test suite
```

### How the timer stays accurate

`js/timer.js` derives the remaining time from wall-clock timestamps
(`endAt = Date.now() + duration`) instead of counting interval ticks, so the
countdown stays correct even when Android throttles a background tab. A
`visibilitychange` handler re-syncs immediately when the app returns to the
foreground.

### How the chime works

`js/audio.js` synthesises the alert with the Web Audio API (three sine voices
with exponential decay envelopes) rather than shipping an audio file. That keeps
the bundle tiny and means the sound works offline with nothing extra to cache.
The context is resumed on the first user gesture to satisfy mobile autoplay rules.

---

## Development

### Regenerate the icons

```bash
python3 tools/make_icons.py     # requires Pillow
```

### Run the test suite

The suite drives real Chrome over the DevTools Protocol and checks the DOM,
timer behaviour, persistence, service worker, and responsive layout:

```bash
python3 -m http.server 8080 &
google-chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-focus about:blank &
python3 tools/smoke_test.py
```

Current status: **100 checks passing**.

### Updating the app

The service worker serves cached assets first and refreshes them in the
background, so a change to `css/` or `js/` appears on the *second* reload.
To force everyone onto the new build, bump `VERSION` in `sw.js` — the old cache
is then deleted on activation. `index.html` is fetched network-first, so markup
changes apply on the first reload.

---

## Data & privacy

Everything stays on the device. There is no server, no analytics and no network
request after the first load. Clearing site data in the browser resets the
settings, tags and history.
