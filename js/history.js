/* ==========================================================================
   history.js — session log rendering, grouping and statistics
   ========================================================================== */
(function (global) {
  'use strict';

  var FT = global.FT || (global.FT = {});

  /* ---------------- Formatting helpers ---------------- */

  /* 65 000 ms → "01:05"; over an hour → "1:05:00" */
  function formatClock(ms) {
    var total = Math.max(0, Math.ceil(Number(ms) / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    var mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes).padStart(2, '0');
    var ss = String(seconds).padStart(2, '0');
    return hours > 0 ? hours + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  /* 600 000 ms → "10 min"; 3 900 000 ms → "1h 05m" */
  function formatDuration(ms) {
    var totalMinutes = Math.max(0, Math.round(Number(ms) / 60000));
    if (totalMinutes < 60) return totalMinutes + ' min';
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    return hours + 'h ' + String(minutes).padStart(2, '0') + 'm';
  }

  /* Compact duration for stat tiles: "1h 05m" / "45m" / "0m" */
  function formatCompact(ms) {
    var totalMinutes = Math.max(0, Math.round(Number(ms) / 60000));
    if (totalMinutes < 60) return totalMinutes + 'm';
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    return hours + 'h ' + String(minutes).padStart(2, '0') + 'm';
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatClockTime(date) {
    var d = new Date(date);
    if (isNaN(d.getTime())) return '--:--';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function dayKey(date) {
    var d = new Date(date);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function startOfDay(date) {
    var d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function formatDayLabel(date) {
    var d = new Date(date);
    if (isNaN(d.getTime())) return '';
    var today = startOfDay(Date.now());
    var target = startOfDay(d.getTime());
    var diffDays = Math.round((today - target) / 86400000);

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });

    var sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: sameYear ? undefined : 'numeric'
    });
  }

  /* ---------------- Filtering ---------------- */

  function filterSessions(sessions, filter) {
    var list = Array.isArray(sessions) ? sessions.slice() : [];
    if (filter === 'today') {
      var today = startOfDay(Date.now());
      var tomorrow = today + 86400000;
      return list.filter(function (s) {
        var t = new Date(s.endedAt).getTime();
        return t >= today && t < tomorrow;
      });
    }
    if (filter === 'week') {
      var cutoff = startOfDay(Date.now()) - 6 * 86400000;
      return list.filter(function (s) {
        return new Date(s.endedAt).getTime() >= cutoff;
      });
    }
    return list;
  }

  /* ---------------- Statistics ---------------- */

  function computeStats(sessions) {
    var list = Array.isArray(sessions) ? sessions : [];
    var total = 0;
    var today = 0;
    var todayStart = startOfDay(Date.now());
    var tomorrow = todayStart + 86400000;

    for (var i = 0; i < list.length; i++) {
      var duration = Number(list[i].durationMs) || 0;
      total += duration;
      var ended = new Date(list[i].endedAt).getTime();
      if (ended >= todayStart && ended < tomorrow) today += duration;
    }

    return {
      sessions: list.length,
      totalMs: total,
      todayMs: today
    };
  }

  /* ---------------- Rendering ---------------- */

  var CHECK_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M20 6 9 17l-5-5"></path></svg>';

  /* Renders the grouped session list into a <ul>. */
  function renderList(container, sessions) {
    if (!container) return;
    container.innerHTML = '';

    var list = Array.isArray(sessions) ? sessions : [];
    if (!list.length) return;

    var groups = [];
    var index = {};

    for (var i = 0; i < list.length; i++) {
      var session = list[i];
      var key = dayKey(session.endedAt);
      // `index[key] === undefined` — a plain truthiness check would treat the
      // first group (index 0) as missing and split the day in two.
      if (index[key] === undefined) {
        index[key] = groups.length;
        groups.push({ key: key, date: session.endedAt, items: [] });
      }
      groups[index[key]].items.push(session);
    }

    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];

      var heading = document.createElement('li');
      heading.className = 'history__day';
      heading.textContent = formatDayLabel(group.date);
      container.appendChild(heading);

      for (var j = 0; j < group.items.length; j++) {
        var item = group.items[j];
        var row = document.createElement('li');
        row.className = 'history__item';

        var badge = document.createElement('span');
        badge.className = 'history__badge';
        badge.innerHTML = CHECK_ICON;

        var body = document.createElement('div');
        body.className = 'history__body';

        var title = document.createElement('div');
        title.className = 'history__task';
        title.textContent = item.task && item.task.trim() ? item.task : 'Untitled session';

        var meta = document.createElement('div');
        meta.className = 'history__meta';

        var time = document.createElement('span');
        time.textContent = formatClockTime(item.endedAt);
        meta.appendChild(time);

        if (item.tag) {
          var dot = document.createElement('span');
          dot.className = 'history__dot';
          dot.textContent = '•';
          meta.appendChild(dot);

          var tag = document.createElement('span');
          tag.textContent = item.tag;
          meta.appendChild(tag);
        }

        body.appendChild(title);
        body.appendChild(meta);

        var duration = document.createElement('span');
        duration.className = 'history__dur';
        duration.textContent = formatDuration(item.durationMs);

        row.appendChild(badge);
        row.appendChild(body);
        row.appendChild(duration);
        container.appendChild(row);
      }
    }
  }

  FT.history = {
    formatClock: formatClock,
    formatDuration: formatDuration,
    formatCompact: formatCompact,
    formatClockTime: formatClockTime,
    formatDayLabel: formatDayLabel,
    startOfDay: startOfDay,
    filterSessions: filterSessions,
    computeStats: computeStats,
    renderList: renderList
  };
})(window);
