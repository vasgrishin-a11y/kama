/* Overview forecast source toggle: the previous S&OP cycle (default) or the
   active scenario drives every overview card, chart and table; months outside
   the previous cycle's horizon stay empty in its view. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import M from "../assets/kama-model.js";

const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);
const horizons = new Map(M.scenarios.map((c) => [c.id, M.runHorizon(c)]));
const plan = (id, year) => M.forYear(horizons.get(id), year);
const bp2026 = M.runBusinessPlan(2026);
const bp = { 2026: bp2026, 2027: M.runBusinessPlan(2027, bp2026) };
const inMonths = (rows, months) => rows.filter((row) => months.includes(row.month));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const mln = (rows) => sum(rows, "revenue") / 1e6;

function browser(storage = {}) {
  const dom = new JSDOM(readFileSync(new URL("../assets/kama.html", import.meta.url), "utf8"), {
    url: "http://localhost:8080",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  for (const file of ["kama-model.js", "kama-analytics.js", "kama-orders.js", "kama-app.js"])
    w.eval(readFileSync(new URL(`../assets/${file}`, import.meta.url), "utf8"));
  return dom;
}
const change = (w, selector, value) => {
  const el = w.document.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new w.Event("change"));
};
const number = (text) => Number(text.replace(/\s/g, "").replace("−", "-").replace(",", "."));
const pressed = (d) => [...d.querySelectorAll("[data-overview-source]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.overviewSource);
const cards = (d) => [...d.querySelectorAll(".overview-kpis .kpi")].map((kpi) => ({
  label: kpi.querySelector(".kpi-label").textContent,
  value: kpi.querySelector(".kpi-value").firstChild.textContent,
  foot: kpi.querySelector(".kpi-foot").textContent,
}));
/* Landing (second row) revenue card: value and the business plan in its foot. */
const landingRevenue = (d) => {
  const card = cards(d)[3];
  return { label: card.label, value: number(card.value), bp: number(card.foot.match(/^БП ([^·]+)·/)[1]) };
};
/* Value of a chart point/bar by its tooltip, optionally inside one panel. */
const point = (d, label, panelTitle) => {
  const root = panelTitle ? [...d.querySelectorAll("#content .panel")].find((p) => p.querySelector("h2").textContent === panelTitle) : d.querySelector("#content");
  const title = [...root.querySelectorAll("svg.chart title")].find((t) => t.textContent.startsWith(`${label}: `));
  return title ? number(title.textContent.slice(label.length + 2).replace(/\s*(млн ₽|т)$/, "")) : null;
};
const monthRows = (d) => [...d.querySelectorAll("#content > section.panel:last-of-type tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.051, `${label}: ${actual} vs ${expected}`);

test("model: the previous S&OP cycle (V5, September 2026) covers September 2026 – November 2027", () => {
  assert.equal(M.previousSop.id, M.previousSopId);
  assert.equal(M.previousSopId, "balanced");
  assert.equal(M.previousSop.cycle, "Сентябрь 2026");
  assert.equal(M.previousSopCovers(2026, 7), false, "август 2026 — до прошлого цикла (факт)");
  assert.equal(M.previousSopCovers(2026, 8), true);
  assert.equal(M.previousSopCovers(2026, 11), true);
  assert.equal(M.previousSopCovers(2027, 0), true);
  assert.equal(M.previousSopCovers(2027, 10), true);
  assert.equal(M.previousSopCovers(2027, 11), false, "декабрь 2027 — вне горизонта прошлого цикла");
  /* Reported actual is shared, so the toggle changes only forecast months. */
  for (const c of M.scenarios)
    assert.equal(mln(inMonths(plan(c.id, 2026).rows, range(0, 8))), mln(inMonths(plan("balanced", 2026).rows, range(0, 8))), c.id);
});

test("UI: the previous cycle is the default; the active scenario updates cards, charts, direction chart and table", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    assert.equal(d.querySelectorAll("[data-overview-source]").length, 2);
    assert.deepEqual(pressed(d), ["previous"]);
    assert.match(d.querySelector('[data-overview-source="previous"]').textContent, /Прошлый цикл S&OP\s*V5 · сен 2026 – ноя 2027/);
    change(w, "#scenario", "margin");
    assert.deepEqual(pressed(d), ["previous"], "смена активного плана не переключает обзор");
    assert.match(d.querySelector('[data-overview-source="active"]').textContent, /Активный сценарий\s*V2 · Приоритет маржинального дохода/);
    const v5 = plan("balanced", 2026), v2 = plan("margin", 2026);
    const factBefore = cards(d).slice(0, 3).map((c) => c.value);
    let landing = landingRevenue(d);
    assert.equal(landing.label, "Выручка · факт + прогноз Янв–дек 2026");
    near(landing.value, mln(v5.rows), "прошлый цикл = V5");
    near(landing.bp, mln(bp[2026].rows), "БП года");
    near(point(d, "Дек 2026 · Ожидаемое закрытие"), mln(inMonths(v5.rows, [11])), "график выручки");
    assert.match(d.querySelector(".chart-context").textContent, /БП · факт · прошлый цикл S&OP/);
    assert.match(d.querySelector(".revenue-panel .panel-heading small").textContent, /^Прошлый цикл S&OP \(V5\) против бизнес-плана · Янв–дек 2026$/);
    let december = monthRows(d).at(-1);
    assert.equal(december[1], "Прогноз · прошлый цикл S&OP");
    near(number(december[6]), mln(inMonths(v5.rows, [11])), "таблица");
    const storedKeys = Object.keys(w.localStorage).sort();

    d.querySelector('[data-overview-source="active"]').click();
    assert.deepEqual(pressed(d), ["active"]);
    assert.equal(d.activeElement.dataset.overviewSource, "active", "фокус остаётся на переключателе");
    landing = landingRevenue(d);
    near(landing.value, mln(v2.rows), "активный сценарий = V2");
    near(landing.bp, mln(bp[2026].rows), "БП не зависит от переключателя");
    near(number(cards(d)[4].value), sum(v2.rows, "margin") / 1e6, "МД V2");
    assert.equal(number(cards(d)[5].value), Math.round(sum(v2.rows, "sales")));
    assert.deepEqual(cards(d).slice(0, 3).map((c) => c.value), factBefore, "факт одинаков в обоих режимах");
    near(point(d, "Дек 2026 · Ожидаемое закрытие"), mln(inMonths(v2.rows, [11])), "график выручки V2");
    near(point(d, "Дек 2026 · Факт / прогноз S&OP"), sum(inMonths(v2.rows, [11]), "margin") / 1e6, "график МД V2");
    assert.match(d.querySelector(".chart-context").textContent, /БП · факт · сценарий V2/);
    assert.match(d.querySelector(".revenue-panel .panel-heading small").textContent, /^V2 · Приоритет маржинального дохода против бизнес-плана/);
    const carton = mln(v2.rows.filter((row) => row.family === "Картон"));
    assert.ok(d.querySelector(".revenue-mix-chart").textContent.includes(`${carton.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} млн ₽`));
    december = monthRows(d).at(-1);
    assert.equal(december[1], "Прогноз · V2");
    near(number(december[6]), mln(inMonths(v2.rows, [11])), "таблица V2");
    assert.deepEqual(Object.keys(w.localStorage).sort(), storedKeys, "выбор не сохраняется между загрузками");

    change(w, "#family", "Бумага");
    near(landingRevenue(d).value, mln(v2.rows.filter((row) => row.family === "Бумага")), "направление");
    change(w, "#family", "all");
    change(w, "#month", "q4");
    assert.deepEqual(pressed(d), ["active"], "выбор сохраняется при смене периода");
    assert.equal(landingRevenue(d).label, "Выручка · прогноз Окт–дек 2026");
    near(landingRevenue(d).value, mln(inMonths(v2.rows, range(9, 11))), "IV квартал V2");
    assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector("#content").textContent));
  } finally {
    w.close();
  }
  const fresh = browser(), fd = fresh.window.document;
  try {
    assert.deepEqual(pressed(fd), ["previous"], "после перезагрузки снова прошлый цикл");
  } finally {
    fresh.window.close();
  }
});

