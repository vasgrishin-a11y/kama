import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import M from "../assets/kama-model.js";

const sum = (rows, key) =>
  rows.reduce((total, row) => total + (row[key] || 0), 0);

function browser() {
  const dom = new JSDOM(
    readFileSync(new URL("../assets/kama.html", import.meta.url), "utf8"),
    {
      url: "http://localhost:8080",
      runScripts: "outside-only",
      pretendToBeVisual: true,
    },
  );
  const w = dom.window;
  w.eval(
    readFileSync(new URL("../assets/kama-model.js", import.meta.url), "utf8"),
  );
  w.eval(
    readFileSync(new URL("../assets/kama-analytics.js", import.meta.url), "utf8"),
  );
  w.eval(
    readFileSync(new URL("../assets/kama-orders.js", import.meta.url), "utf8"),
  );
  w.eval(
    readFileSync(new URL("../assets/kama-app.js", import.meta.url), "utf8"),
  );
  return dom;
}

test("2026 actual is immutable; custom demand applies only inside the selected 2027 period", () => {
  const base = M.runHorizon(M.scenarios.find((c) => c.id === "balanced"));
  const custom = M.runHorizon(
    M.scenarios.find((c) => c.id === "balanced"),
    {
      demandScale: 1.1,
      periodFrom: 15,
      periodTo: 17,
    },
  );
  assert.equal(base.rows.length, 1728);
  assert.equal(M.forYear(base, 2026).rows.length, 864);
  assert.equal(M.forYear(base, 2027).rows.length, 864);
  assert.deepEqual(M.forYear(custom, 2026).rows, M.forYear(base, 2026).rows);
  const baseForecast = M.forYear(base, 2027);
  const customForecast = M.forYear(custom, 2027);
  for (const [month, expected] of [
    [0, 1],
    [3, 1.1],
    [4, 1.1],
    [5, 1.1],
    [6, 1],
    [11, 1],
  ]) {
    const before = sum(
      baseForecast.rows.filter((r) => r.month === month),
      "demand",
    );
    const after = sum(
      customForecast.rows.filter((r) => r.month === month),
      "demand",
    );
    assert.ok(
      Math.abs(after / before - expected) < 1e-9,
      `месяц ${month}: ${after / before}`,
    );
  }
  assert.ok(
    custom.checks.every((c) => c.ok),
    JSON.stringify(custom.checks.filter((c) => !c.ok)),
  );
});

test("advanced production, utility and logistics parameters preserve all balances", () => {
  const result = M.runHorizon(
    M.scenarios.find((c) => c.id === "balanced"),
    {
      demandScale: 1.1,
      priceScale: 1.03,
      kdmRate: 0.92,
      bdmRate: 1.05,
      kdmYield: 1.005,
      bdmYield: 0.99,
      setupScale: 1.1,
      fiberIntensity: 1.04,
      coatIntensity: 0.97,
      energyIntensity: 1.06,
      waterIntensity: 0.95,
      energyTariff: 1.12,
      waterTariff: 1.08,
      freightCost: 1.07,
      lastMileCost: 0.96,
      holdingCost: 1.04,
      target: 0.34,
      periodFrom: 12,
      periodTo: 23,
    },
  );
  assert.ok(
    result.checks.every((c) => c.ok),
    JSON.stringify(result.checks.filter((c) => !c.ok)),
  );
  assert.equal(result.utilities.length, 24);
  assert.ok(
    result.campaigns.every((c) => c.fiber > 0 && c.energy > 0 && c.water > 0),
  );
  assert.ok(
    Math.abs(sum(result.ledgers, "logistics") - sum(result.rows, "logistics")) <
      1e-5,
  );
  assert.ok(
    result.rows.every(
      (r) =>
        Math.abs(
          r.fiberCost +
            r.coatCost +
            r.energyCost +
            r.waterCost +
            r.conversionCost -
            r.variable,
        ) < 1e-6,
    ),
  );
});

test("workspace: year filters, real panel expansion, navigation and detailed production", () => {
  const dom = browser(),
    w = dom.window,
    d = w.document;
  try {
    assert.equal(d.querySelector("#cycle-tag").textContent, "2026");
    assert.equal(d.querySelector("#month").options.length, 20);
    const expand = d.querySelector("[data-expand-panel]");
    expand.click();
    assert.equal(d.querySelectorAll(".panel.is-expanded").length, 1);
    assert.ok(d.body.classList.contains("has-expanded-panel"));
    assert.equal(expand.getAttribute("aria-expanded"), "true");
    expand.click();
    assert.equal(d.querySelectorAll(".panel.is-expanded").length, 0);
    expand.click();
    d.dispatchEvent(
      new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    assert.equal(d.querySelectorAll(".panel.is-expanded").length, 0);

    d.querySelector("#nav-toggle").click();
    assert.ok(d.querySelector("#app").classList.contains("nav-collapsed"));
    d.querySelector("#nav-position").click();
    assert.ok(d.querySelector("#app").classList.contains("nav-top"));
    assert.ok(!d.querySelector("#app").classList.contains("nav-collapsed"));

    d.querySelector('[data-year="2027"]').click();
    assert.equal(
      d.querySelector("#month").options[0].textContent,
      "Весь год · 2027",
    );
    assert.match(d.querySelector("#footer-period").textContent, /2027/);
    d.querySelector('[data-tab="production"]').click();
    assert.equal(d.querySelectorAll(".heat .machine").length, 7);
    assert.equal(d.querySelectorAll(".campaign-stage").length, 3);
    assert.equal(d.querySelectorAll(".process-sankey").length, 1);
    assert.equal(d.querySelector(".campaign-panel"), null);
    assert.equal(d.querySelectorAll(".campaign-stage.embedded").length, 3);
    const headings = [...d.querySelectorAll(".stage-panel h2")].map(
      (h) => h.textContent,
    );
    assert.ok(headings.some((h) => h.includes("Массоподготовка")));
    assert.ok(headings.some((h) => h.includes("КДМ-9 и БДМ-7")));
    assert.ok(headings.some((h) => h.includes("Отделка")));
    assert.ok(
      !/NaN|undefined|Infinity/.test(d.querySelector("#content").textContent),
    );
    d.querySelector('[data-flow-mode="cost"]').click();
    assert.match(
      d.querySelector(".flow-reconciliation").textContent,
      /передел КДМ\/БДМ/,
    );
  } finally {
    w.close();
  }
});
