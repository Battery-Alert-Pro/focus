#!/usr/bin/env python3
"""Drive the Focus PWA in headless Chrome via the DevTools Protocol.

Usage: python3 tools/smoke_test.py [base_url]
"""
import asyncio
import base64
import json
import os
import sys
import urllib.request

import websockets

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080/"
SHOTS = "/tmp/opencode/shots"
os.makedirs(SHOTS, exist_ok=True)


def http_json(url):
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read().decode())


class CDP:
    def __init__(self, ws):
        self.ws = ws
        self.id = 0
        self.events = []
        self.logs = []

    async def send(self, method, **params):
        self.id += 1
        msg_id = self.id
        await self.ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=30)
            msg = json.loads(raw)
            if msg.get("id") == msg_id:
                if "error" in msg:
                    raise RuntimeError(f"{method} -> {msg['error']}")
                return msg.get("result", {})
            self.events.append(msg)
            if msg.get("method") == "Runtime.consoleAPICalled":
                p = msg["params"]
                text = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
                self.logs.append((p.get("type"), text))
            elif msg.get("method") == "Runtime.exceptionThrown":
                d = msg["params"]["exceptionDetails"]
                self.logs.append(("exception", d.get("text", "") + " " + str(d.get("exception", {}).get("description", ""))))

    async def eval(self, expression, await_promise=False):
        res = await self.send(
            "Runtime.evaluate",
            expression=expression,
            returnByValue=True,
            awaitPromise=await_promise,
            userGesture=True,
        )
        if res.get("exceptionDetails"):
            raise RuntimeError("eval error: " + json.dumps(res["exceptionDetails"])[:400])
        return res["result"].get("value")

    async def shot(self, name):
        res = await self.send("Page.captureScreenshot", format="png")
        path = os.path.join(SHOTS, name + ".png")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(res["data"]))
        return path


PASS, FAIL = [], []


def check(label, ok, detail=""):
    (PASS if ok else FAIL).append(label)
    print(("  PASS  " if ok else "  FAIL  ") + label + (f"  [{detail}]" if detail else ""))


