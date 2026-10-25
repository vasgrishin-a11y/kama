/* S&OP review 23.10.2026: overview pairs, demand accuracy, segmentation,
   order management (shipped facts, OTIF, quick filters, order filter, quotas),
   production order, resources, support shops, inventory risks, finance,
   named user scenarios. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import M from "../assets/kama-model.js";
import A from "../assets/kama-analytics.js";
import O from "../assets/kama-orders.js";

const sum = (rows, key) => rows.reduce((total, row) => total + (typeof key === "function" ? key(row) : row[key] || 0), 0);
const horizons = new Map(M.scenarios.map((c) => [c.id, M.runHorizon(c)]));
const year2026 = (id) => M.forYear(horizons.get(id), 2026);

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
  w.HTMLDialogElement.prototype.showModal ||= function () { this.open = true; };
  w.HTMLDialogElement.prototype.close ||= function () { this.open = false; };
  return dom;
}
const setPeriod = (w, value) => {
  const el = w.document.querySelector("#month");
  el.value = value;
  el.dispatchEvent(new w.Event("change"));
};
const legendNames = (root) => [...root.querySelectorAll(".legend-toggle")].map((b) => b.textContent.trim());

test("model: reported months are planned on the lag-1 forecast; gross profit reconciles to operating profit", () => {
  const r = year2026("balanced");
  const actual = r.rows.filter((row) => row.dataType === "actual");
  const planned = r.rows.filter((row) => row.dataType !== "actual");
  assert.ok(actual.some((row) => Math.abs(row.forecast - row.demand) > 1e-6), "у факта есть ошибка прогноза");
  assert.ok(planned.every((row) => Math.abs(row.forecast - row.demand) < 1e-9), "план строится на спросе без ошибки");
  const accuracy = A.forecastAccuracy(r.rows, M.forecastAccuracyTarget);
  assert.ok(accuracy.accuracy > 0.85 && accuracy.accuracy < 0.97, String(accuracy.accuracy));
  assert.deepEqual(accuracy.months, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const paper = A.forecastAccuracy(r.rows.filter((row) => row.family === "Бумага"));
  assert.ok(paper.accuracy < accuracy.accuracy, "бумага прогнозируется хуже картона");
  for (const row of [...r.rows, ...M.runBusinessPlan(2026).rows]) {
    assert.ok(Math.abs(row.revenue - row.costOfSales - row.grossProfit) < 1e-6);
    assert.ok(Math.abs(row.grossProfit - row.commercialCost - row.administrationCost - row.operatingProfit) < 1e-6);
  }
  for (const [id, horizon] of horizons) assert.ok(horizon.checks.every((c) => c.ok), id);
  const stress = year2026("stress");
  assert.ok(stress.resources.filter((x) => x.id === "fiber" && x.month >= 9).every((x) => Math.abs(x.priceIndex - 1.12) < 1e-9));
  assert.ok(stress.resources.filter((x) => x.month < 9).every((x) => x.priceIndex === 1), "факт не переоценивается сценарием");
});

test("inventory analytics: turnover above target and obsolete lots with write-off risk exist", () => {
  const r = year2026("balanced");
  const turnover = A.stockTurnover(M, r);
  const hot = turnover.flatMap((row) => row.cells.filter((cell) => cell.ratio > 1.5 && cell.month <= 8));
  assert.ok(hot.length >= 10, `ячеек выше 150% цели: ${hot.length}`);
  assert.ok(turnover.find((row) => row.product.id === "offset").cells.filter((cell) => cell.ratio > 1.5).length >= 5);
  const obsolete = A.obsoleteStock(M, r);
  const inWindow = obsolete.lots.filter((lot) => lot.inWindow);
  assert.ok(obsolete.lots.some((lot) => lot.overdue));
  assert.ok(inWindow.length >= 5 && obsolete.lots.some((lot) => !lot.inWindow));
  for (const lot of obsolete.lots) {
    assert.ok(lot.atRisk <= lot.qty && lot.atRisk >= 0);
    assert.ok(Math.abs(lot.valueAtRisk - lot.atRisk * lot.unitValue) < 1e-6 && lot.unitValue > 30000);
  }
});

test("orders: shipped facts, all OTIF × source cases in every scenario, just-in-time dates and quota overflows", () => {
  assert.equal(O.shippedOrders.length, 4);
  for (const [id] of horizons) {
    const plan = O.planPortfolio(M, year2026(id));
    const shipped = plan.results.filter((row) => row.shipped);
    assert.deepEqual(shipped.map((row) => [row.otif, row.onTime, row.inFull, Boolean(row.productionDate)]), [
      [true, true, true, false],
      [false, false, true, true],
      [false, true, false, false],
      [true, true, true, true],
    ], id);
    assert.ok(shipped.every((row) => row.status === "Отгружено" && row.deliveryDate < O.AS_OF));
    const open = plan.results.filter((row) => !row.shipped);
    for (const [otif, production] of [[true, true], [true, false], [false, true], [false, false]])
      assert.ok(open.some((row) => row.otif === otif && Boolean(row.productionDate) === production), `${id}: OTIF=${otif}, производство=${production}`);
    for (const row of open) {
      assert.ok(row.deliveryDate >= row.requestedDate, `${id} ${row.orderId}: поставка не раньше требуемой даты`);
      assert.ok(row.shipDate >= O.AS_OF);
      assert.equal(row.otif, row.lateDays === 0);
    }
    assert.equal(plan.summary.otif, plan.results.filter((row) => row.otif).length);
    assert.ok(plan.quotaUsage.some((q) => q.usage > 1), `${id}: перегруз квоты по продукту`);
    assert.ok(plan.segmentQuotaUsage.some((q) => q.usage > 1), `${id}: перегруз квоты по сегменту`);
    for (const month of ["2026-10", "2026-11", "2026-12"])
      assert.ok(Math.abs(sum(plan.quotaUsage.filter((q) => q.month === month), "ordered") - sum(plan.segmentQuotaUsage.filter((q) => q.month === month), "ordered")) < 1e-9);
    const flagged = plan.results.filter((row) => row.overQuota > 0);
    assert.ok(flagged.length >= 1 && flagged.every((row) => plan.quotaUsage.find((q) => q.product === row.product && row.requestedDate.startsWith(q.month)).usage > 1));
  }
});

test("UI: tab order, no captions/badges, period-aware overview pairs, no operating profit and no deviation curves", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    const tabs = [...d.querySelectorAll("#nav [data-tab]")].map((b) => b.dataset.tab);
    assert.deepEqual(tabs.slice(-3), ["compare", "orders", "dispatch"]);
    assert.equal(d.querySelector("#subtitle"), null);
    assert.equal(d.querySelector("#validation"), null);
    assert.ok(!/проверок/.test(d.querySelector("main").textContent));
    for (const tab of tabs) {
      d.querySelector(`[data-tab="${tab}"]`).click();
      assert.equal(d.querySelectorAll("#content .insight, #content .block-note").length, 0, tab);
    }
    d.querySelector('[data-tab="overview"]').click();
    const labels = () => [...d.querySelectorAll(".overview-kpis .kpi-label")].map((x) => x.textContent);
    assert.deepEqual(labels(), [
      "Выручка · факт Янв–сен 2026", "МД · факт Янв–сен 2026", "Отгрузки · факт Янв–сен 2026",
      "Выручка · факт + прогноз Янв–дек 2026", "МД · факт + прогноз Янв–дек 2026", "Отгрузки · факт + прогноз Янв–дек 2026",
    ]);
    assert.ok(!/Опер\. прибыль|Операционная/.test(d.querySelector(".overview-kpis").textContent));
    assert.ok(!legendNames(d).some((name) => /Отклонение/.test(name)));
    const r = year2026("balanced");
    const factRevenue = sum(r.rows.filter((row) => row.month >= 6 && row.month <= 8), "revenue") / 1e6;
    setPeriod(w, "h2");
    assert.deepEqual(labels().slice(0, 4), ["Выручка · факт Июл–сен 2026", "МД · факт Июл–сен 2026", "Отгрузки · факт Июл–сен 2026", "Выручка · факт + прогноз Июл–дек 2026"]);
    const shown = Number(d.querySelector(".overview-kpis .kpi-value").firstChild.textContent.replace(/\s/g, "").replace(",", "."));
    assert.ok(Math.abs(shown - factRevenue) < 0.06, `${shown} vs ${factRevenue}`);
    setPeriod(w, "q4");
    assert.match(d.querySelector(".overview-kpis .kpi").textContent, /Нет закрытых месяцев/);
    assert.equal(labels()[3], "Выручка · прогноз Окт–дек 2026");
    setPeriod(w, "q1");
    assert.equal(labels()[3], "Выручка · факт Янв–мар 2026");
    d.querySelector('[data-year="2027"]').click();
    assert.match(d.querySelector(".overview-kpis").textContent, /Нет закрытых месяцев/);
    assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector("#content").textContent));
  } finally {
    w.close();
  }
});

test("UI: demand accuracy card, segmentation ordered by gross profit with OTIF fact vs target", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    d.querySelector('[data-tab="demand"]').click();
    const kpiText = d.querySelector(".kpis").textContent;
    assert.ok(!/Клиентов на пересмотр/.test(kpiText));
    assert.match(kpiText, /Точность прогноза/);
    assert.match(kpiText, /Цель 90,0%/);
    const bands = [...d.querySelectorAll(".segment-band")];
    assert.equal(bands.length, 6);
    const gross = bands.map((band) => Number(band.querySelector(".segment-band-head span").textContent.match(/валовая прибыль ([\d\s ,]+) млн/)[1].replace(/[\s ]/g, "").replace(",", ".")));
    assert.deepEqual([...gross].sort((x, y) => y - x), gross);
    for (const band of bands) assert.match(band.querySelector(".segment-otif").textContent, /OTIF[\d,]+%цель [\d,]+% · [+−-]?[\d,]+ п\.п\./);
    const sizes = [...d.querySelectorAll(".client-bubble")].map((b) => Number(b.style.getPropertyValue("--bubble").replace("px", "")));
    assert.equal(sizes.length, 24);
    assert.ok(Math.min(...sizes) >= 92 && Math.max(...sizes) <= 150);
    setPeriod(w, "q4");
    assert.match(d.querySelector(".kpis").textContent, /последний факт/);
  } finally {
    w.close();
  }
});

test("UI: quota rows expand to their matching order table and explain the last-mile dispatch location", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    d.querySelector('[data-tab="orders"]').click();
    const quotaPanel = d.querySelector(".quota-panel");
    const portfolioPanel = d.querySelector(".orders-portfolio-panel");
    assert.ok(quotaPanel.compareDocumentPosition(portfolioPanel) & w.Node.DOCUMENT_POSITION_FOLLOWING, "график квот расположен перед портфелем");
    assert.ok(d.querySelectorAll(".quota-entry").length > 0);
    assert.equal(d.querySelectorAll(".quota-entry[open]").length, 0, "по умолчанию списки заказов закрыты");
    assert.equal(quotaPanel.querySelectorAll(".quota-entry[open] .order-table").length, 0);

    const plan = O.planPortfolio(M, year2026("balanced"));
    const entry = [...d.querySelectorAll(".quota-entry")].find((item) => {
      const [view, month, ...keyParts] = item.dataset.quotaEntry.split("|");
      const key = keyParts.join("|");
      const rows = view === "segment" ? plan.segmentQuotaUsage : plan.quotaUsage;
      const quota = rows.find((row) => row.month === month && row.key === key);
      return quota?.orders.some((order) => !plan.results.find((result) => result.orderId === order.id)?.shipped);
    });
    assert.ok(entry, "есть строка квоты с открытыми заказами");
    const [view, month, ...keyParts] = entry.dataset.quotaEntry.split("|");
    const rows = view === "segment" ? plan.segmentQuotaUsage : plan.quotaUsage;
    const quota = rows.find((row) => row.month === month && row.key === keyParts.join("|"));
    entry.querySelector("summary").click();
    assert.equal(entry.open, true, "клик по строке раскрывает заказы под ней");

    const detailTable = entry.querySelector(".order-table-details");
    const detailIds = [...detailTable.querySelectorAll("tbody tr td:nth-child(2) b")].map((cell) => cell.textContent);
    assert.deepEqual(detailIds, quota.orders.map((order) => order.id), "в раскрытии только заказы выбранного продукта/сегмента и месяца");
    const mainTable = d.querySelector(".order-table-main");
    const mainHeaders = [...mainTable.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const detailHeaders = [...detailTable.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    assert.ok(mainHeaders.includes("Место отгрузки клиенту"));
    assert.deepEqual(detailHeaders.slice(1), mainHeaders.slice(1), "раскрытие использует формат портфельной таблицы");
    const firstResult = plan.results.find((result) => result.orderId === detailIds[0]);
    const expectedLocation = firstResult.sourceNode === "plant" ? "Склад ГП завода" : M.nodes.find((node) => node.id === firstResult.sourceNode).name;
    assert.equal(detailTable.querySelector("tbody tr td:nth-child(8)").textContent, expectedLocation, "показывается место отгрузки последней мили");

    const selectable = detailTable.querySelector("[data-order-select]");
    assert.ok(selectable);
    selectable.checked = true;
    selectable.dispatchEvent(new w.Event("change", { bubbles: true }));
    const restored = [...d.querySelectorAll(".quota-entry")].find((item) => item.dataset.quotaEntry === entry.dataset.quotaEntry);
    assert.equal(restored.open, true, "список остается раскрытым после выбора заказа и перерисовки");
  } finally {
    w.close();
  }
});

test("UI: orders — OTIF card, quick filters, order-number filter scoped to the section, shipped facts in every table, quota views", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    d.querySelector('[data-tab="orders"]').click();
    const plan = O.planPortfolio(M, year2026("balanced"));
    const kpiValue = (label) => [...d.querySelectorAll(".kpi")].find((k) => k.querySelector(".kpi-label").textContent === label).querySelector(".kpi-value").firstChild.textContent;
    assert.equal(kpiValue("OTIF"), `${(plan.summary.otifRate * 100).toFixed(1).replace(".", ",")}`);
    assert.equal(d.querySelectorAll(".order-table-main tbody tr").length, O.orders.length);
    assert.equal(d.querySelectorAll(".order-table-main .order-shipped").length, 4);
    assert.ok([...d.querySelectorAll(".daily-production-panel tbody tr")].some((tr) => /Выполнено/.test(tr.textContent)));
    assert.equal([...d.querySelectorAll(".shipment-plan-panel tbody tr")].filter((tr) => /Отгружено/.test(tr.textContent)).length, 4);
    const rows = () => [...d.querySelectorAll(".order-table-main tbody tr td:nth-child(2) b")].map((b) => b.textContent);
    d.querySelector('[data-order-quick="otif"]').click();
    assert.equal(rows().length, plan.summary.otif);
    assert.ok([...d.querySelectorAll(".order-table-main .otif-badge")].every((b) => b.textContent === "OTIF"));
    d.querySelector('[data-order-source="prod"]').click();
    const otifProd = plan.results.filter((x) => x.otif && x.productionDate).map((x) => x.orderId);
    assert.deepEqual(rows(), otifProd);
    d.querySelector('[data-order-quick="not"]').click();
    d.querySelector('[data-order-source="stock"]').click();
    assert.deepEqual(rows(), plan.results.filter((x) => !x.otif && !x.productionDate).map((x) => x.orderId));
    assert.ok(rows().includes("ЗК-260998"), "частичная отгрузка — Not OTIF из запаса");
    d.querySelector('[data-order-quick="all"]').click();
    const kpisBefore = d.querySelector(".kpis").textContent;
    d.querySelectorAll(".order-picker-list input").forEach((input) => (input.checked = ["ЗК-261011", "ЗК-261014"].includes(input.value)));
    d.querySelector("[data-order-filter-apply]").click();
    assert.deepEqual(rows(), ["ЗК-261011", "ЗК-261014"]);
    assert.equal(d.querySelectorAll(".order-chip").length, 2);
    assert.equal(d.querySelector(".kpis").textContent, kpisBefore, "фильтр по номерам не меняет карточки");
    assert.equal(d.querySelectorAll(".shipment-plan-panel tbody tr").length, 2);
    const selectedQuota = [...d.querySelectorAll(".quota-entry")].find((entry) => {
      const [view, month, ...keyParts] = entry.dataset.quotaEntry.split("|");
      const quotas = view === "segment" ? plan.segmentQuotaUsage : plan.quotaUsage;
      return quotas.find((q) => q.month === month && q.key === keyParts.join("|"))?.orders.some((order) => ["ЗК-261011", "ЗК-261014"].includes(order.id));
    });
    assert.ok(selectedQuota);
    if (!selectedQuota.open) selectedQuota.querySelector("summary").click();
    const expandedIds = [...selectedQuota.querySelectorAll(".order-table-details tbody tr td:nth-child(2) b")].map((b) => b.textContent);
    assert.ok(expandedIds.length > 0 && expandedIds.every((id) => ["ЗК-261011", "ЗК-261014"].includes(id)), "раскрытие учитывает фильтр заказов раздела");
    assert.ok(d.querySelector(".quota-selected"));
    d.querySelector('[data-tab="demand"]').click();
    assert.equal(d.querySelectorAll(".client-bubble").length, 24, "другие разделы фильтр не затрагивает");
    d.querySelector('[data-tab="orders"]').click();
    assert.equal(d.querySelectorAll(".order-table-main tbody tr").length, 2, "фильтр сохраняется в разделе");
    d.querySelector('[data-order-chip="ЗК-261011"]').click();
    assert.deepEqual(rows(), ["ЗК-261014"]);
    d.querySelector("[data-order-filter-clear]").click();
    assert.equal(rows().length, O.orders.length);
    assert.ok(d.querySelectorAll(".quota-row.over").length >= 1);
    d.querySelector('[data-quota-view="segment"]').click();
    assert.ok(d.querySelectorAll(".quota-row.over").length >= 1);
    assert.ok([...d.querySelectorAll(".quota-row b")].some((b) => b.textContent === "Дистрибьюторы"));
    assert.ok(!/NaN|undefined|Infinity/.test(d.querySelector("#content").textContent));
  } finally {
    w.close();
  }
});

test("UI: production, resources, support shops, inventory and finance follow the review", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    d.querySelector('[data-tab="production"]').click();
    const stage3 = [...d.querySelectorAll(".stage-panel")].find((panel) => /Отделка/.test(panel.querySelector("h2").textContent));
    const html = stage3.innerHTML;
    assert.ok(html.indexOf("Последовательность кампаний · Отделка") < html.indexOf("План раскроя по каждой кампании"));
    const card = d.querySelector(".cut-campaign");
    const patterns = [...card.querySelectorAll(".cut-map-meta b")].map((b) => b.textContent);
    assert.equal(new Set(patterns).size, patterns.length, "одинаковые схемы сгруппированы");

    d.querySelector('[data-tab="resources"]').click();
    const first = d.querySelector(".resource-dynamic");
    assert.deepEqual(legendNames(first), ["БП", "Факт", "План S&OP", "Месячное ограничение снабжения"]);
    assert.ok(!/Целевое значение/.test(d.querySelector("#content").textContent));
    d.querySelector('[data-resource-mode="fiber"][data-value="cost"]').click();
    assert.deepEqual(legendNames(d.querySelector(".resource-dynamic")), ["БП", "Факт", "План S&OP"]);
    assert.equal(d.querySelectorAll('[data-value="volume"][aria-pressed="true"][data-resource-mode]').length, 3);

    d.querySelector('[data-tab="capacity"]').click();
    const unit = d.querySelector(".utility-unit-panel");
    const headers = [...unit.querySelectorAll("th")].map((th) => th.textContent);
    assert.deepEqual(headers, ["Показатель", "Ед.", "План S&OP", "БП", "Δ к БП", "Лимит / норматив", "Δ к лимиту / нормативу", "Статус"]);
    assert.ok(unit.querySelectorAll("tbody tr").length >= 8);
    assert.match(unit.textContent, /Выше норматива/);
    assert.match(unit.textContent, /лимит снабжения/);

    d.querySelector('[data-tab="network"]').click();
    assert.ok(d.querySelectorAll(".turn-heat .turn-cell.hot").length >= 10);
    assert.ok(d.querySelector(".obsolete-panel svg.obsolete-chart"));
    assert.equal(d.querySelectorAll(".obsolete-panel tbody tr").length, A.obsoleteLots.length);
    assert.match(d.querySelector(".kpis").textContent, /Неликвиды · риск списания/);
    const stockLegends = legendNames(d.querySelector(".stock-mini"));
    assert.deepEqual(stockLegends, ["Факт", "План S&OP", "Цель"]);

    d.querySelector('[data-tab="finance"]').click();
    const top = d.querySelector(".finance-top-chart");
    const names = legendNames(top);
    assert.ok(!names.some((name) => /Δ/.test(name)));
    for (const metric of ["Выручка", "Себестоимость", "МД"])
      for (const kind of ["БП", "факт", "план S&OP"]) assert.ok(names.includes(`${metric} · ${kind}`), `${metric} · ${kind}`);
    assert.match(d.querySelector(".waterfall-panel").textContent, /Валовая прибыль/);
    assert.equal(d.querySelector(".waterfall-panel").closest(".grid"), null);
    assert.equal(d.querySelector(".cost-structure-panel").closest(".grid"), null);
    const r = year2026("balanced");
    const gp = sum(r.rows, "grossProfit") / 1e6;
    assert.match(d.querySelector(".waterfall-panel").textContent, new RegExp(gp.toFixed(1).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "[\\s ]")));
  } finally {
    w.close();
  }
});

test("UI: named user scenarios — name required, several copies, separate deletion, legacy storage migrated", () => {
  const legacy = JSON.stringify({ base: "stress", params: { demandScale: 1.05, periodFrom: 9, periodTo: 23 } });
  const dom = browser({ kama_sop_custom_v1: legacy }), w = dom.window, d = w.document;
  try {
    assert.equal(w.localStorage.getItem("kama_sop_custom_v1"), null, "старая копия перенесена");
    assert.equal(JSON.parse(w.localStorage.getItem("kama_sop_customs_v2")).length, 1);
    assert.ok(!d.querySelector("#delete-scenarios").disabled);
    const submit = () => d.querySelector("#editor-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    d.querySelector("#edit").click();
    d.querySelector("#scenario-name").value = " ";
    submit();
    assert.match(d.querySelector("#editor-error").textContent, /Введите название/);
    d.querySelector("#scenario-name").value = "V5 · Сбалансированный план";
    submit();
    assert.match(d.querySelector("#editor-error").textContent, /штатной версией/);
    d.querySelector("#scenario-name").value = "Рост Pharma";
    d.querySelector("#demand-input").value = "108";
    submit();
    assert.equal(d.querySelector("#scenario option:checked").textContent, "Рост Pharma");
    d.querySelector("#edit").click();
    assert.equal(d.querySelector("#scenario-name").value, "Рост Pharma");
    assert.match(d.querySelector("#editor-submit").textContent, /Сохранить/);
    d.querySelector("#scenario-name").value = "Дорогое волокно";
    d.querySelector("#cost-input").value = "125";
    submit();
    const stored = JSON.parse(w.localStorage.getItem("kama_sop_customs_v2"));
    assert.deepEqual(stored.map((s) => s.name), ["V6 · Пользовательский сценарий", "Рост Pharma", "Дорогое волокно"]);
    assert.equal(new Set(stored.map((s) => s.id)).size, 3);
    assert.equal(d.querySelectorAll('#scenario optgroup[label="Пользовательские сценарии"] option').length, 3);
    d.querySelector("#edit").click();
    d.querySelector("#scenario-name").value = "Рост Pharma";
    submit();
    assert.match(d.querySelector("#editor-error").textContent, /уже есть/);
    d.querySelector("#editor").close();
    d.querySelector("#delete-scenarios").click();
    assert.equal(d.querySelectorAll("#manager-list .manager-row").length, 3);
    const active = d.querySelector("#scenario").value;
    d.querySelector(`[data-manager-delete="${active}"]`).click();
    assert.equal(d.querySelector("#scenario").value, "balanced", "удалён активный — переключение на V5");
    assert.deepEqual(JSON.parse(w.localStorage.getItem("kama_sop_customs_v2")).map((s) => s.name), ["V6 · Пользовательский сценарий", "Рост Pharma"]);
    d.querySelector("#manager-delete-all").click();
    assert.equal(JSON.parse(w.localStorage.getItem("kama_sop_customs_v2")).length, 0);
    assert.ok(d.querySelector("#delete-scenarios").disabled);
    assert.equal(d.querySelectorAll("#scenario option").length, 5);
    assert.equal(d.querySelectorAll("#editor .param-help").length, 33, "каждый параметр и название описаны");
  } finally {
    w.close();
  }
});
