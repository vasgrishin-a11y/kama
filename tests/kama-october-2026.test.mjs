import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import M from "../assets/kama-model.js";
import A from "../assets/kama-analytics.js";
import O from "../assets/kama-orders.js";

const balanced = M.scenarios.find((scenario) => scenario.id === "balanced");
const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] || 0), 0);

function browser() {
  const dom = new JSDOM(readFileSync(new URL("../assets/kama.html", import.meta.url), "utf8"), {
    url: "http://localhost:8080",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const file of ["kama-model.js", "kama-analytics.js", "kama-orders.js", "kama-app.js"])
    w.eval(readFileSync(new URL(`../assets/${file}`, import.meta.url), "utf8"));
  return dom;
}

test("new S&OP cycle starts in October 2026 without rewriting actuals or the business plan", () => {
  const base = M.runHorizon(balanced);
  const custom = M.runHorizon(balanced, { demandScale: 1.1, periodFrom: 9, periodTo: 10 });
  const base2026 = M.forYear(base, 2026), custom2026 = M.forYear(custom, 2026);
  assert.deepEqual(
    custom2026.rows.filter((row) => row.month < 9),
    base2026.rows.filter((row) => row.month < 9),
  );
  for (const [month, ratio] of [[8, 1], [9, 1.1], [10, 1.1], [11, 1]]) {
    const before = sum(base2026.rows.filter((row) => row.month === month), "demand");
    const after = sum(custom2026.rows.filter((row) => row.month === month), "demand");
    assert.ok(Math.abs(after / before - ratio) < 1e-9, `${month}: ${after / before}`);
  }
  assert.ok(custom.checks.every((check) => check.ok), JSON.stringify(custom.checks.filter((check) => !check.ok)));
  const bp1 = M.runBusinessPlan(2026), bp2 = M.runBusinessPlan(2026);
  assert.deepEqual(bp1.rows, bp2.rows);
  assert.notDeepEqual(bp1.rows, custom2026.rows);
});

test("full cost contains every stage and reconciles with operating profit", () => {
  const result = M.forYear(M.runHorizon(balanced), 2026);
  for (const row of result.rows) {
    assert.ok(Math.abs(row.conversionCost - row.massPrepCost - row.machineCost - row.finishingCost) < 1e-6);
    assert.ok(Math.abs(row.fullCost - row.variable - row.fixedCost - row.logistics - row.holding) < 1e-6);
    assert.ok(Math.abs(row.operatingProfit - row.revenue + row.fullCost) < 1e-6);
    if (row.sales > 0) assert.ok(row.depreciationCost > 0 && row.laborCost > 0 && row.maintenanceCost > 0);
  }
});

test("extended logistics reconciles with the same S&OP ledgers", () => {
  const result = M.forYear(M.runHorizon(balanced), 2026);
  const data = A.movementData(M, result, O.customers);
  assert.equal(M.nodes.length, 7);
  assert.equal(O.customers.length, 12);
  assert.ok(Math.abs(A.sum(data.rcFlows, "qty") - sum(result.ledgers, "inbound")) < 1e-6);
  assert.ok(Math.abs(A.sum(data.customerFlows, "qty") - sum(result.ledgers, "sales")) < 1e-6);
  assert.ok(Math.abs(A.sum(data.nodeCosts, "storage") - sum(result.rows, "holding")) < 1e-5);
  assert.ok(Math.abs(A.sum(data.nodeCosts, "transport") + A.sum(data.nodeCosts, "lastMile") - sum(result.rows, "logistics")) < 1e-5);
  assert.equal(new Set(data.customerFlows.map((flow) => flow.customerId)).size, 12);
});

test("daily order ATP creates linked production and shipment schedules; selected recalc preserves fixed orders", () => {
  const result = M.forYear(M.runHorizon(balanced), 2026);
  const plan = O.planPortfolio(M, result);
  assert.equal(plan.results.length, 20);
  assert.ok(plan.summary.fromStock > 0 && plan.summary.withProduction > 0);
  assert.equal(plan.summary.shipmentQty, sum(O.orders, "qty"));
  for (const row of plan.results) {
    assert.ok(row.deliveryDate >= row.shipDate);
    assert.ok(!row.productionDate || row.shipDate > row.productionDate);
    assert.ok(!row.productionDate || row.productionQty > 0);
    assert.equal(row.lateDays, Math.max(0, O.diffDays(row.deliveryDate, row.requestedDate)));
  }
  for (const quota of plan.quotaUsage) {
    const expected = sum(plan.results.filter((row) => row.product === quota.product && row.requestedDate.startsWith(quota.month)), "qty");
    assert.ok(Math.abs(expected - quota.ordered) < 1e-9);
  }
  const ids = [O.orders[0].id, O.orders[1].id];
  const partial = O.planPortfolio(M, result, { orderIds: ids, previousResults: plan.results });
  assert.equal(partial.results.length, 20);
  for (const fixed of plan.results.filter((row) => !ids.includes(row.orderId)))
    assert.deepEqual(partial.results.find((row) => row.orderId === fixed.orderId), fixed);
  assert.ok(O.productionSchedule(partial.results).every((row) => row.date && row.machine && row.qty > 0));
});

test("October workspace renders and wires every requested dashboard workflow", () => {
  const dom = browser(), w = dom.window, d = w.document;
  try {
    assert.match(d.querySelector(".overview-kpis").textContent, /БП/);
    assert.match(d.querySelector("#content").textContent, /прошлого цикла S&OP/);
    assert.ok(d.querySelector(".revenue-mix-chart"));
    assert.equal(d.querySelector("#scenario-from").options.length, 15);
    assert.equal(d.querySelector("#scenario-from").options[0].value, "9");

    d.querySelector('[data-tab="demand"]').click();
    assert.equal(d.querySelectorAll(".client-bubble").length, 24);
    assert.equal(d.querySelectorAll(".otif-card").length, 6);
    const reviewCount = d.querySelectorAll('.client-bubble[class*="review-"]').length;
    assert.ok(reviewCount >= 3 && reviewCount <= 8, String(reviewCount));
    d.querySelector('[data-seg-review="review"]').click();
    assert.equal(d.querySelectorAll(".client-bubble:not(.dim)").length, reviewCount);
    assert.match(d.querySelector("#content").textContent, /Цель маржи/);

    d.querySelector('[data-tab="orders"]').click();
    assert.equal(d.querySelectorAll("[data-order-select]").length, 20);
    assert.ok(d.querySelectorAll(".daily-production-panel tbody tr").length > 0);
    assert.ok(d.querySelectorAll(".shipment-plan-panel tbody tr").length === 20);
    d.querySelector('[data-order-select="ЗК-261001"]').click();
    d.querySelector('[data-order-recalc="selected"]').click();
    assert.match(d.querySelector(".order-notice").textContent, /Пересчитано заказов: 1/);

    d.querySelector('[data-tab="production"]').click();
    assert.equal(d.querySelectorAll(".campaign-stage.embedded").length, 3);
    assert.equal(d.querySelector(".campaign-panel"), null);
    assert.equal(d.querySelectorAll(".cut-campaign").length, 6);
    assert.ok(!/Сквозной выход по машинам|Карта раскроя · пример/.test(d.querySelector("#content").textContent));
    d.querySelector('[data-cut-page="1"]').click();
    assert.match(d.querySelector(".cutting-plan .pager span").textContent.trim(), /^2 \//);

    d.querySelector('[data-tab="resources"]').click();
    assert.equal(d.querySelectorAll(".resource-dynamic").length, 4);
    assert.equal(d.querySelectorAll(".dual-axis-chart").length, 4);

    d.querySelector('[data-tab="network"]').click();
    assert.equal(d.querySelectorAll(".stock-mini").length, 4);
    assert.ok(!/Динамика целевого запаса/.test(d.querySelector("#content").textContent));
    d.querySelector('[data-stock-mode="value"]').click();
    assert.equal(d.querySelector('[data-stock-mode="value"]').getAttribute("aria-pressed"), "true");

    d.querySelector('[data-tab="movements"]').click();
    assert.match(d.querySelector("#content").textContent, /РЦ Санкт-Петербург/);
    assert.equal(d.querySelectorAll(".node-cost-chart .row-label").length, 7);
    assert.ok(d.querySelector('[data-search="movement-plan"]'));
    d.querySelector('[data-movement-detail="inboundDetail"][data-value="resource"]').click();
    assert.equal(d.querySelector('[data-movement-detail="inboundDetail"][data-value="resource"]').getAttribute("aria-pressed"), "true");

    d.querySelector('[data-tab="finance"]').click();
    const financeText = d.querySelector("#content").textContent;
    assert.match(financeText, /Полная себестоимость/);
    assert.match(financeText, /Массоподготовка/);
    assert.ok(!/Прочий передел/.test(financeText));
    assert.equal(d.querySelectorAll(".finance-heat tbody tr").length, 13);
    assert.equal(d.querySelectorAll(".finance-heat tbody tr:first-child .finance-heat-cell").length, 12);
    assert.ok(d.querySelector(".finance-top-chart"));
  } finally {
    w.close();
  }
});