async def main():
    targets = http_json("http://127.0.0.1:9222/json/list")
    page = next(t for t in targets if t["type"] == "page")
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=40 * 1024 * 1024) as ws:
        cdp = CDP(ws)
        await cdp.send("Page.enable")
        await cdp.send("Runtime.enable")
        await cdp.send("Log.enable")
        await cdp.send("Network.enable")

        print("\n--- Load page ---")
        await cdp.send("Page.navigate", url=BASE)
        await asyncio.sleep(2.0)
        # Start from a clean slate, and drop any cached service-worker assets so
        # the run always tests the files on disk.
        await cdp.eval("localStorage.clear()")
        await cdp.eval(
            "navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));})",
            await_promise=True,
        )
        await cdp.eval(
            "caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));})",
            await_promise=True,
        )
        await cdp.send("Page.reload", ignoreCache=True)
        await asyncio.sleep(2.5)
        # Make sure the freshly installed worker has precached the new assets.
        await cdp.eval(
            "navigator.serviceWorker.ready.then(function(){return 1;})", await_promise=True
        )
        await cdp.send("Page.reload", ignoreCache=True)
        await asyncio.sleep(2.5)

        # ---------- Structural checks ----------
        print("\n--- DOM / app bootstrap ---")
        check(
            "no JS exceptions on load",
            not any(t == "exception" for t, _ in cdp.logs),
            "; ".join(m for t, m in cdp.logs if t == "exception")[:200],
        )
        check(
            "no console errors",
            not any(t == "error" for t, _ in cdp.logs),
            "; ".join(m for t, m in cdp.logs if t == "error")[:200],
        )
        check(
            "FT namespace exposed",
            await cdp.eval("typeof window.FT === 'object' && typeof FT.app === 'object'"),
        )
        check(
            "timer display shows 10:00",
            (await cdp.eval("document.getElementById('display').textContent")) == "10:00",
            await cdp.eval("document.getElementById('display').textContent"),
        )
        check(
            "status reads Ready",
            (await cdp.eval("document.getElementById('status').textContent")) == "Ready",
        )
        check(
            "tag select populated",
            (await cdp.eval("document.getElementById('tagSelect').options.length")) >= 7,
            await cdp.eval("document.getElementById('tagSelect').options.length"),
        )
        check(
            "10 MIN BREAK tag present",
            await cdp.eval(
                "Array.from(document.getElementById('tagSelect').options).some(o=>o.textContent==='10 MIN BREAK')"
            ),
        )
        check(
            "tab pill sized",
            (await cdp.eval("document.getElementById('tabsPill').style.width")) not in ("", "0px"),
            await cdp.eval("document.getElementById('tabsPill').style.width"),
        )
        check(
            "pause disabled at rest",
            await cdp.eval("document.getElementById('pauseBtn').disabled"),
        )
        check(
            "start enabled at rest",
            await cdp.eval("!document.getElementById('startBtn').disabled"),
        )
        check(
            "history panel hidden initially",
            await cdp.eval("document.getElementById('panel-history').hidden"),
        )
        check(
            "4 quick presets present",
            (await cdp.eval("document.querySelectorAll('.preset').length")) == 4,
        )
        check(
            "minutes input within 1-180",
            await cdp.eval(
                "document.getElementById('minutesInput').min==='1' && document.getElementById('minutesInput').max==='180'"
            ),
        )
        check(
            "sound toggle is a switch",
            await cdp.eval("document.getElementById('soundToggle').type==='checkbox'"),
        )
        check(
            "alerts moved out of the timer view",
            await cdp.eval(
                "document.getElementById('panel-timer').querySelector('#soundToggle') === null"
            ),
        )
        check(
            "settings button present in app bar",
            await cdp.eval("!!document.getElementById('settingsBtn')"),
        )
        check(
            "no theme toggle button left in app bar",
            await cdp.eval("document.querySelector('#themeToggle') === null"),
        )
        check(
            "always-on-screen option present",
            await cdp.eval("!!document.getElementById('wakeToggle')"),
        )
        check(
            "brightness control present",
            await cdp.eval(
                "!!document.getElementById('brightnessInput') && !!document.getElementById('brightnessValue')"
            ),
        )
        check(
            "brightness slider spans 20-100%",
            await cdp.eval(
                "document.getElementById('brightnessInput').min==='20' && "
                "document.getElementById('brightnessInput').max==='100'"
            ),
        )
        check(
            "theme choices are auto/light/dark",
            await cdp.eval(
                "Array.from(document.querySelectorAll('[data-theme-choice]')).map(b=>b.dataset.themeChoice).join(',')==='auto,light,dark'"
            ),
        )
        check(
            "switch input is visually hidden (not a native checkbox)",
            await cdp.eval(
                "Array.from(document.querySelectorAll('.switch__input')).length===4 && "
                "getComputedStyle(document.querySelector('.switch__input')).opacity==='0'"
            ),
        )
        # The track colour and knob position must differ between on/off.
        # The switches now live in the settings dialog, so open it first —
        # a closed <dialog> is display:none and CSS transitions do not run.
        await cdp.eval("document.getElementById('settingsBtn').click()")
        await asyncio.sleep(0.4)
        await cdp.eval("document.getElementById('soundToggle').checked=false")
        await asyncio.sleep(0.45)
        off_state = await cdp.eval(
            "getComputedStyle(document.querySelector('.switch__track')).backgroundColor + '|' + "
            "getComputedStyle(document.querySelector('.switch__thumb')).transform"
        )
        await cdp.eval("document.getElementById('soundToggle').checked=true")
        await asyncio.sleep(0.45)
        on_state = await cdp.eval(
            "getComputedStyle(document.querySelector('.switch__track')).backgroundColor + '|' + "
            "getComputedStyle(document.querySelector('.switch__thumb')).transform"
        )
        check("switch animates between on/off", off_state != on_state, f"off={off_state} on={on_state}")
        check(
            "switch knob travels when toggled",
            "none" in off_state.lower() and "matrix" in on_state.lower(),
            f"off={off_state} on={on_state}",
        )
        await cdp.eval("document.getElementById('settingsDialog').close()")
        await asyncio.sleep(0.3)

        await cdp.shot("01-timer-idle")

        # ---------- Duration controls ----------
        print("\n--- Duration controls ---")
        await cdp.eval("document.getElementById('incBtn').click()")
        check(
            "increment -> 11 min",
            (await cdp.eval("document.getElementById('minutesInput').value")) == "11",
            await cdp.eval("document.getElementById('minutesInput').value"),
        )
        await cdp.eval("document.getElementById('decBtn').click()")
        await cdp.eval("document.getElementById('decBtn').click()")
        check(
            "decrement x2 -> 9 min",
            (await cdp.eval("document.getElementById('minutesInput').value")) == "9",
            await cdp.eval("document.getElementById('minutesInput').value"),
        )
        check(
            "display follows duration",
            (await cdp.eval("document.getElementById('display').textContent")) == "09:00",
            await cdp.eval("document.getElementById('display').textContent"),
        )
        await cdp.eval("document.querySelector('.preset[data-min=\"20\"]').click()")
        check(
            "preset 20 applies",
            (await cdp.eval("document.getElementById('minutesInput').value")) == "20",
        )
        check(
            "preset marked active",
            await cdp.eval("document.querySelector('.preset[data-min=\"20\"]').classList.contains('is-active')"),
        )
        check(
            "lower bound clamps to 1",
            await cdp.eval(
                "document.getElementById('minutesInput').value='0';"
                "document.getElementById('minutesInput').dispatchEvent(new Event('change'));"
                "document.getElementById('minutesInput').value==='1'"
            ),
        )
        check(
            "upper bound clamps to 180",
            await cdp.eval(
                "document.getElementById('minutesInput').value='999';"
                "document.getElementById('minutesInput').dispatchEvent(new Event('change'));"
                "document.getElementById('minutesInput').value==='180'"
            ),
        )

        # ---------- Task + tags ----------
        print("\n--- Session fields ---")
        await cdp.eval(
            "(function(){const i=document.getElementById('taskInput'); i.value='Write the proposal';"
            "i.dispatchEvent(new Event('input'));})();"
        )
        check(
            "task persisted to localStorage",
            await cdp.eval(
                "JSON.parse(localStorage.getItem('focus.settings.v1')).task==='Write the proposal'"
            ),
        )
        check(
            "active task shown under dial",
            (await cdp.eval("document.getElementById('activeTask').textContent")) == "Write the proposal",
        )
        await cdp.eval(
            "(function(){const s=document.getElementById('tagSelect'); s.value='10 MIN BREAK';"
            "s.dispatchEvent(new Event('change'));})();"
        )
        check(
            "tag selection applied",
            await cdp.eval("FT.app.state.tag==='10 MIN BREAK'"),
            await cdp.eval("FT.app.state.tag"),
        )
        check(
            "active tag chip visible",
            await cdp.eval(
                "!document.getElementById('activeTag').hidden && "
                "document.getElementById('activeTag').textContent==='10 MIN BREAK'"
            ),
        )
        await cdp.eval(
            "(function(){const s=document.getElementById('tagSelect'); s.value='__custom__';"
            "s.dispatchEvent(new Event('change'));})();"
        )
        check(
            "custom tag input revealed",
            await cdp.eval("!document.getElementById('customTagInput').hidden"),
        )
        await cdp.eval(
            "(function(){const c=document.getElementById('customTagInput'); c.value='Deep Dive';"
            "c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})();"
        )
        await asyncio.sleep(0.4)
        check(
            "custom tag created and selected",
            await cdp.eval("FT.app.state.tag==='DEEP DIVE'"),
            await cdp.eval("FT.app.state.tag"),
        )
        check(
            "custom tag persisted",
            await cdp.eval(
                "JSON.parse(localStorage.getItem('focus.tags.v1')).includes('DEEP DIVE')"
            ),
        )

        # ---------- Settings dialog ----------
        print("\n--- Settings dialog ---")
        await cdp.eval("document.getElementById('settingsBtn').click()")
        await asyncio.sleep(0.5)
        check("settings dialog opens", await cdp.eval("document.getElementById('settingsDialog').open"))
        check(
            "alerts live inside the dialog",
            await cdp.eval(
                "!!document.getElementById('settingsDialog').querySelector('#soundToggle') && "
                "!!document.getElementById('settingsDialog').querySelector('#testSoundBtn')"
            ),
        )
        check(
            "always-on-screen defaults to on",
            await cdp.eval("document.getElementById('wakeToggle').checked"),
        )
        await cdp.eval("document.getElementById('wakeToggle').click()")
        await asyncio.sleep(0.3)
        check(
            "always-on-screen toggles off and persists",
            await cdp.eval(
                "JSON.parse(localStorage.getItem('focus.settings.v1')).wakeLock===false && "
                "!document.getElementById('wakeToggle').checked"
            ),
        )
        await cdp.eval("document.getElementById('wakeToggle').click()")
        await asyncio.sleep(0.3)
        check(
            "always-on-screen toggles back on",
            await cdp.eval("JSON.parse(localStorage.getItem('focus.settings.v1')).wakeLock===true"),
        )

        # Brightness
        await cdp.eval(
            "(function(){var b=document.getElementById('brightnessInput'); b.value='60';"
            "b.dispatchEvent(new Event('input'));})();"
        )
        await asyncio.sleep(0.4)
        check(
            "brightness label updates",
            (await cdp.eval("document.getElementById('brightnessValue').textContent")) == "60%",
            await cdp.eval("document.getElementById('brightnessValue').textContent"),
        )
        check(
            "brightness persists",
            await cdp.eval("JSON.parse(localStorage.getItem('focus.settings.v1')).brightness===0.6"),
        )
        check(
            "dimmer scrim responds to brightness",
            float(await cdp.eval("parseFloat(document.getElementById('dimmer').style.opacity)")) > 0,
            await cdp.eval("document.getElementById('dimmer').style.opacity"),
        )
        check(
            "dimmer does not block clicks",
            (await cdp.eval("getComputedStyle(document.getElementById('dimmer')).pointerEvents")) == "none",
        )
        await cdp.eval(
            "(function(){var b=document.getElementById('brightnessInput'); b.value='100';"
            "b.dispatchEvent(new Event('input'));})();"
        )
        await asyncio.sleep(0.3)
        check(
            "brightness reset to 100%",
            (await cdp.eval("document.getElementById('brightnessValue').textContent")) == "100%",
        )

        # Theme choice
        await cdp.eval("document.querySelector('[data-theme-choice=\"dark\"]').click()")
        await asyncio.sleep(0.4)
        check(
            "theme switches to dark",
            (await cdp.eval("document.documentElement.getAttribute('data-theme')")) == "dark",
        )
        check(
            "theme choice marked active",
            await cdp.eval(
                "document.querySelector('[data-theme-choice=\"dark\"]').classList.contains('is-active')"
            ),
        )
        await cdp.eval("document.querySelector('[data-theme-choice=\"auto\"]').click()")
        await asyncio.sleep(0.3)
        check(
            "theme returns to auto",
            await cdp.eval("document.documentElement.getAttribute('data-theme') === null"),
        )
        await cdp.eval("document.getElementById('settingsDialog').close()")
        await asyncio.sleep(0.3)
        check("settings dialog closes", not await cdp.eval("document.getElementById('settingsDialog').open"))

        # ---------- Tag manager dialog ----------
        print("\n--- Tag manager ---")
        await cdp.eval("document.getElementById('editTagsBtn').click()")
        await asyncio.sleep(0.3)
        check("tag dialog opens", await cdp.eval("document.getElementById('tagDialog').open"))
        check(
            "tag manager lists tags",
            (await cdp.eval("document.querySelectorAll('.tag-list__item').length")) >= 6,
            await cdp.eval("document.querySelectorAll('.tag-list__item').length"),
        )
        await cdp.shot("02-tag-manager")
        await cdp.eval(
            "document.getElementById('tagDialog').close();"
            "document.getElementById('addTagBtn').click();"
        )
        check(
            "dialog closed",
            not await cdp.eval("document.getElementById('tagDialog').open"),
        )

        # ---------- Timer run ----------
        print("\n--- Timer run (accelerated) ---")
        await cdp.eval(
            "document.getElementById('minutesInput').value='1';"
            "document.getElementById('minutesInput').dispatchEvent(new Event('change'));"
        )
        await cdp.eval("document.getElementById('startBtn').click()")
        await asyncio.sleep(1.2)
        check("status -> Running", (await cdp.eval("document.getElementById('status').textContent")) == "Running")
        check("start disabled while running", await cdp.eval("document.getElementById('startBtn').disabled"))
        check("pause enabled while running", await cdp.eval("!document.getElementById('pauseBtn').disabled"))
        check("stop enabled while running", await cdp.eval("!document.getElementById('stopBtn').disabled"))
        check(
            "config locked while running",
            await cdp.eval("document.getElementById('taskInput').disabled && document.getElementById('minutesInput').disabled"),
        )
        t1 = await cdp.eval("document.getElementById('display').textContent")
        await asyncio.sleep(2.2)
        t2 = await cdp.eval("document.getElementById('display').textContent")
        check("countdown is ticking", t1 != t2, f"{t1} -> {t2}")
        check(
            "ring progress shrinking",
            float(await cdp.eval("parseFloat(document.getElementById('dialProgress').style.strokeDashoffset)")) > 0,
            await cdp.eval("document.getElementById('dialProgress').style.strokeDashoffset"),
        )
        await cdp.shot("03-running")

        # Pause / resume
        await cdp.eval("document.getElementById('pauseBtn').click()")
        await asyncio.sleep(0.3)
        check("status -> Paused", (await cdp.eval("document.getElementById('status').textContent")) == "Paused")
        check("start label -> Resume", (await cdp.eval("document.getElementById('startLabel').textContent")) == "Resume")
        frozen = await cdp.eval("document.getElementById('display').textContent")
        await asyncio.sleep(1.5)
        check(
            "paused value frozen",
            (await cdp.eval("document.getElementById('display').textContent")) == frozen,
            frozen,
        )
        await cdp.eval("document.getElementById('startBtn').click()")
        await asyncio.sleep(0.4)
        check("resumed -> Running", (await cdp.eval("document.getElementById('status').textContent")) == "Running")

        # Completion path (fast-forward the internal clock)
        await cdp.eval(
            "FT.app.timer.endAt = Date.now() + 250; FT.app.timer.tick();"
        )
        await asyncio.sleep(0.6)
        check("status -> Done after completion", (await cdp.eval("document.getElementById('status').textContent")) == "Done")
        check(
            "session logged to history",
            (await cdp.eval("JSON.parse(localStorage.getItem('focus.history.v1')).length")) == 1,
        )
        check(
            "logged session keeps task + tag",
            await cdp.eval(
                "JSON.parse(localStorage.getItem('focus.history.v1'))[0].task==='Write the proposal' && "
                "JSON.parse(localStorage.getItem('focus.history.v1'))[0].tag==='DEEP DIVE'"
            ),
        )
        check(
            "logged duration = 1 min",
            await cdp.eval("JSON.parse(localStorage.getItem('focus.history.v1'))[0].durationMs===60000"),
        )

        # ---------- History tab ----------
        print("\n--- History view ---")
        await cdp.eval("document.getElementById('tab-history').click()")
        await asyncio.sleep(0.5)
        check("history panel visible", await cdp.eval("!document.getElementById('panel-history').hidden"))
        check("timer panel hidden", await cdp.eval("document.getElementById('panel-timer').hidden"))
        check(
            "history row rendered",
            (await cdp.eval("document.querySelectorAll('.history__item').length")) == 1,
        )
        check(
            "row shows task",
            (await cdp.eval("document.querySelector('.history__task').textContent")) == "Write the proposal",
        )
        check(
            "row shows duration",
            (await cdp.eval("document.querySelector('.history__dur').textContent")) == "1 min",
            await cdp.eval("document.querySelector('.history__dur').textContent"),
        )
        check("stats show 1 session", (await cdp.eval("document.getElementById('statSessions').textContent")) == "1")
        check("stats show focus time", (await cdp.eval("document.getElementById('statFocus').textContent")) == "1m")
        check("stats show today", (await cdp.eval("document.getElementById('statToday').textContent")) == "1m")
        # Two sessions on the same day must share one heading, not two.
        await cdp.eval(
            """
            (function(){
              var base = JSON.parse(localStorage.getItem('focus.history.v1'))[0];
              var twin = Object.assign({}, base, { id:'twin', task:'Second task today' });
              localStorage.setItem('focus.history.v1', JSON.stringify([base, twin]));
              FT.app.renderHistory();
            })();
            """
        )
        await asyncio.sleep(0.4)
        headings = await cdp.eval(
            "Array.from(document.querySelectorAll('.history__day')).map(function(h){return h.textContent;})"
        )
        check(
            "same-day sessions share one heading",
            len(headings) == 1 and headings[0] == "Today",
            str(headings),
        )
        check(
            "both same-day rows listed",
            (await cdp.eval("document.querySelectorAll('.history__item').length")) == 2,
        )
        # Restore a single session for the remaining checks.
        await cdp.eval(
            "localStorage.setItem('focus.history.v1', JSON.stringify([JSON.parse(localStorage.getItem('focus.history.v1'))[0]]));"
            "FT.app.renderHistory();"
        )
        await asyncio.sleep(0.3)
        check(
            "clear button visible with data",
            await cdp.eval("!document.getElementById('clearHistoryBtn').hidden"),
        )
        await cdp.shot("04-history")

        # Filters
        await cdp.eval("document.querySelector('.filter[data-filter=\"today\"]').click()")
        await asyncio.sleep(0.3)
        check(
            "today filter keeps today's session",
            (await cdp.eval("document.querySelectorAll('.history__item').length")) == 1,
        )
        await cdp.eval("document.querySelector('.filter[data-filter=\"all\"]').click()")

        # Clear history (two-step)
        await cdp.eval("document.getElementById('clearHistoryBtn').click()")
        await asyncio.sleep(0.2)
        check(
            "clear button arms first",
            (await cdp.eval("document.getElementById('clearHistoryBtn').textContent")) == "Tap again to clear",
        )
        await cdp.eval("document.getElementById('clearHistoryBtn').click()")
        await asyncio.sleep(0.3)
        check(
            "history cleared",
            (await cdp.eval("JSON.parse(localStorage.getItem('focus.history.v1')).length")) == 0,
        )
        check("empty state shown", await cdp.eval("!document.getElementById('historyEmpty').hidden"))

        # ---------- Persistence across reload ----------
        print("\n--- Persistence ---")
        await cdp.send("Page.reload")
        await asyncio.sleep(2.0)
        check(
            "task restored after reload",
            (await cdp.eval("document.getElementById('taskInput').value")) == "Write the proposal",
        )
        check(
            "custom tag restored after reload",
            await cdp.eval(
                "Array.from(document.getElementById('tagSelect').options).some(o=>o.textContent==='DEEP DIVE')"
            ),
        )
        check(
            "selected tag restored after reload",
            (await cdp.eval("FT.app.state.tag")) == "DEEP DIVE",
        )
        check(
            "duration restored after reload",
            (await cdp.eval("document.getElementById('minutesInput').value")) == "1",
            await cdp.eval("document.getElementById('minutesInput').value"),
        )

        # ---------- PWA plumbing ----------
        print("\n--- PWA plumbing ---")
        sw = await cdp.eval(
            "navigator.serviceWorker.getRegistration().then(r => r ? r.active ? 'active' : 'registered' : 'none')",
            await_promise=True,
        )
        check("service worker registered", sw in ("active", "registered"), str(sw))
        caches = await cdp.eval(
            "caches.keys().then(k => k.join(','))", await_promise=True
        )
        check("cache created", "focus-cache" in str(caches), str(caches))
        cached = await cdp.eval(
            "caches.keys().then(function(ks){"
            "  var name = ks.filter(function(k){return k.indexOf('focus-cache-')===0;})[0];"
            "  return name ? caches.open(name).then(function(c){return c.keys().then(function(k){return k.length;});}) : 0;"
            "})",
            await_promise=True,
        )
        check("app shell precached", int(cached or 0) >= 10, f"{cached} entries")
        manifest_ok = await cdp.eval(
            "fetch('manifest.json').then(r=>r.json()).then(m=>!!(m.name && m.icons.length>=4 && m.display))",
            await_promise=True,
        )
        check("manifest loads with icons + display", bool(manifest_ok))
        manifest_link = await cdp.eval(
            "!!document.querySelector('link[rel=manifest]')"
        )
        check("manifest linked from HTML", bool(manifest_link))
        check(
            "viewport uses viewport-fit=cover",
            (await cdp.eval("document.querySelector('meta[name=viewport]').content")).find("viewport-fit=cover") >= 0,
        )

        # ---------- Responsive layouts ----------
        print("\n--- Responsive ---")
        for name, w, h in [("desktop", 1280, 900), ("tablet", 768, 1024), ("mobile", 390, 844), ("small", 320, 640)]:
            await cdp.send("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=(w < 500))
            await asyncio.sleep(0.5)
            await cdp.shot(f"05-{name}-{w}x{h}")
            overflow = await cdp.eval("document.documentElement.scrollWidth <= window.innerWidth + 1")
            check(f"no horizontal overflow @ {w}px", bool(overflow),
                  f"scrollWidth={await cdp.eval('document.documentElement.scrollWidth')}")
        await cdp.send("Emulation.clearDeviceMetricsOverride")

        # ---------- Final error sweep ----------
        print("\n--- Error sweep ---")
        errs = [m for t, m in cdp.logs if t in ("error", "exception")]
        check("no console errors/exceptions overall", not errs, " | ".join(errs)[:300])

    print(f"\n================  {len(PASS)} passed, {len(FAIL)} failed  ================")
    for f in FAIL:
        print("  FAILED: " + f)
    return 1 if FAIL else 0


sys.exit(asyncio.run(main()))
