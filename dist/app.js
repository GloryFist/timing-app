(function () {
  "use strict";

  var C = window.TimingCore;
  var STORAGE_KEY = "timing.v1";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var now = new Date();
  var state = {
    entries: [],
    view: "today",
    journal: { year: now.getFullYear(), month: now.getMonth() },
    exportMode: "new",
    draftActivity: "",
    draftNote: "",
    switching: false,
    editingId: null
  };

  var deferredPrompt = null;
  var lastExportIds = null;
  var toastTimer = null;

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function nowParts(date) {
    var d = date || new Date();
    return {
      date: C.isoDate(d),
      time: C.pad2(d.getHours()) + ":" + C.pad2(d.getMinutes())
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.entries)) return;
      state.entries = data.entries.filter(function (e) {
        return e && typeof e.date === "string" && typeof e.start === "string" && typeof e.activity === "string";
      }).map(function (e) {
        return {
          id: e.id || uid(),
          date: e.date,
          start: e.start,
          end: e.end || null,
          activity: e.activity,
          note: e.note || "",
          createdAt: e.createdAt || null,
          exportedAt: e.exportedAt || null
        };
      });
      keepSingleOpen();
    } catch (err) {
      console.warn("Не удалось прочитать данные", err);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, entries: state.entries }));
    } catch (err) {
      toast("Не удалось сохранить данные: хранилище браузера недоступно");
    }
  }

  function keepSingleOpen() {
    var open = state.entries.filter(function (e) { return !e.end; });
    if (open.length <= 1) return;
    open.sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? 1 : -1; });
    open.slice(1).forEach(function (e) {
      e.end = e.start;
    });
  }

  function activeEntry() {
    var open = state.entries.filter(function (e) { return !e.end; });
    if (!open.length) return null;
    return open.sort(function (a, b) {
      return (a.date + a.start) < (b.date + b.start) ? 1 : -1;
    })[0];
  }

  function closeOpenAt(parts, exclusive) {
    var changed = false;
    state.entries.forEach(function (e) {
      if (e.end) return;
      var startMin = C.timeToMinutes(e.start);
      var endMin = C.timeToMinutes(parts.time);
      if (exclusive) endMin -= 1;
      if (e.date !== parts.date) endMin = 23 * 60 + 59;
      if (endMin < startMin) endMin = startMin;
      e.end = C.minutesToTime(endMin);
      e.exportedAt = null;
      changed = true;
    });
    return changed;
  }

  function startEntry(activity, note, at) {
    var text = String(activity || "").trim();
    if (!text) return false;
    var parts = nowParts(at);
    closeOpenAt(parts, true);
    state.entries.push({
      id: uid(),
      date: parts.date,
      start: parts.time,
      end: null,
      activity: text,
      note: String(note || "").trim(),
      createdAt: new Date().toISOString(),
      exportedAt: null
    });
    save();
    renderAll();
    return true;
  }

  function stopActive() {
    var active = activeEntry();
    if (!active) return;
    var before = C.entryMinutes(active);
    closeOpenAt(nowParts(), false);
    save();
    renderAll();
    var after = C.entryMinutes(active);
    toast("Интервал сохранён: " + C.formatDuration(after || before));
  }

  function checkMidnight() {
    var today = C.todayISO();
    var active = activeEntry();
    if (!active || active.date >= today) return;
    closeOpenAt({ date: active.date, time: "23:59" }, false);
    save();
    renderAll();
    toast("Интервал закрыт в 23:59");
  }

  function renderAll() {
    renderHeader();
    renderTimer();
    renderToday();
    renderJournal();
    renderExport();
  }

  function renderHeader() {
    var today = C.todayISO();
    $("#todayDate").textContent = C.formatDateShort(today);
    $("#todayWeekday").textContent = C.weekdayName(today);
  }

  function renderTimer() {
    var el = $("#timerCard");
    var active = activeEntry();

    if (!active) {
      state.switching = false;
      el.className = "timer is-idle";
      el.innerHTML =
        '<label class="field" for="activityInput">Чем занимаетесь?' +
          '<input id="activityInput" type="text" autocomplete="off" placeholder="Например: Проверка @" value="' + esc(state.draftActivity) + '">' +
        '</label>' +
        '<button class="primary wide" type="button" data-act="start">Старт</button>' +
        '<button class="link note-toggle" type="button" data-act="toggle-note">' +
          (state.draftNote ? "Примечание: " + esc(state.draftNote) : "＋ примечание") +
        '</button>' +
        '<div class="note-box"' + (state.draftNote ? "" : " hidden") + '>' +
          '<input id="noteInput" type="text" autocomplete="off" aria-label="Примечание к интервалу" placeholder="Примечание к интервалу" value="' + esc(state.draftNote) + '">' +
        '</div>';
      return;
    }

    var started = "с " + active.start;
    var header =
      '<div class="timer-top">' +
        '<span class="live"><i class="dot"></i> идёт ' + started + '</span>' +
        '<button class="link" type="button" data-act="edit-active">Изменить</button>' +
      '</div>' +
      '<div class="clock" id="elapsed">' + C.formatClock(C.elapsedSeconds(active)) + '</div>' +
      '<p class="timer-activity">' + esc(active.activity) + '</p>' +
      (active.note ? '<p class="timer-note">' + esc(active.note) + '</p>' : "");

    if (state.switching) {
      el.className = "timer is-running is-switching";
      el.innerHTML = header +
        '<div class="switch-box">' +
          '<input id="nextActivity" type="text" autocomplete="off" aria-label="Новая деятельность" placeholder="Новая деятельность">' +
          '<p class="switch-hint">Текущий интервал закончится в ' + C.minutesToTime(C.timeToMinutes(nowParts().time) - 1) + '.</p>' +
        '</div>' +
        '<div class="timer-actions">' +
          '<button class="primary" type="button" data-act="switch-go">Начать</button>' +
          '<button class="ghost" type="button" data-act="switch-cancel">Отмена</button>' +
        '</div>';
      return;
    }

    el.className = "timer is-running";
    el.innerHTML = header +
      '<div class="timer-actions">' +
        '<button class="primary" type="button" data-act="switch">Переключить</button>' +
        '<button class="ghost" type="button" data-act="stop">Стоп</button>' +
      '</div>';
  }

  function entryHtml(e) {
    var live = !e.end;
    var dur = live ? Math.floor(C.elapsedSeconds(e) / 60) : C.entryMinutes(e);
    return '<li>' +
      '<button class="entry' + (live ? " is-live" : "") + '" type="button" data-id="' + esc(e.id) + '">' +
        '<span class="entry-time">' + esc(e.start) + "–" + (live ? "сейчас" : esc(e.end)) + '</span>' +
        '<span class="entry-body">' +
          '<span class="entry-activity">' + esc(e.activity) + '</span>' +
          (e.note ? '<span class="entry-note">' + esc(e.note) + '</span>' : "") +
        '</span>' +
        '<span class="entry-dur"' + (live ? ' data-live-dur="' + esc(e.id) + '"' : "") + '>' +
          C.formatDuration(dur) +
        '</span>' +
      '</button>' +
    '</li>';
  }

  function renderToday() {
    var today = C.todayISO();
    var list = C.sortEntries(state.entries.filter(function (e) { return e.date === today; }));
    var active = activeEntry();
    var closedMinutes = C.totalMinutes(list);
    var runningMinutes = active && active.date === today ? Math.floor(C.elapsedSeconds(active) / 60) : 0;
    var total = closedMinutes + runningMinutes;

    $("#dayTotal").textContent = C.formatDuration(total);
    var count = list.length;
    $("#dayCount").textContent = count
      ? count + " " + plural(count, "интервал", "интервала", "интервалов")
      : "нет записей";

    renderStrip(list, active);

    var ul = $("#todayList");
    if (!list.length) {
      ul.innerHTML = '<li class="empty">Пока пусто. Нажмите «Старт» или добавьте интервал вручную.</li>';
      return;
    }
    ul.innerHTML = list.map(entryHtml).join("");
  }

  function renderStrip(list, active) {
    var strip = $("#dayStrip");
    var parts = [];
    list.forEach(function (e) {
      var startMin = C.timeToMinutes(e.start);
      var endMin = e.end ? C.timeToMinutes(e.end) : C.timeToMinutes(nowParts().time);
      if (isNaN(startMin) || isNaN(endMin)) return;
      var left = Math.max(0, Math.min(1440, startMin)) / 1440 * 100;
      var width = Math.max(0.35, (Math.min(1440, endMin + 1) - Math.max(0, startMin)) / 1440 * 100);
      parts.push('<span class="strip-seg' + (e.end ? "" : " is-open") + '" style="left:' +
        left.toFixed(3) + "%;width:" + width.toFixed(3) + '%"></span>');
    });
    if (C.todayISO() === nowParts().date) {
      var nowMin = C.timeToMinutes(nowParts().time);
      parts.push('<span class="strip-now" style="left:' + (nowMin / 1440 * 100).toFixed(3) + '%"></span>');
    }
    strip.innerHTML = parts.join("");
  }

  function renderJournal() {
    var year = state.journal.year;
    var month = state.journal.month;
    var prefix = year + "-" + C.pad2(month + 1);
    var list = state.entries.filter(function (e) { return C.monthKey(e.date) === prefix; });
    var groups = {};

    list.forEach(function (e) {
      if (!groups[e.date]) groups[e.date] = [];
      groups[e.date].push(e);
    });

    $("#monthLabel").textContent = C.formatMonth(year, month);
    $("#monthTotal").textContent = C.formatDuration(C.totalMinutes(list));

    var dates = Object.keys(groups).sort().reverse();
    var root = $("#journalList");

    if (!dates.length) {
      root.innerHTML = '<p class="empty">В этом месяце записей нет.</p>';
      return;
    }

    root.innerHTML = dates.map(function (date) {
      var items = C.sortEntries(groups[date]);
      var total = C.totalMinutes(items);
      return '<section class="day-group">' +
        '<div class="day-group-head">' +
          '<strong>' + esc(C.formatDateShort(date)) + ", " + esc(C.weekdayName(date)) + '</strong>' +
          '<span>' + esc(C.formatDuration(total)) + '</span>' +
        '</div>' +
        '<ul class="entries">' + items.map(entryHtml).join("") + '</ul>' +
      '</section>';
    }).join("");
  }

  function exportSelection() {
    var closed = state.entries.filter(function (e) { return !!e.end; });
    if (state.exportMode === "new") {
      return C.sortEntries(closed.filter(function (e) { return !e.exportedAt; }));
    }
    if (state.exportMode === "month") {
      var ym = C.monthKey(C.todayISO());
      return C.sortEntries(closed.filter(function (e) { return C.monthKey(e.date) === ym; }));
    }
    return C.sortEntries(closed);
  }

  function renderExport() {
    var list = exportSelection();
    var minutes = C.totalMinutes(list);
    $("#exportCount").textContent = list.length
      ? list.length + " " + plural(list.length, "запись", "записи", "записей")
      : "нет записей";
    $("#exportMinutes").textContent = C.formatDuration(minutes);

    var period = "—";
    if (list.length) {
      var first = list[0].date;
      var last = list[list.length - 1].date;
      period = first === last ? C.formatDateLong(first) : C.formatDateShort(first) + " — " + C.formatDateLong(last);
    }
    if (state.exportMode === "new" && list.length) {
      period += " · ещё не выгружались";
    }
    $("#exportPeriod").textContent = period;
    $("#exportLive").hidden = !activeEntry();
    $("#exportBtn").disabled = !list.length;
    $("#copyBtn").disabled = !list.length;

    $$(".seg-btn").forEach(function (btn) {
      var on = btn.getAttribute("data-mode") === state.exportMode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  function download(text, filename, type) {
    var blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function exportCsv(silent) {
    var list = exportSelection();
    if (!list.length) {
      toast("Нет записей для выгрузки");
      return;
    }
    var csv = "\uFEFF" + C.toCsv(list);
    download(csv, C.csvFilename(list), "text/csv;charset=utf-8");
    var ids = list.map(function (e) { return e.id; });
    list.forEach(function (e) { e.exportedAt = new Date().toISOString(); });
    save();
    lastExportIds = ids;
    renderAll();
    if (!silent) {
      toast("Выгружено: " + list.length + " " + plural(list.length, "запись", "записи", "записей"),
        "Отменить", undoExport);
    }
  }

  function undoExport() {
    if (!lastExportIds) return;
    state.entries.forEach(function (e) {
      if (lastExportIds.indexOf(e.id) !== -1) e.exportedAt = null;
    });
    lastExportIds = null;
    save();
    renderAll();
    toast("Отметка о выгрузке снята");
  }

  async function copyCsv() {
    var list = exportSelection();
    if (!list.length) return;
    var csv = C.toCsv(list);
    try {
      await navigator.clipboard.writeText(csv);
      toast("CSV скопирован в буфер");
    } catch (err) {
      var ta = document.createElement("textarea");
      ta.value = csv;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        toast("CSV скопирован в буфер");
      } catch (e2) {
        toast("Не удалось скопировать — скачайте файл");
      }
      ta.remove();
    }
  }

  function toast(message, actionLabel, action) {
    var el = $("#toast");
    el.innerHTML = '<span>' + esc(message) + "</span>";
    if (actionLabel && action) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = actionLabel;
      btn.addEventListener("click", function () {
        el.hidden = true;
        action();
      });
      el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, actionLabel ? 6000 : 3200);
  }

  function switchView(view) {
    state.view = view;
    $$(".view").forEach(function (section) {
      section.hidden = section.id !== "view-" + view;
    });
    $$(".tab").forEach(function (tab) {
      var on = tab.getAttribute("data-view") === view;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    window.scrollTo(0, 0);
  }

  function openDialog(entry) {
    state.editingId = entry ? entry.id : null;
    $("#dialogTitle").textContent = entry ? "Изменить интервал" : "Новый интервал";
    $("#fDate").value = entry ? entry.date : C.todayISO();
    $("#fStart").value = entry ? entry.start : nowParts().time;
    $("#fEnd").value = entry && entry.end ? entry.end : "";
    $("#fActivity").value = entry ? entry.activity : "";
    $("#fNote").value = entry ? entry.note : "";
    $("#formError").hidden = true;
    $("#btnDelete").hidden = !entry;
    $("#entryDialog").showModal();
    setTimeout(function () { $("#fActivity").focus(); }, 40);
  }

  function submitDialog(event) {
    event.preventDefault();
    var draft = {
      id: state.editingId,
      date: $("#fDate").value,
      start: $("#fStart").value,
      end: $("#fEnd").value || null,
      activity: $("#fActivity").value.trim(),
      note: $("#fNote").value.trim()
    };
    var error = C.validate(draft, state.entries);
    if (!error && !draft.end && draft.date < C.todayISO()) {
      error = "Незакрытый интервал можно оставить только на сегодня.";
    }
    if (error) {
      var box = $("#formError");
      box.textContent = error;
      box.hidden = false;
      return;
    }

    if (draft.id) {
      var existing = state.entries.find(function (e) { return e.id === draft.id; });
      if (existing) {
        existing.date = draft.date;
        existing.start = draft.start;
        existing.end = draft.end;
        existing.activity = draft.activity;
        existing.note = draft.note;
        existing.exportedAt = null;
      }
    } else {
      state.entries.push({
        id: uid(),
        date: draft.date,
        start: draft.start,
        end: draft.end,
        activity: draft.activity,
        note: draft.note,
        createdAt: new Date().toISOString(),
        exportedAt: null
      });
    }

    save();
    $("#entryDialog").close();
    renderAll();
    toast(draft.id ? "Интервал обновлён" : "Интервал добавлен");
  }

  function deleteEntry() {
    if (!state.editingId) return;
    if (!window.confirm("Удалить этот интервал?")) return;
    state.entries = state.entries.filter(function (e) { return e.id !== state.editingId; });
    save();
    $("#entryDialog").close();
    renderAll();
    toast("Интервал удалён");
  }

  function bind() {
    document.addEventListener("click", function (event) {
      var actionEl = event.target.closest("[data-act]");
      if (actionEl) {
        var act = actionEl.getAttribute("data-act");
        if (act === "start") {
          var ok = startEntry($("#activityInput").value, $("#noteInput") ? $("#noteInput").value : "");
          if (!ok) {
            toast("Напишите, чем занимаетесь");
            $("#activityInput").focus();
            return;
          }
          state.draftActivity = "";
          state.draftNote = "";
        } else if (act === "toggle-note") {
          var box = $(".note-box");
          box.hidden = !box.hidden;
          if (!box.hidden) $("#noteInput").focus();
        } else if (act === "stop") {
          stopActive();
        } else if (act === "switch") {
          state.switching = true;
          renderTimer();
          setTimeout(function () { var el = $("#nextActivity"); if (el) el.focus(); }, 30);
        } else if (act === "switch-cancel") {
          state.switching = false;
          renderTimer();
        } else if (act === "switch-go") {
          var input = $("#nextActivity");
          var text = input ? input.value : "";
          if (!text.trim()) {
            toast("Напишите новую деятельность");
            if (input) input.focus();
            return;
          }
          state.switching = false;
          startEntry(text, "");
        } else if (act === "edit-active") {
          openDialog(activeEntry());
        }
        return;
      }

      var entryEl = event.target.closest(".entry[data-id]");
      if (entryEl) {
        var entry = state.entries.find(function (e) { return e.id === entryEl.getAttribute("data-id"); });
        if (entry) openDialog(entry);
        return;
      }

      var modeEl = event.target.closest(".seg-btn");
      if (modeEl) {
        state.exportMode = modeEl.getAttribute("data-mode");
        renderExport();
        return;
      }

      var tabEl = event.target.closest(".tab");
      if (tabEl) switchView(tabEl.getAttribute("data-view"));
    });

    document.addEventListener("input", function (event) {
      if (event.target.id === "activityInput") state.draftActivity = event.target.value;
      if (event.target.id === "noteInput") {
        state.draftNote = event.target.value;
        var toggle = $(".note-toggle");
        if (toggle) toggle.textContent = state.draftNote ? "Примечание: " + state.draftNote : "＋ примечание";
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.target.id === "activityInput" && event.key === "Enter") {
        event.preventDefault();
        var btn = $('[data-act="start"]');
        if (btn) btn.click();
      }
      if (event.target.id === "nextActivity") {
        if (event.key === "Enter") {
          event.preventDefault();
          var go = $('[data-act="switch-go"]');
          if (go) go.click();
        } else if (event.key === "Escape") {
          state.switching = false;
          renderTimer();
        }
      }
    });

    $("#entryForm").addEventListener("submit", submitDialog);
    $("#btnDelete").addEventListener("click", deleteEntry);
    $("#dialogClose").addEventListener("click", function () { $("#entryDialog").close(); });
    $("#entryDialog").addEventListener("click", function (event) {
      if (event.target === $("#entryDialog")) $("#entryDialog").close();
    });

    $("#addManual").addEventListener("click", function () { openDialog(null); });
    $("#exportBtn").addEventListener("click", function () { exportCsv(false); });
    $("#copyBtn").addEventListener("click", copyCsv);

    $("#monthPrev").addEventListener("click", function () {
      var m = C.monthsAgo(state.journal.year, state.journal.month, -1);
      state.journal = m;
      renderJournal();
    });
    $("#monthNext").addEventListener("click", function () {
      var m = C.monthsAgo(state.journal.year, state.journal.month, 1);
      state.journal = m;
      renderJournal();
    });

    $("#backupBtn").addEventListener("click", function () {
      var text = JSON.stringify({
        app: "timing",
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: C.sortEntries(state.entries)
      }, null, 2);
      download(text, "Тайминг_копия_" + C.todayISO() + ".json", "application/json;charset=utf-8");
      toast("Копия сохранена");
    });

    $("#restoreInput").addEventListener("change", function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var list = data && data.entries;
          if (!Array.isArray(list) || !list.length) throw new Error("нет записей");
          var ok = window.confirm("Заменить текущие данные копией (" + list.length + " " +
            plural(list.length, "запись", "записи", "записей") + ")?");
          if (!ok) return;
          state.entries = list.filter(function (e) {
            return e && e.date && e.start && e.activity;
          }).map(function (e) {
            return {
              id: e.id || uid(),
              date: e.date,
              start: e.start,
              end: e.end || null,
              activity: e.activity,
              note: e.note || "",
              createdAt: e.createdAt || null,
              exportedAt: e.exportedAt || null
            };
          });
          keepSingleOpen();
          save();
          renderAll();
          toast("Данные восстановлены");
        } catch (err) {
          toast("Не удалось прочитать файл копии");
        }
      };
      reader.readAsText(file);
      event.target.value = "";
    });

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredPrompt = event;
      $("#installBtn").hidden = false;
    });

    $("#installBtn").addEventListener("click", async function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      try { await deferredPrompt.userChoice; } catch (err) { /* noop */ }
      deferredPrompt = null;
      $("#installBtn").hidden = true;
    });

    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      $("#installBtn").hidden = true;
      toast("Приложение установлено");
    });
  }

  function tick() {
    checkMidnight();
    var active = activeEntry();
    if (!active) return;
    var clock = $("#elapsed");
    if (clock) clock.textContent = C.formatClock(C.elapsedSeconds(active));
    var liveDur = $('[data-live-dur="' + active.id + '"]');
    if (liveDur) liveDur.textContent = C.formatDuration(Math.floor(C.elapsedSeconds(active) / 60));
    var today = C.todayISO();
    if (active.date === today) {
      var dayList = state.entries.filter(function (e) { return e.date === today; });
      var total = C.totalMinutes(dayList) + Math.floor(C.elapsedSeconds(active) / 60);
      $("#dayTotal").textContent = C.formatDuration(total);
    }
  }

  load();
  checkMidnight();
  bind();
  renderAll();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* offline shell unavailable */ });
    });
  }

  setInterval(tick, 1000);
})();