test("UI: months outside the previous cycle horizon are empty; the active scenario fills them", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    d.querySelector('[data-year="2027"]').click();
    assert.deepEqual(pressed(d), ["previous"]);
    const v5 = plan("balanced", 2027), v2 = plan("margin", 2027), janNov = range(0, 10);
    let landing = landingRevenue(d);
    assert.equal(landing.label, "Выручка · прогноз Янв–ноя 2027");
    near(landing.value, mln(inMonths(v5.rows, janNov)), "прошлый цикл Янв–ноя");
    near(landing.bp, mln(inMonths(bp[2027].rows, janNov)), "БП тех же месяцев");
    for (const series of ["Прогноз S&OP", "Ожидаемое закрытие", "Факт / прогноз S&OP", "Выпуск · факт / прогноз", "Запас · факт / прогноз"]) {
      assert.equal(point(d, `Дек 2027 · ${series}`), null, series);
      assert.notEqual(point(d, `Ноя 2027 · ${series}`), null, series);
    }
    near(point(d, "Дек 2027 · Бизнес-план", "Выручка: закрытие года против бизнес-плана"), mln(inMonths(bp[2027].rows, [11])), "БП декабря остаётся");
    assert.match(d.querySelector(".revenue-panel .panel-heading small").textContent, /Янв–ноя 2027$/);
    const rows = monthRows(d);
    assert.equal(rows.length, 12);
    assert.deepEqual(rows.at(-1).slice(1), ["Нет прогноза прошлого цикла S&OP", rows.at(-1)[2], "—", "—", rows.at(-1)[5], "—", "—", rows.at(-1)[8], "—", "—"]);
    near(number(rows.at(-1)[5]), mln(inMonths(bp[2027].rows, [11])), "БП в пустой строке");

    change(w, "#month", "q4");
    assert.equal(landingRevenue(d).label, "Выручка · прогноз Окт–ноя 2027");
    change(w, "#month", "11");
    assert.deepEqual(cards(d).slice(3).map((c) => [c.value, c.foot]), Array(3).fill(["—", "Нет прогноза прошлого цикла S&OP"]));
    assert.equal(d.querySelector(".overview-empty").textContent, "Нет прогноза прошлого цикла S&OP за Дек 2027");
    assert.equal(d.querySelector(".revenue-mix-chart"), null);

    d.querySelector('[data-overview-source="active"]').click();
    landing = landingRevenue(d);
    assert.equal(landing.label, "Выручка · прогноз Дек 2027");
    near(landing.value, mln(inMonths(v5.rows, [11])), "активный план по умолчанию — V5");
    assert.equal(d.querySelector(".overview-empty"), null);
    assert.ok(d.querySelector(".revenue-mix-chart"));
    change(w, "#scenario", "margin");
    near(landingRevenue(d).value, mln(inMonths(v2.rows, [11])), "декабрь V2");
    near(point(d, "Дек 2027 · Ожидаемое закрытие"), mln(inMonths(v2.rows, [11])), "график декабря V2");
    assert.equal(monthRows(d)[0][1], "Прогноз · V2");

    d.querySelector('[data-overview-source="previous"]').click();
    for (const period of ["all", "h1", "h2", "q1", "q2", "q3", "q4", "11", "0"]) {
      change(w, "#month", period);
      assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector("#content").textContent), period);
    }
    d.querySelector('[data-year="2026"]').click();
    assert.deepEqual(pressed(d), ["previous"]);
    assert.equal(landingRevenue(d).label, "Выручка · факт + прогноз Янв–дек 2026", "2026 год прошлый цикл покрывает полностью");
  } finally {
    w.close();
  }
});
