/* Browser presentation: no network requests, DB connections or external assets. */
(function () {
  "use strict";
  const M = window.KamaModel,
    $ = (s) => document.querySelector(s),
    S = M.sum,
    fmt = (v, d = 0) =>
      Number(v).toLocaleString("ru-RU", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      }),
    money = (v) => fmt(v / 1e6, 1),
    pct = (v) => fmt(v * 100, 1) + "%",
    esc = (v) =>
      String(v).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      ),
    product = (id) => M.products.find((p) => p.id === id),
    sku = (id) => M.skus.find((s) => s.id === id);
  const tabs = [
    [
      "overview",
      "◫",
      "Обзор плана",
      "Согласованный взгляд на спрос, производство и экономику.",
    ],
    [
      "demand",
      "◴",
      "Спрос и продажи",
      "Спрос и отгрузки по всему ассортименту и сегментам покупателей.",
    ],
    [
      "production",
      "▤",
      "Производство и раскрой",
      "Кампании по марке и граммажу, переходы и схемы резки полотна.",
    ],
    [
      "resources",
      "◇",
      "Сырьё и ресурсы",
      "Снабжение и обеспеченность производственного плана.",
    ],
    [
      "capacity",
      "▥",
      "Обеспечивающие цеха",
      "Загрузка энергоцеха, ТМЦ и ЦОС по месяцам.",
    ],
    ["network", "⌘", "Запасы", "Запасы и складская аналитика по сети."],
    [
      "movements",
      "⇄",
      "План перемещений",
      "План потоков между заводом, РЦ, клиентами и складами 3PL.",
    ],
    [
      "finance",
      "₽",
      "Экономика плана",
      "Маржинальный доход после переменных затрат, логистики и хранения.",
    ],
    [
      "compare",
      "⇄",
      "Сравнение версий",
      "Последствия плановых решений на едином 12-месячном горизонте.",
    ],
  ];
  let year = 2026;
  const horizonResults = new Map(
    M.scenarios.map((c) => [c.id, M.runHorizon(c)]),
  );
  let results = new Map(
    [...horizonResults].map(([id, r]) => [id, M.forYear(r, year)]),
  );
  let active = "balanced",
    tab = "overview",
    month = "all",
    family = "all",
    a = "base",
    b = "balanced",
    fromMonth = 0,
    toMonth = 11,
    flowMode = "volume",
    panelCounter = 0,
    expandedPanel = null;
  const pages = {};
  let custom = null;
  try {
    const stored = JSON.parse(localStorage.getItem("kama_sop_custom_v1"));
    if (stored && M.scenarios.some((c) => c.id === stored.base)) {
      custom = stored;
      const horizon = M.runHorizon(
        {
          ...M.scenarios.find((c) => c.id === stored.base),
          id: "custom",
          name: "V6 · Пользовательский сценарий",
        },
        stored.params,
      );
      horizonResults.set("custom", horizon);
      results.set("custom", M.forYear(horizon, year));
    }
  } catch (e) {
    /* Storage is optional. */
  }
  const auxiliaryUnits = [
    {
      id: "МП-1",
      name: "МП-1 · масса картона",
      stage: "Массоподготовка",
      family: "Картон",
      source: "gross",
      rate: 42,
    },
    {
      id: "МП-2",
      name: "МП-2 · масса бумаги",
      stage: "Массоподготовка",
      family: "Бумага",
      source: "gross",
      rate: 18,
    },
    {
      id: "ПРС-1",
      name: "ПРС-1 · резка картона",
      stage: "Отделка",
      family: "Картон",
      source: "good",
      rate: 40,
    },
    {
      id: "ПРС-2",
      name: "ПРС-2 · резка бумаги",
      stage: "Отделка",
      family: "Бумага",
      source: "good",
      rate: 16,
    },
    {
      id: "УП-1",
      name: "УП-1 · упаковка",
      stage: "Отделка",
      family: "all",
      source: "good",
      rate: 55,
    },
  ];

  /* Auxiliary operations are reconciled with the same campaigns as KDM/BDM.
     They expose bottlenecks instead of silently consuming duplicate tonnage. */
  function unitOperations(r) {
    const capacities = r.capacities.map((c) => ({
      ...c,
      name: c.machine,
      stage: "КДМ / БДМ",
      family: c.machine === "КДМ-9" ? "Картон" : "Бумага",
    }));
    const campaigns = r.campaigns.map((c) => ({
      ...c,
      name: c.machine,
      stage: "КДМ / БДМ",
    }));
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (const unit of auxiliaryUnits) {
      for (let m = 0; m < 12; m++) {
        const source = r.campaigns.filter(
          (c) =>
            c.month === m &&
            (unit.family === "all" ||
              product(c.product).family === unit.family),
        );
        const calendar = days[m] * 24;
        const repair = m === 5 ? 24 : 8;
        const available = calendar - repair;
        let elapsed = 0,
          setupTotal = 0,
          runTotal = 0;
        source.forEach((c, index) => {
          const setup = index ? Math.min(1.2, c.setup * 0.25) : 0.5;
          const run = c[unit.source] / unit.rate;
          const begin = elapsed;
          elapsed += setup + run;
          setupTotal += setup;
          runTotal += run;
          campaigns.push({
            ...c,
            id: `${unit.id}-${c.id}`,
            machine: unit.id,
            name: unit.name,
            stage: unit.stage,
            start: begin,
            end: elapsed,
            setup,
            run,
          });
        });
        capacities.push({
          month: m,
          machine: unit.id,
          name: unit.name,
          stage: unit.stage,
          family: unit.family,
          calendar,
          repair,
          available,
          setup: setupTotal,
          run: runTotal,
          used: elapsed,
          load: elapsed / available,
        });
      }
    }
    return { capacities, campaigns };
  }

  const eligible = (r) =>
    r.month >= fromMonth &&
    r.month <= toMonth &&
    (family === "all" ||
      (r.family || product(r.product || sku(r.sku)?.product)?.family) ===
        family);
  const rowFilter = (r) => r.filter(eligible),
    capFilter = (r) =>
      r.filter(
        (c) =>
          c.month >= fromMonth &&
          c.month <= toMonth &&
          (family === "all" ||
            c.machine === (family === "Картон" ? "КДМ-9" : "БДМ-7")),
      );
  const totals = (r) => {
    const rows = rowFilter(r.rows);
    return {
      rows,
      demand: S(rows, "demand"),
      sales: S(rows, "sales"),
      production: S(rows, "production"),
      revenue: S(rows, "revenue"),
      margin: S(rows, "margin"),
      variable: S(rows, "variable"),
      logistics: S(rows, "logistics"),
      holding: S(rows, "holding"),
      gap: S(rows, "gap"),
      end: S(
        rows.filter((x) => x.month === toMonth),
        "end",
      ),
      start: S(
        rows.filter((x) => x.month === fromMonth),
        "start",
      ),
      coverage: S(rows, "demand") ? S(rows, "sales") / S(rows, "demand") : 0,
    };
  };
  function options(selected) {
    return [...results]
      .map(
        ([id, r]) =>
          `<option value="${id}" ${id === selected ? "selected" : ""}>${esc(r.config.name)}</option>`,
      )
      .join("");
  }
  function kpi(label, value, unit, foot, accent = false) {
    return `<div class="kpi ${accent ? "accent" : ""}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}<span class="kpi-unit">${unit}</span></div><div class="kpi-foot">${foot}</div></div>`;
  }
  function panel(title, sub, body, className = "") {
    const id = `panel-${++panelCounter}`;
    const hasChart =
      body.includes('class="chart"') || body.includes('class="process-sankey"');
    return `<section class="panel ${hasChart ? "chart-panel" : ""} ${className}" id="${id}"><div class="panel-head"><div class="panel-heading"><h2>${title}</h2><small>${sub}</small></div><button class="panel-toggle" type="button" data-expand-panel="${id}" aria-expanded="false" aria-controls="${id}-body" aria-label="Развернуть: ${esc(title)}" title="Развернуть почти на весь дашборд"><span class="expand-icon" aria-hidden="true">⛶</span><span>Развернуть</span></button></div><div class="panel-body" id="${id}-body">${body}</div></section>`;
  }
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Нет строк для выбранных фильтров</td></tr>`}</tbody></table></div>`;
  }
  function paged(id, headers, rows) {
    const state = pages[id] || { page: 0, search: "" };
    pages[id] = state;
    const filtered = rows.filter((r) =>
      r.join(" ").toLowerCase().includes(state.search.toLowerCase()),
    );
    const count = Math.max(1, Math.ceil(filtered.length / 24));
    state.page = Math.min(state.page, count - 1);
    return `<div class="table-tools"><span>${fmt(filtered.length)} строк · по 24 на странице</span><input data-search="${id}" aria-label="Поиск в таблице ${id}" placeholder="Поиск по таблице…" value="${esc(state.search)}"></div>${table(headers, filtered.slice(state.page * 24, (state.page + 1) * 24))}<div class="pager"><button class="button" data-page="${id}" data-step="-1" ${state.page === 0 ? "disabled" : ""}>← Назад</button><span>${state.page + 1} / ${count}</span><button class="button" data-page="${id}" data-step="1" ${state.page === count - 1 ? "disabled" : ""}>Далее →</button></div>`;
  }
  function monthly(r, key) {
    return M.months.map((_, m) =>
      S(
        r.rows.filter(
          (x) => x.month === m && (family === "all" || x.family === family),
        ),
        key,
      ),
    );
  }
  function chart(title, series, unit = "т", options = {}) {
    const w = 720,
      h = 280,
      left = 58,
      right = 20,
      top = 20,
      bottom = 40;
    const values = series.flatMap((s) => s.values).filter(Number.isFinite);
    let min = Math.min(0, ...values),
      max = Math.max(0, ...values);
    if (max === min) max = min + 1;
    if (max > 0) max *= 1.08;
    if (min < 0) min *= 1.08;
    const plotW = w - left - right,
      plotH = h - top - bottom;
    const y = (v) => top + ((max - v) / (max - min)) * plotH;
    const zeroY = y(0);
    const axis = (v) =>
      Math.abs(v) >= 1000
        ? `${fmt(v / 1000, 1)}к`
        : fmt(v, Math.abs(v) < 10 ? 1 : 0);
    let svg = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}. ${esc(unit)}</title>`;
    for (let i = 0; i <= 4; i++) {
      const value = max - ((max - min) * i) / 4;
      const gy = top + (plotH * i) / 4;
      svg += `<line x1="${left}" x2="${w - right}" y1="${gy}" y2="${gy}" stroke="#e8edf1"/><text x="${left - 9}" y="${gy + 4}" text-anchor="end">${axis(value)}</text>`;
    }
    if (min < 0)
      svg += `<line x1="${left}" x2="${w - right}" y1="${zeroY}" y2="${zeroY}" stroke="#9eabb9" stroke-width="1.2"/>`;
    if (year === 2026 && !options.compare) {
      const splitX = left + (9 * plotW) / 12;
      svg += `<line x1="${splitX}" x2="${splitX}" y1="${top}" y2="${top + plotH}" stroke="#aab4c4" stroke-dasharray="3 4"/><text x="${splitX + 5}" y="${top + 10}" class="chart-note">актуализация</text>`;
    }
    const bars = series.filter((s) => !s.line);
    series.forEach((s, j) => {
      svg += `<g class="chart-series" data-series="${j}">`;
      if (s.line) {
        const points = s.values
          .map((v, i) => `${left + ((i + 0.5) * plotW) / 12},${y(v)}`)
          .join(" ");
        svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2.4" stroke-dasharray="${s.dashed === false ? "0" : "6 4"}" points="${points}"/>`;
        s.values.forEach((v, i) => {
          svg += `<circle cx="${left + ((i + 0.5) * plotW) / 12}" cy="${y(v)}" r="3" fill="${s.color}"><title>${M.months[i]} ${s.seriesYear || year} · ${esc(s.name)}: ${fmt(v, 1)} ${unit}</title></circle>`;
        });
      } else {
        const barIndex = bars.indexOf(s);
        const groupW = (plotW / 12) * 0.74;
        const bw = groupW / Math.max(1, bars.length);
        s.values.forEach((v, i) => {
          const x =
            left + (i * plotW) / 12 + (plotW / 12 - groupW) / 2 + barIndex * bw;
          const outside = i < fromMonth || i > toMonth;
          const estimate =
            (options.compare ? s.seriesYear === 2026 : year === 2026) && i >= 9;
          const opacity = outside ? 0.16 : estimate ? 0.68 : 1;
          svg += `<rect x="${x}" y="${Math.min(y(v), zeroY)}" width="${Math.max(2, bw - 2)}" height="${Math.max(0.5, Math.abs(y(v) - zeroY))}" rx="2.5" fill="${s.color}" opacity="${opacity}"><title>${M.months[i]} ${s.seriesYear || year} · ${esc(s.name)}: ${fmt(v, 1)} ${unit}</title></rect>`;
        });
      }
      svg += "</g>";
    });
    M.months.forEach((m, i) => {
      svg += `<text x="${left + ((i + 0.5) * plotW) / 12}" y="${h - 12}" text-anchor="middle">${m}</text>`;
    });
    svg += "</svg>";
    const context =
      options.context ||
      (year === 2026 ? "Янв–сен факт · Окт–дек актуализация" : "Прогноз 2027");
    return `<div class="chart-block"><div class="legend">${series.map((s, i) => `<button type="button" class="legend-toggle" data-legend="${i}" aria-pressed="true"><i style="background:${s.color}"></i>${s.name}</button>`).join("")}<span class="chart-context">${context} · ${unit}</span></div><div class="chart-scroll">${svg}</div></div>`;
  }

  function horizontalChart(title, items, unit = "", digits = 1) {
    const w = 720,
      left = 225,
      right = 82,
      rowH = 40,
      top = 12;
    const h = Math.max(250, top + items.length * rowH + 24);
    const values = items.map((d) => Number(d.value) || 0);
    let min = Math.min(0, ...values),
      max = Math.max(0, ...values);
    if (max === min) max = min + 1;
    const plotW = w - left - right;
    const x = (v) => left + ((v - min) / (max - min)) * plotW;
    let svg = `<svg class="chart horizontal-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`;
    items.forEach((d, i) => {
      const cy = top + i * rowH + 14;
      const value = Number(d.value) || 0;
      const label =
        String(d.name).length > 31 ? `${String(d.name).slice(0, 30)}…` : d.name;
      svg += `<text x="${left - 12}" y="${cy + 5}" text-anchor="end" class="row-label">${esc(label)}</text><rect x="${left}" y="${cy - 4}" width="${plotW}" height="20" rx="5" fill="#f1f4f8"/><rect x="${Math.min(x(0), x(value))}" y="${cy - 4}" width="${Math.max(2, Math.abs(x(value) - x(0)))}" height="20" rx="5" fill="${d.color || (value < 0 ? "#c65562" : "#4769ff")}"><title>${esc(d.name)}: ${fmt(value, digits)} ${unit}</title></rect><text x="${w - 8}" y="${cy + 5}" text-anchor="end" class="value">${fmt(value, digits)}${unit === "%" ? "%" : ""}</text>`;
    });
    svg += "</svg>";
    return `<div class="chart-block"><div class="chart-scroll">${svg}</div>${unit && unit !== "%" ? `<div class="axis-unit">Единицы: ${unit}</div>` : ""}</div>`;
  }

  function monthlyTable(r) {
    const rows = M.months
      .map((name, m) => {
        const rr = r.rows.filter(
          (x) => x.month === m && (family === "all" || x.family === family),
        );
        return [
          `${name} ${year}`,
          fmt(S(rr, "demand")),
          fmt(S(rr, "production")),
          fmt(S(rr, "sales")),
          pct(S(rr, "demand") ? S(rr, "sales") / S(rr, "demand") : 0),
          fmt(S(rr, "end")),
          money(S(rr, "margin")),
        ];
      })
      .filter((r, i) => i >= fromMonth && i <= toMonth);
    return table(
      [
        "Месяц",
        "Спрос, т",
        "Выпуск, т",
        "Отгрузки, т",
        "Покрытие",
        "Запас, т",
        "МД, млн ₽",
      ],
      rows,
    );
  }
  function overview(r, t) {
    const base = totals(results.get("base")),
      last = totals(results.get("balanced"));
    const actualYear = M.forYear(horizonResults.get(active), 2026);
    const forecastYear = M.forYear(horizonResults.get(active), 2027);
    const delta = (x, y) => x - y;
    const context =
      year === 2026
        ? "Факт января–сентября и актуализация IV квартала 2026"
        : "Прогноз на 2027 год";
    const familyRevenue = ["Картон", "Бумага"].map((name, i) => ({
      name,
      value:
        S(
          t.rows.filter((x) => x.family === name),
          "revenue",
        ) / 1e6,
      color: i ? "#19a27b" : "#4769ff",
    }));
    const productMargins = M.products
      .filter((p) => family === "all" || p.family === family)
      .map((p) => {
        const rows = t.rows.filter((x) => x.product === p.id);
        const revenue = S(rows, "revenue");
        return {
          name: p.name,
          value: revenue ? (S(rows, "margin") / revenue) * 100 : 0,
          color: p.family === "Картон" ? "#4769ff" : "#19a27b",
        };
      })
      .sort((x, y) => y.value - x.value)
      .slice(0, 6);
    return `<div class="kpis">${kpi("Выручка", money(t.revenue), "млн ₽", `К базовой версии: ${money(delta(t.revenue, base.revenue))} млн ₽`, true)}${kpi("Маржинальный доход", money(t.margin), "млн ₽", `К бизнес-плану: ${money(delta(t.margin, last.margin))} млн ₽`, true)}${kpi("План отгрузок", fmt(t.sales), "т", `Бизнес-план: ${fmt(last.sales)} т`)}${kpi("Покрытие спроса", pct(t.coverage), "", `Непокрытый спрос: ${fmt(t.gap)} т`)}${kpi("Годный выпуск", fmt(t.production), "т", "После обрези и потерь качества")}${kpi("Запас на конец периода", fmt(t.end), "т", "По выбранному горизонту")}</div>
      <div class="insight"><strong>${context}.</strong> Денежные показатели без НДС. Факт 2026 года един для всех версий; сценарные решения изменяют только прогноз 2027 года.</div>
      <div class="grid equal chart-grid">${panel(
        "Объёмы: спрос, бизнес-план и отгрузки",
        `Месячная динамика · ${year} · тонны`,
        chart("Спрос, бизнес-план и отгрузки", [
          {
            name: "Неограниченный спрос",
            values: monthly(r, "demand"),
            color: "#a1a9b7",
          },
          {
            name: "Бизнес-план",
            values: monthly({ rows: last.rows }, "sales"),
            color: "#19a27b",
          },
          {
            name: "План отгрузок",
            values: monthly(r, "sales"),
            color: "#4769ff",
          },
        ]),
      )}${panel(
        "Выручка и маржинальный доход",
        `Сопоставимый месячный масштаб · ${year} · млн ₽`,
        chart(
          "Выручка и маржинальный доход",
          [
            {
              name: "Выручка",
              values: monthly(r, "revenue").map((x) => x / 1e6),
              color: "#4769ff",
            },
            {
              name: "Маржинальный доход",
              values: monthly(r, "margin").map((x) => x / 1e6),
              color: "#19a27b",
            },
          ],
          "млн ₽",
        ),
      )}</div>
      <div class="grid equal chart-grid">${panel(
        "2026 → 2027 · отгрузки",
        "Одноимённые месяцы: факт / актуализация 2026 против прогноза 2027",
        chart(
          "Отгрузки год к году",
          [
            {
              name: "2026 · факт / актуализация",
              values: monthly(actualYear, "sales"),
              color: "#8b5cf6",
              seriesYear: 2026,
            },
            {
              name: "2027 · прогноз",
              values: monthly(forecastYear, "sales"),
              color: "#4769ff",
              seriesYear: 2027,
            },
          ],
          "т",
          { compare: true, context: "2026 → 2027" },
        ),
      )}${panel(
        "2026 → 2027 · маржинальный доход",
        "Единый масштаб млн ₽ показывает эффект прогнозных допущений",
        chart(
          "Маржинальный доход год к году",
          [
            {
              name: "2026 · факт / актуализация",
              values: monthly(actualYear, "margin").map((x) => x / 1e6),
              color: "#19a27b",
              seriesYear: 2026,
            },
            {
              name: "2027 · прогноз",
              values: monthly(forecastYear, "margin").map((x) => x / 1e6),
              color: "#4769ff",
              seriesYear: 2027,
            },
          ],
          "млн ₽",
          { compare: true, context: "2026 → 2027" },
        ),
      )}</div>
      <div class="grid equal chart-grid">${panel(
        "Производство и отгрузки",
        "Годный выпуск сопоставлен с продажами; разница формирует запас",
        chart("Производство и отгрузки", [
          {
            name: "Годный выпуск",
            values: monthly(r, "production"),
            color: "#8b5cf6",
          },
          { name: "Отгрузки", values: monthly(r, "sales"), color: "#4769ff" },
        ]),
      )}${panel(
        "Запасы и целевой уровень",
        "Конец месяца и норматив пополнения в тоннах",
        chart("Запасы и целевой уровень", [
          { name: "Остаток", values: monthly(r, "end"), color: "#4769ff" },
          {
            name: "Целевой запас",
            values: monthly(r, "target"),
            color: "#ed0084",
            line: true,
          },
        ]),
      )}</div>
      <div class="grid equal chart-grid">${panel("Выручка по направлениям", `Картон и бумага · выбранный период ${year}`, horizontalChart("Выручка по направлениям", familyRevenue, "млн ₽"))}${panel("Маржинальность продуктовых групп", "Топ-6 по доле маржинального дохода в выручке", horizontalChart("Маржинальность по продуктам", productMargins, "%", 1))}</div>
      ${panel("Помесячная экономика и объём", `${context}; отклонения оцениваются от бизнес-плана`, monthlyTable(r))}`;
  }

  function demandView(r, t) {
    const rows = M.products
      .filter((p) => family === "all" || p.family === family)
      .map((p) => {
        const rr = t.rows.filter((x) => x.product === p.id);
        const demand = S(rr, "demand"),
          sales = S(rr, "sales");
        return [
          p.name,
          fmt(demand),
          fmt(sales),
          fmt(S(rr, "gap")),
          `<span class="pill ${sales / (demand || 1) < 0.95 ? "warn" : ""}">${pct(sales / (demand || 1))}</span>`,
          money(S(rr, "revenue")),
        ];
      });
    const cr = r.customerRows.filter(eligible);
    const rowMap = new Map(r.rows.map((x) => [`${x.sku}|${x.month}`, x]));
    const economics = (clientRows, key) =>
      S(clientRows, (x) => {
        const source = rowMap.get(`${x.sku}|${x.month}`);
        return source && source.sales
          ? (x.sales * source[key]) / source.sales
          : 0;
      });
    const clients = M.clients.map((c) => {
      const rr = cr.filter((x) => x.client === c.id);
      const demand = S(rr, "demand");
      return [
        esc(c.name),
        esc(c.segment),
        M.nodes.find((n) => n.id === c.node).name,
        fmt(demand),
        fmt(S(rr, "sales")),
        pct(demand ? S(rr, "sales") / demand : 0),
      ];
    });
    const segments = [...new Set(M.clients.map((c) => c.segment))];
    const segmentItems = segments
      .map((seg, i) => ({
        name: seg,
        value: S(
          cr.filter(
            (x) => M.clients.find((c) => c.id === x.client)?.segment === seg,
          ),
          "demand",
        ),
        color: [
          "#4769ff",
          "#19a27b",
          "#8b5cf6",
          "#ff8c00",
          "#a5246c",
          "#64748b",
        ][i],
      }))
      .sort((a, b) => b.value - a.value);
    return `<div class="kpis">${kpi("Неограниченный спрос", fmt(t.demand), "т", "Сезонность по продуктовым группам", true)}${kpi("План отгрузок", fmt(t.sales), "т", "Не превышает спрос и доступный запас")}${kpi("Непокрытый спрос", fmt(t.gap), "т", "Не является фактом потерянного заказа")}${kpi("Покрытие", pct(t.coverage), "", "Не OTIF: без дат заказов")}</div>
      <div class="grid equal chart-grid">${panel(
        "Спрос и отгрузки по месяцам",
        `Полный годовой контекст ${year} с подсветкой выбранного периода`,
        chart("Спрос и отгрузки", [
          { name: "Спрос", values: monthly(r, "demand"), color: "#a1a9b7" },
          { name: "Отгрузки", values: monthly(r, "sales"), color: "#4769ff" },
        ]),
      )}${panel("Спрос по клиентским сегментам", "Шесть каналов · тонны за выбранный период", horizontalChart("Спрос по сегментам", segmentItems, "т", 0))}</div>
      ${panel(
        "Сегментация клиентов",
        "Портфель покупателей по типам бизнеса: объём спроса и уровень покрытия",
        `<div class="segment-grid">${segments
          .map((seg) => {
            const group = cr.filter(
              (x) => M.clients.find((c) => c.id === x.client)?.segment === seg,
            );
            const demand = S(group, "demand"),
              coverage = demand ? S(group, "sales") / demand : 0;
            return `<div class="segment-card"><b>${esc(seg)}</b><strong>${fmt(demand)} т</strong><small>спрос · покрытие ${pct(coverage)} · OTIF модели ${pct(Math.min(0.99, coverage * 0.96))}</small><div class="load-track"><i style="width:${Math.min(100, coverage * 100)}%"></i></div></div>`;
          })
          .join("")}</div>`,
      )}
      ${panel("Покрытие по ассортименту", "Все текущие продуктовые группы компании", table(["Продукт", "Спрос, т", "Отгрузки, т", "Дефицит, т", "Покрытие", "Выручка, млн ₽"], rows))}
      ${panel("Клиенты и сегменты", "Сегменты: издательства, типографии, упаковочные производства и дистрибьюторы", paged("clients", ["Клиент", "Сегмент", "Склад отгрузки", "Спрос, т", "Отгрузки, т", "Покрытие"], clients))}
      ${panel(
        "Клиентская аналитика: объём и маржинальность",
        "Экономика распределена пропорционально отгрузкам SKU; WAPE — модельная оценка, не исторический факт",
        table(
          [
            "Клиент",
            "Сегмент",
            "Объём спроса, т",
            "Выручка, млн ₽",
            "Маржа, млн ₽",
            "Точность прогноза · оценка",
          ],
          M.clients.map((c) => {
            const rr = cr.filter((x) => x.client === c.id),
              d = S(rr, "demand");
            const revenue = economics(rr, "revenue"),
              margin = economics(rr, "margin");
            const idx = M.clients.findIndex((y) => y.id === c.id),
              acc = 0.78 + (idx % 6) * 0.035;
            return [
              esc(c.name),
              esc(c.segment),
              `<span class="heat-cell">${fmt(d)}</span>`,
              money(revenue),
              `<span class="${margin >= 0 ? "delta-pos" : "delta-neg"}">${money(margin)}</span>`,
              `<span class="heat-cell ${acc < 0.84 ? "hot" : ""}">${pct(acc)}</span>`,
            ];
          }),
        ),
      )}`;
  }

  function heat(r, operations = unitOperations(r)) {
    const stages = ["Массоподготовка", "КДМ / БДМ", "Отделка"];
    const units = [
      ...new Map(operations.capacities.map((c) => [c.machine, c])).values(),
    ].filter(
      (c) => family === "all" || c.family === "all" || c.family === family,
    );
    return `<div class="chart-scroll"><div class="heat"><span></span>${M.months.map((m) => `<span>${m}</span>`).join("")}${stages
      .map((stage) =>
        units
          .filter((u) => u.stage === stage)
          .map(
            (unit) =>
              `<span class="machine" title="${esc(unit.stage)}">${esc(unit.name)}</span>${M.months
                .map((_, m) => {
                  const c = operations.capacities.find(
                    (x) => x.machine === unit.machine && x.month === m,
                  );
                  const load = c?.load || 0;
                  return `<span class="heat-cell ${load > 1 ? "overload" : load >= 0.9 ? "hot" : ""}" title="${esc(unit.name)} · ${M.months[m]} ${year}: ${fmt(c?.used || 0, 1)} / ${fmt(c?.available || 0)} ч">${pct(load)}</span>`;
                })
                .join("")}`,
          )
          .join(""),
      )
      .join(
        "",
      )}</div></div><div class="heat-legend"><span><i class="ok"></i>&lt;90%</span><span><i class="hot"></i>90–100%</span><span><i class="overload"></i>&gt;100% · узкое место</span></div>`;
  }

  function monthlyCampaigns(r, key, machine = "") {
    return M.months.map((_, m) =>
      S(
        r.campaigns.filter(
          (c) =>
            c.month === m &&
            (!machine || c.machine === machine) &&
            (family === "all" || product(c.product).family === family),
        ),
        key,
      ),
    );
  }

  function flowData(r, camps) {
    const rowMap = new Map();
    r.rows.forEach((row) => {
      const key = `${row.product}|${row.month}`;
      if (!rowMap.has(key)) rowMap.set(key, row);
    });
    const machines = ["КДМ-9", "БДМ-7"].map((machine) => {
      const rows = camps.filter((c) => c.machine === machine);
      const gross = S(rows, "gross"),
        good = S(rows, "good");
      const qualityLoss = S(rows, (c) =>
        Math.max(0, c.gross - c.trim - c.good),
      );
      const finishLoss = qualityLoss * 0.35;
      const productionValue = S(
        rows,
        (c) =>
          c.good *
          (rowMap.get(`${c.product}|${c.month}`)?.unitCost ||
            product(c.product).cost),
      );
      return {
        machine,
        gross,
        good,
        finishLoss,
        machineOutput: good + finishLoss,
        machineLoss: gross - good - finishLoss,
        stage1: productionValue * 0.73,
        stage2: productionValue * 0.9,
        stage3: productionValue,
      };
    });
    return {
      machines,
      gross: S(machines, "gross"),
      good: S(machines, "good"),
      machineOutput: S(machines, "machineOutput"),
      machineLoss: S(machines, "machineLoss"),
      finishLoss: S(machines, "finishLoss"),
      stage1: S(machines, "stage1"),
      stage2: S(machines, "stage2"),
      stage3: S(machines, "stage3"),
    };
  }

  function processFlow(r, camps) {
    const d = flowData(r, camps);
    const cost = flowMode === "cost";
    const colors = ["#4769ff", "#19a27b"];
    const nodeY = [52, 238],
      nodeH = 132;
    const massValue = cost ? d.stage1 / 1e6 : d.gross;
    const finishValue = cost ? d.stage3 / 1e6 : d.good;
    const maxLink = Math.max(
      1,
      ...d.machines.flatMap((x) =>
        cost ? [x.stage1, x.stage2] : [x.gross, x.machineOutput],
      ),
    );
    const width = (value) => (value > 0 ? 7 + (value / maxLink) * 34 : 0);
    const fmtFlow = (value) =>
      cost ? `${money(value)} млн ₽` : `${fmt(value, 1)} т`;
    let links = "";
    d.machines.forEach((x, i) => {
      const input = cost ? x.stage1 : x.gross;
      const output = cost ? x.stage2 : x.machineOutput;
      const y1 = 185,
        y2 = nodeY[i] + nodeH / 2;
      const endY = i === 0 ? 164 : 216;
      links += `<path d="M270 ${y1} C350 ${y1},350 ${y2},430 ${y2}" stroke="${colors[i]}" stroke-width="${width(input)}" opacity="0.34"/><text x="342" y="${(y1 + y2) / 2 - 8}" class="flow-value" text-anchor="middle">${fmtFlow(input)}</text>`;
      links += `<path d="M680 ${y2} C760 ${y2},770 ${endY},850 ${endY}" stroke="${colors[i]}" stroke-width="${width(output)}" opacity="0.48"/><text x="766" y="${(y2 + endY) / 2 - 9}" class="flow-value" text-anchor="middle">${fmtFlow(output)}</text>`;
    });
    const machineNodes = d.machines
      .map((x, i) => {
        const value = cost ? x.stage2 / 1e6 : x.gross;
        const secondary = cost
          ? `+ передел ${money(x.stage2 - x.stage1)} млн ₽`
          : `на отделку ${fmt(x.machineOutput, 1)} т`;
        const tertiary = cost
          ? `выход на отделку: ${money(x.stage2)} млн ₽`
          : `обрезь и потери ${fmt(x.machineLoss, 1)} т`;
        return `<g class="flow-node"><rect x="430" y="${nodeY[i]}" width="250" height="${nodeH}" rx="14" fill="#fff" stroke="${colors[i]}"/><rect x="430" y="${nodeY[i]}" width="6" height="${nodeH}" rx="3" fill="${colors[i]}"/><text x="452" y="${nodeY[i] + 29}" class="flow-title">${x.machine}</text><text x="452" y="${nodeY[i] + 57}" class="flow-primary">${fmt(value, cost ? 1 : 0)} ${cost ? "млн ₽" : "т"}</text><text x="452" y="${nodeY[i] + 83}" class="flow-sub">${secondary}</text><text x="452" y="${nodeY[i] + 105}" class="flow-sub">${tertiary}</text></g>`;
      })
      .join("");
    const massSecondary = cost
      ? "сырьё + массоподготовка"
      : `на КДМ / БДМ: ${fmt(d.gross, 0)} т`;
    const finishSecondary = cost
      ? `+ отделка ${money(d.stage3 - d.stage2)} млн ₽`
      : `вход ${fmt(d.machineOutput, 1)} т`;
    const finishTertiary = cost
      ? "накопленная стоимость выпуска"
      : `потери отделки ${fmt(d.finishLoss, 1)} т`;
    const reconciliation = cost
      ? `Масса ${money(d.stage1)} + передел КДМ/БДМ ${money(d.stage2 - d.stage1)} + отделка ${money(d.stage3 - d.stage2)} = ${money(d.stage3)} млн ₽.`
      : `Брутто ${fmt(d.gross, 1)} = вход отделки ${fmt(d.machineOutput, 1)} + обрезь и машинные потери ${fmt(d.machineLoss, 1)}. Вход отделки = годный ${fmt(d.good, 1)} + потери отделки ${fmt(d.finishLoss, 1)} т.`;
    return `<div class="flow-switch" role="group" aria-label="Показатель потока агрегатов"><button type="button" data-flow-mode="volume" aria-pressed="${!cost}">Объём, т</button><button type="button" data-flow-mode="cost" aria-pressed="${cost}">Затраты, млн ₽</button></div>
      <div class="flow-legend"><span><i style="background:#4769ff"></i>Поток КДМ-9</span><span><i style="background:#19a27b"></i>Поток БДМ-7</span><span>Ширина ленты и подпись рассчитаны из одного значения</span></div>
      <div class="chart-scroll"><svg class="process-sankey" viewBox="0 0 1120 420" role="img" aria-label="Сквозной поток: массоподготовка, КДМ и БДМ, отделка">
        <text x="30" y="26" class="flow-stage">ЭТАП 1 · МАССОПОДГОТОВКА</text><text x="430" y="26" class="flow-stage">ЭТАП 2 · КДМ / БДМ</text><text x="850" y="26" class="flow-stage">ЭТАП 3 · ОТДЕЛКА</text>
        <g fill="none" stroke-linecap="round">${links}</g>
        <g class="flow-node"><rect x="30" y="120" width="240" height="132" rx="14" fill="#fff" stroke="#8b5cf6"/><rect x="30" y="120" width="6" height="132" rx="3" fill="#8b5cf6"/><text x="52" y="149" class="flow-title">Массоподготовка</text><text x="52" y="177" class="flow-primary">${fmt(massValue, cost ? 1 : 0)} ${cost ? "млн ₽" : "т"}</text><text x="52" y="203" class="flow-sub">${massSecondary}</text><text x="52" y="225" class="flow-sub">очистка · рафинирование</text></g>
        ${machineNodes}
        <g class="flow-node"><rect x="850" y="120" width="240" height="132" rx="14" fill="#fff" stroke="#ff8c00"/><rect x="850" y="120" width="6" height="132" rx="3" fill="#ff8c00"/><text x="872" y="149" class="flow-title">Отделка</text><text x="872" y="177" class="flow-primary">${fmt(finishValue, cost ? 1 : 0)} ${cost ? "млн ₽" : "т"}</text><text x="872" y="203" class="flow-sub">${finishSecondary}</text><text x="872" y="225" class="flow-sub">${finishTertiary}</text></g>
      </svg></div><div class="flow-reconciliation">${reconciliation}</div>`;
  }

  function stageSteps(items) {
    return `<div class="stage-steps">${items.map((item, i) => `<span>${item}</span>${i < items.length - 1 ? "<b>→</b>" : ""}`).join("")}</div>`;
  }

  function stageMetrics(items) {
    return `<div class="stage-metrics">${items.map(([label, value, note]) => `<div><small>${label}</small><strong>${value}</strong><span>${note}</span></div>`).join("")}</div>`;
  }

  function machineDetail(r, machine) {
    const camps = r.campaigns.filter(
      (c) => c.machine === machine && eligible(c),
    );
    const gross = S(camps, "gross"),
      good = S(camps, "good"),
      trim = S(camps, "trim");
    const qualityLoss = Math.max(0, gross - good - trim);
    const paper = machine === "БДМ-7";
    return `<article class="machine-detail"><h3>${machine} · ${paper ? "бумага" : "картон"}</h3>${stageMetrics(
      [
        ["Брутто", `${fmt(gross)} т`, "полотно на машине"],
        ["Годный", `${fmt(good)} т`, `выход ${pct(good / (gross || 1))}`],
        ["Потери", `${fmt(trim + qualityLoss)} т`, "обрезь + качество"],
      ],
    )}${stageSteps(paper ? ["Формование", "Прессование", "Сушка", "Каландрирование"] : ["Формование", "Прессование", "Сушка", "Мелование GC1 / GC2"])}${chart(
      `${machine}: брутто и годный выпуск`,
      [
        {
          name: "Брутто",
          values: monthlyCampaigns(r, "gross", machine),
          color: paper ? "#19a27b" : "#4769ff",
        },
        {
          name: "Годный выпуск",
          values: monthlyCampaigns(r, "good", machine),
          color: "#8b5cf6",
        },
      ],
    )}</article>`;
  }

  function productionView(r, t) {
    const operations = unitOperations(r);
    const camps = r.campaigns.filter(eligible),
      cuts = r.cuts.filter(eligible);
    const caps = operations.capacities.filter(
      (c) =>
        c.month >= fromMonth &&
        c.month <= toMonth &&
        (family === "all" || c.family === "all" || c.family === family),
    );
    const gross = S(camps, "gross"),
      trim = S(camps, "trim");
    const bottlenecks = caps.filter((c) => c.load > 1);
    const units = [
      ...new Map(operations.capacities.map((c) => [c.machine, c])).values(),
    ].filter(
      (c) => family === "all" || c.family === "all" || c.family === family,
    );
    const timelines = ["Массоподготовка", "КДМ / БДМ", "Отделка"]
      .map(
        (stage) =>
          `<section class="campaign-stage"><h3>${stage}</h3>${units
            .filter((u) => u.stage === stage)
            .map(
              (unit) =>
                `<div class="campaign-machine"><h4>${esc(unit.name)}</h4>${M.months
                  .map((mn, mi) => {
                    if (mi < fromMonth || mi > toMonth) return "";
                    const c = operations.capacities.find(
                      (x) => x.machine === unit.machine && x.month === mi,
                    );
                    const cs = operations.campaigns.filter(
                      (x) => x.machine === unit.machine && x.month === mi,
                    );
                    return `<button class="campaign-month ${month === String(mi) ? "selected" : ""}" data-camp-month="${mi}" aria-label="Выбрать кампании ${mn} ${year}"><span>${mn}</span><div class="timeline">${cs.map((x) => `<i style="width:${((x.run + x.setup) / c.calendar) * 100}%" title="${esc(product(x.product).name)} · ${x.gram} г/м² · выпуск ${fmt(x.good)} т · ${fmt(x.run + x.setup, 1)} ч"></i>`).join("")}<i class="repair" style="width:${(c.repair / c.calendar) * 100}%" title="Плановый ремонт · ${fmt(c.repair)} ч"></i></div><small>${fmt(c.run)} ч работы · ${fmt(c.setup)} ч переходов · ${c.used > c.available ? `<b class="delta-neg">дефицит ${fmt(c.used - c.available)} ч</b>` : `резерв ${fmt(c.available - c.used)} ч`}</small></button>`;
                  })
                  .join("")}</div>`,
            )
            .join("")}</section>`,
      )
      .join("");

    const example = cuts.find((c) => c.trim > 0.001) || cuts[0];
    let cutExample = "<p>Для выбранного фильтра нет карт раскроя.</p>";
    if (example) {
      const p = product(example.product),
        nums = example.pattern
          .split(" + ")
          .map((x) => x.split("×").map(Number));
      cutExample = `<h3>${p.name} · ${example.gram} г/м² · ${M.months[example.month]} ${year}</h3><div class="chart-scroll"><div class="cut-pattern">${nums.flatMap(([count, width]) => Array.from({ length: count }, () => `<span style="width:${(width / example.deckle) * 100}%">${width}</span>`)).join("")}<span class="waste" style="width:${example.trim * 100}%" title="Обрезь ${example.deckle - example.used} мм"></span></div></div><p>Полотно ${example.deckle} мм → ${example.pattern} мм; обрезь ${example.deckle - example.used} мм (${pct(example.trim)}). Годный выпуск учитывает также брак качества.</p>`;
    }
    const flowCamps = camps;
    const d = flowData(r, flowCamps);
    const fiber = S(camps, "fiber");
    const massRows = ["Картон", "Бумага"]
      .filter((f) => family === "all" || family === f)
      .map((f) => {
        const cc = camps.filter((c) => product(c.product).family === f);
        const g = S(cc, "gross"),
          good = S(cc, "good");
        const fiberUsed = S(cc, "fiber");
        return [f, fmt(g), fmt(fiberUsed, 1), fmt(good), pct(good / (g || 1))];
      });
    const finishingInput = M.months.map((_, m) => {
      const cc = r.campaigns.filter(
        (c) =>
          c.month === m &&
          (family === "all" || product(c.product).family === family),
      );
      return S(
        cc,
        (c) => c.good + Math.max(0, c.gross - c.trim - c.good) * 0.35,
      );
    });
    const finishingLoss = finishingInput.map(
      (v, i) => v - monthlyCampaigns(r, "good")[i],
    );
    const yields = ["КДМ-9", "БДМ-7"]
      .filter(
        (machine) =>
          family === "all" ||
          (family === "Картон" ? machine === "КДМ-9" : machine === "БДМ-7"),
      )
      .map((machine) => {
        const cc = camps.filter((c) => c.machine === machine),
          g = S(cc, "gross");
        return {
          name: `${machine} · выход годного`,
          value: g ? (S(cc, "good") / g) * 100 : 0,
          color: machine === "КДМ-9" ? "#4769ff" : "#19a27b",
        };
      });

    return `<div class="kpis">${kpi("Годный выпуск", fmt(t.production), "т", "После обрези и потерь качества", true)}${kpi("Кампании КДМ / БДМ", fmt(camps.length), "", "Марка × граммаж × проход приоритета")}${kpi("Переналадки всех агрегатов", fmt(S(caps, "setup")), "ч", "КДМ, БДМ, массоподготовка и отделка")}${kpi("Обрезь по ширине", pct(trim / (gross || 1)), "", `${fmt(trim)} т из ${fmt(gross)} т брутто`)}${kpi("Узкие места", fmt(bottlenecks.length), "агрегат·мес.", bottlenecks.length ? "Требуется перенос объёма или увеличение фонда" : "Загрузка не превышает доступный фонд", bottlenecks.length > 0)}</div>
      ${panel("Загрузка производственных агрегатов", "Массоподготовка, КДМ-9, БДМ-7, резка и упаковка · использованные / доступные часы", heat(r, operations))}
      ${panel("Последовательность кампаний", "Все агрегаты · порядок в месяце, не календарное диспетчерское расписание. Нажмите месяц для фильтра.", timelines, "campaign-panel")}
      ${panel("Сквозной поток агрегатов", "Единый баланс объёма и накопленной стоимости · массоподготовка → КДМ / БДМ → отделка", processFlow(r, flowCamps), "flow-panel")}
      ${panel(
        "Этап 1 · Массоподготовка",
        "Растаривание, очистка и рафинирование · волокно показано в абсолютно сухих тоннах",
        `${stageMetrics([
          ["Волокно", `${fmt(fiber)} т`, "фактический расход модели"],
          ["Масса на машины", `${fmt(d.gross)} т`, "брутто-выпуск"],
          [
            "Выход в годный",
            pct(d.good / (d.gross || 1)),
            "с учётом всех последующих потерь",
          ],
        ])}${stageSteps(["Растаривание и растворение", "Высококонцентрационная очистка", "Рафинирование", "Машинный бассейн"])}${chart(
          "Массоподготовка: волокно и масса",
          [
            {
              name: "Волокно",
              values: monthlyCampaigns(r, "fiber"),
              color: "#8b5cf6",
            },
            {
              name: "Масса на машины",
              values: monthlyCampaigns(r, "gross"),
              color: "#4769ff",
            },
          ],
        )}${table(["Направление", "Брутто, т", "Волокно, т абс. сух.", "Годный, т", "Сквозной выход"], massRows)}`,
        "stage-panel",
      )}
      ${panel("Этап 2 · КДМ-9 и БДМ-7", "Отдельная специфика картонной и бумажной машин · брутто, годный выпуск, переходы и качество", `<div class="grid equal machine-grid">${family === "Бумага" ? "" : machineDetail(r, "КДМ-9")}${family === "Картон" ? "" : machineDetail(r, "БДМ-7")}</div>`, "stage-panel")}
      ${panel(
        "Этап 3 · Отделка",
        "Продольная резка, перемотка и упаковка · вход и годный выход согласованы с машинными кампаниями",
        `${stageMetrics([
          [
            "Вход отделки",
            `${fmt(d.machineOutput)} т`,
            "годный + отделочные потери",
          ],
          ["Готовая продукция", `${fmt(d.good)} т`, "после отделки"],
          [
            "Потери отделки",
            `${fmt(d.finishLoss)} т`,
            "доля потерь качества в модели",
          ],
        ])}${stageSteps(["Продольная резка", "Перемотка рулонов", "Листорезка по ассортименту", "Упаковка и склад ГП"])}${chart(
          "Отделка: вход и годный выход",
          [
            { name: "Вход отделки", values: finishingInput, color: "#ff8c00" },
            {
              name: "Готовая продукция",
              values: monthlyCampaigns(r, "good"),
              color: "#4769ff",
            },
            { name: "Потери отделки", values: finishingLoss, color: "#c65562" },
          ],
        )}`,
        "stage-panel",
      )}
      <div class="grid equal chart-grid">${panel("Карта раскроя · пример", "Целочисленные полосы в пределах обрезной ширины", cutExample)}${panel("Сквозной выход по машинам", "Годный выпуск / брутто за выбранный период", horizontalChart("Выход годного", yields, "%", 2))}</div>
      ${panel(
        "Реестр производственных кампаний",
        "КДМ-9 и БДМ-7 · начало и конец — накопленные часы доступного фонда",
        paged(
          "campaigns",
          [
            "Кампания",
            "Месяц",
            "Машина",
            "Продукт",
            "г/м²",
            "Начало, ч",
            "Конец, ч",
            "Переход, ч",
            "Брутто, т",
            "Годный, т",
          ],
          camps.map((c) => [
            c.id,
            `${M.months[c.month]} ${year}`,
            c.machine,
            product(c.product).name,
            c.gram,
            fmt(c.start, 1),
            fmt(c.end, 1),
            fmt(c.setup, 1),
            fmt(c.gross),
            fmt(c.good),
          ]),
        ),
      )}
      ${panel(
        "Карты раскроя",
        "Полосы не смешивают разные марки и граммажи. Подбор схем — проверяемая эвристика, не доказанный глобальный оптимум.",
        paged(
          "cuts",
          [
            "Кампания",
            "Продукт",
            "г/м²",
            "Полотно, мм",
            "Схема, мм",
            "Обрезь",
            "Брутто, т",
            "Годный, т",
            "Брак, т",
          ],
          cuts.map((c) => [
            c.campaign,
            product(c.product).name,
            c.gram,
            c.deckle,
            c.pattern,
            pct(c.trim),
            fmt(c.gross, 1),
            fmt(c.good, 1),
            fmt(c.qualityLoss, 1),
          ]),
        ),
      )}`;
  }

  function resourcesView(r) {
    const names = {
      fiber: ["Волокнистое сырьё", "т абс. сух."],
      coat: ["Компоненты мелования", "т"],
      energy: ["Электроэнергия", "МВт·ч"],
      water: ["Оборотная вода", "м³"],
    };
    const allResources = [...r.resources, ...(r.utilities || [])];
    const rr = allResources.filter(
      (x) => x.month >= fromMonth && x.month <= toMonth,
    );
    const cards = Object.entries(names)
      .map(([id, [name, unit]]) => {
        const rows = rr.filter((x) => x.id === id),
          used = S(rows, "used"),
          cap = S(rows, "available");
        return panel(
          name,
          `${unit} · общий ресурс площадки`,
          `<div class="kpi-value">${fmt(used)} <span class="kpi-unit">из ${fmt(cap)}</span></div><div class="progress"><span style="width:${Math.min(100, (used / (cap || 1)) * 100)}%"></span></div><p>Использование ${pct(used / (cap || 1))} · резерв ${fmt(cap - used)} ${unit}</p>`,
        );
      })
      .join("");
    const productFiber = M.products
      .filter((p) => family === "all" || p.family === family)
      .map((p) => ({
        name: p.name,
        value: S(
          r.campaigns.filter(
            (c) =>
              c.product === p.id && c.month >= fromMonth && c.month <= toMonth,
          ),
          "fiber",
        ),
        color: p.family === "Картон" ? "#4769ff" : "#19a27b",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    const monthlyResource = (id) =>
      M.months.map(
        (_, m) =>
          S(
            allResources.filter((x) => x.id === id && x.month === m),
            "used",
          ) / 1000,
      );
    return `<div class="insight">Лимиты ресурсов показаны <strong>для всей площадки</strong>. Расход зависит от брутто-выпуска, а не от продаж. Вода учитывается в ограничении выпуска и в себестоимости, но не смешивается с тоннами волокна.</div><div class="catalog resource-catalog">${cards}</div>
      <div class="grid equal chart-grid">${panel(
        "Динамика использования ресурсов",
        "Фактический расход модели · тыс. единиц соответствующего ресурса",
        chart(
          "Использование ресурсов",
          [
            {
              name: "Волокно, тыс. т",
              values: monthlyResource("fiber"),
              color: "#4769ff",
            },
            {
              name: "Мелование, тыс. т",
              values: monthlyResource("coat"),
              color: "#19a27b",
            },
            {
              name: "Энергия, тыс. МВт·ч",
              values: monthlyResource("energy"),
              color: "#ff8c00",
            },
          ],
          "тыс. ед.",
        ),
      )}${panel("Волокно по продуктовым группам", "Топ-6 · расход на брутто-выпуск за выбранный период", horizontalChart("Волокно по продуктам", productFiber, "т абс. сух.", 0))}</div>
      ${panel(
        "Месячные ограничения снабжения",
        "Лимиты и рецептурные коэффициенты синтетические; месячная проверка не заменяется годовым агрегатом",
        table(
          [
            "Месяц",
            "Ресурс",
            "Ед.",
            "Лимит",
            "Потребность",
            "Резерв",
            "Использование",
          ],
          rr.map((x) => [
            `${M.months[x.month]} ${year}`,
            names[x.id][0],
            names[x.id][1],
            fmt(x.available),
            fmt(x.used),
            fmt(x.available - x.used),
            pct(x.used / (x.available || 1)),
          ]),
        ),
      )}
      ${panel(
        "Коэффициенты потребления",
        "На 1 т брутто-выпуска; укрупнённые допущения, не технологические рецептуры КАМА",
        table(
          [
            "Группа",
            "Волокно, т/т",
            "Мелование, т/т",
            "Энергия, МВт·ч/т",
            "Вода, м³/т",
          ],
          M.products
            .filter((p) => family === "all" || p.family === family)
            .map((p) => [
              p.name,
              fmt(p.fiber, 3),
              fmt(p.coat, 3),
              fmt(p.energy, 2),
              fmt(18 * Number(r.config.waterIntensity || 1), 1),
            ]),
        ),
      )}`;
  }

  function capacityView(r, t) {
    const caps = capFilter(r.capacities),
      resource = (id) =>
        S(
          r.resources.filter(
            (x) => x.id === id && x.month >= fromMonth && x.month <= toMonth,
          ),
          "used",
        ),
      gross = S(
        r.campaigns.filter((c) => c.month >= fromMonth && c.month <= toMonth),
        "gross",
      ),
      good = S(
        r.campaigns.filter((c) => c.month >= fromMonth && c.month <= toMonth),
        "good",
      ),
      energyRows = r.resources.filter(
        (x) => x.id === "energy" && x.month >= fromMonth && x.month <= toMonth,
      ),
      energy = S(energyRows, "used"),
      energyCap = S(energyRows, "available"),
      fiber = resource("fiber"),
      energyLoad = energyCap ? energy / energyCap : 0;
    const waterRows = (r.utilities || []).filter(
      (x) => x.id === "water" && x.month >= fromMonth && x.month <= toMonth,
    );
    const water = S(waterRows, "used"),
      waterCapacity = S(waterRows, "available"),
      tmcCost = t.holding * 0.14,
      energyCost = S(t.rows, "energyCost");
    const departments = [
      [
        "Энергоцех",
        energyLoad,
        `${fmt(energy)} МВт·ч`,
        `Потребление / лимит ${fmt(energyCap)} МВт·ч`,
      ],
      [
        "ТМЦ и складское хозяйство",
        Math.min(
          1,
          t.end /
            Math.max(
              1,
              M.nodes.reduce((x, n) => x + n.cap, 0),
            ),
        ),
        `${fmt(t.end)} т остатка`,
        `Оборачиваемость и обеспечение запасами`,
      ],
      [
        "ЦОС / водооборотный цех",
        waterCapacity ? water / waterCapacity : 0,
        `${fmt(water)} м³`,
        `Потребление / лимит ${fmt(waterCapacity)} м³ · брутто-выпуск × норма`,
      ],
    ];
    return `<div class="kpis">${kpi("Обеспечивающих направлений", "3", "", "Энергоцех · ТМЦ · ЦОС", true)}${kpi("Энергоёмкость", fmt(energy / (good || 1), 2), "МВт·ч/т", "Энергопотребление / годный выпуск")}${kpi("Энергоцех: затраты", money(energyCost), "млн ₽", "Компонент переменной себестоимости продаж")}${kpi("ТМЦ и содержание запасов", money(tmcCost), "млн ₽", "Модельная доля затрат на хранение")}</div>${panel(
      "Загрузка обеспечивающих цехов",
      "Основное производство исключено из этого раздела. Оценки загрузки не заменяют нормативные паспорта мощностей.",
      table(
        ["Цех", "Загрузка / индекс", "Объём периода", "Расчёт"],
        departments.map(([n, load, amount, detail]) => [
          n,
          `<div class="load-track"><i style="width:${Math.min(100, load * 100)}%"></i></div><small>${pct(load)}</small>`,
          amount,
          detail,
        ]),
      ),
    )}<div class="grid equal">${panel(
      "Энергопотребление",
      "МВт·ч по месяцам · агрегат всей площадки",
      chart(
        "Энергопотребление",
        [
          {
            name: "Потребление",
            values: M.months.map((_, m) =>
              S(
                r.resources.filter((x) => x.id === "energy" && x.month === m),
                "used",
              ),
            ),
            color: "#ff8c00",
          },
          {
            name: "Доступный лимит",
            values: M.months.map((_, m) =>
              S(
                r.resources.filter((x) => x.id === "energy" && x.month === m),
                "available",
              ),
            ),
            color: "#a1a9b7",
            line: true,
          },
        ],
        "МВт·ч",
      ),
    )}${panel(
      "Поток воды и выпуск",
      "Оценочная связь потребности в оборотной воде с выпуском",
      chart(
        "Водоёмкость производства",
        [
          {
            name: "Годный выпуск, тыс. т",
            values: monthly(r, "production").map((x) => x / 1000),
            color: "#4769ff",
          },
          {
            name: "Водооборот, тыс. м³ (оценка)",
            values: M.months.map(
              (_, m) =>
                S(
                  (r.utilities || []).filter(
                    (x) => x.id === "water" && x.month === m,
                  ),
                  "used",
                ) / 1000,
            ),
            color: "#19a27b",
          },
        ],
        "тыс. ед.",
      ),
    )}</div>${panel(
      "Удельные затраты обеспечивающих процессов",
      "Модельный управленческий разрез; ставок фактических договоров в данных нет",
      table(
        ["Показатель", "Результат периода", "Основа расчёта"],
        [
          ["Электроэнергия, МВт·ч", fmt(energy), "Сумма месячного потребления"],
          [
            "Энергетические затраты",
            money(energyCost) + " млн ₽",
            "Сумма energyCost в плане SKU · себестоимость проданного объёма",
          ],
          [
            "Содержание запасов ТМЦ",
            money(tmcCost) + " млн ₽",
            "14% от агрегированных расходов хранения",
          ],
          [
            "Волокнистое сырьё, т",
            fmt(fiber),
            "Ресурс, обеспечивающий основное производство",
          ],
          [
            "Годный выпуск, т",
            fmt(good),
            "Выход после обрези и потерь качества",
          ],
        ],
      ),
    )}<div class="insight">ЦОС и расходы ТМЦ пока являются оценочными прокси, а не исходными данными предприятия. Для точных загрузок нужны мощности/планы смен ЦОС и ТМЦ, фактический водный баланс и тарифы энергоносителей.</div>`;
  }

  function networkView(r, t) {
    const ledgers = r.ledgers.filter(eligible),
      first = fromMonth,
      last = toMonth,
      avgStock = S(t.rows, "end") / Math.max(1, toMonth - fromMonth + 1),
      dailySales =
        S(t.rows, "sales") / Math.max(1, (toMonth - fromMonth + 1) * 30),
      days = avgStock / (dailySales || 1),
      stockBySku = M.skus.map((s) => {
        const rr = t.rows.filter((x) => x.sku === s.id),
          stock = S(
            rr.filter((x) => x.month === last),
            "end",
          ),
          target = S(
            rr.filter((x) => x.month === last),
            "target",
          ),
          demand = S(rr, "demand");
        return {
          s,
          stock,
          target,
          demand,
          margin: S(rr, "margin"),
          days:
            stock / (demand / Math.max(1, toMonth - fromMonth + 1) / 30 || 1),
        };
      });
    const low = stockBySku.filter((x) => x.stock < x.target * 0.75),
      high = stockBySku.filter((x) => x.stock > x.target * 1.5),
      nr = M.nodes.map((n) => {
        const ls = ledgers.filter((l) => l.node === n.id);
        return [
          n.name,
          fmt(
            S(
              ls.filter((x) => x.month === first),
              "start",
            ),
          ),
          fmt(S(ls, "production")),
          fmt(S(ls, "inbound")),
          fmt(S(ls, "outbound")),
          fmt(S(ls, "sales")),
          fmt(
            S(
              ls.filter((x) => x.month === last),
              "end",
            ),
          ),
          fmt(n.cap),
        ];
      });
    return `<div class="kpis">${kpi("Запас на конец периода", fmt(t.end), "т", `Средний запас: ${fmt(avgStock)} т`, true)}${kpi("Запас в днях продаж", fmt(days, 1), "дн.", "Средний запас ÷ средние суточные отгрузки")}${kpi("Риск дефицита", fmt(low.length), "SKU", `Остаток ниже 75% целевого уровня`, low.length > 0)}${kpi("Риск излишка", fmt(high.length), "SKU", `Остаток выше 150% целевого уровня`)}</div><div class="grid equal">${panel(
      "Динамика запасов и целевой уровень",
      "Складской остаток сопоставлен с целевым запасом плана",
      chart("Остатки и целевой запас", [
        {
          name: "Фактический остаток модели",
          values: monthly(r, "end"),
          color: "#4769ff",
        },
        {
          name: "Целевой запас",
          values: monthly(r, "target"),
          color: "#ed0084",
          line: true,
        },
      ]),
    )}${panel(
      "Стоимость содержания запасов",
      "Модельные затраты на хранение и логистику запасов",
      chart(
        "Затраты на хранение",
        [
          {
            name: "Хранение",
            values: monthly(r, "holding").map((x) => x / 1e6),
            color: "#ff8c00",
          },
          {
            name: "Логистика",
            values: monthly(r, "logistics").map((x) => x / 1e6),
            color: "#4769ff",
          },
        ],
        "млн ₽",
      ),
    )}</div>${panel(
      "Риски по ассортименту",
      "Оценка относительно целевого остатка на конец выбранного периода; пороги — аналитические, не нормативные",
      table(
        [
          "SKU",
          "Продукт",
          "Остаток, т",
          "Цель, т",
          "Отклонение к цели",
          "Дней запаса",
          "Маржинальный доход",
        ],
        stockBySku
          .filter((x) => x.stock < x.target * 0.75 || x.stock > x.target * 1.5)
          .sort(
            (x, y) =>
              Math.abs(y.stock - y.target) - Math.abs(x.stock - x.target),
          )
          .slice(0, 30)
          .map((x) => [
            x.s.name,
            product(x.s.product).name,
            fmt(x.stock),
            fmt(x.target),
            `<span class="${x.stock < x.target ? "delta-neg" : "delta-pos"}">${pct(x.target ? (x.stock - x.target) / x.target : 0)}</span>`,
            fmt(x.days, 1),
            money(x.margin),
          ]),
      ),
    )}${panel("Складская сеть и материальный баланс", "Материальный баланс по заводскому и региональным складам · плановые перемещения внутри месяца", table(["Склад", "Начало, т", "Производство, т", "Приход, т", "Перемещения, т", "Отгрузки, т", "Конец, т", "Ёмкость, т"], nr))}${panel(
      "Динамика целевого запаса",
      "Ежемесячный профиль по портфелю; запасы ниже целевого уровня требуют проверки пополнения",
      chart("Помесячный запас", [
        { name: "Остаток", values: monthly(r, "end"), color: "#4769ff" },
        {
          name: "Целевой запас",
          values: monthly(r, "target"),
          color: "#ed0084",
          line: true,
        },
      ]),
    )}${panel(
      "Реестр складских остатков",
      "Проверяемый баланс SKU × узел × месяц",
      paged(
        "stocks",
        [
          "Месяц",
          "SKU",
          "Склад",
          "Начало",
          "Выпуск",
          "Приход",
          "Перемещения",
          "Продажи",
          "Конец",
        ],
        ledgers.map((l) => [
          M.months[l.month],
          l.sku,
          M.nodes.find((n) => n.id === l.node).name,
          fmt(l.start, 1),
          fmt(l.production, 1),
          fmt(l.inbound, 1),
          fmt(l.outbound, 1),
          fmt(l.sales, 1),
          fmt(l.end, 1),
        ]),
      ),
    )}`;
  }

  function movementView(r, t) {
    const ledgers = r.ledgers.filter(eligible);
    const routes = M.nodes.map((n) => {
      const rows = ledgers.filter((l) => l.node === n.id);
      const inbound = S(rows, "inbound"),
        sales = S(rows, "sales");
      const freight = S(rows, "freightCost"),
        lastMile = S(rows, "lastMileCost");
      return { n, inbound, sales, freight, lastMile, cost: freight + lastMile };
    });
    const transfers = S(ledgers, "inbound");
    const monthlyTransfers = M.months.map((_, m) =>
      S(
        r.ledgers.filter((l) => l.month === m && eligible(l)),
        "inbound",
      ),
    );
    const routeTable = routes.map(
      ({ n, inbound, sales, freight, lastMile, cost }) => [
        n.name,
        n.id === "plant"
          ? "Прямые отгрузки + пополнение РЦ"
          : "Завод → РЦ → клиент",
        fmt(inbound),
        fmt(sales),
        money(freight),
        money(lastMile),
        money(cost),
      ],
    );
    return `<div class="kpis">${kpi("Узлов сети", "3", "", "Заводской склад · РЦ Москва · РЦ Казань", true)}${kpi("Пополнение РЦ", fmt(transfers), "т", "Фактические перемещения в модели сценария")}${kpi("Затраты на логистику", money(t.logistics), "млн ₽", "Межскладские плечи + последняя миля")}${kpi("Покрытие сети", pct(t.coverage), "", "Отгрузки к неограниченному спросу")}</div>
      ${panel("Схема логистических потоков", "Поставка сырья, производство, региональное пополнение и отгрузка клиентам", `<div class="process-flow"><span>Поставщики сырья</span><b>→</b><span>Завод КАМА<small>Краснокамск</small></span><b>→</b><span>Склад готовой продукции</span><b>→</b><span>РЦ Москва · Казань</span><b>→</b><span>Клиенты</span></div>`)}
      <div class="grid equal chart-grid">${panel("Пополнение региональных складов", "Тонны завод → РЦ по месяцам · без двойного счёта клиентских отгрузок", chart("Перемещения завод → РЦ", [{ name: "Пополнение РЦ", values: monthlyTransfers, color: "#4769ff" }]))}${panel(
        "Логистика и хранение",
        "Совместимые затраты по месяцам, млн ₽",
        chart(
          "Логистические затраты",
          [
            {
              name: "Логистика",
              values: monthly(r, "logistics").map((x) => x / 1e6),
              color: "#4769ff",
            },
            {
              name: "Хранение",
              values: monthly(r, "holding").map((x) => x / 1e6),
              color: "#19a27b",
            },
          ],
          "млн ₽",
        ),
      )}</div>
      ${panel("Маршруты и стоимость", "Складские проводки сходятся с общей логистикой сценария", table(["Узел", "Маршрут", "Пополнение, т", "Отгрузки, т", "Завод → РЦ, млн ₽", "Последняя миля, млн ₽", "Итого, млн ₽"], routeTable))}
      ${panel(
        "Затраты по узлам",
        "Сравнение полной стоимости пополнения и последней мили",
        horizontalChart(
          "Логистика по узлам",
          routes.map((x, i) => ({
            name: x.n.name,
            value: x.cost / 1e6,
            color: ["#4769ff", "#19a27b", "#ff8c00"][i],
          })),
          "млн ₽",
        ),
      )}`;
  }

  function financeView(r, t) {
    const costStructure = [
      ["Волокно", "fiberCost", "#4769ff"],
      ["Мелование", "coatCost", "#19a27b"],
      ["Энергия", "energyCost", "#ff8c00"],
      ["Вода и ЦОС", "waterCost", "#38a3c7"],
      ["Прочий передел", "conversionCost", "#8b5cf6"],
    ].map(([name, key, color]) => ({
      name,
      value: S(t.rows, key) / 1e6,
      color,
    }));
    const marginByProduct = M.products
      .filter((p) => family === "all" || p.family === family)
      .map((p) => ({
        name: p.name,
        value:
          S(
            t.rows.filter((x) => x.product === p.id),
            "margin",
          ) / 1e6,
        color: p.family === "Картон" ? "#4769ff" : "#19a27b",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
    return `<div class="kpis">${kpi("Выручка", money(t.revenue), "млн ₽", "Отгрузки × цена реализации", true)}${kpi("Переменная себестоимость", money(t.variable), "млн ₽", "Себестоимость только проданного объёма")}${kpi("Маржинальный доход", money(t.margin), "млн ₽", "После логистики и хранения", true)}${kpi("Рентабельность по МД", pct(t.margin / t.revenue), "", "Не EBITDA и не чистая прибыль")}</div><div class="insight">Постоянные затраты, амортизация, проценты, налоги и инвестиции не включены. Непроданные остатки не списываются в себестоимость продаж; хранение — по среднему запасу. Цены и затраты условные, не коммерческие данные компании.</div><div class="grid equal">${panel("Маржинальный доход по месяцам", "Доход после переменных затрат, логистики и хранения", chart("Маржинальный доход", [{ name: "Маржинальный доход", values: monthly(r, "margin").map((x) => x / 1e6), color: "#4769ff" }], "млн ₽"))}${panel(
      "Waterfall маржинального дохода",
      "Выручка минус затраты по процессам · компоненты сходятся с маржинальным доходом",
      `<div class="waterfall">${[
        ["Выручка", t.revenue, "start"],
        ["Сырьё и производство", -t.variable, "cost"],
        ["Логистика", -t.logistics, "cost"],
        ["Запасы и хранение", -t.holding, "cost"],
        ["Маржинальный доход", t.margin, "total"],
      ]
        .map(
          ([label, value, type]) =>
            `<div class="waterfall-col"><strong>${money(Math.abs(value))}</strong><div class="waterfall-bar ${type}" style="height:${Math.max(8, (Math.abs(value) / (Math.max(1, t.revenue) * 1.05)) * 150)}px"></div><small>${label}</small></div>`,
        )
        .join(
          "",
        )}</div><p>Мост показан в абсолютных суммах; затраты разделены по доступным в модели статьям. Финансовые данные демонстрационные.</p>`,
    )}</div><div class="grid equal chart-grid">${panel("Структура переменной себестоимости", "Себестоимость проданного объёма по пяти согласованным компонентам", horizontalChart("Структура себестоимости", costStructure, "млн ₽"))}${panel("Маржинальный доход по продуктам", "Топ-6 продуктовых групп за выбранный период", horizontalChart("Маржинальный доход по продуктам", marginByProduct, "млн ₽"))}</div>${panel(
      "Выручка и затраты по месяцам",
      "Сопоставление выручки, себестоимости и маржинального результата",
      chart(
        "Экономика по месяцам",
        [
          {
            name: "Выручка",
            values: monthly(r, "revenue").map((x) => x / 1e6),
            color: "#4769ff",
          },
          {
            name: "Переменные затраты",
            values: monthly(r, "variable").map((x) => x / 1e6),
            color: "#a1a9b7",
          },
          {
            name: "Маржинальный доход",
            values: monthly(r, "margin").map((x) => x / 1e6),
            color: "#19a27b",
          },
        ],
        "млн ₽",
      ),
    )}${panel(
      "Экономика по ассортименту",
      "НДС не учитывается · ценовой тренд +0,2% исходной цены в месяц",
      table(
        [
          "Продукт",
          "Отгрузки, т",
          "Ср. цена, ₽/т",
          "Выручка, млн ₽",
          "Себестоимость",
          "Логистика",
          "Хранение",
          "МД, млн ₽",
        ],
        M.products
          .filter((p) => family === "all" || p.family === family)
          .map((p) => {
            const rr = t.rows.filter((x) => x.product === p.id);
            return [
              p.name,
              fmt(S(rr, "sales")),
              fmt(S(rr, "revenue") / S(rr, "sales") || 0),
              money(S(rr, "revenue")),
              money(S(rr, "variable")),
              money(S(rr, "logistics")),
              money(S(rr, "holding")),
              money(S(rr, "margin")),
            ];
          }),
      ),
    )}`;
  }
  function compareView() {
    const ar = results.get(a),
      br = results.get(b),
      at = totals(ar),
      bt = totals(br);
    const changes = [
      ["Выручка", bt.revenue - at.revenue],
      ["Переменная себестоимость", at.variable - bt.variable],
      ["Логистика", at.logistics - bt.logistics],
      ["Хранение", at.holding - bt.holding],
    ];
    const max = Math.max(1, ...changes.map((x) => Math.abs(x[1])));
    const comparable = [...results].map(([id, r]) => ({ id, r, t: totals(r) }));
    const candidates = comparable.filter(
      (x) => x.t.coverage >= 0.97 && x.r.checks.every((c) => c.ok),
    );
    const recommended = [...candidates].sort(
      (x, y) => y.t.margin - x.t.margin,
    )[0];
    const metrics = [
      ["Спрос, т", at.demand, bt.demand, "qty", 0],
      ["Отгрузки, т", at.sales, bt.sales, "qty", 1],
      ["Покрытие спроса", at.coverage, bt.coverage, "pct", 1],
      ["Годный выпуск, т", at.production, bt.production, "qty", 0],
      ["Конечный запас, т", at.end, bt.end, "qty", 0],
      ["Выручка, млн ₽", at.revenue, bt.revenue, "money", 1],
      ["Маржинальный доход, млн ₽", at.margin, bt.margin, "money", 1],
      ["Логистика, млн ₽", at.logistics, bt.logistics, "money", -1],
      ["Хранение, млн ₽", at.holding, bt.holding, "money", -1],
    ];
    const heatRows = M.products
      .filter((p) => family === "all" || p.family === family)
      .map((p) => [
        p.name,
        ...M.months.map((_, m) => {
          const delta =
            S(
              br.rows.filter((x) => x.product === p.id && x.month === m),
              "margin",
            ) -
            S(
              ar.rows.filter((x) => x.product === p.id && x.month === m),
              "margin",
            );
          return `<span class="${delta >= 0 ? "delta-pos" : "delta-neg"}">${delta > 0 ? "+" : ""}${money(delta)}</span>`;
        }),
      ]);
    return `<div class="compare-selects"><label>ВЕРСИЯ A · ТОЧКА ОТСЧЁТА<select id="compare-a">${options(a)}</select></label><label>ВЕРСИЯ B · КАНДИДАТ<select id="compare-b">${options(b)}</select></label></div><div class="insight"><strong>${recommended ? `По правилу выбора: ${esc(recommended.r.config.name)}` : "Нет версии, удовлетворяющей порогу сервиса 97%."}</strong> Максимальный маржинальный доход среди проверенных версий с покрытием не ниже 97% в текущем срезе. Это управленческое правило, не доказательство оптимальности. Разница спроса B − A: ${fmt(bt.demand - at.demand)} т.</div>${panel(
      "Матрица всех версий",
      "Одинаковый исходный спрос у пяти штатных версий. Пользовательская копия может менять спрос.",
      table(
        [
          "Версия",
          "Спрос, т",
          "Отгрузки, т",
          "Покрытие",
          "МД, млн ₽",
          "Запас, т",
          "Проверки",
        ],
        comparable.map(({ r, t }) => [
          esc(r.config.name),
          fmt(t.demand),
          fmt(t.sales),
          pct(t.coverage),
          money(t.margin),
          fmt(t.end),
          r.checks.every((c) => c.ok)
            ? '<span class="pill">Пройдены</span>'
            : '<span class="pill red">Есть ошибки</span>',
        ]),
      ),
    )}<div class="grid equal">${panel(
      "Ключевые различия A → B",
      "Для запасов и выпуска больше не всегда лучше.",
      table(
        ["Метрика", "A", "B", "B − A", "Лидер"],
        metrics.map(([name, av, bv, type, direction]) => {
          const f = (v) =>
            type === "money" ? money(v) : type === "pct" ? pct(v) : fmt(v);
          const delta = bv - av;
          return [
            name,
            f(av),
            f(bv),
            `<span class="${direction && delta * direction >= 0 ? "delta-pos" : direction ? "delta-neg" : ""}">${delta > 0 ? "+" : ""}${type === "pct" ? fmt(delta * 100, 1) + " п.п." : f(delta)}</span>`,
            av === bv ? "Ничья" : (bv - av) * direction > 0 ? "B" : "A",
          ];
        }),
      ),
    )}${panel("Мост изменения маржинального дохода", "Положительный вклад улучшает результат B относительно A.", changes.map(([name, value]) => `<div class="bridge-row"><span>${name}</span><div class="bridge-track"><div class="bridge-bar ${value < 0 ? "negative" : ""}" style="width:${(Math.abs(value) / max) * 100}%"></div></div><strong>${value > 0 ? "+" : ""}${money(value)} млн ₽</strong></div>`).join("") + `<hr style="border:0;border-top:1px solid #e3e9ef"><p><strong>Итого B − A: ${money(bt.margin - at.margin)} млн ₽.</strong> Компоненты моста точно сходятся с разницей результата.</p>`)}</div>${panel("Маржинальный доход: продукт × месяц", "Δ B − A, млн ₽ · все месяцы показаны для контекста, даже при фильтре одного месяца", table(["Продукт", ...M.months], heatRows))}${panel(
      "Профили сценариев",
      "Что изменено относительно базового плана",
      table(
        ["Версия", "Плановое решение"],
        [...results].map(([, r]) => [esc(r.config.name), esc(r.config.desc)]),
      ),
    )}`;
  }
  function closeExpandedPanel() {
    expandedPanel = null;
    document.body.classList.remove("has-expanded-panel");
    document.querySelectorAll(".panel.is-expanded").forEach((panelEl) => {
      panelEl.classList.remove("is-expanded");
      const btn = panelEl.querySelector(".panel-toggle");
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute(
          "aria-label",
          `Развернуть: ${panelEl.querySelector("h2").textContent}`,
        );
        btn.querySelector("span:last-child").textContent = "Развернуть";
      }
    });
  }

  function toggleExpandedPanel(id) {
    const panelEl = document.getElementById(id);
    if (!panelEl) return;
    const opening = !panelEl.classList.contains("is-expanded");
    closeExpandedPanel();
    if (!opening) return;
    expandedPanel = id;
    panelEl.classList.add("is-expanded");
    document.body.classList.add("has-expanded-panel");
    const btn = panelEl.querySelector(".panel-toggle");
    btn.setAttribute("aria-expanded", "true");
    btn.querySelector("span:last-child").textContent = "Свернуть";
    btn.setAttribute(
      "aria-label",
      `Свернуть в обычный вид: ${panelEl.querySelector("h2").textContent}`,
    );
    panelEl.scrollTop = 0;
    btn.focus();
  }

  function render() {
    closeExpandedPanel();
    panelCounter = 0;
    const r = results.get(active),
      t = totals(r),
      current = tabs.find((x) => x[0] === tab);
    $("#nav").innerHTML = tabs
      .map(
        ([id, icon, label]) =>
          `<button type="button" data-tab="${id}" class="${id === tab ? "active" : ""}" ${id === tab ? 'aria-current="page"' : ""} title="${esc(label)}"><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${label}</span></button>`,
      )
      .join("");
    $("#scenario").innerHTML = options(active);
    $("#title").textContent = current[2];
    $("#subtitle").textContent = current[3];
    const failed = r.checks.filter((c) => !c.ok);
    $("#validation").textContent = failed.length
      ? `${failed.length} ошибок проверки`
      : `✓ ${r.checks.length} проверок`;
    $("#validation").className = `status${failed.length ? " bad" : ""}`;
    $("#validation").title = failed.length
      ? failed.map((c) => c.name).join("; ")
      : "Материальные, ресурсные и финансовые балансы сходятся";
    const views = {
      overview,
      demand: demandView,
      production: productionView,
      resources: resourcesView,
      capacity: capacityView,
      network: networkView,
      movements: movementView,
      finance: financeView,
      compare: compareView,
    };
    $("#content").innerHTML = views[tab](r, t);
    wireContent();
  }

  function wireContent() {
    document.querySelectorAll("[data-flow-mode]").forEach(
      (btn) =>
        (btn.onclick = () => {
          flowMode = btn.dataset.flowMode;
          render();
        }),
    );
    document
      .querySelectorAll("[data-expand-panel]")
      .forEach(
        (btn) =>
          (btn.onclick = () => toggleExpandedPanel(btn.dataset.expandPanel)),
      );
    document.querySelectorAll("[data-legend]").forEach(
      (btn) =>
        (btn.onclick = () => {
          const block = btn.closest(".chart-block");
          const g = block?.querySelector(
            `.chart-series[data-series="${btn.dataset.legend}"]`,
          );
          if (!g) return;
          const show = btn.getAttribute("aria-pressed") === "false";
          btn.setAttribute("aria-pressed", String(show));
          g.style.display = show ? "" : "none";
        }),
    );
    document.querySelectorAll("[data-tab]").forEach(
      (el) =>
        (el.onclick = () => {
          tab = el.dataset.tab;
          render();
          $("#main").focus();
        }),
    );
    document.querySelectorAll("[data-camp-month]").forEach(
      (el) =>
        (el.onclick = () => {
          month = String(el.dataset.campMonth);
          fromMonth = toMonth = Number(month);
          $("#month").value = month;
          $("#fromMonth").value = month;
          $("#toMonth").value = month;
          render();
        }),
    );
    document.querySelectorAll("[data-page]").forEach(
      (el) =>
        (el.onclick = () => {
          pages[el.dataset.page].page += Number(el.dataset.step);
          render();
        }),
    );
    document.querySelectorAll("[data-search]").forEach(
      (el) =>
        (el.oninput = () => {
          const id = el.dataset.search,
            pos = el.selectionStart;
          pages[id].search = el.value;
          pages[id].page = 0;
          render();
          const input = document.querySelector(`[data-search="${id}"]`);
          input.focus();
          input.setSelectionRange(pos, pos);
        }),
    );
    if ($("#compare-a"))
      $("#compare-a").onchange = (e) => {
        a = e.target.value;
        render();
      };
    if ($("#compare-b"))
      $("#compare-b").onchange = (e) => {
        b = e.target.value;
        render();
      };
  }

  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").style.display = "block";
    setTimeout(() => ($("#toast").style.display = "none"), 4500);
  }

  function buildPeriodControls() {
    const periodOptions = [
      ["all", `Весь год · ${year}`],
      ["h1", "I полугодие"],
      ["h2", "II полугодие"],
      ["q1", "I квартал"],
      ["q2", "II квартал"],
      ["q3", "III квартал"],
      ["q4", "IV квартал"],
      ["custom", "Произвольный диапазон"],
    ];
    $("#month").innerHTML =
      periodOptions
        .map(([value, label]) => `<option value="${value}">${label}</option>`)
        .join("") +
      M.months
        .map((name, i) => `<option value="${i}">${name} ${year}</option>`)
        .join("");
    $("#month").value = month;
    ["#fromMonth", "#toMonth"].forEach((sel) => {
      $(sel).innerHTML = M.months
        .map((name, i) => `<option value="${i}">${name} ${year}</option>`)
        .join("");
    });
    $("#fromMonth").value = String(fromMonth);
    $("#toMonth").value = String(toMonth);
    $("#cycle-tag").textContent = String(year);
    $("#period-status").textContent =
      year === 2026
        ? "Янв–сен факт · Окт–дек актуализация"
        : "Прогноз · 12 месяцев";
    $("#footer-period").textContent =
      year === 2026
        ? "Факт и актуализация: январь — декабрь 2026"
        : "Прогноз: январь — декабрь 2027";
    document.querySelectorAll("[data-year]").forEach((btn) => {
      const selected = Number(btn.dataset.year) === year;
      btn.classList.toggle("active", selected);
      btn.setAttribute("aria-pressed", String(selected));
    });
  }

  function setYear(nextYear, quiet = false) {
    year = Number(nextYear) === 2027 ? 2027 : 2026;
    results = new Map(
      [...horizonResults].map(([id, r]) => [id, M.forYear(r, year)]),
    );
    month = "all";
    fromMonth = 0;
    toMonth = 11;
    Object.keys(pages).forEach((k) => delete pages[k]);
    buildPeriodControls();
    if (!quiet) render();
  }

  document
    .querySelectorAll("[data-year]")
    .forEach((btn) => (btn.onclick = () => setYear(btn.dataset.year)));
  ["#fromMonth", "#toMonth"].forEach(
    (sel) =>
      ($(sel).onchange = (e) => {
        if (sel === "#fromMonth") fromMonth = Number(e.target.value);
        else toMonth = Number(e.target.value);
        if (toMonth < fromMonth) {
          if (sel === "#fromMonth") toMonth = fromMonth;
          else fromMonth = toMonth;
        }
        month = "custom";
        buildPeriodControls();
        render();
      }),
  );
  $("#scenario").onchange = (e) => {
    active = e.target.value;
    Object.keys(pages).forEach((k) => delete pages[k]);
    render();
  };
  $("#month").onchange = (e) => {
    month = e.target.value;
    if (/^q[1-4]$/.test(month)) {
      const q = Number(month[1]) - 1;
      fromMonth = q * 3;
      toMonth = fromMonth + 2;
    } else if (/^h[12]$/.test(month)) {
      fromMonth = month === "h1" ? 0 : 6;
      toMonth = fromMonth + 5;
    } else if (/^\d+$/.test(month)) {
      fromMonth = toMonth = Number(month);
    } else if (month === "all") {
      fromMonth = 0;
      toMonth = 11;
    } else return;
    Object.keys(pages).forEach((k) => delete pages[k]);
    buildPeriodControls();
    render();
  };
  $("#family").onchange = (e) => {
    family = e.target.value;
    Object.keys(pages).forEach((k) => delete pages[k]);
    render();
  };

  function initNavigation() {
    const app = $("#app");
    let position = "left",
      collapsed = false;
    try {
      position = localStorage.getItem("kama_nav_position") || "left";
      collapsed = localStorage.getItem("kama_nav_collapsed") === "true";
    } catch (e) {
      /* optional storage */
    }
    const paint = () => {
      const top = position === "top";
      app.classList.toggle("nav-top", top);
      app.classList.toggle("nav-collapsed", collapsed);
      $("#nav-toggle").setAttribute("aria-expanded", String(!collapsed));
      $("#nav-toggle").setAttribute(
        "aria-label",
        collapsed ? "Раскрыть меню" : "Свернуть меню",
      );
      $("#nav-position").setAttribute(
        "aria-label",
        top ? "Вернуть меню слева" : "Перенести меню наверх",
      );
      $("#nav-position").title = top
        ? "Меню сверху — вернуть слева"
        : "Меню слева — перенести наверх";
      $(".nav-position-line").setAttribute("d", top ? "M3 9h18" : "M9 3v18");
    };
    $("#nav-toggle").onclick = () => {
      collapsed = !collapsed;
      try {
        localStorage.setItem("kama_nav_collapsed", String(collapsed));
      } catch (e) {
        /* optional */
      }
      paint();
    };
    $("#nav-position").onclick = () => {
      position = position === "top" ? "left" : "top";
      collapsed = false;
      try {
        localStorage.setItem("kama_nav_position", position);
        localStorage.setItem("kama_nav_collapsed", "false");
      } catch (e) {
        /* optional */
      }
      paint();
    };
    paint();
  }

  function initScenarioEditor() {
    $("#scenario-from").innerHTML = M.months
      .map((name, i) => `<option value="${i + 12}">${name} 2027</option>`)
      .join("");
    $("#scenario-to").innerHTML = $("#scenario-from").innerHTML;
    $("#repair-month-input").innerHTML = M.months
      .map((name, i) => `<option value="${i}">${name} 2027</option>`)
      .join("");
    $("#bdm-repair-month-input").innerHTML = $("#repair-month-input").innerHTML;
  }

  const editorDefaults = {
    demandScale: 1,
    forecastGrowth: 0,
    seasonality: 1,
    priceScale: 1,
    priority: "base",
    kdmRate: 1,
    bdmRate: 1,
    kdmYield: 1,
    bdmYield: 1,
    setupScale: 1,
    minCampaign: 8,
    extra: 0,
    repairMonth: 4,
    extraBdm: 0,
    repairMonthBdm: 6,
    cost: 1,
    coatCost: 1,
    fiberSupply: 1,
    coatSupply: 1,
    fiberIntensity: 1,
    coatIntensity: 1,
    energySupply: 1,
    energyIntensity: 1,
    energyTariff: 1,
    waterSupply: 1,
    waterIntensity: 1,
    waterTariff: 1,
    target: 0.3,
    storageCap: 1,
    freightCost: 1,
    lastMileCost: 1,
    holdingCost: 1,
  };

  function populateEditor(cfg) {
    document.querySelectorAll("#editor [data-param]").forEach((el) => {
      const key = el.dataset.param;
      let value = cfg[key] ?? editorDefaults[key];
      if (
        key === "coatCost" &&
        cfg.coatCost === undefined &&
        cfg.cost !== undefined
      )
        value = cfg.cost;
      const scale = Number(el.dataset.scale || 1);
      el.value = String(typeof value === "number" ? value * scale : value);
    });
    $("#scenario-from").value = String(cfg.periodFrom ?? 12);
    $("#scenario-to").value = String(cfg.periodTo ?? 23);
    $("#editor-error").textContent = "";
  }

  $("#edit").onclick = () => {
    populateEditor(horizonResults.get(active).config);
    $("#editor").showModal();
  };
  $("#cancel").onclick = () => $("#editor").close();
  $("#cancel-x").onclick = () => $("#editor").close();
  $("#editor-reset").onclick = () => {
    const base = active === "custom" ? custom?.base || "balanced" : active;
    populateEditor(horizonResults.get(base).config);
  };
  $("#editor-form").onsubmit = (e) => {
    e.preventDefault();
    const base = active === "custom" ? custom?.base || "balanced" : active;
    const params = {};
    for (const el of document.querySelectorAll("#editor [data-param]")) {
      const key = el.dataset.param;
      if (key === "priority") params[key] = el.value;
      else {
        const raw = Number(el.value),
          scale = Number(el.dataset.scale || 1);
        if (!Number.isFinite(raw)) {
          $("#editor-error").textContent =
            "Проверьте числовые параметры сценария.";
          return;
        }
        params[key] = raw / scale;
      }
    }
    params.periodFrom = Number($("#scenario-from").value);
    params.periodTo = Number($("#scenario-to").value);
    if (params.periodTo < params.periodFrom) {
      $("#editor-error").textContent =
        "Месяц окончания не может быть раньше месяца начала.";
      return;
    }
    const result = M.runHorizon(
      {
        ...M.scenarios.find((c) => c.id === base),
        id: "custom",
        name: "V6 · Пользовательский сценарий",
        desc: `Копия ${base}; период ${M.months[params.periodFrom - 12]}–${M.months[params.periodTo - 12]} 2027; спрос ${fmt(params.demandScale * 100)}%, цена ${fmt(params.priceScale * 100)}%, целевой запас ${fmt(params.target * 100)}%.`,
      },
      params,
    );
    const failed = result.checks.filter((c) => !c.ok);
    if (failed.length) {
      $("#editor-error").textContent =
        `Сценарий не прошёл проверки: ${failed.map((c) => c.name).join("; ")}. Смягчите ограничения или измените целевой запас.`;
      return;
    }
    const baseForecast = M.forYear(horizonResults.get(base), 2027);
    const customForecast = M.forYear(result, 2027);
    const marginDelta = customForecast.total.margin - baseForecast.total.margin;
    custom = { base, params };
    horizonResults.set("custom", result);
    active = "custom";
    b = "custom";
    let saved = true;
    try {
      localStorage.setItem("kama_sop_custom_v1", JSON.stringify(custom));
    } catch (err) {
      saved = false;
    }
    $("#editor").close();
    setYear(2027, true);
    render();
    toast(
      `${saved ? "Сценарий сохранён. " : "Сценарий рассчитан без локального сохранения. "}Прогноз 2027: Δ МД ${marginDelta >= 0 ? "+" : ""}${money(marginDelta)} млн ₽.`,
    );
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expandedPanel) closeExpandedPanel();
  });
  document.addEventListener("click", (e) => {
    if (
      expandedPanel &&
      !e.target.closest(".panel.is-expanded") &&
      !e.target.closest("[data-expand-panel]")
    )
      closeExpandedPanel();
  });

  $("#export").onclick = () => {
    try {
      const r = results.get(active),
        wb = XLSX.utils.book_new();
      const add = (name, data) =>
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name);
      add("Описание", [
        {
          Поле: "Источник",
          Значение: "Демонстрационные данные, не фактические показатели КАМА",
        },
        { Поле: "Версия", Значение: r.config.name },
        {
          Поле: "Горизонт",
          Значение: `Январь–декабрь ${year}, полный год, весь ассортимент; фильтры экрана не применяются`,
        },
        {
          Поле: "Статус",
          Значение:
            year === 2026 ? "Янв–сен факт, Окт–дек актуализация" : "Прогноз",
        },
        { Поле: "Деньги", Значение: "Рубли без НДС; объёмы в тоннах" },
        { Поле: "Параметры", Значение: JSON.stringify(r.config) },
      ]);
      add(
        "План SKU",
        r.rows.map((x) => ({
          Месяц: `${M.months[x.month]} ${year}`,
          SKU: x.sku,
          Продукт: product(x.product).name,
          Статус:
            x.dataType === "actual"
              ? "Факт"
              : x.dataType === "estimate"
                ? "Актуализация"
                : "Прогноз",
          Спрос_т: x.demand,
          Выпуск_т: x.production,
          Отгрузки_т: x.sales,
          Начальный_запас_т: x.start,
          Конечный_запас_т: x.end,
          Дефицит_т: x.gap,
          Выручка_руб: x.revenue,
          Переменные_затраты_руб: x.variable,
          Логистика_руб: x.logistics,
          Хранение_руб: x.holding,
          Маржинальный_доход_руб: x.margin,
        })),
      );
      add("Кампании", r.campaigns);
      add("Раскрой", r.cuts);
      add("Мощности", r.capacities);
      add("Сырьё", [...r.resources, ...(r.utilities || [])]);
      add("Склады", r.ledgers);
      add("Клиентский спрос", r.customerRows);
      add("Клиенты", M.clients);
      add("Ассортимент", M.skus);
      add(
        "Версии",
        [...results].map(([, x]) => ({ Версия: x.config.name, ...x.total })),
      );
      add("Проверки", r.checks);
      XLSX.writeFile(wb, `KAMA_${year}_${active}.xlsx`);
      toast(`Экспортирован ${year} год, все направления.`);
    } catch (e) {
      toast("Не удалось сформировать Excel: " + e.message);
    }
  };

  initScenarioEditor();
  initNavigation();
  buildPeriodControls();
  populateEditor(horizonResults.get(active).config);
  render();
})();
