(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TimingCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  var MONTHS_NOM = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
  ];
  var WEEKDAYS = [
    "воскресенье", "понедельник", "вторник", "среда",
    "четверг", "пятница", "суббота"
  ];

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function isoDate(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function parseISODate(s) {
    var p = String(s).split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function todayISO(now) {
    return isoDate(now || new Date());
  }

  function timeToMinutes(t) {
    if (!/^\d{1,2}:\d{2}$/.test(String(t))) return NaN;
    var p = String(t).split(":").map(Number);
    if (p[0] > 23 || p[1] > 59) return NaN;
    return p[0] * 60 + p[1];
  }

  function minutesToTime(min) {
    var m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
  }

  function entryMinutes(e) {
    if (!e || !e.end) return 0;
    var a = timeToMinutes(e.start);
    var b = timeToMinutes(e.end);
    if (isNaN(a) || isNaN(b) || b < a) return 0;
    return b - a + 1;
  }

  function isOpen(e) {
    return !!e && !e.end;
  }

  function sortEntries(list) {
    return list.slice().sort(function (a, b) {
      var ka = a.date + " " + a.start;
      var kb = b.date + " " + b.start;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  function totalMinutes(list) {
    return list.reduce(function (sum, e) {
      return sum + entryMinutes(e);
    }, 0);
  }

  function formatDuration(min) {
    var m = Math.max(0, Math.round(min));
    if (m < 60) return m + " мин";
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + " ч " + pad2(rest) + " мин" : h + " ч";
  }

  function elapsedSeconds(entry, now) {
    if (!entry) return 0;
    var d = parseISODate(entry.date);
    var t = timeToMinutes(entry.start);
    if (isNaN(t)) return 0;
    d.setHours(Math.floor(t / 60), t % 60, 0, 0);
    var diff = Math.floor(((now || new Date()).getTime() - d.getTime()) / 1000);
    return diff > 0 ? diff : 0;
  }

  function formatClock(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return pad2(h) + ":" + pad2(m) + ":" + pad2(s % 60);
  }

  function formatDateLong(iso) {
    var d = parseISODate(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }

  function formatDateShort(iso) {
    var d = parseISODate(iso);
    return d.getDate() + " " + MONTHS[d.getMonth()];
  }

  function weekdayName(iso) {
    return WEEKDAYS[parseISODate(iso).getDay()];
  }

  function formatMonth(year, month) {
    return MONTHS_NOM[month] + " " + year;
  }

  function dateToDMY(iso) {
    var p = String(iso).split("-");
    return p[2] + "." + p[1] + "." + p[0];
  }

  function parseDMY(s) {
    var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s).trim());
    if (!m) return null;
    var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[1])) return null;
    return isoDate(d);
  }

  function csvField(value) {
    var s = value == null ? "" : String(value);
    if (/[;"\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function toCsv(entries) {
    var rows = [["Дата", "Начало", "Конец", "Деятельность", "Примечание"]];
    sortEntries(entries).forEach(function (e) {
      rows.push([
        dateToDMY(e.date),
        e.start,
        e.end || "",
        e.activity || "",
        e.note || ""
      ]);
    });
    return rows.map(function (r) {
      return r.map(csvField).join(";");
    }).join("\r\n") + "\r\n";
  }

  function csvFilename(entries, now) {
    var list = sortEntries(entries);
    if (!list.length) return "Тайминг.csv";
    var first = list[0].date;
    var last = list[list.length - 1].date;
    var stamp = first === last ? first : first + "_" + last;
    if (!first) stamp = todayISO(now);
    return "Тайминг_" + stamp + ".csv";
  }

  function validate(draft, existing) {
    var activity = String(draft.activity || "").trim();
    if (!activity) return "Укажите, чем занимались.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || "")) return "Укажите дату.";
    if (isNaN(timeToMinutes(draft.start))) return "Укажите время начала.";
    if (draft.end && isNaN(timeToMinutes(draft.end))) return "Время окончания указано неверно.";
    if (draft.end && timeToMinutes(draft.end) < timeToMinutes(draft.start)) {
      return "Окончание раньше начала. Интервалы через полночь не поддерживаются.";
    }
    if (!draft.end) {
      var otherOpen = (existing || []).some(function (e) {
        return !e.end && e.id !== draft.id;
      });
      if (otherOpen) return "Уже идёт другой интервал — сначала остановите его.";
    }
    return "";
  }

  function groupByDate(entries) {
    var map = {};
    sortEntries(entries).forEach(function (e) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }

  function monthKey(iso) {
    return String(iso).slice(0, 7);
  }

  function monthsAgo(year, month, delta) {
    var d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  return {
    MONTHS: MONTHS,
    MONTHS_NOM: MONTHS_NOM,
    WEEKDAYS: WEEKDAYS,
    pad2: pad2,
    isoDate: isoDate,
    parseISODate: parseISODate,
    todayISO: todayISO,
    timeToMinutes: timeToMinutes,
    minutesToTime: minutesToTime,
    entryMinutes: entryMinutes,
    isOpen: isOpen,
    sortEntries: sortEntries,
    totalMinutes: totalMinutes,
    formatDuration: formatDuration,
    elapsedSeconds: elapsedSeconds,
    formatClock: formatClock,
    formatDateLong: formatDateLong,
    formatDateShort: formatDateShort,
    weekdayName: weekdayName,
    formatMonth: formatMonth,
    dateToDMY: dateToDMY,
    parseDMY: parseDMY,
    csvField: csvField,
    toCsv: toCsv,
    csvFilename: csvFilename,
    validate: validate,
    groupByDate: groupByDate,
    monthKey: monthKey,
    monthsAgo: monthsAgo,
    daysInMonth: daysInMonth
  };
});
