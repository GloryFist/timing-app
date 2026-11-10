const assert = require("assert");
const path = require("path");
const C = require(path.join(__dirname, "..", "core.js"));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("ok - " + name);
  } catch (err) {
    console.error("FAIL - " + name);
    console.error(err.message);
    process.exitCode = 1;
  }
}

test("время туда и обратно", () => {
  assert.strictEqual(C.timeToMinutes("09:15"), 555);
  assert.strictEqual(C.minutesToTime(555), "09:15");
  assert.strictEqual(C.minutesToTime(1440), "00:00");
  assert.ok(Number.isNaN(C.timeToMinutes("25:00")));
});

test("длительность включает минуту начала, как в книге", () => {
  assert.strictEqual(C.entryMinutes({ start: "10:15", end: "10:19" }), 5);
  assert.strictEqual(C.entryMinutes({ start: "10:15", end: "10:15" }), 1);
  assert.strictEqual(C.entryMinutes({ start: "10:15", end: null }), 0);
  assert.strictEqual(C.entryMinutes({ start: "10:20", end: "10:10" }), 0);
});

test("сумма за день", () => {
  const list = [
    { start: "09:00", end: "09:59" },
    { start: "10:00", end: "10:29" }
  ];
  assert.strictEqual(C.totalMinutes(list), 60 + 30);
});

test("сортировка по дате и времени", () => {
  const list = [
    { id: "b", date: "2026-11-09", start: "12:00" },
    { id: "a", date: "2026-11-09", start: "09:00" },
    { id: "c", date: "2026-11-08", start: "18:00" }
  ];
  assert.deepStrictEqual(C.sortEntries(list).map((e) => e.id), ["c", "a", "b"]);
});

test("CSV: шапка, разделитель и экранирование", () => {
  const csv = C.toCsv([
    { date: "2026-11-09", start: "09:15", end: "09:40", activity: 'Проверка; "СП"', note: "строка\nвторая" }
  ]);
  const lines = csv.split("\r\n");
  assert.strictEqual(lines[0], "Дата;Начало;Конец;Деятельность;Примечание");
  assert.strictEqual(
    lines[1],
    '09.11.2026;09:15;09:40;"Проверка; ""СП""";"строка\nвторая"'
  );
});

test("имя файла CSV", () => {
  const name = C.csvFilename([
    { date: "2026-11-09", start: "09:00" },
    { date: "2026-11-10", start: "10:00" }
  ]);
  assert.strictEqual(name, "Тайминг_2026-11-09_2026-11-10.csv");
});

test("даты ДД.ММ.ГГГГ", () => {
  assert.strictEqual(C.dateToDMY("2026-11-09"), "09.11.2026");
  assert.strictEqual(C.parseDMY("09.11.2026"), "2026-11-09");
  assert.strictEqual(C.parseDMY("31.02.2026"), null);
});

test("проверка интервала", () => {
  assert.ok(C.validate({ date: "2026-11-09", start: "09:00", end: "10:00", activity: "" }, []));
  assert.ok(C.validate({ date: "2026-11-09", start: "10:00", end: "09:00", activity: "Тест" }, []));
  assert.strictEqual(C.validate({ date: "2026-11-09", start: "09:00", end: "10:00", activity: "Тест" }, []), "");
  const open = { id: "1", date: "2026-11-09", start: "09:00", end: null, activity: "Тест" };
  assert.ok(C.validate({ date: "2026-11-09", start: "10:00", end: null, activity: "Второй" }, [open]));
  assert.strictEqual(C.validate({ id: "1", date: "2026-11-09", start: "09:00", end: null, activity: "Тест" }, [open]), "");
});

test("формат длительности", () => {
  assert.strictEqual(C.formatDuration(0), "0 мин");
  assert.strictEqual(C.formatDuration(59), "59 мин");
  assert.strictEqual(C.formatDuration(60), "1 ч");
  assert.strictEqual(C.formatDuration(65), "1 ч 05 мин");
  assert.strictEqual(C.formatDuration(125), "2 ч 05 мин");
});

test("секунды с начала интервала", () => {
  const entry = { date: "2026-11-09", start: "09:15" };
  const now = new Date(2026, 10, 9, 10, 0, 5);
  assert.strictEqual(C.elapsedSeconds(entry, now), 45 * 60 + 5);
  assert.strictEqual(C.formatClock(45 * 60 + 5), "00:45:05");
});

test("группировка и ключ месяца", () => {
  const groups = C.groupByDate([
    { date: "2026-11-09", start: "09:00" },
    { date: "2026-11-09", start: "10:00" },
    { date: "2026-11-08", start: "10:00" }
  ]);
  assert.deepStrictEqual(Object.keys(groups), ["2026-11-08", "2026-11-09"]);
  assert.strictEqual(C.monthKey("2026-11-09"), "2026-11");
});

console.log("\n" + passed + " tests passed");
