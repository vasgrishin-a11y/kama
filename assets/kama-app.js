/* Browser presentation: no network requests, DB connections or external assets. */
(function () {
  "use strict";
  const M = window.KamaModel,
    A = window.KamaAnalytics,
    O = window.KamaOrders,
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
      "orders",
      "✓",
      "Управление заказами",
      "Ежедневное согласование портфеля заказов с запасами, кампаниями S&OP и отгрузками.",
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
  const business2026 = M.runBusinessPlan(2026);
  const businessResults = new Map([
    [2026, business2026],
    [2027, M.runBusinessPlan(2027, business2026)],
  ]);
  let active = "balanced",
    tab = "overview",
    month = "all",
    family = "all",
    a = "base",
    b = "balanced",
    fromMonth = 0,
    toMonth = 11,
    flowMode = "volume",
    revenueMetric = "revenue",
    stockMode = "volume",
    cutMachine = "all",
    cutPage = 0,
    segmentReviewOnly = false,
    segmentOff = new Set(),
    movementModes = {
      inbound: "volume",
      inboundDetail: "supplier",
      internal: "volume",
      rc: "volume",
      rcDetail: "node",
      customers: "volume",
      customerDetail: "customer",
    },
    orderPlan = null,
    orderSelected = new Set(),
    orderNotice = "Портфель загружен · требуется подтверждение пересчётом",
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
      fixedCost: S(rows, "fixedCost"),
      fullCost: S(rows, "fullCost"),
      operatingProfit: S(rows, "operatingProfit"),
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
      body.includes('class="chart"') || body.includes('class="chart ') || body.includes('class="process-sankey"');
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
      svg += `<line x1="${splitX}" x2="${splitX}" y1="${top}" y2="${top + plotH}" stroke="#aab4c4" stroke-dasharray="3 4"/><text x="${splitX + 5}" y="${top + 10}" class="chart-note">план S&OP</text>`;
    }
    const bars = series.filter((s) => !s.line);
    series.forEach((s, j) => {
      svg += `<g class="chart-series" data-series="${j}">`;
      if (s.line) {
        let segment = [];
        const flush = () => {
          if (segment.length > 1)
            svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2.4" stroke-dasharray="${s.dashed === false ? "0" : "6 4"}" points="${segment.join(" ")}"/>`;
          segment = [];
        };
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return flush();
          segment.push(`${left + ((i + 0.5) * plotW) / 12},${y(v)}`);
        });
        flush();
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          svg += `<circle cx="${left + ((i + 0.5) * plotW) / 12}" cy="${y(v)}" r="3" fill="${s.color}"><title>${M.months[i]} ${s.seriesYear || year} · ${esc(s.name)}: ${fmt(v, 1)} ${unit}</title></circle>`;
        });
      } else {
        const barIndex = bars.indexOf(s);
        const groupW = (plotW / 12) * 0.74;
        const bw = groupW / Math.max(1, bars.length);
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
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
      (year === 2026 ? "Янв–сен факт · Окт–дек план нового цикла" : "Прогноз 2027");
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
  function metricSum(rows) {
    return {
      demand: S(rows, "demand"),
      sales: S(rows, "sales"),
      production: S(rows, "production"),
      revenue: S(rows, "revenue"),
      margin: S(rows, "margin"),
      variable: S(rows, "variable"),
      fixedCost: S(rows, "fixedCost"),
      fullCost: S(rows, "fullCost"),
      operatingProfit: S(rows, "operatingProfit"),
      gap: S(rows, "gap"),
    };
  }

  function comparisonFoot(value, plan, formatter = money, suffix = "млн ₽") {
    const delta = value - plan;
    const relative = plan ? (delta / Math.abs(plan)) * 100 : 0;
    return `<span class="${delta >= 0 ? "delta-pos" : "delta-neg"}">${delta >= 0 ? "+" : ""}${formatter(delta)} ${suffix} · ${delta >= 0 ? "+" : ""}${fmt(relative, 1)}%</span> к БП`;
  }

  function revenueDirectionChart(currentRows, planRows) {
    const config = {
      revenue: { key: "revenue", label: "Выручка", unit: "млн ₽", scale: 1e6 },
      margin: { key: "margin", label: "Маржинальный доход", unit: "млн ₽", scale: 1e6 },
      sales: { key: "sales", label: "Отгрузки", unit: "т", scale: 1 },
    }[revenueMetric];
    const families = ["Картон", "Бумага"].filter(
      (name) => family === "all" || family === name,
    );
    const palette = {
      Картон: ["#3155d9", "#4769ff", "#6482ff", "#8299ff", "#a24fc4", "#c0659f"],
      Бумага: ["#087f64", "#19a27b", "#35b493", "#58c3a7", "#7cd0ba", "#9adccb"],
    };
    const groups = families.map((name) => {
      const items = M.products.filter((p) => p.family === name).map((p, index) => {
        const rows = currentRows.filter((row) => row.product === p.id);
        const bpRows = planRows.filter((row) => row.product === p.id);
        const value = S(rows, config.key) / config.scale;
        const bp = S(bpRows, config.key) / config.scale;
        return { product: p, value, bp, color: palette[name][index] };
      });
      return {
        name,
        items,
        total: S(currentRows.filter((row) => row.family === name), config.key) / config.scale,
        bp: S(planRows.filter((row) => row.family === name), config.key) / config.scale,
      };
    });
    const maximum = Math.max(1, ...groups.flatMap((g) => g.items.flatMap((d) => [d.value, d.bp])));
    const rowH = 35, groupH = 45, left = 235, right = 120, top = 40, w = 900;
    const h = top + groups.reduce((n, g) => n + groupH + g.items.length * rowH, 0) + 20;
    const plotW = w - left - right;
    const x = (value) => left + (Math.max(0, value) / maximum) * plotW;
    let y = top;
    let svg = `<svg class="chart revenue-mix-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${config.label} по направлениям и продуктовым группам"><title>${config.label}: текущий план и бизнес-план по всем продуктовым группам</title>`;
    for (const group of groups) {
      const delta = group.bp ? ((group.total - group.bp) / group.bp) * 100 : 0;
      svg += `<text x="12" y="${y + 18}" class="revenue-group-title">${group.name}</text><text x="${left}" y="${y + 18}" class="revenue-group-total">${fmt(group.total, 1)} ${config.unit}</text><text x="${w - 8}" y="${y + 18}" text-anchor="end" class="${delta >= 0 ? "svg-pos" : "svg-neg"}">${delta >= 0 ? "+" : ""}${fmt(delta, 1)}% к БП</text>`;
      y += groupH;
      for (const item of group.items) {
        const share = group.total ? (item.value / group.total) * 100 : 0;
        const name = item.product.name.length > 30 ? `${item.product.name.slice(0, 29)}…` : item.product.name;
        svg += `<text x="${left - 14}" y="${y + 15}" text-anchor="end" class="row-label">${esc(name)}</text><rect x="${left}" y="${y}" width="${plotW}" height="20" rx="5" fill="#f0f3f7"/><rect x="${left}" y="${y}" width="${Math.max(2, x(item.value) - left)}" height="20" rx="5" fill="${item.color}"><title>${esc(item.product.name)} · ${config.label}: ${fmt(item.value, 1)} ${config.unit}; БП ${fmt(item.bp, 1)}; доля направления ${fmt(share, 1)}%</title></rect><line x1="${x(item.bp)}" x2="${x(item.bp)}" y1="${y - 4}" y2="${y + 24}" stroke="#17283e" stroke-width="2"><title>Бизнес-план: ${fmt(item.bp, 1)} ${config.unit}</title></line><text x="${w - 8}" y="${y + 15}" text-anchor="end" class="value">${fmt(item.value, 1)} · ${fmt(share, 0)}%</text>`;
        y += rowH;
      }
      y += 8;
    }
    svg += "</svg>";
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Показатель выручки по направлениям">${[["revenue", "Выручка"], ["margin", "МД"], ["sales", "Отгрузки"]].map(([id, label]) => `<button type="button" data-revenue-metric="${id}" aria-pressed="${revenueMetric === id}">${label}</button>`).join("")}</div><span class="chart-context"><i class="bp-marker"></i> метка — бизнес-план · значение / доля направления</span></div><div class="chart-scroll">${svg}</div>`;
  }

  function overview(r, t) {
    const previous = results.get(M.previousSopId);
    const bp = businessResults.get(year);
    const bpTotals = totals(bp);
    const factEnd = year === 2026 ? 8 : -1;
    const remainingStart = year === 2026 ? 9 : 0;
    const inFamily = (row) => family === "all" || row.family === family;
    const factRows = previous.rows.filter((row) => row.month <= factEnd && inFamily(row));
    const remainingRows = previous.rows.filter((row) => row.month >= remainingStart && inFamily(row));
    const landingRows = previous.rows.filter(inFamily);
    const bpFactRows = bp.rows.filter((row) => row.month <= factEnd && inFamily(row));
    const bpRemainingRows = bp.rows.filter((row) => row.month >= remainingStart && inFamily(row));
    const bpLandingRows = bp.rows.filter(inFamily);
    const fact = metricSum(factRows), remaining = metricSum(remainingRows), landing = metricSum(landingRows);
    const bpFact = metricSum(bpFactRows), bpRemaining = metricSum(bpRemainingRows), bpLanding = metricSum(bpLandingRows);
    const actualForecastMonthly = (key, scale = 1) => M.months.map((_, m) => {
      if (year === 2026 && m < 9) return null;
      return S(previous.rows.filter((row) => row.month === m && inFamily(row)), key) / scale;
    });
    const actualMonthly = (key, scale = 1) => M.months.map((_, m) => {
      if (year !== 2026 || m > 8) return null;
      return S(previous.rows.filter((row) => row.month === m && inFamily(row)), key) / scale;
    });
    const bpMonthly = (key, scale = 1) => M.months.map((_, m) => S(bp.rows.filter((row) => row.month === m && inFamily(row)), key) / scale);
    const landingMonthly = (key, scale = 1) => M.months.map((_, m) => S(previous.rows.filter((row) => row.month === m && inFamily(row)), key) / scale);
    const periodLabel = year === 2026 ? "Янв–сен 2026" : "2027";
    const remainingLabel = year === 2026 ? "Окт–дек 2026 · прошлый S&OP" : "Прогноз 2027 · прошлый S&OP";
    const rowsTable = M.months.map((name, m) => {
      const currentRows = previous.rows.filter((row) => row.month === m && inFamily(row));
      const planRows = bp.rows.filter((row) => row.month === m && inFamily(row));
      const current = metricSum(currentRows), plan = metricSum(planRows);
      const status = year === 2026 && m < 9 ? "Факт" : "Прогноз прошлого S&OP";
      return [
        `${name} ${year}`, status,
        fmt(plan.sales), fmt(current.sales),
        `<span class="${current.sales >= plan.sales ? "delta-pos" : "delta-neg"}">${current.sales - plan.sales >= 0 ? "+" : ""}${fmt(current.sales - plan.sales)}</span>`,
        money(plan.revenue), money(current.revenue),
        `<span class="${current.revenue >= plan.revenue ? "delta-pos" : "delta-neg"}">${current.revenue - plan.revenue >= 0 ? "+" : ""}${money(current.revenue - plan.revenue)}</span>`,
        money(current.margin),
      ];
    }).filter((_, m) => m >= fromMonth && m <= toMonth);
    const headline = year === 2026 ? fact : landing;
    const bpHeadline = year === 2026 ? bpFact : bpLanding;
    const headlineLabel = year === 2026 ? `факт ${periodLabel}` : "прогноз прошлого S&OP · 2027";
    const fourth = year === 2026
      ? kpi("Выручка · оставшийся прогноз", money(remaining.revenue), "млн ₽", `БП ${money(bpRemaining.revenue)} · ${comparisonFoot(remaining.revenue, bpRemaining.revenue)}`)
      : kpi("Выручка · активный сценарий", money(t.revenue), "млн ₽", `БП ${money(bpTotals.revenue)} · ${comparisonFoot(t.revenue, bpTotals.revenue)}`);
    const fifth = year === 2026
      ? kpi("МД · закрытие года", money(landing.margin), "млн ₽", `БП ${money(bpLanding.margin)} · ${comparisonFoot(landing.margin, bpLanding.margin)}`, true)
      : kpi("МД · активный сценарий", money(t.margin), "млн ₽", `БП ${money(bpTotals.margin)} · ${comparisonFoot(t.margin, bpTotals.margin)}`, true);
    const sixth = year === 2026
      ? kpi("Опер. прибыль · закрытие года", money(landing.operatingProfit), "млн ₽", `БП ${money(bpLanding.operatingProfit)} · ${comparisonFoot(landing.operatingProfit, bpLanding.operatingProfit)}`)
      : kpi("Опер. прибыль · активный сценарий", money(t.operatingProfit), "млн ₽", `БП ${money(bpTotals.operatingProfit)} · ${comparisonFoot(t.operatingProfit, bpTotals.operatingProfit)}`);
    return `<div class="kpis overview-kpis">
      ${kpi(`Выручка · ${headlineLabel}`, money(headline.revenue), "млн ₽", `БП ${money(bpHeadline.revenue)} · ${comparisonFoot(headline.revenue, bpHeadline.revenue)}`, true)}
      ${kpi(`МД · ${headlineLabel}`, money(headline.margin), "млн ₽", `БП ${money(bpHeadline.margin)} · ${comparisonFoot(headline.margin, bpHeadline.margin)}`, true)}
      ${kpi(`Отгрузки · ${headlineLabel}`, fmt(headline.sales), "т", `БП ${fmt(bpHeadline.sales)} · ${comparisonFoot(headline.sales, bpHeadline.sales, fmt, "т")}`)}
      ${fourth}${fifth}${sixth}
    </div>
    <div class="insight"><strong>Единая база сравнения — утверждённый бизнес-план.</strong> Факт: январь–сентябрь 2026. Оставшийся период: прогноз прошлого цикла S&OP (${esc(previous.config.name)}), а не активный сценарий. План нового цикла начинается с октября 2026; денежные показатели без НДС.</div>
    <div class="grid equal chart-grid">
      ${panel("Объём: бизнес-план, факт и оставшийся прогноз", `${remainingLabel} · тонны`, chart("План-факт отгрузок", [
        { name: "Бизнес-план", values: bpMonthly("sales"), color: "#b8c0cc" },
        { name: "Факт", values: actualMonthly("sales"), color: "#4769ff" },
        { name: "Прогноз прошлого S&OP", values: actualForecastMonthly("sales"), color: "#8b5cf6", line: true, dashed: false },
      ], "т", { compare: true, context: "БП · факт · прошлый S&OP" }))}
      ${panel("Выручка: закрытие года против бизнес-плана", "Факт и прогноз объединены в ожидаемое закрытие года", chart("Выручка против бизнес-плана", [
        { name: "Бизнес-план", values: bpMonthly("revenue", 1e6), color: "#b8c0cc" },
        { name: "Факт", values: actualMonthly("revenue", 1e6), color: "#4769ff" },
        { name: "Ожидаемое закрытие", values: landingMonthly("revenue", 1e6), color: "#19a27b", line: true, dashed: false },
        { name: "Отклонение от БП", values: landingMonthly("revenue", 1e6).map((v, i) => v - bpMonthly("revenue", 1e6)[i]), color: "#ed0084", line: true },
      ], "млн ₽", { compare: true, context: "Отклонение = факт / прогноз − БП" }))}
    </div>
    ${panel("Выручка по направлениям", "Укрупнённая группировка по всем продуктовым группам · столбец — текущий план, риска — бизнес-план", revenueDirectionChart(t.rows, bpTotals.rows), "revenue-panel")}
    <div class="grid equal chart-grid">
      ${panel("Маржинальный доход: план-факт", "Ожидаемое закрытие и отклонение от бизнес-плана", chart("МД против бизнес-плана", [
        { name: "Бизнес-план", values: bpMonthly("margin", 1e6), color: "#b8c0cc" },
        { name: "Факт / прогноз прошлого S&OP", values: landingMonthly("margin", 1e6), color: "#19a27b", line: true, dashed: false },
        { name: "Отклонение от БП", values: landingMonthly("margin", 1e6).map((v, i) => v - bpMonthly("margin", 1e6)[i]), color: "#ed0084", line: true },
      ], "млн ₽", { compare: true, context: "Все отклонения от БП" }))}
      ${panel("Производство и запас против бизнес-плана", "Выпуск — столбцы; конечный запас — линии", chart("Производство и запас против БП", [
        { name: "Выпуск · БП", values: bpMonthly("production"), color: "#c4ccd7" },
        { name: "Выпуск · факт / прогноз", values: landingMonthly("production"), color: "#8b5cf6" },
        { name: "Запас · БП", values: bpMonthly("end"), color: "#ed0084", line: true },
        { name: "Запас · факт / прогноз", values: landingMonthly("end"), color: "#4769ff", line: true, dashed: false },
      ], "т", { compare: true, context: "БП и прошлый S&OP" }))}
    </div>
    ${panel("План-факт по месяцам", "Факт за прошедший период; оставшийся прогноз строго по прошлому циклу S&OP; Δ = показатель − бизнес-план", table(["Месяц", "Статус", "Отгрузки БП, т", "Факт / прогноз, т", "Δ, т", "Выручка БП, млн ₽", "Факт / прогноз, млн ₽", "Δ выручки", "МД, млн ₽"], rowsTable))}`;
  }

  function clientAnalytics(r) {
    const cr = r.customerRows.filter(eligible);
    const rowMap = new Map(r.rows.map((x) => [`${x.sku}|${x.month}`, x]));
    const economics = (clientRows, key) => S(clientRows, (x) => {
      const source = rowMap.get(`${x.sku}|${x.month}`);
      return source && source.sales ? (x.sales * source[key]) / source.sales : 0;
    });
    const otifTargets = [0.96, 0.95, 0.94, 0.95, 0.92, 0.9];
    const marginTargets = [0.29, 0.25, 0.27, 0.3, 0.21, 0.19];
    const colors = ["#4769ff", "#19a27b", "#8b5cf6", "#e8930c", "#38a3c7", "#64748b"];
    const clients = M.clients.map((client, index) => {
      const rows = cr.filter((x) => x.client === client.id);
      const demand = S(rows, "demand"), sales = S(rows, "sales");
      const revenue = economics(rows, "revenue"), margin = economics(rows, "margin");
      const segmentIndex = M.segments.indexOf(client.segment);
      const coverage = demand ? sales / demand : 0;
      const otifTarget = otifTargets[segmentIndex];
      const otif = Math.max(0.76, Math.min(0.99, coverage * 0.975 + ((index % 5) - 2) * 0.006));
      const marginRate = revenue ? margin / revenue : 0;
      const marginTarget = marginTargets[segmentIndex];
      const review = "", reviewDirection = "";
      return {
        ...client, index, rows, demand, sales, coverage, revenue, margin, marginRate,
        marginTarget, otif, otifTarget, review, reviewDirection,
        color: colors[segmentIndex], segmentIndex,
      };
    });
    const scores = clients.map((client) => ({
      client,
      score: (client.marginRate - client.marginTarget) * 0.7 + (client.otif - client.otifTarget) * 0.3,
    })).sort((a, b) => a.score - b.score);
    scores.filter(({ client }) => client.otif < client.otifTarget || client.marginRate < client.marginTarget).slice(0, 3).forEach(({ client }) => {
      client.review = "На пересмотр: наиболее слабое сочетание маржи и OTIF относительно целей сегмента";
      client.reviewDirection = "down";
    });
    scores.filter((item) => item.score > 0).slice(-2).forEach(({ client }) => {
      client.review = "На пересмотр: кандидат на повышение по марже и сервису";
      client.reviewDirection = "up";
    });
    const segments = M.segments.map((name, index) => {
      const clientsInSegment = clients.filter((client) => client.segment === name);
      const revenue = S(clientsInSegment, "revenue");
      return {
        name, index, clients: clientsInSegment, color: colors[index],
        revenue, margin: S(clientsInSegment, "margin"),
        demand: S(clientsInSegment, "demand"), sales: S(clientsInSegment, "sales"),
        otifTarget: otifTargets[index],
        otif: revenue ? S(clientsInSegment, (client) => client.otif * client.revenue) / revenue : 0,
      };
    });
    return { cr, rowMap, economics, clients, segments };
  }

  function segmentationMatrix(analytics) {
    const margins = analytics.clients.map((client) => Math.max(0, client.margin));
    const min = Math.min(...margins), max = Math.max(...margins);
    const size = (value) => 48 + Math.sqrt((Math.max(0, value) - min) / Math.max(1, max - min)) * 68;
    const bands = analytics.segments.map((segment) => {
      const hidden = segmentOff.has(segment.name);
      const bubbles = segment.clients.sort((a, b) => b.margin - a.margin).map((client) => {
        const dim = hidden || (segmentReviewOnly && !client.review);
        const diameter = size(client.margin);
        const short = client.name.length > 17 ? `${client.name.slice(0, 16)}…` : client.name;
        const title = `${client.name} · ${client.segment}. Выручка ${money(client.revenue)} млн ₽; валовая прибыль ${money(client.margin)} млн ₽; маржа ${pct(client.marginRate)}; OTIF ${pct(client.otif)} при цели ${pct(client.otifTarget)}${client.review ? `. ${client.review}` : ""}`;
        return `<div class="client-bubble ${dim ? "dim" : ""} ${client.reviewDirection ? `review-${client.reviewDirection}` : ""}" style="--bubble:${fmt(diameter, 0)}px;--segment:${client.color}" tabindex="0" title="${esc(title)}" aria-label="${esc(title)}"><span>${esc(short)}</span><strong>${money(client.margin)}</strong><small>млн ₽</small></div>`;
      }).join("");
      return `<div class="segment-band ${hidden ? "is-off" : ""}" style="--segment:${segment.color}"><div class="segment-band-head"><div><b>${esc(segment.name)}</b><span>${segment.clients.length} клиента · выручка ${money(segment.revenue)} млн ₽ · валовая прибыль ${money(segment.margin)} млн ₽</span></div><strong>${pct(segment.otif)} OTIF</strong></div><div class="segment-bubbles">${hidden ? '<span class="muted">Сегмент скрыт фильтром</span>' : bubbles}</div></div>`;
    }).join("");
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Фильтр клиентов на пересмотр"><button type="button" data-seg-review="all" aria-pressed="${!segmentReviewOnly}">Все клиенты</button><button type="button" data-seg-review="review" aria-pressed="${segmentReviewOnly}">⚑ На пересмотр (${analytics.clients.filter((c) => c.review).length})</button></div><span class="chart-context">Площадь круга — валовая прибыль · кольцо: зелёное ↑ / красное ↓</span></div><div class="segment-matrix">${bands}</div><div class="segment-legend">${analytics.segments.map((segment) => `<button type="button" data-seg-toggle="${esc(segment.name)}" class="${segmentOff.has(segment.name) ? "off" : ""}" aria-pressed="${!segmentOff.has(segment.name)}"><i style="background:${segment.color}"></i>${esc(segment.name)}</button>`).join("")}</div>`;
  }

  function otifBySegment(analytics) {
    return `<div class="otif-grid">${analytics.segments.map((segment) => {
      const delta = (segment.otif - segment.otifTarget) * 100;
      return `<article class="otif-card" style="--segment:${segment.color}"><div class="otif-head"><div><small>${esc(segment.name)}</small><strong>${pct(segment.otif)}</strong></div><span class="${delta >= 0 ? "delta-pos" : "delta-neg"}">${delta >= 0 ? "+" : ""}${fmt(delta, 1)} п.п.</span></div><div class="otif-track"><i style="width:${Math.min(100, segment.otif * 100)}%"></i><b style="left:${segment.otifTarget * 100}%" title="Цель ${pct(segment.otifTarget)}"></b></div><div class="otif-target">Цель сегмента ${pct(segment.otifTarget)}</div><div class="otif-clients">${segment.clients.map((client) => {
        const d = (client.otif - client.otifTarget) * 100;
        return `<div class="otif-client" title="${esc(client.name)}: OTIF ${pct(client.otif)}, цель ${pct(client.otifTarget)}"><span>${esc(client.name)}${client.review ? " ⚑" : ""}</span><div class="mini-otif"><i style="width:${Math.min(100, client.otif * 100)}%"></i></div><b>${pct(client.otif)}</b><em class="${d >= 0 ? "delta-pos" : "delta-neg"}">${d >= 0 ? "+" : ""}${fmt(d, 1)}</em></div>`;
      }).join("")}</div></article>`;
    }).join("")}</div>`;
  }

  function demandView(r, t) {
    const analytics = clientAnalytics(r);
    const bp = businessResults.get(year);
    const bpMonthlySales = M.months.map((_, m) => S(bp.rows.filter((row) => row.month === m && (family === "all" || row.family === family)), "sales"));
    const segmentItems = analytics.segments.map((segment) => ({ name: segment.name, value: segment.demand, color: segment.color })).sort((a, b) => b.value - a.value);
    const coverageRows = [];
    for (const p of M.products.filter((p) => family === "all" || p.family === family)) {
      for (const client of analytics.clients) {
        const rows = analytics.cr.filter((x) => x.client === client.id && sku(x.sku)?.product === p.id);
        const demand = S(rows, "demand");
        if (demand < 0.001) continue;
        const sales = S(rows, "sales");
        const revenue = analytics.economics(rows, "revenue");
        const margin = analytics.economics(rows, "margin");
        const marginRate = revenue ? margin / revenue : 0;
        const delta = (marginRate - client.marginTarget) * 100;
        coverageRows.push([
          p.name, esc(client.name), fmt(demand), fmt(sales),
          `<span class="pill ${sales / (demand || 1) < 0.95 ? "warn" : ""}">${pct(sales / (demand || 1))}</span>`,
          money(revenue), money(margin), pct(marginRate), pct(client.marginTarget),
          `<span class="margin-deviation ${delta < 0 ? "below" : "ok"}">${delta < 0 ? "▼" : "✓"} ${delta >= 0 ? "+" : ""}${fmt(delta, 1)} п.п.</span>`,
        ]);
      }
    }
    const clientRows = analytics.clients.map((client) => [
      esc(client.name), esc(client.segment), M.nodes.find((n) => n.id === client.node).name,
      fmt(client.demand), fmt(client.sales), money(client.revenue), money(client.margin),
      pct(client.otif), pct(client.otifTarget),
      client.review ? `<span class="review-label ${client.reviewDirection}">⚑ ${client.reviewDirection === "up" ? "На повышение" : "На пересмотр"}</span>` : "—",
    ]);
    return `<div class="kpis">${kpi("Неограниченный спрос", fmt(t.demand), "т", "Сезонность по продуктовым группам", true)}${kpi("План отгрузок", fmt(t.sales), "т", `Бизнес-план: ${fmt(totals(bp).sales)} т`)}${kpi("Непокрытый спрос", fmt(t.gap), "т", "Не является фактом потерянного заказа")}${kpi("Покрытие", pct(t.coverage), "", "Покрытие спроса не равно OTIF")}${kpi("Клиентов на пересмотр", analytics.clients.filter((c) => c.review).length, "", "Отклонение маржи или OTIF от порога", true)}</div>
      <div class="grid equal chart-grid">${panel("Спрос и отгрузки по месяцам", `Бизнес-план и активный план · полный контекст ${year}`, chart("Спрос, бизнес-план и отгрузки", [
        { name: "Неограниченный спрос", values: monthly(r, "demand"), color: "#a1a9b7" },
        { name: "Бизнес-план · отгрузки", values: bpMonthlySales, color: "#19a27b" },
        { name: "Активный план · отгрузки", values: monthly(r, "sales"), color: "#4769ff" },
      ]))}${panel("Спрос по клиентским сегментам", "Шесть отраслевых сегментов КАМА · тонны за выбранный период", horizontalChart("Спрос по сегментам", segmentItems, "т", 0))}</div>
      ${panel("Сегментация клиентов", "Матрица ценности по аналогии с эталонным дашбордом · размер круга — валовая прибыль клиента", segmentationMatrix(analytics), "segmentation-panel")}
      ${panel("OTIF по сегментам и клиентам", "Факт — взвешенный по выручке; вертикальная метка — цель сегмента; для каждого клиента показано отклонение в п.п.", otifBySegment(analytics), "otif-panel")}
      ${panel("Покрытие по ассортименту и клиентам", "Продукт × клиент · маржа после переменных затрат, логистики и хранения; красным — ниже целевой маржи сегмента", paged("coverage", ["Продукт", "Клиент", "Спрос, т", "Отгрузки, т", "Покрытие", "Выручка, млн ₽", "Валовая прибыль, млн ₽", "Маржа", "Цель маржи", "Отклонение"], coverageRows))}
      ${panel("Клиенты, сервис и статус пересмотра", "24 клиента · основной склад и детализация экономики за выбранный период", paged("clients", ["Клиент", "Сегмент", "Основной склад", "Спрос, т", "Отгрузки, т", "Выручка, млн ₽", "Валовая прибыль, млн ₽", "OTIF", "Цель", "Статус"], clientRows))}`;
  }

  function ordersView() {
    const orderResult = M.forYear(horizonResults.get(active), 2026);
    if (!orderPlan) orderPlan = O.planPortfolio(M, orderResult);
    const date = (value) => {
      if (!value) return "—";
      const [y, m, d] = value.split("-");
      return `${d}.${m}.${y}`;
    };
    const nodeName = (id) => M.nodes.find((node) => node.id === id)?.name || id;
    const plan = orderPlan;
    const productionRows = O.productionSchedule(plan.results);
    const orderRows = plan.results.map((result) => {
      const selected = orderSelected.has(result.orderId);
      const stock = result.stockStatus === "yes" ? ["Да", "ok"] : result.stockStatus === "partial" ? ["Частично", "partial"] : ["Нет", "no"];
      return `<tr class="${result.exception ? "order-exception" : ""}"><td><input type="checkbox" data-order-select="${result.orderId}" aria-label="Выбрать ${result.orderId}" ${selected ? "checked" : ""}></td><td><b>${result.orderId}</b><small>${esc(result.customer)} · P${result.priority}</small></td><td>${esc(result.productName)}</td><td>${fmt(result.qty)}</td><td>${date(result.requestedDate)}</td><td><span class="stock-flag ${stock[1]}">${stock[0]}</span><small>${fmt(Math.max(0, result.availableQty))} т на дату проверки</small></td><td>${esc(nodeName(result.sourceNode))}<small>${esc(result.sourceKind)}</small></td><td>${result.productionDate ? `${date(result.productionDate)}<small>${esc(result.machine)} · ${esc(result.campaign)}</small>` : "—"}</td><td>${date(result.shipDate)}</td><td>${date(result.deliveryDate)}</td><td><span class="${result.lateDays ? "delta-neg" : "delta-pos"}">${result.lateDays ? `+${result.lateDays} дн.` : "В срок"}</span></td><td><span class="pill ${result.exception || result.lateDays ? "warn" : ""}">${esc(result.status)}</span></td></tr>`;
    }).join("");
    const quotaRows = plan.quotaUsage.map((quota) => {
      const used = quota.usage * 100;
      return [quota.productName, quota.month, fmt(quota.plannedSales), fmt(quota.ordered), `<div class="quota-cell"><div class="load-track"><i class="${used > 100 ? "overload" : ""}" style="width:${Math.min(100, used)}%"></i></div><b>${fmt(used, 1)}%</b></div>`, `<span class="${quota.remaining < 0 ? "delta-neg" : "delta-pos"}">${fmt(quota.remaining)}</span>`, used > 100 ? '<span class="pill warn">Сверх квоты</span>' : used > 85 ? '<span class="pill warn">Почти заполнена</span>' : '<span class="pill">Доступна</span>'];
    });
    const shipmentRows = [...plan.results].sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.orderId.localeCompare(b.orderId)).map((result) => [date(result.shipDate), date(result.deliveryDate), result.orderId, esc(result.customer), esc(result.productName), fmt(result.qty), esc(nodeName(result.sourceNode)), result.productionDate ? `${date(result.productionDate)} · ${esc(result.machine)}` : "Из запаса", result.lateDays ? `<span class="delta-neg">+${result.lateDays} дн.</span>` : '<span class="delta-pos">В срок</span>']);
    return `<div class="order-heading"><div><span class="status">Актуальный портфель · 20 заказов</span><p>Дата расчёта ATP: <strong>${date(plan.asOf)}</strong>. Согласованный план: <strong>${esc(orderResult.config.name)}</strong>. Гранулярность производства и отгрузок — день.</p></div><div class="order-actions"><button type="button" class="button primary" data-order-recalc="all">↻ Пересчитать весь портфель</button><button type="button" class="button" data-order-recalc="selected">Пересчитать выбранные <span class="selection-count">${orderSelected.size}</span></button></div></div>
      <div class="insight order-notice"><strong>${esc(orderNotice)}.</strong> Сначала проверяется запас РЦ, затем заводской запас. При дефиците создаётся заказ на ближайшую кампанию S&OP; дата отгрузки учитывает готовность, лидтайм пополнения РЦ и доставку клиенту. Плановый выпуск S&OP не дублируется. Портфель показывается целиком независимо от фильтра направления и года.</div>
      <div class="kpis">${kpi("Заказов в портфеле", plan.summary.orders, "", `${O.customers.length} клиентов · ${fmt(plan.summary.shipmentQty)} т`, true)}${kpi("Покрывается запасом", plan.summary.fromStock, "заказов", "Без нового производственного заказа")}${kpi("Требуют производства", plan.summary.withProduction, "заказов", `${fmt(plan.summary.productionQty)} т к выпуску`, plan.summary.withProduction > 0)}${kpi("С отклонением по дате", plan.summary.late, "заказов", "Позже requested delivery date", plan.summary.late > 0)}${kpi("Исключения SOP", plan.summary.exceptions, "", "Нет доступного объёма в кампаниях", plan.summary.exceptions > 0)}</div>
      ${panel("Портфель клиентских заказов и доступность", "Отметьте заказы для частичного пересчёта · запас показан на дату проверки с учётом уже зарезервированных заказов", `<div class="table-wrap order-table-wrap"><table class="order-table"><thead><tr><th scope="col"><input type="checkbox" data-order-select-all aria-label="Выбрать все заказы" ${orderSelected.size === O.orders.length ? "checked" : ""}></th><th scope="col">Заказ / клиент</th><th scope="col">Продукт</th><th scope="col">Кол-во, т</th><th scope="col">Требуемая дата</th><th scope="col">Запас доступен</th><th scope="col">Источник</th><th scope="col">Производство</th><th scope="col">Отгрузка</th><th scope="col">Поставка</th><th scope="col">Отклонение</th><th scope="col">Статус</th></tr></thead><tbody>${orderRows}</tbody></table></div>`, "orders-portfolio-panel")}
      ${panel("Заполнение квоты S&OP по продуктам", "Квота — согласованный план продаж продукта в месяц требуемой поставки; портфель суммируется без двойного счёта", table(["Продукт", "Месяц", "Квота S&OP, т", "Портфель, т", "Заполнение", "Остаток квоты, т", "Статус"], quotaRows), "quota-panel")}
      ${panel("1 · План производства по суткам и агрегатам", "Только производственные заказы портфеля · привязка к ближайшей кампании согласованного S&OP", table(["Дата", "Агрегат", "Кампания S&OP", "Продукт", "Заказы", "К выпуску, т", "Объём кампании, т", "Доля заказа", "Проверка"], productionRows.map((row) => [date(row.date), row.machine, row.campaign, esc(row.productName), row.orders.join(", "), fmt(row.qty), fmt(row.campaignGood), pct(row.campaignGood ? row.qty / row.campaignGood : 0), row.exceptions ? '<span class="pill red">Вне SOP</span>' : row.qty > row.campaignGood ? '<span class="pill warn">Нужен пересмотр</span>' : '<span class="pill">В кампании</span>'])), "daily-production-panel")}
      ${panel("2 · План отгрузок", "Дата отгрузки рассчитана после производства (если нужно) и с учётом лидтайма перемещения / последней мили", table(["Отгрузка", "Поставка", "Заказ", "Клиент", "Продукт", "Кол-во, т", "Склад отгрузки", "Производство / запас", "Срок"], shipmentRows), "shipment-plan-panel")}`;
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

  function campaignTimeline(operations, stage) {
    const units = [...new Map(operations.capacities.map((c) => [c.machine, c])).values()].filter(
      (c) => c.stage === stage && (family === "all" || c.family === "all" || c.family === family),
    );
    return `<section class="campaign-stage embedded"><h3>Последовательность кампаний · ${esc(stage)}</h3><p class="block-note">Порядок внутри месяца по каждому агрегату; нажмите месяц для детализации.</p>${units.map((unit) => `<div class="campaign-machine"><h4>${esc(unit.name)}</h4>${M.months.map((mn, mi) => {
      if (mi < fromMonth || mi > toMonth) return "";
      const c = operations.capacities.find((x) => x.machine === unit.machine && x.month === mi);
      const cs = operations.campaigns.filter((x) => x.machine === unit.machine && x.month === mi);
      if (!c) return "";
      return `<button class="campaign-month ${month === String(mi) ? "selected" : ""}" data-camp-month="${mi}" aria-label="Выбрать кампании ${mn} ${year}"><span>${mn}</span><div class="timeline">${cs.map((x) => `<i style="width:${((x.run + x.setup) / c.calendar) * 100}%" title="${esc(product(x.product).name)} · ${x.gram} г/м² · выпуск ${fmt(x.good)} т · ${fmt(x.run + x.setup, 1)} ч"></i>`).join("")}<i class="repair" style="width:${(c.repair / c.calendar) * 100}%" title="Плановый ремонт · ${fmt(c.repair)} ч"></i></div><small>${fmt(c.run)} ч работы · ${fmt(c.setup)} ч переходов · ${c.used > c.available ? `<b class="delta-neg">дефицит ${fmt(c.used - c.available)} ч</b>` : `резерв ${fmt(c.available - c.used)} ч`}</small></button>`;
    }).join("")}</div>`).join("")}</section>`;
  }

  function cuttingPlan(r) {
    let cuts = r.cuts.filter(eligible);
    if (cutMachine !== "all") cuts = cuts.filter((cut) => cut.machine === cutMachine);
    const groups = new Map();
    for (const cut of cuts) {
      if (!groups.has(cut.campaign)) groups.set(cut.campaign, []);
      groups.get(cut.campaign).push(cut);
    }
    const campaigns = [...groups.entries()].sort((a, b) => {
      const ca = a[1][0], cb = b[1][0];
      return ca.month - cb.month || ca.machine.localeCompare(cb.machine) || a[0].localeCompare(b[0]);
    });
    const pageSize = 6, pageCount = Math.max(1, Math.ceil(campaigns.length / pageSize));
    cutPage = Math.max(0, Math.min(cutPage, pageCount - 1));
    const visible = campaigns.slice(cutPage * pageSize, (cutPage + 1) * pageSize);
    const cards = visible.map(([campaignId, rows]) => {
      const first = rows[0], p = product(first.product);
      const finishing = p.family === "Картон" ? "ПРС-1" : "ПРС-2";
      const gross = S(rows, "gross"), good = S(rows, "good");
      const trim = S(rows, (row) => row.gross * row.trim) / (gross || 1);
      const patterns = rows.map((cut, index) => {
        const nums = cut.pattern.split(" + ").map((x) => x.split("×").map(Number));
        return `<div class="cut-map-row"><div class="cut-map-meta"><span>Схема ${index + 1}</span><b>${esc(cut.pattern)} мм</b><small>${fmt(cut.gross, 1)} т брутто · обрезь ${pct(cut.trim)}</small></div><div class="chart-scroll"><div class="cut-pattern" aria-label="Раскрой ${esc(cut.pattern)}">${nums.flatMap(([count, width]) => Array.from({ length: count }, () => `<span style="width:${(width / cut.deckle) * 100}%">${width}</span>`)).join("")}<span class="waste" style="width:${cut.trim * 100}%" title="Обрезь ${cut.deckle - cut.used} мм"></span></div></div></div>`;
      }).join("");
      return `<article class="cut-campaign"><div class="cut-campaign-head"><div><small>${finishing} · источник ${first.machine} · ${M.months[first.month]} ${year}</small><h4>${esc(p.name)} · ${first.gram} г/м²</h4><span>Кампания ${esc(campaignId)}</span></div><div class="cut-total"><strong>${fmt(good)} т</strong><span>годный · обрезь ${pct(trim)}</span></div></div>${patterns}</article>`;
    }).join("");
    return `<div class="cutting-plan"><div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Фильтр карт раскроя по машине">${[["all", "Все машины"], ["КДМ-9", "КДМ-9 → ПРС-1"], ["БДМ-7", "БДМ-7 → ПРС-2"]].map(([id, label]) => `<button type="button" data-cut-machine="${id}" aria-pressed="${cutMachine === id}">${label}</button>`).join("")}</div><span class="chart-context">${campaigns.length} кампаний · ${cuts.length} схем раскроя</span></div><h3>План раскроя по каждой кампании</h3><p class="block-note">Каждая карточка — отдельная производственная кампания; показаны все применённые схемы, а не один иллюстративный пример.</p>${cards || '<div class="insight">Для выбранного фильтра карт раскроя нет.</div>'}<div class="pager"><button class="button" type="button" data-cut-page="-1" ${cutPage === 0 ? "disabled" : ""}>← Предыдущие кампании</button><span>${cutPage + 1} / ${pageCount}</span><button class="button" type="button" data-cut-page="1" ${cutPage >= pageCount - 1 ? "disabled" : ""}>Следующие кампании →</button></div></div>`;
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
    return `<div class="kpis">${kpi("Годный выпуск", fmt(t.production), "т", "После обрези и потерь качества", true)}${kpi("Кампании КДМ / БДМ", fmt(camps.length), "", "Марка × граммаж × проход приоритета")}${kpi("Переналадки всех агрегатов", fmt(S(caps, "setup")), "ч", "КДМ, БДМ, массоподготовка и отделка")}${kpi("Обрезь по ширине", pct(trim / (gross || 1)), "", `${fmt(trim)} т из ${fmt(gross)} т брутто`)}${kpi("Узкие места", fmt(bottlenecks.length), "агрегат·мес.", bottlenecks.length ? "Требуется перенос объёма или увеличение фонда" : "Загрузка не превышает доступный фонд", bottlenecks.length > 0)}</div>
      ${panel("Загрузка производственных агрегатов", "Массоподготовка, КДМ-9, БДМ-7, резка и упаковка · использованные / доступные часы", heat(r, operations))}
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
        )}${table(["Направление", "Брутто, т", "Волокно, т абс. сух.", "Годный, т", "Сквозной выход"], massRows)}${campaignTimeline(operations, "Массоподготовка")}`,
        "stage-panel",
      )}
      ${panel("Этап 2 · КДМ-9 и БДМ-7", "Отдельная специфика картонной и бумажной машин · брутто, годный выпуск, переходы и качество", `<div class="grid equal machine-grid">${family === "Бумага" ? "" : machineDetail(r, "КДМ-9")}${family === "Картон" ? "" : machineDetail(r, "БДМ-7")}</div>${campaignTimeline(operations, "КДМ / БДМ")}`, "stage-panel")}
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
        )}${cuttingPlan(r)}${campaignTimeline(operations, "Отделка")}`,
        "stage-panel",
      )}
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

  function dualAxisChart(title, volumeSeries, costSeries, volumeUnit) {
    const w = 780, h = 310, left = 68, right = 72, top = 24, bottom = 44;
    const plotW = w - left - right, plotH = h - top - bottom;
    const finite = (series) => series.flatMap((s) => s.values).filter(Number.isFinite);
    const leftValues = finite(volumeSeries), rightValues = finite(costSeries);
    const leftMax = Math.max(1, ...leftValues) * 1.12;
    const rightMax = Math.max(1, ...rightValues) * 1.15;
    const yLeft = (v) => top + (1 - v / leftMax) * plotH;
    const yRight = (v) => top + (1 - v / rightMax) * plotH;
    const x = (i) => left + ((i + 0.5) * plotW) / 12;
    let svg = `<svg class="chart dual-axis-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`;
    for (let i = 0; i <= 4; i++) {
      const y = top + (plotH * i) / 4;
      const lv = leftMax * (1 - i / 4), rv = rightMax * (1 - i / 4);
      svg += `<line x1="${left}" x2="${w - right}" y1="${y}" y2="${y}" stroke="#e8edf1"/><text x="${left - 9}" y="${y + 4}" text-anchor="end">${fmt(lv, lv < 10 ? 1 : 0)}</text><text x="${w - right + 9}" y="${y + 4}">${fmt(rv, rv < 10 ? 1 : 0)}</text>`;
    }
    const bars = volumeSeries.filter((s) => !s.line);
    let seriesIndex = 0;
    const drawLine = (s, yScale, index) => {
      let out = `<g class="chart-series" data-series="${index}">`, points = [];
      const flush = () => {
        if (points.length > 1) out += `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" stroke-dasharray="${s.dashed === false ? "0" : "6 4"}" points="${points.join(" ")}"/>`;
        points = [];
      };
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return flush();
        points.push(`${x(i)},${yScale(v)}`);
      });
      flush();
      s.values.forEach((v, i) => {
        if (Number.isFinite(v)) out += `<circle cx="${x(i)}" cy="${yScale(v)}" r="2.8" fill="${s.color}"><title>${M.months[i]} · ${esc(s.name)}: ${fmt(v, 1)}</title></circle>`;
      });
      return `${out}</g>`;
    };
    volumeSeries.forEach((s) => {
      const index = seriesIndex++;
      if (s.line) svg += drawLine(s, yLeft, index);
      else {
        const barIndex = bars.indexOf(s), groupW = (plotW / 12) * 0.68, bw = groupW / Math.max(1, bars.length);
        svg += `<g class="chart-series" data-series="${index}">`;
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          const bx = left + (i * plotW) / 12 + (plotW / 12 - groupW) / 2 + barIndex * bw;
          const outside = i < fromMonth || i > toMonth;
          svg += `<rect x="${bx}" y="${yLeft(v)}" width="${Math.max(2, bw - 2)}" height="${Math.max(0.5, top + plotH - yLeft(v))}" rx="2" fill="${s.color}" opacity="${outside ? 0.18 : 0.9}"><title>${M.months[i]} · ${esc(s.name)}: ${fmt(v, 1)} ${volumeUnit}</title></rect>`;
        });
        svg += "</g>";
      }
    });
    costSeries.forEach((s) => { svg += drawLine(s, yRight, seriesIndex++); });
    M.months.forEach((name, i) => { svg += `<text x="${x(i)}" y="${h - 13}" text-anchor="middle">${name}</text>`; });
    svg += `<text x="${left}" y="12" class="axis-title">${esc(volumeUnit)}</text><text x="${w - right}" y="12" text-anchor="end" class="axis-title">млн ₽</text></svg>`;
    const all = [...volumeSeries, ...costSeries];
    return `<div class="chart-block"><div class="legend">${all.map((s, i) => `<button type="button" class="legend-toggle" data-legend="${i}" aria-pressed="true"><i style="background:${s.color}"></i>${s.name}</button>`).join("")}</div><div class="chart-scroll">${svg}</div></div>`;
  }

  function resourcesView(r) {
    const names = A.resourceMeta;
    const allResources = [...r.resources, ...(r.utilities || [])];
    const bp = businessResults.get(year);
    const bpResources = [...bp.resources, ...(bp.utilities || [])];
    const rr = allResources.filter((x) => x.month >= fromMonth && x.month <= toMonth);
    const monthlyResource = (source, id, key = "used") => M.months.map((_, m) => S(source.filter((x) => x.id === id && x.month === m), key));
    const actualFactor = [0.97, 1.025, 0.985, 1.04, 0.965, 1.015, 1.035, 0.98, 1.02];
    const cards = Object.entries(names).map(([id, meta]) => {
      const rows = rr.filter((x) => x.id === id), used = S(rows, "used"), cap = S(rows, "available");
      const bpUsed = S(bpResources.filter((x) => x.id === id && x.month >= fromMonth && x.month <= toMonth), "used");
      const cost = used * meta.tariff, bpCost = bpUsed * meta.tariff;
      return panel(meta.name, `${meta.unit} · общий ресурс площадки`, `<div class="resource-card-value"><strong>${fmt(used)}</strong><span>${meta.unit}</span></div><div class="progress"><span style="width:${Math.min(100, (used / (cap || 1)) * 100)}%"></span></div><div class="resource-card-grid"><span>Затраты <b>${money(cost)} млн ₽</b></span><span>БП <b>${money(bpCost)} млн ₽</b></span><span>Отклонение <b class="${cost <= bpCost ? "delta-pos" : "delta-neg"}">${cost - bpCost >= 0 ? "+" : ""}${money(cost - bpCost)} млн ₽</b></span><span>Резерв <b>${fmt(cap - used)} ${meta.unit}</b></span></div>`);
    }).join("");
    const resourceCharts = Object.entries(names).map(([id, meta]) => {
      const plan = monthlyResource(allResources, id);
      const bpPlan = monthlyResource(bpResources, id);
      const target = monthlyResource(allResources, id, "available").map((value) => value * meta.target);
      const actual = plan.map((value, m) => year === 2026 && m < 9 ? value * actualFactor[m] : null);
      const cost = (values, factor = 1) => values.map((value, m) => Number.isFinite(value) ? (value * meta.tariff * factor * (1 + m * 0.0015)) / 1e6 : null);
      return panel(`Динамика · ${meta.name}`, `Левая ось: ${meta.unit}; правая ось: затраты, млн ₽ · цель — максимально допустимое потребление`, dualAxisChart(`${meta.name}: объём и затраты`, [
        { name: "План S&OP", values: plan, color: meta.color },
        { name: "Факт", values: actual, color: "#27364a" },
        { name: "Целевое значение", values: target, color: "#ed0084", line: true },
      ], [
        { name: "Затраты · план", values: cost(plan), color: "#8b5cf6", dashed: false },
        { name: "Затраты · факт", values: cost(actual, 1.025), color: "#e8930c", dashed: false },
        { name: "Затраты · БП", values: cost(bpPlan), color: "#94a3b8" },
      ], meta.unit), "resource-dynamic");
    }).join("");
    const productFiber = M.products.filter((p) => family === "all" || p.family === family).map((p) => ({
      name: p.name,
      value: S(r.campaigns.filter((c) => c.product === p.id && c.month >= fromMonth && c.month <= toMonth), "fiber"),
      color: p.family === "Картон" ? "#4769ff" : "#19a27b",
    })).sort((a, b) => b.value - a.value).slice(0, 6);
    return `<div class="insight">Для каждого ресурса показаны <strong>отдельно натуральный объём и денежные затраты</strong>. Факт — январь–сентябрь 2026; план — активный сценарий S&OP; бизнес-план — независимая база затрат. Цель рассчитана от доступного месячного лимита.</div><div class="catalog resource-catalog">${cards}</div>
      <div class="grid equal chart-grid resource-charts">${resourceCharts}</div>
      ${panel("Волокно по продуктовым группам", "Топ-6 · расход на брутто-выпуск за выбранный период", horizontalChart("Волокно по продуктам", productFiber, "т абс. сух.", 0))}
      ${panel("Месячные ограничения снабжения", "Лимиты и рецептурные коэффициенты синтетические; месячная проверка не заменяется годовым агрегатом", table(["Месяц", "Ресурс", "Ед.", "Лимит", "Потребность", "Резерв", "Использование"], rr.map((x) => [`${M.months[x.month]} ${year}`, names[x.id].name, names[x.id].unit, fmt(x.available), fmt(x.used), fmt(x.available - x.used), pct(x.used / (x.available || 1))])))}
      ${panel("Коэффициенты потребления", "На 1 т брутто-выпуска; укрупнённые допущения, не технологические рецептуры КАМА", table(["Группа", "Волокно, т/т", "Мелование, т/т", "Энергия, МВт·ч/т", "Вода, м³/т"], M.products.filter((p) => family === "all" || p.family === family).map((p) => [p.name, fmt(p.fiber, 3), fmt(p.coat, 3), fmt(p.energy, 2), fmt(18 * Number(r.config.waterIntensity || 1), 1)])))}`;
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

  function stockGroupDynamics(r) {
    const previous = results.get(M.previousSopId);
    const resources = [...r.resources, ...(r.utilities || [])];
    const previousResources = [...previous.resources, ...(previous.utilities || [])];
    const valueMode = stockMode === "value";
    const actualFactor = [1.04, 0.97, 1.02, 0.96, 1.06, 0.99, 1.03, 0.95, 1.01];
    const raw = (id) => {
      const meta = A.resourceMeta[id];
      const plan = M.months.map((_, m) => S(resources.filter((x) => x.id === id && x.month === m), "used") * (id === "fiber" ? 0.22 : 0.26));
      const actual = M.months.map((_, m) => year === 2026 && m < 9 ? S(previousResources.filter((x) => x.id === id && x.month === m), "used") * (id === "fiber" ? 0.22 : 0.26) * actualFactor[m] : null);
      const target = plan.map((_, m) => S(resources.filter((x) => x.id === id && x.month === m), "used") * (id === "fiber" ? 0.18 : 0.21));
      const convert = (values) => values.map((v) => Number.isFinite(v) ? (valueMode ? (v * meta.tariff) / 1e6 : v) : null);
      return { name: meta.name, plan: convert(plan), actual: convert(actual), target: convert(target) };
    };
    const finished = (familyName) => {
      const filter = (rows, m) => rows.filter((x) => x.month === m && x.family === familyName);
      const planQty = M.months.map((_, m) => S(filter(r.rows, m), "end"));
      const actualQty = M.months.map((_, m) => year === 2026 && m < 9 ? S(filter(previous.rows, m), "end") * actualFactor[m] : null);
      const targetQty = M.months.map((_, m) => S(filter(r.rows, m), "target"));
      const unitCost = M.months.map((_, m) => {
        const rows = filter(r.rows, m), qty = S(rows, "end");
        return qty ? S(rows, (x) => x.end * x.unitCost) / qty : 0;
      });
      const convert = (values) => values.map((v, m) => Number.isFinite(v) ? (valueMode ? (v * unitCost[m]) / 1e6 : v) : null);
      return { name: `Готовая продукция · ${familyName}`, plan: convert(planQty), actual: convert(actualQty), target: convert(targetQty) };
    };
    const groups = [raw("fiber"), raw("coat"), ...["Картон", "Бумага"].filter((name) => family === "all" || family === name).map(finished)];
    const unit = valueMode ? "млн ₽" : "т";
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Единицы динамики запасов"><button type="button" data-stock-mode="volume" aria-pressed="${!valueMode}">Объём, т</button><button type="button" data-stock-mode="value" aria-pressed="${valueMode}">Стоимость, млн ₽</button></div><span class="chart-context">Сырьё оценено по тарифу; ГП — по полной переменной себестоимости запаса</span></div><div class="stock-group-grid">${groups.map((group) => `<section class="stock-mini"><h3>${esc(group.name)}</h3>${chart(`${group.name}: запасы`, [
      { name: "План S&OP", values: group.plan, color: "#4769ff" },
      { name: "Факт", values: group.actual, color: "#19a27b" },
      { name: "Цель", values: group.target, color: "#ed0084", line: true },
    ], unit, { compare: true, context: "Факт · план · цель" })}</section>`).join("")}</div>`;
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
    )}${panel("Складская сеть и материальный баланс", "Материальный баланс по заводскому и региональным складам · плановые перемещения внутри месяца", table(["Склад", "Начало, т", "Производство, т", "Приход, т", "Перемещения, т", "Отгрузки, т", "Конец, т", "Ёмкость, т"], nr))}${panel("Запасы по группам: факт, план и цель", "Сырьё и готовая продукция · переключение натурального и стоимостного выражения", stockGroupDynamics(r), "stock-groups-panel")}${panel(
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

  function movementControls(modeKey, detailKey = "", detailOptions = []) {
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Показатель перемещений"><button type="button" data-movement-mode="${modeKey}" data-value="volume" aria-pressed="${movementModes[modeKey] === "volume"}">Объём, т</button><button type="button" data-movement-mode="${modeKey}" data-value="cost" aria-pressed="${movementModes[modeKey] === "cost"}">Затраты, млн ₽</button></div>${detailKey ? `<div class="flow-switch" role="group" aria-label="Детализация перемещений">${detailOptions.map(([id, label]) => `<button type="button" data-movement-detail="${detailKey}" data-value="${id}" aria-pressed="${movementModes[detailKey] === id}">${label}</button>`).join("")}</div>` : ""}</div>`;
  }

  function movementMonthlyChart(title, rows, modeKey, detail) {
    const mode = movementModes[modeKey], palette = ["#4769ff", "#19a27b", "#8b5cf6", "#ff8c00", "#38a3c7", "#a5246c", "#64748b", "#d65f45", "#7d5ab6", "#29859b", "#9b7b32", "#485e78"];
    const keys = [...new Set(rows.map(detail))].filter(Boolean).sort();
    const series = keys.map((key, index) => ({
      name: key,
      values: M.months.map((_, m) => S(rows.filter((row) => row.month === m && detail(row) === key), (row) => mode === "cost" ? row.cost / 1e6 : row.qty)),
      color: palette[index % palette.length],
    }));
    return chart(title, series, mode === "cost" ? "млн ₽" : "т", { compare: true, context: `${keys.length} детализаций · ${mode === "cost" ? "затраты" : "объём"}` });
  }

  function nodeCostChart(rows) {
    const components = [["transport", "Магистраль завод → РЦ", "#4769ff"], ["handling", "Погрузка и обработка", "#8b5cf6"], ["storage", "Хранение", "#19a27b"], ["lastMile", "Последняя миля", "#ff8c00"]];
    const totals = rows.map((row) => ({ ...row, total: S(components, ([key]) => row[key]) }));
    const max = Math.max(1, ...totals.map((row) => row.total));
    const w = 900, left = 220, right = 110, rowH = 54, top = 22, h = top + rows.length * rowH + 30, plotW = w - left - right;
    let svg = `<svg class="chart node-cost-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Детальные затраты по логистическим узлам"><title>Затраты по узлам с разбивкой по четырём компонентам</title>`;
    totals.forEach((row, i) => {
      const y = top + i * rowH, label = row.name.length > 28 ? `${row.name.slice(0, 27)}…` : row.name;
      let x = left;
      svg += `<text x="${left - 12}" y="${y + 21}" text-anchor="end" class="row-label">${esc(label)}</text><rect x="${left}" y="${y}" width="${plotW}" height="26" rx="5" fill="#f0f3f7"/>`;
      components.forEach(([key, name, color]) => {
        const value = row[key] / 1e6, width = (row[key] / max) * plotW;
        if (width > 0) svg += `<rect x="${x}" y="${y}" width="${Math.max(1, width)}" height="26" fill="${color}"><title>${esc(row.name)} · ${name}: ${money(row[key])} млн ₽</title></rect>`;
        x += width;
      });
      svg += `<text x="${w - 8}" y="${y + 20}" text-anchor="end" class="value">${money(row.total)} млн ₽</text>`;
    });
    svg += "</svg>";
    return `<div class="legend">${components.map(([, name, color]) => `<span><i style="background:${color}"></i>${name}</span>`).join("")}</div><div class="chart-scroll">${svg}</div>`;
  }

  function movementView(r, t) {
    const data = A.movementData(M, r, O.customers);
    const inFamily = (flow) => family === "all" || !flow.product || product(flow.product)?.family === family;
    const supplierFlows = data.supplierFlows;
    const internalFlows = data.internalFlows.filter((flow) => family === "all" || !flow.stage.includes("КДМ-9") && !flow.stage.includes("БДМ-7") || (family === "Картон" ? !flow.stage.includes("БДМ-7") : !flow.stage.includes("КДМ-9")));
    const rcFlows = data.rcFlows.filter(inFamily);
    const customerFlows = data.customerFlows.filter(inFamily);
    const transfers = S(rcFlows, "qty");
    const routeRows = M.nodes.map((node) => {
      const inbound = rcFlows.filter((flow) => flow.node === node.id), outbound = customerFlows.filter((flow) => flow.node === node.id);
      const costs = data.nodeCosts.find((x) => x.node === node.id);
      return [node.name, node.id === "plant" ? "Прямые отгрузки + пополнение шести РЦ" : "Завод → РЦ → клиент", fmt(S(inbound, "qty")), fmt(S(outbound, "qty")), money(costs.transport), money(costs.handling), money(costs.storage), money(costs.lastMile), money(costs.transport + costs.handling + costs.storage + costs.lastMile)];
    });
    const detailFlows = [...supplierFlows, ...internalFlows, ...rcFlows, ...customerFlows].filter((flow) => flow.month >= fromMonth && flow.month <= toMonth && inFamily(flow));
    const detailRows = detailFlows.map((flow) => [flow.category, `${M.months[flow.month]} ${year}`, flow.from, flow.to, flow.item, fmt(flow.qty, 1), money(flow.cost), `${fmt(flow.lead, 1)} дн.`]);
    return `<div class="kpis">${kpi("Узлов сети", M.nodes.length, "", "Заводской склад + 6 региональных РЦ", true)}${kpi("Поставщиков сырья", A.suppliers.length, "", "Волокно и компоненты мелования")}${kpi("Пополнение РЦ", fmt(transfers), "т", "Без двойного счёта клиентских отгрузок")}${kpi("Клиентов в плане", O.customers.length, "", "12 именованных получателей")}${kpi("Логистика по S&OP", money(t.logistics), "млн ₽", "Магистраль + последняя миля")}</div>
      ${panel("Схема логистических потоков", "Все последующие графики и сводная таблица следуют этой цепочке", `<div class="process-flow logistics-chain"><span>Поставщики сырья<small>6 контрагентов</small></span><b>→</b><span>Завод КАМА<small>Краснокамск</small></span><b>→</b><span>Внутризаводские этапы<small>Масса → КДМ/БДМ → отделка</small></span><b>→</b><span>Склад ГП<small>Единый выпуск</small></span><b>→</b><span>6 РЦ<small>Москва · Казань · СПб · Ростов · Екатеринбург · Новосибирск</small></span><b>→</b><span>12 клиентов<small>Продукт / склад / день</small></span></div>`)}
      ${panel("Поставщики сырья → завод", "Волокно и компоненты мелования · детализация по поставщику или виду сырья", `${movementControls("inbound", "inboundDetail", [["supplier", "По поставщикам"], ["resource", "По видам сырья"]])}${movementMonthlyChart("Входящие поставки", supplierFlows, "inbound", (flow) => movementModes.inboundDetail === "supplier" ? flow.supplier : flow.item)}`)}
      ${panel("Внутризаводские перемещения", "Склад сырья → массоподготовка → КДМ-9 / БДМ-7 → отделка → склад ГП", `${movementControls("internal")}${movementMonthlyChart("Внутризаводские потоки", internalFlows, "internal", (flow) => flow.stage)}`)}
      ${panel("Склад готовой продукции → РЦ", "Шесть региональных складов · пополнение по проводкам S&OP", `${movementControls("rc", "rcDetail", [["node", "По РЦ"], ["family", "По направлениям"]])}${movementMonthlyChart("Пополнение региональных РЦ", rcFlows, "rc", (flow) => movementModes.rcDetail === "node" ? flow.to : product(flow.product).family)}`)}
      ${panel("Отгрузки клиентам", "12 клиентов · исходный склад и продуктовая группа сохранены в каждой строке", `${movementControls("customers", "customerDetail", [["customer", "По клиентам"], ["node", "По складам"], ["family", "По направлениям"]])}${movementMonthlyChart("Клиентские отгрузки", customerFlows, "customers", (flow) => movementModes.customerDetail === "customer" ? flow.to : movementModes.customerDetail === "node" ? flow.from : product(flow.product).family)}`)}
      ${panel("Затраты по узлам", "Магистраль, погрузка и обработка, хранение, последняя миля · млн ₽ за выбранный год", nodeCostChart(data.nodeCosts), "node-cost-panel")}
      ${panel("Маршруты и стоимость узлов", "Количественный баланс и четыре компонента затрат по каждому складу", table(["Узел", "Маршрут", "Пополнение, т", "Отгрузки, т", "Магистраль, млн ₽", "Обработка, млн ₽", "Хранение, млн ₽", "Последняя миля, млн ₽", "Итого, млн ₽"], routeRows))}
      ${panel("Сводный детальный план перемещений", "Поставки сырья, внутризаводские этапы, пополнение РЦ и клиентские отгрузки · месяц × маршрут × продукт", paged("movement-plan", ["Тип", "Месяц", "Откуда", "Куда", "Ресурс / продукт", "Объём, т", "Затраты, млн ₽", "Лидтайм"], detailRows))}`;
  }

  function marginHeatmap(r) {
    const products = M.products.filter((p) => family === "all" || p.family === family);
    const values = products.flatMap((p) => M.months.map((_, m) => S(r.rows.filter((x) => x.product === p.id && x.month === m), "margin") / 1e6));
    const max = Math.max(1, ...values.map(Math.abs));
    const rows = products.map((p) => {
      const productRows = r.rows.filter((x) => x.product === p.id);
      const cells = M.months.map((_, m) => {
        const value = S(productRows.filter((x) => x.month === m), "margin") / 1e6;
        const intensity = Math.min(1, Math.abs(value) / max);
        return `<td class="finance-heat-cell ${value < 0 ? "negative" : ""}" style="--heat:${intensity.toFixed(3)}" title="${esc(p.name)} · ${M.months[m]}: МД ${fmt(value, 1)} млн ₽">${fmt(value, 1)}</td>`;
      }).join("");
      const revenue = S(productRows, "revenue"), margin = S(productRows, "margin");
      return `<tr><th scope="row">${esc(p.name)}<small>${p.family}</small></th>${cells}<td class="heat-total">${money(margin)}</td><td>${pct(revenue ? margin / revenue : 0)}</td></tr>`;
    }).join("");
    const totalsRow = `<tr class="heat-summary"><th scope="row">Итого<small>млн ₽</small></th>${M.months.map((_, m) => `<td>${money(S(r.rows.filter((x) => x.month === m && (family === "all" || x.family === family)), "margin"))}</td>`).join("")}<td>${money(S(r.rows.filter((x) => family === "all" || x.family === family), "margin"))}</td><td>—</td></tr>`;
    return `<div class="heat-legend finance-legend"><span><i class="heat-low"></i>Низкий МД</span><span><i class="heat-high"></i>Высокий МД</span><span>Красный — отрицательный МД</span></div><div class="table-wrap finance-heat-wrap"><table class="finance-heat"><thead><tr><th scope="col">Продукт</th>${M.months.map((m) => `<th scope="col">${m}</th>`).join("")}<th scope="col">Итого</th><th scope="col">Маржа</th></tr></thead><tbody>${rows}${totalsRow}</tbody></table></div>`;
  }

  function financeView(r, t) {
    const bp = businessResults.get(year), bpt = totals(bp);
    const costStructure = [
      ["Волокнистое сырьё", "fiberCost", "#4769ff"],
      ["Компоненты мелования", "coatCost", "#19a27b"],
      ["Электроэнергия", "energyCost", "#ff8c00"],
      ["Вода и ЦОС", "waterCost", "#38a3c7"],
      ["Массоподготовка", "massPrepCost", "#7257d5"],
      ["КДМ-9 / БДМ-7", "machineCost", "#8b5cf6"],
      ["Отделка и упаковка", "finishingCost", "#aa7bd4"],
      ["ФОТ и соц. взносы", "laborCost", "#64748b"],
      ["Ремонты и обслуживание", "maintenanceCost", "#8291a3"],
      ["Амортизация", "depreciationCost", "#485e78"],
      ["Управление и IT", "administrationCost", "#9aa6b5"],
      ["Коммерческие расходы", "sellingCost", "#b18b9d"],
    ].map(([name, key, color]) => ({ name, value: S(t.rows, key) / 1e6, color }));
    costStructure.push(
      { name: "Логистика", value: t.logistics / 1e6, color: "#e8930c" },
      { name: "Хранение запасов", value: t.holding / 1e6, color: "#c49a45" },
    );
    const bpMonthly = (key) => monthly(bp, key).map((x) => x / 1e6);
    const activeMonthly = (key) => monthly(r, key).map((x) => x / 1e6);
    const revenueDeviation = activeMonthly("revenue").map((value, i) => value - bpMonthly("revenue")[i]);
    const marginDeviation = activeMonthly("margin").map((value, i) => value - bpMonthly("margin")[i]);
    const fullCostDelta = t.fullCost - bpt.fullCost;
    return `<div class="kpis">${kpi("Выручка", money(t.revenue), "млн ₽", `БП ${money(bpt.revenue)} · ${comparisonFoot(t.revenue, bpt.revenue)}`, true)}${kpi("Полная себестоимость", money(t.fullCost), "млн ₽", `БП ${money(bpt.fullCost)} · <span class="${fullCostDelta <= 0 ? "delta-pos" : "delta-neg"}">${fullCostDelta >= 0 ? "+" : ""}${money(fullCostDelta)} млн ₽</span> к БП`, true)}${kpi("Маржинальный доход", money(t.margin), "млн ₽", `БП ${money(bpt.margin)} · ${comparisonFoot(t.margin, bpt.margin)}`, true)}${kpi("Операционная прибыль", money(t.operatingProfit), "млн ₽", `БП ${money(bpt.operatingProfit)} · ${comparisonFoot(t.operatingProfit, bpt.operatingProfit)}`)}${kpi("Полная себестоимость на тонну", fmt(t.fullCost / (t.sales || 1)), "₽/т", "Все производственные, логистические и поглощённые постоянные затраты")}</div>
      ${panel("Выручка и затраты по месяцам", "Выручка и полная себестоимость — столбцы; МД и отклонения от бизнес-плана — кривые · млн ₽", chart("Выручка, полные затраты и отклонения от БП", [
        { name: "Выручка", values: activeMonthly("revenue"), color: "#4769ff" },
        { name: "Полная себестоимость", values: activeMonthly("fullCost"), color: "#a1a9b7" },
        { name: "Маржинальный доход", values: activeMonthly("margin"), color: "#19a27b", line: true, dashed: false },
        { name: "Δ выручки к БП", values: revenueDeviation, color: "#ed0084", line: true, dashed: false },
        { name: "Δ МД к БП", values: marginDeviation, color: "#8b5cf6", line: true, dashed: false },
      ], "млн ₽", { compare: true, context: "Δ = активный план − бизнес-план" }), "finance-top-chart")}
      <div class="insight"><strong>Полная себестоимость</strong> включает переменное сырьё и переделы, логистику, хранение, ФОТ, ремонты, амортизацию, управление и коммерческие расходы. Маржинальный доход по-прежнему показан до поглощённых постоянных затрат; операционная прибыль — после них. Проценты, налог на прибыль и CAPEX не входят в себестоимость.</div>
      <div class="grid equal">${panel("Waterfall операционной прибыли", "Выручка минус все компоненты полной себестоимости", `<div class="waterfall">${[["Выручка", t.revenue, "start"], ["Переменное производство", -t.variable, "cost"], ["Логистика", -t.logistics, "cost"], ["Хранение", -t.holding, "cost"], ["Постоянные затраты", -t.fixedCost, "cost"], ["Операционная прибыль", t.operatingProfit, "total"]].map(([label, value, type]) => `<div class="waterfall-col"><strong>${money(Math.abs(value))}</strong><div class="waterfall-bar ${type}" style="height:${Math.max(8, (Math.abs(value) / (Math.max(1, t.revenue) * 1.05)) * 150)}px"></div><small>${label}</small></div>`).join("")}</div><p>Мост сходится с операционной прибылью: выручка − полная себестоимость.</p>`)}${panel("Структура полной себестоимости", "Все переделы примера показаны отдельно: массоподготовка, КДМ/БДМ и отделка", horizontalChart("Полная себестоимость по статьям", costStructure, "млн ₽"))}</div>
      ${panel("Маржинальный доход по всем продуктам", "Тепловая карта: 12 продуктовых групп × 12 месяцев · млн ₽; интенсивность цвета показывает абсолютный МД", marginHeatmap(r), "margin-heatmap-panel")}
      ${panel("Экономика по ассортименту", "Полный результат продуктовых групп · НДС не учитывается", table(["Продукт", "Отгрузки, т", "Ср. цена, ₽/т", "Выручка, млн ₽", "Полная себестоимость", "В т.ч. постоянные", "МД, млн ₽", "Опер. прибыль, млн ₽", "Рентабельность"], M.products.filter((p) => family === "all" || p.family === family).map((p) => {
        const rr = t.rows.filter((x) => x.product === p.id), revenue = S(rr, "revenue"), profit = S(rr, "operatingProfit");
        return [p.name, fmt(S(rr, "sales")), fmt(revenue / (S(rr, "sales") || 1)), money(revenue), money(S(rr, "fullCost")), money(S(rr, "fixedCost")), money(S(rr, "margin")), money(profit), pct(revenue ? profit / revenue : 0)];
      })))}`;
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
      orders: ordersView,
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
    document.querySelectorAll("[data-revenue-metric]").forEach((btn) => (btn.onclick = () => {
      revenueMetric = btn.dataset.revenueMetric;
      render();
    }));
    document.querySelectorAll("[data-stock-mode]").forEach((btn) => (btn.onclick = () => {
      stockMode = btn.dataset.stockMode;
      render();
    }));
    document.querySelectorAll("[data-cut-machine]").forEach((btn) => (btn.onclick = () => {
      cutMachine = btn.dataset.cutMachine;
      cutPage = 0;
      render();
    }));
    document.querySelectorAll("[data-cut-page]").forEach((btn) => (btn.onclick = () => {
      cutPage = Math.max(0, cutPage + Number(btn.dataset.cutPage));
      render();
    }));
    document.querySelectorAll("[data-seg-review]").forEach((btn) => (btn.onclick = () => {
      segmentReviewOnly = btn.dataset.segReview === "review";
      render();
    }));
    document.querySelectorAll("[data-seg-toggle]").forEach((btn) => (btn.onclick = () => {
      const name = btn.dataset.segToggle;
      if (segmentOff.has(name)) segmentOff.delete(name);
      else segmentOff.add(name);
      render();
    }));
    document.querySelectorAll("[data-movement-mode]").forEach((btn) => (btn.onclick = () => {
      movementModes[btn.dataset.movementMode] = btn.dataset.value;
      render();
    }));
    document.querySelectorAll("[data-movement-detail]").forEach((btn) => (btn.onclick = () => {
      movementModes[btn.dataset.movementDetail] = btn.dataset.value;
      render();
    }));
    document.querySelectorAll("[data-order-select]").forEach((input) => (input.onchange = () => {
      if (input.checked) orderSelected.add(input.dataset.orderSelect);
      else orderSelected.delete(input.dataset.orderSelect);
      render();
    }));
    const selectAll = document.querySelector("[data-order-select-all]");
    if (selectAll) selectAll.onchange = () => {
      orderSelected = selectAll.checked ? new Set(O.orders.map((order) => order.id)) : new Set();
      render();
    };
    document.querySelectorAll("[data-order-recalc]").forEach((btn) => (btn.onclick = () => {
      const onlySelected = btn.dataset.orderRecalc === "selected";
      if (onlySelected && !orderSelected.size) {
        toast("Отметьте хотя бы один заказ для частичного пересчёта.");
        return;
      }
      const orderResult = M.forYear(horizonResults.get(active), 2026);
      orderPlan = O.planPortfolio(M, orderResult, {
        orderIds: onlySelected ? [...orderSelected] : undefined,
        previousResults: orderPlan?.results || [],
      });
      orderNotice = `${onlySelected ? `Пересчитано заказов: ${orderSelected.size}` : "Пересчитан весь портфель: 20 заказов"} по состоянию на 23.10.2026`;
      render();
      toast("ATP, квоты S&OP, производство и отгрузки обновлены.");
    }));
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
        ? "Янв–сен факт · Окт–дек план нового цикла"
        : "Прогноз · 12 месяцев";
    $("#footer-period").textContent =
      year === 2026
        ? "Факт январь — сентябрь · план октябрь — декабрь 2026"
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
    orderPlan = null;
    orderSelected.clear();
    orderNotice = "Активный план S&OP изменён · выполнен предварительный расчёт";
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
    const planningMonths = Array.from({ length: 15 }, (_, index) => index + 9);
    const monthOptions = planningMonths.map((absolute) => {
      const month = absolute % 12, year = 2026 + Math.floor(absolute / 12);
      return `<option value="${absolute}">${M.months[month]} ${year}</option>`;
    }).join("");
    $("#scenario-from").innerHTML = monthOptions;
    $("#scenario-to").innerHTML = monthOptions;
    $("#repair-month-input").innerHTML = M.months.map((name, i) => `<option value="${i}">${name} · календарный месяц</option>`).join("");
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
    $("#scenario-from").value = String(cfg.periodFrom ?? 9);
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
        desc: `Копия ${base}; период ${M.months[params.periodFrom % 12]} ${2026 + Math.floor(params.periodFrom / 12)}–${M.months[params.periodTo % 12]} ${2026 + Math.floor(params.periodTo / 12)}; спрос ${fmt(params.demandScale * 100)}%, цена ${fmt(params.priceScale * 100)}%, целевой запас ${fmt(params.target * 100)}%.`,
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
    const base2026 = M.forYear(horizonResults.get(base), 2026);
    const custom2026 = M.forYear(result, 2026);
    const q4Delta = S(custom2026.rows.filter((row) => row.month >= 9), "margin") - S(base2026.rows.filter((row) => row.month >= 9), "margin");
    const marginDelta = customForecast.total.margin - baseForecast.total.margin + q4Delta;
    custom = { base, params };
    horizonResults.set("custom", result);
    orderPlan = null;
    orderSelected.clear();
    orderNotice = "Создан новый сценарий · портфель рассчитан по его кампаниям";
    active = "custom";
    b = "custom";
    let saved = true;
    try {
      localStorage.setItem("kama_sop_custom_v1", JSON.stringify(custom));
    } catch (err) {
      saved = false;
    }
    $("#editor").close();
    setYear(2026, true);
    render();
    toast(
      `${saved ? "Сценарий сохранён. " : "Сценарий рассчитан без локального сохранения. "}Окт 2026 – дек 2027: Δ МД ${marginDelta >= 0 ? "+" : ""}${money(marginDelta)} млн ₽.`,
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
            year === 2026 ? "Янв–сен факт, Окт–дек план S&OP" : "Прогноз",
        },
        { Поле: "Деньги", Значение: "Рубли без НДС; объёмы в тоннах" },
        { Поле: "Портфель заказов", Значение: "20 заказов · ATP на 23.10.2026 · горизонт октябрь–декабрь 2026 независимо от выбранного года" },
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
                ? "План S&OP"
                : "Прогноз",
          Спрос_т: x.demand,
          Выпуск_т: x.production,
          Отгрузки_т: x.sales,
          Начальный_запас_т: x.start,
          Конечный_запас_т: x.end,
          Дефицит_т: x.gap,
          Выручка_руб: x.revenue,
          Переменные_затраты_руб: x.variable,
          Постоянные_затраты_руб: x.fixedCost,
          Полная_себестоимость_руб: x.fullCost,
          Логистика_руб: x.logistics,
          Хранение_руб: x.holding,
          Маржинальный_доход_руб: x.margin,
          Операционная_прибыль_руб: x.operatingProfit,
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
      const bp = businessResults.get(year);
      add("Бизнес-план", bp.rows.map((x) => ({
        Месяц: `${M.months[x.month]} ${year}`,
        SKU: x.sku,
        Продукт: product(x.product).name,
        Отгрузки_т: x.sales,
        Выручка_руб: x.revenue,
        Полная_себестоимость_руб: x.fullCost,
        Маржинальный_доход_руб: x.margin,
        Операционная_прибыль_руб: x.operatingProfit,
      })));
      add("Перемещения", A.movementData(M, r, O.customers).all.map((x) => ({
        Тип: x.category,
        Месяц: `${M.months[x.month]} ${year}`,
        Откуда: x.from,
        Куда: x.to,
        Продукт_или_ресурс: x.item,
        Объем_т: x.qty,
        Затраты_руб: x.cost,
        Лидтайм_дн: x.lead,
      })));
      const orderResult = M.forYear(horizonResults.get(active), 2026);
      const exportOrders = orderPlan || O.planPortfolio(M, orderResult);
      add("Портфель заказов", exportOrders.results.map((x) => ({
        Заказ: x.orderId,
        Клиент: x.customer,
        Продукт: x.productName,
        Количество_т: x.qty,
        Требуемая_дата: x.requestedDate,
        Запас_доступен: x.stockStatus,
        Склад: x.sourceNode,
        Дата_производства: x.productionDate,
        Дата_отгрузки: x.shipDate,
        Дата_поставки: x.deliveryDate,
        Отклонение_дн: x.lateDays,
        Статус: x.status,
      })));
      add("Производство заказов", O.productionSchedule(exportOrders.results));
      add("Отгрузки заказов", [...exportOrders.results].sort((a, b) => a.shipDate.localeCompare(b.shipDate)).map((x) => ({
        Дата_отгрузки: x.shipDate,
        Дата_поставки: x.deliveryDate,
        Заказ: x.orderId,
        Клиент: x.customer,
        Продукт: x.productName,
        Количество_т: x.qty,
        Склад: x.sourceNode,
      })));
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
