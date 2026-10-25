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
    nodeLabel = (id) => (id === "plant" ? "Склад ГП завода" : M.nodes.find((n) => n.id === id)?.name || id),
    sku = (id) => M.skus.find((s) => s.id === id);
  const tabs = [
    ["overview", "◫", "Обзор плана"],
    ["demand", "◴", "Спрос и продажи"],
    ["production", "▤", "Производство и раскрой"],
    ["resources", "◇", "Сырьё и ресурсы"],
    ["capacity", "▥", "Обеспечивающие цеха"],
    ["network", "⌘", "Запасы"],
    ["movements", "⇄", "План перемещений"],
    ["finance", "₽", "Экономика плана"],
    ["compare", "⇆", "Сравнение версий"],
    ["orders", "✓", "Управление заказами"],
    ["dispatch", "▦", "Графикование кампаний"],
  ];
  let year = 2026;
  const tableSorts = new Map(); /* tableKey -> { col, dir: "asc" | "desc" }; persistently stores column sort */
  let tableSeq = 0;
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
    overviewSource = "previous",
    stockMode = "volume",
    obsoleteMode = "value",
    cutMachine = "all",
    cutPage = 0,
    registryStream = "mass",
    fiberType = "all",
    dispatchUnits = new Set(), /* пусто = все агрегаты; иначе — выбранный набор */
    dispatchFocus = null, /* кампания, выбранная мышью: подсвечивается её цепочка */
    dispatchDimDone = true, /* завершённые кампании по умолчанию серые */
    dispatchLinks = true,
    dispatchCascade = true,
    dispatchMoves = new Map(),
    dispatchOrders = new Set(),
    segmentReviewOnly = false,
    segmentOff = new Set(),
    resourceModes = { fiber: "volume", coat: "volume", energy: "volume", water: "volume" },
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
    orderFilter = new Set(),
    orderQuick = "all",
    orderSource = "all",
    quotaView = "product",
    panelCounter = 0,
    expandedPanel = null,
    expandedPanelTab = null,
    ganttScrollLeft = 0,
    ganttWindowKey = null;
  const pages = {};

  /* User scenarios: several named copies of a standard version, stored locally.
     The single copy of the previous release (kama_sop_custom_v1) is migrated. */
  const CUSTOM_KEY = "kama_sop_customs_v2",
    LEGACY_CUSTOM_KEY = "kama_sop_custom_v1",
    CUSTOM_LIMIT = 8;
  let customs = [];
  const isCustom = (id) => customs.some((c) => c.id === id);
  const customById = (id) => customs.find((c) => c.id === id);
  function customConfig(entry) {
    const base = M.scenarios.find((c) => c.id === entry.base);
    const p = entry.params || {};
    const period = (value) => `${M.months[value % 12]} ${2026 + Math.floor(value / 12)}`;
    return {
      ...base,
      id: entry.id,
      name: entry.name,
      custom: true,
      desc: `Копия ${base.name}; период ${period(p.periodFrom ?? 9)}–${period(p.periodTo ?? 23)}; спрос ${fmt((p.demandScale ?? 1) * 100)}%, цена ${fmt((p.priceScale ?? 1) * 100)}%, целевой запас ${fmt((p.target ?? base.target) * 100)}%.`,
    };
  }
  function saveCustoms() {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customs));
      localStorage.removeItem(LEGACY_CUSTOM_KEY);
      return true;
    } catch (e) {
      return false;
    }
  }
  try {
    let stored = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "null");
    if (!Array.isArray(stored)) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_CUSTOM_KEY) || "null");
      stored = legacy && legacy.base
        ? [{ id: "custom", name: "V6 · Пользовательский сценарий", base: legacy.base, params: legacy.params || {}, created: null }]
        : [];
    }
    customs = stored
      .filter((entry) => entry && typeof entry.id === "string" && M.scenarios.some((c) => c.id === entry.base))
      .slice(0, CUSTOM_LIMIT);
    for (const entry of customs) {
      const horizon = M.runHorizon(customConfig(entry), entry.params);
      horizonResults.set(entry.id, horizon);
      results.set(entry.id, M.forYear(horizon, year));
    }
    if (customs.length) saveCustoms();
  } catch (e) {
    customs = [];
  }
  /* «Сегодня» плана — ATP-дата модуля заказов (23.10.2026): октябрьские
     кампании до этого часа уже запущены или выполнены. */
  const NOW_YEAR = 2026,
    NOW_MONTH = 9,
    NOW_DAY = Number(O.AS_OF.slice(8, 10)),
    NOW_HOUR = (NOW_DAY - 1) * 24;
  /* Статус кампании относительно «сегодня»: факт до октября, «идёт сейчас»
     для кампаний, накрывающих текущий час, план после. */
  function campaignStatus(c, y = year) {
    if (y !== NOW_YEAR) return { label: "План", cls: "" };
    if (c.month < NOW_MONTH) return { label: "Факт", cls: "shipped" };
    if (c.month > NOW_MONTH) return { label: "План", cls: "" };
    if (c.end <= NOW_HOUR) return { label: "Выполнена", cls: "shipped" };
    if (c.start <= NOW_HOUR) return { label: "Идёт сейчас", cls: "warn" };
    return { label: "План", cls: "" };
  }
  const statusPill = (c) => {
    const s = campaignStatus(c);
    return `<span class="pill ${s.cls}">${s.label}</span>`;
  };
  /* Классификация рецептуры волокна для кампаний массоподготовки: состав
     ЛЦ / ХЦ / BCTMP и уровень мелования определяют вид массы. */
  function recipeClass(recipe) {
    if (!recipe) return "Без рецептуры";
    if ((recipe.coat || 0) >= 0.12) return "Мелованная масса GC";
    if ((recipe.coat || 0) >= 0.05) return "Мелованная масса LWC";
    if ((recipe.bctmp || 0) >= 0.25) return "BCTMP-пухлая масса";
    return "Немелованная офсетная масса";
  }
  const recipeColors = {
    "Мелованная масса GC": "#4769ff",
    "Мелованная масса LWC": "#9b58be",
    "BCTMP-пухлая масса": "#ff8c00",
    "Немелованная офсетная масса": "#27a47b",
    "Без рецептуры": "#a1a9b7",
  };
  const recipeKey = (recipe) =>
    recipe
      ? [recipe.lc, recipe.sc, recipe.bctmp || 0, recipe.coat || 0]
          .map((v) => Math.round(v * 1000))
          .join("-")
      : "none";
  /* Каждая конкретная рецептура волокна получает свой устойчивый цвет: на
     таймлайне массоподготовки одна рецептура узнаваемо повторяется из месяца
     в месяц, а разные составы не сливаются в один «класс». */
  const recipePalette = [
    "#4769ff", "#ff8c00", "#27a47b", "#9b58be", "#e0455e", "#38a3c7",
    "#b58a00", "#d66ba0", "#7cb342", "#8d6e63", "#566378", "#a1a9b7",
  ];
  const recipeColorCache = new Map();
  const recipeColor = (recipe) => {
    const key = recipeKey(recipe);
    if (!recipeColorCache.has(key))
      recipeColorCache.set(key, recipePalette[recipeColorCache.size % recipePalette.length]);
    return recipeColorCache.get(key);
  };

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
     They expose bottlenecks instead of silently consuming duplicate tonnage.
     Mass preparation is aggregated one level higher than the paper machines:
     campaigns of a month with an identical fibre recipe (ЛЦ / ХЦ / BCTMP +
     coating) are prepared as ONE mass campaign that covers ("снабжает")
     several КДМ/БДМ campaigns; finishing stays 1:1 with machine campaigns. */
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
    /* Режущий комплект — непосредственный upstream упаковки. Заполняется
       раньше УП-1 благодаря порядку auxiliaryUnits. */
    const cuttingByCampaign = new Map();
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
        if (unit.stage === "Массоподготовка") {
          /* Group the month's machine campaigns by fibre recipe: one mass
             campaign per recipe, in chronological order of its first member. */
          const byRecipe = new Map();
          for (const c of source) {
            const recipe = M.recipes ? M.recipes[c.product] : undefined;
            const key = recipeKey(recipe);
            if (!byRecipe.has(key)) byRecipe.set(key, { recipe, members: [] });
            byRecipe.get(key).members.push(c);
          }
          /* Рецептуры идут по сроку первой потребляющей кампании. Даже если
             несколько партий нужны одновременно, один агрегат готовит их
             строго последовательно: базовый план не содержит физически
             невозможных накладок. Диспетчер по-прежнему может создать
             накладку ручным сдвигом — её поймает проверка мощностей. */
          const groups = [...byRecipe.values()].sort(
            (a, b) => Math.min(...a.members.map((c) => c.start)) - Math.min(...b.members.map((c) => c.start)),
          );
          let cursor = 0;
          const schedule = groups.map((group, index) => {
            const members = group.members, first = members[0];
            const setup = index ? Math.min(1.2, (S(members, "setup") / members.length) * 0.25) : 0.5;
            const run = S(members, unit.source) / unit.rate;
            const begin = cursor;
            cursor += setup + run;
            return { group, members, first, setup, run, begin };
          });
          /* Вся очередь массы сдвигается так, чтобы каждая кампания ЗАВЕРШИЛАСЬ
             до старта первой потребляющей её кампании машины. Сравнивать только
             старты недостаточно: при параллельном старте масса ещё готовится,
             а машина уже начинает её расходовать. Первый член группы — самый
             ранний потребитель, поэтому остальные члены также обеспечены. */
          const earlyShift = Math.min(
            0,
            ...schedule.map((item) =>
              item.first.start - (item.begin + item.setup + item.run)),
          );
          for (let index = 0; index < schedule.length; index++) {
            const { group, members, first, setup, run } = schedule[index];
            const seq = index + 1;
            const begin = schedule[index].begin + earlyShift;
            const end = begin + setup + run;
            elapsed = end;
            setupTotal += setup;
            runTotal += run;
            campaigns.push({
              ...first,
              id: `${first.year || year}-${m + 1}-${unit.id}-${String(seq).padStart(2, "0")}`,
              machine: unit.id,
              name: unit.name,
              stage: unit.stage,
              product: first.product,
              products: [...new Set(members.map((c) => c.product))],
              grams: [...new Set(members.map((c) => c.gram))].sort((a, b) => a - b),
              start: begin,
              end,
              setup,
              run,
              gross: S(members, "gross"),
              good: S(members, "good"),
              trim: S(members, "trim"),
              fiber: S(members, "fiber"),
              coat: S(members, "coat"),
              energy: S(members, "energy"),
              water: S(members, "water"),
              recipe: group.recipe,
              recipeClass: recipeClass(group.recipe),
              covers: members.map((c) => c.id),
              supplies: unit.family === "Картон" ? "КДМ-9" : "БДМ-7",
            });
          }
        } else {
          /* Finish-to-start для каждого передела: резка ждёт ОКОНЧАНИЯ
             кампании КДМ/БДМ, а упаковка — окончания своей кампании резки.
             Очередь на самом агрегате также остаётся строго последовательной. */
          const ordered = [...source].sort((a, b) => a.start - b.start);
          ordered.forEach((c, index) => {
            const setup = index ? Math.min(1.2, c.setup * 0.25) : 0.5;
            const run = c[unit.source] / unit.rate;
            const upstream = unit.id === "УП-1" ? cuttingByCampaign.get(c.id) : c;
            const begin = Math.max(elapsed, upstream?.end ?? c.end);
            elapsed = begin + setup + run;
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
              recipe: M.recipes ? M.recipes[c.product] : undefined,
              supplies: c.machine,
              dependsOn: upstream?.id || c.id,
            });
            if (unit.id === "ПРС-1" || unit.id === "ПРС-2")
              cuttingByCampaign.set(c.id, campaigns[campaigns.length - 1]);
          });
        }
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
          used: setupTotal + runTotal,
          load: (setupTotal + runTotal) / available,
        });
      }
    }

    /* Сверяем очереди на единой часовой оси года. Месячные планы могут
       выходить за границу своего месяца (масса готовится заранее, отделка
       завершает выпуск следующего месяца); без этого шага кампания следующего
       месяца могла начаться поверх хвоста предыдущей. */
    const monthOffsets = [];
    let monthOffset = 0;
    for (const daysInMonth of days) {
      monthOffsets.push(monthOffset);
      monthOffset += daysInMonth * 24;
    }
    const absoluteStart = (c) => monthOffsets[c.month] + c.start;
    const absoluteEnd = (c) => monthOffsets[c.month] + c.end;
    const operationById = new Map(campaigns.map((c) => [c.id, c]));
    const writeAbsoluteInterval = (c, begin, end) => {
      c.start = begin - monthOffsets[c.month];
      c.end = end - monthOffsets[c.month];
    };
    for (const unit of auxiliaryUnits) {
      const list = campaigns.filter((c) => c.machine === unit.id);
      if (unit.stage === "Массоподготовка") {
        /* EDD (earliest due date): дедлайн — старт самого раннего потребителя.
           Обратный проход ставит каждую кампанию не позже дедлайна и не позже
           начала следующей кампании на том же агрегате. */
        const ordered = list
          .map((c) => ({
            c,
            deadline: Math.min(...(c.covers || []).map((id) => {
              const consumer = operationById.get(id);
              return consumer ? absoluteStart(consumer) : Infinity;
            })),
          }))
          .sort((a, b) => a.deadline - b.deadline || absoluteStart(a.c) - absoluteStart(b.c));
        let nextStart = Infinity;
        for (let i = ordered.length - 1; i >= 0; i--) {
          const { c, deadline } = ordered[i];
          const end = Math.min(deadline, nextStart);
          const begin = end - c.setup - c.run;
          writeAbsoluteInterval(c, begin, end);
          nextStart = begin;
        }
      } else {
        /* Прямой finish-to-start проход. Для УП-1 dependsOn уже указывает на
           ПРС, поэтому упаковка всегда правее и машины, и резки своей цепочки. */
        const ordered = [...list].sort((a, b) => {
          const upstreamA = operationById.get(a.dependsOn);
          const upstreamB = operationById.get(b.dependsOn);
          return (upstreamA ? absoluteStart(upstreamA) : absoluteStart(a)) -
            (upstreamB ? absoluteStart(upstreamB) : absoluteStart(b));
        });
        let cursor = 0;
        for (const c of ordered) {
          const upstream = operationById.get(c.dependsOn);
          const begin = Math.max(cursor, upstream ? absoluteEnd(upstream) : 0);
          const end = begin + c.setup + c.run;
          writeAbsoluteInterval(c, begin, end);
          cursor = end;
        }
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
    const option = ([id, r]) =>
      `<option value="${id}" ${id === selected ? "selected" : ""}>${esc(r.config.name)}</option>`;
    const standard = [...results].filter(([id]) => !isCustom(id));
    const own = [...results].filter(([id]) => isCustom(id));
    return own.length
      ? `<optgroup label="Штатные версии">${standard.map(option).join("")}</optgroup><optgroup label="Пользовательские сценарии">${own.map(option).join("")}</optgroup>`
      : standard.map(option).join("");
  }

  function kpi(label, value, unit, foot, accent = false) {
    const tone = typeof accent === "string" ? accent : accent ? "accent" : "";
    return `<div class="kpi ${tone}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}<span class="kpi-unit">${unit}</span></div><div class="kpi-foot">${foot}</div></div>`;
  }

  function panel(title, sub, body, className = "") {
    const id = `panel-${++panelCounter}`;
    const hasChart =
      body.includes('class="chart"') || body.includes('class="chart ') || body.includes('class="process-sankey"');
    return `<section class="panel ${hasChart ? "chart-panel" : ""} ${className}" id="${id}"><div class="panel-head"><div class="panel-heading"><h2>${title}</h2>${sub ? `<small>${sub}</small>` : ""}</div><button class="panel-toggle" type="button" data-expand-panel="${id}" aria-expanded="false" aria-controls="${id}-body" aria-label="Развернуть: ${esc(title)}" title="Развернуть почти на весь дашборд"><span class="expand-icon" aria-hidden="true">⛶</span><span>Развернуть</span></button></div><div class="panel-body" id="${id}-body">${body}</div></section>`;
  }

  /* Plain text of a cell, used both for sorting and for clean tooltip text. */
  function cellText(s) {
    return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  /* Best-effort numeric extraction from a cell (ru-RU thousands/decimals,
     minus/unbreakable-space, "%"/"т"/"млн ₽" suffixes, embedded in HTML). */
  function toNumber(s) {
    const t = cellText(s);
    if (t === "—" || t === "–" || t === "") return null;
    const n = t.replace(/[  ]/g, "").replace(/−/g, "-").replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
    return n ? parseFloat(n[0]) : null;
  }
  /* Compare two cell values: numeric columns sort numerically, "—"/empty sink
     to the bottom, everything else sorts as Russian text. */
  function compareCells(a, b) {
    const na = toNumber(a), nb = toNumber(b);
    if (na !== null && nb !== null) return na - nb;
    const ta = cellText(a), tb = cellText(b);
    const empty = (v) => v === "—" || v === "–" || v === "";
    if (empty(ta) && empty(tb)) return 0;
    if (empty(ta)) return 1;
    if (empty(tb)) return -1;
    return ta.localeCompare(tb, "ru");
  }

  /* Generic data table. Every column header is clickable and sorts that column;
     sort state is kept in `tableSorts` keyed by a stable table id, so it survives
     re-renders. `key` lets paged() share one stable id across renders. */
  function table(headers, rows, opts = {}) {
    const key = opts.key || `tbl-${tableSeq++}`;
    const sort = opts.skipSort ? null : tableSorts.get(key);
    let body = rows;
    if (sort && rows.length) {
      const dir = sort.dir === "asc" ? 1 : -1;
      body = [...rows].sort((r1, r2) => dir * compareCells(r1[sort.col] ?? "", r2[sort.col] ?? ""));
    }
    const head = headers
      .map((h, i) => {
        const active = sort && sort.col === i;
        const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
        return `<th scope="col" class="sortable${active ? " sorted" : ""}" data-table-key="${esc(key)}" data-col="${i}" tabindex="0" title="Сортировать по «${esc(cellText(h))}»" aria-sort="${active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}">${h}${arrow}</th>`;
      })
      .join("");
    return `<div class="table-wrap"><table data-table-key="${esc(key)}"><thead><tr>${head}</tr></thead><tbody>${body.length ? body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Нет строк для выбранных фильтров</td></tr>`}</tbody></table></div>`;
  }
  function paged(id, headers, rows) {
    const state = pages[id] || { page: 0, search: "" };
    pages[id] = state;
    const filtered = rows.filter((r) =>
      r.join(" ").toLowerCase().includes(state.search.toLowerCase()),
    );
    const sort = tableSorts.get(id);
    if (sort && filtered.length) {
      const dir = sort.dir === "asc" ? 1 : -1;
      filtered.sort((r1, r2) => dir * compareCells(r1[sort.col] ?? "", r2[sort.col] ?? ""));
    }
    const count = Math.max(1, Math.ceil(filtered.length / 24));
    state.page = Math.min(state.page, count - 1);
    return `<div class="table-tools"><span>${fmt(filtered.length)} строк · по 24 на странице</span><input data-search="${id}" aria-label="Поиск в таблице ${id}" placeholder="Поиск по таблице…" value="${esc(state.search)}"></div>${table(headers, filtered.slice(state.page * 24, (state.page + 1) * 24), { key: id, skipSort: true })}<div class="pager"><button class="button" data-page="${id}" data-step="-1" ${state.page === 0 ? "disabled" : ""}>← Назад</button><span>${state.page + 1} / ${count}</span><button class="button" data-page="${id}" data-step="1" ${state.page === count - 1 ? "disabled" : ""}>Далее →</button></div>`;
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
  /* Monthly chart. Bar series with the same `slot` share one position, so a
     fact series (Jan–Sep) and a plan series (Oct–Dec) read as one bar row. */
  function chart(title, allSeries, unit = "т", options = {}) {
    /* Empty series (e.g. "Факт" in the 2027 forecast) are not shown in the legend. */
    const series = allSeries.filter((s) => s.values.some(Number.isFinite));
    const w = options.width || 720,
      h = options.height || 280,
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
    if (year === 2026 && (!options.compare || options.split)) {
      const splitX = left + (9 * plotW) / 12;
      svg += `<line x1="${splitX}" x2="${splitX}" y1="${top}" y2="${top + plotH}" stroke="#aab4c4" stroke-dasharray="3 4"/><text x="${splitX + 5}" y="${top + 10}" class="chart-note">план S&OP</text>`;
    }
    const bars = series.filter((s) => !s.line);
    const slotOf = (s) => (Number.isInteger(s.slot) ? s.slot : bars.indexOf(s));
    const slotCount = Math.max(1, ...bars.map((s) => slotOf(s) + 1));
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
        const slot = slotOf(s);
        const groupW = (plotW / 12) * 0.74;
        const bw = groupW / slotCount;
        s.values.forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          const x =
            left + (i * plotW) / 12 + (plotW / 12 - groupW) / 2 + slot * bw;
          const outside = i < fromMonth || i > toMonth;
          const estimate =
            !options.compare && year === 2026 && i >= 9;
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
    const context = (options.context || (year === 2026 ? "Янв–сен факт · Окт–дек план" : "Прогноз 2027"))
      .split(" · ")
      .filter((part) => year === 2026 || !/^факт$/i.test(part.trim()))
      .join(" · ");
    return `<div class="chart-block"><div class="legend">${series.map((s, i) => `<button type="button" class="legend-toggle" data-legend="${i}" aria-pressed="true"><i style="background:${s.color}${s.line && s.dashed !== false ? ";height:3px;border-radius:2px" : ""}"></i>${s.name}</button>`).join("")}<span class="chart-context">${context} · ${unit}</span></div><div class="chart-scroll">${svg}</div></div>`;
  }

  function horizontalChart(title, items, unit = "", digits = 1, options = {}) {
    const w = options.width || 720,
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

  /* Signed number without "−0,0" for values that round to zero. */
  function signed(value, digits = 1, formatter = (v) => fmt(v, digits)) {
    const text = formatter(Math.abs(value));
    if (/^0([,.]0+)?$/.test(text.replace(/\s/g, ""))) return text;
    return `${value >= 0 ? "+" : "−"}${text}`;
  }

  function comparisonFoot(value, plan, formatter = money, suffix = "млн ₽") {
    const delta = value - plan;
    const relative = plan ? (delta / Math.abs(plan)) * 100 : 0;
    return `<span class="${delta >= 0 ? "delta-pos" : "delta-neg"}">${signed(delta, 1, formatter)} ${suffix} · ${signed(relative, 1)}%</span> к БП`;
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

  /* "Янв–сен 2026", "Окт 2026" … for a sorted list of month indexes. */
  function rangeLabel(list, labelYear = year) {
    if (!list.length) return "—";
    const first = list[0], last = list[list.length - 1];
    return first === last
      ? `${M.months[first]} ${labelYear}`
      : `${M.months[first]}–${M.months[last].toLowerCase()} ${labelYear}`;
  }

  /* Overview forecast source: the previous S&OP cycle (default on every load)
     or the active plan. Reported actual (Jan–Sep 2026) is the same in both;
     months outside the previous cycle's horizon stay empty in its view. */
  function overview(r) {
    const usePrevious = overviewSource === "previous";
    const previousResult = results.get(M.previousSopId);
    const source = usePrevious ? previousResult : r;
    const bp = businessResults.get(year);
    const inFamily = (row) => family === "all" || row.family === family;
    const isActual = (m) => year === 2026 && m <= 8;
    const covered = (m) => !usePrevious || isActual(m) || M.previousSopCovers(year, m);
    const periodMonths = M.months.map((_, m) => m).filter((m) => m >= fromMonth && m <= toMonth);
    const factMonths = periodMonths.filter(isActual);
    const shownMonths = periodMonths.filter(covered);
    const forecastMonths = shownMonths.filter((m) => !isActual(m));
    const pick = (data, list) => {
      const set = new Set(list);
      return data.rows.filter((row) => set.has(row.month) && inFamily(row));
    };
    const fact = metricSum(pick(source, factMonths)), bpFact = metricSum(pick(bp, factMonths));
    const landing = metricSum(pick(source, shownMonths)), bpLanding = metricSum(pick(bp, shownMonths));
    const factLabel = rangeLabel(factMonths), periodLabel = rangeLabel(periodMonths), shownLabel = rangeLabel(shownMonths);
    const landingName = !factMonths.length ? "прогноз" : !forecastMonths.length ? "факт" : "факт + прогноз";
    const previousName = previousResult.config.name;
    const sourceTag = usePrevious ? "прошлый цикл S&OP" : r.config.name.split(" · ")[0];
    const noForecast = "Нет прогноза прошлого цикла S&OP";
    const horizon = M.previousSop;
    const horizonLabel = `${M.months[horizon.from.month].toLowerCase()} ${horizon.from.year} – ${M.months[horizon.to.month].toLowerCase()} ${horizon.to.year}`;
    const toggle = `<div class="overview-source-bar"><span class="control-label">ПРОГНОЗ В ОБЗОРЕ</span><div class="overview-source" role="group" aria-label="Прогноз в обзоре плана">
      <button type="button" data-overview-source="previous" aria-pressed="${usePrevious}" title="${esc(`Цикл S&OP «${horizon.cycle}» · ${previousName} · горизонт ${horizonLabel}`)}">Прошлый цикл S&amp;OP<small>${esc(previousName.split(" · ")[0])} · ${horizonLabel}</small></button><button type="button" data-overview-source="active" aria-pressed="${!usePrevious}" title="${esc(r.config.name)}">Активный сценарий<small>${esc(r.config.name)}</small></button>
    </div></div>`;
    const metrics = [
      ["Выручка", "revenue", money, "млн ₽"],
      ["МД", "margin", money, "млн ₽"],
      ["Отгрузки", "sales", fmt, "т"],
    ];
    const factCards = metrics.map(([label, key, formatter, unit]) =>
      factMonths.length
        ? kpi(`${label} · факт ${factLabel}`, formatter(fact[key]), unit, `БП ${formatter(bpFact[key])} · ${comparisonFoot(fact[key], bpFact[key], formatter, unit)}`, "accent")
        : kpi(`${label} · факт`, "—", "", `Нет закрытых месяцев в периоде ${periodLabel}`, "muted-card"),
    ).join("");
    const landingCards = metrics.map(([label, key, formatter, unit]) =>
      shownMonths.length
        ? kpi(`${label} · ${landingName} ${shownLabel}`, formatter(landing[key]), unit, `БП ${formatter(bpLanding[key])} · ${comparisonFoot(landing[key], bpLanding[key], formatter, unit)}`, "landing")
        : kpi(`${label} · прогноз ${periodLabel}`, "—", "", noForecast, "muted-card"),
    ).join("");
    const monthlyOf = (data, key, scale = 1, filter = () => true) =>
      M.months.map((_, m) => (filter(m) ? S(data.rows.filter((row) => row.month === m && inFamily(row)), key) / scale : null));
    const bpMonthly = (key, scale = 1) => monthlyOf(bp, key, scale);
    const actualMonthly = (key, scale = 1) => monthlyOf(source, key, scale, isActual);
    const forecastMonthly = (key, scale = 1) => monthlyOf(source, key, scale, (m) => !isActual(m) && covered(m));
    const landingMonthly = (key, scale = 1) => monthlyOf(source, key, scale, covered);
    const delta = (value, base, formatter) =>
      `<span class="${value >= base ? "delta-pos" : "delta-neg"}">${signed(value - base, 1, formatter)}</span>`;
    const rowsTable = periodMonths.map((m) => {
      const plan = metricSum(pick(bp, [m]));
      const label = `${M.months[m]} ${year}`;
      if (!covered(m))
        return [label, `<span class="muted">${noForecast}</span>`, fmt(plan.sales), "—", "—", money(plan.revenue), "—", "—", money(plan.margin), "—", "—"];
      const current = metricSum(pick(source, [m]));
      return [
        label, isActual(m) ? "Факт" : `Прогноз · ${esc(sourceTag)}`,
        fmt(plan.sales), fmt(current.sales), delta(current.sales, plan.sales, fmt),
        money(plan.revenue), money(current.revenue), delta(current.revenue, plan.revenue, money),
        money(plan.margin), money(current.margin), delta(current.margin, plan.margin, money),
      ];
    });
    const context = `БП · факт · ${usePrevious ? sourceTag : `сценарий ${esc(sourceTag)}`}`;
    const directionSub = `${esc(usePrevious ? `Прошлый цикл S&OP (${previousName.split(" · ")[0]})` : r.config.name)} против бизнес-плана · ${shownMonths.length ? shownLabel : periodLabel}`;
    const directionBody = shownMonths.length
      ? revenueDirectionChart(pick(source, shownMonths), pick(bp, shownMonths))
      : `<div class="overview-empty">${noForecast} за ${periodLabel}</div>`;
    return `${toggle}<div class="kpis overview-kpis">${factCards}${landingCards}</div>
    <div class="grid equal chart-grid">
      ${panel("Объём: бизнес-план, факт и прогноз", "т", chart("План-факт отгрузок", [
        { name: "Бизнес-план", values: bpMonthly("sales"), color: "#b8c0cc" },
        { name: "Факт", values: actualMonthly("sales"), color: "#4769ff" },
        { name: "Прогноз S&OP", values: forecastMonthly("sales"), color: "#8b5cf6", line: true, dashed: false },
      ], "т", { compare: true, context }))}
      ${panel("Выручка: закрытие года против бизнес-плана", "млн ₽", chart("Выручка против бизнес-плана", [
        { name: "Бизнес-план", values: bpMonthly("revenue", 1e6), color: "#b8c0cc" },
        { name: "Факт", values: actualMonthly("revenue", 1e6), color: "#4769ff" },
        { name: "Прогноз S&OP", values: forecastMonthly("revenue", 1e6), color: "#8b5cf6", line: true, dashed: false },
      ], "млн ₽", { compare: true, context }))}
    </div>
    ${panel("Выручка по направлениям", directionSub, directionBody, "revenue-panel")}
    <div class="grid equal chart-grid">
      ${panel("Маржинальный доход: план-факт", "млн ₽", chart("МД против бизнес-плана", [
        { name: "Бизнес-план", values: bpMonthly("margin", 1e6), color: "#b8c0cc" },
        { name: "Факт / прогноз S&OP", values: landingMonthly("margin", 1e6), color: "#19a27b", line: true, dashed: false },
      ], "млн ₽", { compare: true, context }))}
      ${panel("Производство и запас против бизнес-плана", "т", chart("Производство и запас против БП", [
        { name: "Выпуск · БП", values: bpMonthly("production"), color: "#c4ccd7" },
        { name: "Выпуск · факт / прогноз", values: landingMonthly("production"), color: "#8b5cf6" },
        { name: "Запас · БП", values: bpMonthly("end"), color: "#ed0084", line: true },
        { name: "Запас · факт / прогноз", values: landingMonthly("end"), color: "#4769ff", line: true, dashed: false },
      ], "т", { compare: true, context }))}
    </div>
    ${panel("План-факт по месяцам", "Δ = факт / прогноз − бизнес-план", table(["Месяц", "Статус", "Отгрузки БП, т", "Факт / прогноз, т", "Δ, т", "Выручка БП, млн ₽", "Факт / прогноз, млн ₽", "Δ выручки", "МД БП, млн ₽", "МД факт / прогноз", "Δ МД"], rowsTable))}`;
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
      const grossProfit = economics(rows, "grossProfit");
      const segmentIndex = M.segments.indexOf(client.segment);
      const coverage = demand ? sales / demand : 0;
      const otifTarget = otifTargets[segmentIndex];
      const otif = Math.max(0.76, Math.min(0.99, coverage * 0.975 + ((index % 5) - 2) * 0.006));
      const marginRate = revenue ? margin / revenue : 0;
      const marginTarget = marginTargets[segmentIndex];
      const review = "", reviewDirection = "";
      return {
        ...client, index, rows, demand, sales, coverage, revenue, margin, marginRate,
        grossProfit, grossRate: revenue ? grossProfit / revenue : 0,
        marginTarget, otif, otifTarget, review, reviewDirection,
        color: colors[segmentIndex], segmentIndex,
      };
    });
    const scores = clients.map((client) => ({
      client,
      marginDev: (client.marginRate - client.marginTarget) * 100,
      otifDev: (client.otif - client.otifTarget) * 100,
      score: (client.marginRate - client.marginTarget) * 0.7 + (client.otif - client.otifTarget) * 0.3,
    })).sort((a, b) => a.score - b.score);
    /* Кейсы на пересмотр выбираются по отклонению от ПРАВИЛ сегмента: клиент
       попадает в поле зрения S&OP, только если его маржа МД и/или OTIF ушли за
       целевые рамки своего сегмента. Берём трёх с наибольшим негативным
       отклонением (они намеренно выбиваются из правил сегмента вниз) и двух с
       наибольшим позитивным (кандидаты на повышение, выше правил сегмента). */
    scores
      .filter(({ marginDev, otifDev }) => marginDev < 0 || otifDev < 0)
      .slice(0, 3)
      .forEach(({ client, marginDev, otifDev }) => {
        const parts = [];
        if (marginDev < 0)
          parts.push(`маржа МД ${pct(client.marginRate)} при цели сегмента ${pct(client.marginTarget)} (${signed(marginDev, 1)} п.п.)`);
        if (otifDev < 0)
          parts.push(`OTIF ${pct(client.otif)} при цели ${pct(client.otifTarget)} (${signed(otifDev, 1)} п.п.)`);
        client.review = `На пересмотр: выбивается из правил сегмента «${client.segment}» — ${parts.join("; ")}`;
        client.reviewDirection = "down";
      });
    scores
      .filter(({ marginDev, otifDev }) => marginDev > 0 && otifDev > 0)
      .slice(-2)
      .forEach(({ client, marginDev, otifDev }) => {
        client.review = `Кандидат на повышение: выше правил сегмента «${client.segment}» — маржа МД ${pct(client.marginRate)} (+${fmt(marginDev, 1)} п.п.), OTIF ${pct(client.otif)} (+${fmt(otifDev, 1)} п.п.)`;
        client.reviewDirection = "up";
      });
    const segments = M.segments.map((name, index) => {
      const clientsInSegment = clients.filter((client) => client.segment === name);
      const revenue = S(clientsInSegment, "revenue");
      return {
        name, index, clients: clientsInSegment, color: colors[index],
        revenue, margin: S(clientsInSegment, "margin"),
        grossProfit: S(clientsInSegment, "grossProfit"),
        demand: S(clientsInSegment, "demand"), sales: S(clientsInSegment, "sales"),
        otifTarget: otifTargets[index],
        otif: revenue ? S(clientsInSegment, (client) => client.otif * client.revenue) / revenue : 0,
      };
    }).sort((x, y) => y.grossProfit - x.grossProfit || x.index - y.index);
    return { cr, rowMap, economics, clients, segments };
  }

  /* Soft hyphens at word joints so long names wrap inside a bubble. */
  function softHyphen(name) {
    return String(name)
      .split(" ")
      .map((word) => {
        if (word.length <= 9) return word;
        const camel = word.replace(/([а-яёa-z])([А-ЯЁA-Z])/g, "$1\u00ad$2");
        if (camel !== word) return camel;
        const cut = Math.ceil(word.length / 2);
        return `${word.slice(0, cut)}\u00ad${word.slice(cut)}`;
      })
      .join(" ");
  }

  function segmentationMatrix(analytics) {
    const values = analytics.clients.map((client) => Math.max(0, client.grossProfit));
    const min = Math.min(...values), max = Math.max(...values);
    const size = (value) => 92 + Math.sqrt((Math.max(0, value) - min) / Math.max(1, max - min)) * 58;
    const bands = analytics.segments.map((segment) => {
      const hidden = segmentOff.has(segment.name);
      const bubbles = [...segment.clients].sort((a, b) => b.grossProfit - a.grossProfit).map((client) => {
        const dim = hidden || (segmentReviewOnly && !client.review);
        const diameter = size(client.grossProfit);
        const title = `${client.name} · ${client.segment}. Выручка ${money(client.revenue)} млн ₽; валовая прибыль ${money(client.grossProfit)} млн ₽; МД ${money(client.margin)} млн ₽, маржа МД ${pct(client.marginRate)}; OTIF ${pct(client.otif)} при цели ${pct(client.otifTarget)}${client.review ? `. ${client.review}` : ""}`;
        return `<div class="client-bubble ${dim ? "dim" : ""} ${client.reviewDirection ? `review-${client.reviewDirection}` : ""}" style="--bubble:${fmt(diameter, 0)}px;--segment:${client.color}" tabindex="0" title="${esc(title)}" aria-label="${esc(title)}"><span>${esc(softHyphen(client.name))}</span><strong>${money(client.grossProfit)}</strong><small>млн ₽</small></div>`;
      }).join("");
      const delta = (segment.otif - segment.otifTarget) * 100;
      const otif = `<div class="segment-otif" title="OTIF факт ${pct(segment.otif)} · цель ${pct(segment.otifTarget)}"><span>OTIF</span><strong>${pct(segment.otif)}</strong><div class="otif-track"><i style="width:${Math.min(100, segment.otif * 100)}%"></i><b style="left:${segment.otifTarget * 100}%"></b></div><em class="${delta >= 0 ? "delta-pos" : "delta-neg"}">цель ${pct(segment.otifTarget)} · ${delta >= 0 ? "+" : ""}${fmt(delta, 1)} п.п.</em></div>`;
      return `<div class="segment-band ${hidden ? "is-off" : ""}" style="--segment:${segment.color}"><div class="segment-band-head"><div><b>${esc(segment.name)}</b><span>${segment.clients.length} клиента · выручка ${money(segment.revenue)} млн ₽ · валовая прибыль ${money(segment.grossProfit)} млн ₽</span></div>${otif}</div><div class="segment-bubbles">${hidden ? '<span class="muted">Сегмент скрыт фильтром</span>' : bubbles}</div></div>`;
    }).join("");
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Фильтр клиентов на пересмотр"><button type="button" data-seg-review="all" aria-pressed="${!segmentReviewOnly}">Все клиенты</button><button type="button" data-seg-review="review" aria-pressed="${segmentReviewOnly}">⚑ На пересмотр (${analytics.clients.filter((c) => c.review).length})</button></div><span class="chart-context">Площадь круга — валовая прибыль · сегменты по убыванию валовой прибыли · кольцо: зелёное ↑ / красное ↓</span></div><div class="segment-matrix">${bands}</div><div class="segment-legend">${analytics.segments.map((segment) => `<button type="button" data-seg-toggle="${esc(segment.name)}" class="${segmentOff.has(segment.name) ? "off" : ""}" aria-pressed="${!segmentOff.has(segment.name)}"><i style="background:${segment.color}"></i>${esc(segment.name)}</button>`).join("")}</div>`;
  }

  function segmentationNote() {
    return `<p class="panel-note"><b>Логика отбора на пересмотр.</b> Клиент попадает в поле зрения S&OP, когда его маржа МД и/или OTIF отклоняются от целевых <b>правил своего сегмента</b> (цели маржи и сервиса заданы отдельно для каждого из 6 сегментов). Кольцо ↓ (красное) — наибольшее негативное отклонение: кейс намеренно <b>выбивается из правил сегмента вниз</b> и требует пересмотра цены или условий. Кольцо ↑ (зелёное) — кандидат на повышение, превышающий правила сегмента. В таблице «Клиенты, сервис и статус пересмотра» и во всплывающих подсказках пузырей указано конкретное отклонение от цели.</p>`;
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

  /* Forecast accuracy for the selected period; months without fact fall back
     to the latest reported months (Jan–Sep 2026). */
  function forecastAccuracyCard(r) {
    let rows = rowFilter(r.rows).filter((row) => row.dataType === "actual");
    let basis = "";
    if (!rows.length) {
      rows = M.forYear(horizonResults.get(active), 2026).rows.filter(
        (row) => row.dataType === "actual" && (family === "all" || row.family === family),
      );
      basis = " · последний факт";
    }
    const result = A.forecastAccuracy(rows, M.forecastAccuracyTarget);
    const label = `${rangeLabel(result.months, 2026)}${basis}`;
    if (result.accuracy === null) return kpi("Точность прогноза", "—", "", "Нет закрытых месяцев");
    const delta = (result.accuracy - result.target) * 100;
    return kpi(
      "Точность прогноза",
      fmt(result.accuracy * 100, 1),
      "%",
      `Цель ${pct(result.target)} · <span class="${delta >= 0 ? "delta-pos" : "delta-neg"}">${signed(delta, 1)} п.п.</span> · смещение ${signed(result.bias * 100, 1)}% · ${label}`,
      delta >= 0 ? "accent" : "alert",
    );
  }

  function demandView(r, t) {
    const analytics = clientAnalytics(r);
    const bp = businessResults.get(year), bpt = totals(bp);
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
        const grossProfit = analytics.economics(rows, "grossProfit");
        const margin = analytics.economics(rows, "margin");
        const marginRate = revenue ? margin / revenue : 0;
        const delta = (marginRate - client.marginTarget) * 100;
        coverageRows.push([
          p.name, esc(client.name), fmt(demand), fmt(sales),
          `<span class="pill ${sales / (demand || 1) < 0.95 ? "warn" : ""}">${pct(sales / (demand || 1))}</span>`,
          money(revenue), money(grossProfit), money(margin), pct(marginRate), pct(client.marginTarget),
          `<span class="margin-deviation ${delta < 0 ? "below" : "ok"}">${delta < 0 ? "▼" : "✓"} ${delta >= 0 ? "+" : ""}${fmt(delta, 1)} п.п.</span>`,
        ]);
      }
    }
    const clientRows = analytics.clients.map((client) => [
      esc(client.name), esc(client.segment), M.nodes.find((n) => n.id === client.node).name,
      fmt(client.demand), fmt(client.sales), money(client.revenue), money(client.grossProfit), money(client.margin),
      pct(client.otif), pct(client.otifTarget),
      client.review ? `<span class="review-label ${client.reviewDirection}">⚑ ${client.reviewDirection === "up" ? "На повышение" : "На пересмотр"}</span>` : "—",
    ]);
    return `<div class="kpis kpis-5">${kpi("Неограниченный спрос", fmt(t.demand), "т", `БП ${fmt(bpt.demand)} т · ${comparisonFoot(t.demand, bpt.demand, fmt, "т")}`, true)}${kpi("План отгрузок", fmt(t.sales), "т", `БП ${fmt(bpt.sales)} т · ${comparisonFoot(t.sales, bpt.sales, fmt, "т")}`)}${kpi("Непокрытый спрос", fmt(t.gap), "т", `${pct(t.demand ? t.gap / t.demand : 0)} спроса`)}${kpi("Покрытие", pct(t.coverage), "", `БП ${pct(bpt.coverage)}`)}${forecastAccuracyCard(r)}</div>
      <div class="grid equal chart-grid">${panel("Спрос и отгрузки по месяцам", "т", chart("Спрос, бизнес-план и отгрузки", [
        { name: "Неограниченный спрос", values: monthly(r, "demand"), color: "#a1a9b7" },
        { name: "Бизнес-план · отгрузки", values: bpMonthlySales, color: "#19a27b" },
        { name: "Активный план · отгрузки", values: monthly(r, "sales"), color: "#4769ff" },
      ]))}${panel("Спрос по клиентским сегментам", "т", horizontalChart("Спрос по сегментам", segmentItems, "т", 0))}</div>
      ${panel("Сегментация клиентов", "Размер круга — валовая прибыль клиента", segmentationNote() + segmentationMatrix(analytics), "segmentation-panel")}
      ${panel("OTIF по сегментам и клиентам", "Факт против цели сегмента", otifBySegment(analytics), "otif-panel")}
      ${panel("Покрытие по ассортименту и клиентам", "Продукт × клиент", paged("coverage", ["Продукт", "Клиент", "Спрос, т", "Отгрузки, т", "Покрытие", "Выручка, млн ₽", "Валовая прибыль, млн ₽", "МД, млн ₽", "Маржа МД", "Цель маржи", "Отклонение"], coverageRows))}
      ${panel("Клиенты, сервис и статус пересмотра", "24 клиента", paged("clients", ["Клиент", "Сегмент", "Основной склад", "Спрос, т", "Отгрузки, т", "Выручка, млн ₽", "Валовая прибыль, млн ₽", "МД, млн ₽", "OTIF", "Цель", "Статус"], clientRows))}
      ${panel("Ошибка прогноза по клиентам", "Лаг-1 ошибка прогноза спроса, янв–сен 2026 · взвешено по спросу клиента", forecastErrorHeat(r), "client-error-panel")}`;
  }

  function orderDate(value) {
    if (!value) return "—";
    const [y, m, d] = value.split("-");
    return `${d}.${m}.${y}`;
  }

  function currentOrderPlan() {
    if (!orderPlan) orderPlan = O.planPortfolio(M, M.forYear(horizonResults.get(active), 2026));
    return orderPlan;
  }

  /* Bullet chart: portfolio against the S&OP quota per product (or segment) and month. */
  function quotaChart(plan) {
    const rows = quotaView === "segment" ? plan.segmentQuotaUsage : plan.quotaUsage;
    const visible = orderFilter.size ? rows.filter((q) => q.orders.some((o) => orderFilter.has(o.id))) : rows;
    const monthNames = { "2026-10": "Октябрь 2026", "2026-11": "Ноябрь 2026", "2026-12": "Декабрь 2026" };
    const max = Math.max(1, ...visible.map((q) => Math.max(q.quota, q.ordered))) * 1.06;
    const x = (value) => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
    const body = Object.keys(monthNames).map((monthKey) => {
      const items = visible.filter((q) => q.month === monthKey);
      if (!items.length) return "";
      return `<div class="quota-month"><h3>${monthNames[monthKey]}</h3>${items.map((q) => {
        const over = q.ordered > q.quota + 1e-6, near = !over && q.usage >= 0.85;
        const selected = orderFilter.size ? S(q.orders.filter((o) => orderFilter.has(o.id)), "qty") : 0;
        const title = `${q.label} · ${monthNames[q.month]}: портфель ${fmt(q.ordered)} т, квота S&OP ${fmt(q.quota)} т (${fmt(q.usage * 100, 1)}%)${selected ? `; выбранные заказы ${fmt(selected)} т` : ""}. Заказы: ${q.orders.map((o) => o.id).join(", ")}`;
        return `<div class="quota-row ${over ? "over" : near ? "near" : ""}" title="${esc(title)}"><div class="quota-label"><b>${esc(q.label)}</b>${over ? `<span class="quota-alert">Сверх квоты +${fmt(q.ordered - q.quota)} т</span>` : near ? '<span class="quota-warn">Почти заполнена</span>' : ""}</div><div class="quota-track"><i class="quota-fill" style="width:${x(Math.min(q.ordered, q.quota))}"></i>${over ? `<i class="quota-over" style="left:${x(q.quota)};width:${x(q.ordered - q.quota)}"></i>` : ""}${selected ? `<i class="quota-selected" style="width:${x(selected)}"></i>` : ""}<b class="quota-marker" style="left:${x(q.quota)}"></b></div><div class="quota-value"><strong class="${over ? "delta-neg" : ""}">${fmt(q.usage * 100, 0)}%</strong><small>${fmt(q.ordered)} / ${fmt(q.quota)} т</small></div></div>`;
      }).join("")}</div>`;
    }).join("");
    const overCount = visible.filter((q) => q.ordered > q.quota + 1e-6).length;
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Разрез квоты"><button type="button" data-quota-view="product" aria-pressed="${quotaView === "product"}">По продуктам</button><button type="button" data-quota-view="segment" aria-pressed="${quotaView === "segment"}">По сегментам клиентов</button></div><span class="chart-context">${overCount ? `<b class="delta-neg">Сверх квоты: ${overCount}</b> · ` : ""}портфель / квота S&OP, т</span></div><div class="quota-legend"><span><i class="fill"></i>Портфель в пределах квоты</span><span><i class="over"></i>Сверх квоты</span><span><i class="marker"></i>Квота S&OP</span>${orderFilter.size ? '<span><i class="selected"></i>Выбранные заказы</span>' : ""}</div><div class="quota-chart">${body || '<p class="muted">Нет строк для выбранных заказов</p>'}</div>`;
  }

  function ordersView() {
    const plan = currentOrderPlan();
    const nodeName = nodeLabel;
    const all = plan.results;
    const s = plan.summary;
    const inFilter = (result) => !orderFilter.size || orderFilter.has(result.orderId);
    const filtered = all.filter(inFilter);
    const mainRows = orderQuick === "otif" ? filtered.filter((x) => x.otif) : orderQuick === "not" ? filtered.filter((x) => !x.otif) : filtered;
    const shown = orderQuick === "all" ? mainRows : orderSource === "prod" ? mainRows.filter((x) => x.productionDate) : orderSource === "stock" ? mainRows.filter((x) => !x.productionDate) : mainRows;
    const openShown = shown.filter((x) => !x.shipped);
    const overQuotaOrders = all.filter((x) => x.overQuota > 0).length;
    const decisions = all.filter((x) => x.exception || x.overQuota > 0).length;
    const notOtif = s.orders - s.otif;
    const orderRows = shown.map((x) => {
      const stock = x.stockStatus === "yes" ? ["Да", "ok"] : x.stockStatus === "partial" ? ["Частично", "partial"] : ["Нет", "no"];
      const select = x.shipped
        ? '<span class="row-lock" title="Отгружено: факт, пересчёт не выполняется">●</span>'
        : `<input type="checkbox" data-order-select="${x.orderId}" aria-label="Выбрать ${x.orderId}" ${orderSelected.has(x.orderId) ? "checked" : ""}>`;
      const qty = x.shortQty > 0 ? `${fmt(x.qty)}<small>отгружено ${fmt(x.deliveredQty)}</small>` : fmt(x.qty);
      const deviation = `${x.lateDays ? `<span class="delta-neg">+${x.lateDays} дн.</span>` : '<span class="delta-pos">В срок</span>'}${x.shortQty > 0 ? `<small class="delta-neg">Недогруз ${fmt(x.shortQty)} т</small>` : ""}`;
      const stockNote = x.shipped ? (x.productionDate ? "под заказ" : "отгружено со склада") : `${fmt(Math.max(0, x.availableQty))} т на дату проверки`;
      const statusClass = x.shipped ? (x.otif ? "shipped" : "shipped-bad") : x.exception || x.lateDays ? "warn" : "";
      return `<tr class="${x.shipped ? "order-shipped" : ""} ${x.exception ? "order-exception" : ""}"${x.note ? ` title="${esc(x.note)}"` : x.exception ? ` title="${esc(x.exception)}"` : ""}><td>${select}</td><td><b>${x.orderId}</b><small>${esc(x.customer)} · P${x.priority}</small></td><td>${esc(x.productName)}</td><td>${qty}</td><td>${orderDate(x.requestedDate)}</td><td><span class="stock-flag ${stock[1]}">${stock[0]}</span><small>${stockNote}</small></td><td>${esc(nodeName(x.sourceNode))}<small>${esc(x.sourceKind)}</small></td><td>${x.productionDate ? `${orderDate(x.productionDate)}<small>${esc(x.machine)} · ${esc(x.campaign)}</small>` : "—"}</td><td>${orderDate(x.shipDate)}</td><td>${orderDate(x.deliveryDate)}</td><td>${deviation}</td><td><span class="otif-badge ${x.otif ? "ok" : "no"}">${x.otif ? "OTIF" : "Not OTIF"}</span></td><td><span class="pill ${statusClass}">${esc(x.status)}</span>${x.overQuota > 0 ? `<small class="quota-flag">Сверх квоты ${fmt(x.overQuota)} т</small>` : ""}</td></tr>`;
    }).join("");
    const count = (list) => `<b>${list.length}</b>`;
    const quick = `<div class="order-quick"><div class="flow-switch" role="group" aria-label="Быстрый фильтр OTIF"><button type="button" data-order-quick="all" aria-pressed="${orderQuick === "all"}">Все заказы ${count(filtered)}</button><button type="button" class="quick-ok" data-order-quick="otif" aria-pressed="${orderQuick === "otif"}">OTIF 100% ${count(filtered.filter((x) => x.otif))}</button><button type="button" class="quick-bad" data-order-quick="not" aria-pressed="${orderQuick === "not"}">Not OTIF ${count(filtered.filter((x) => !x.otif))}</button></div>${orderQuick === "all" ? "" : `<div class="flow-switch order-sub" role="group" aria-label="Источник покрытия"><button type="button" data-order-source="all" aria-pressed="${orderSource === "all"}">Все ${count(mainRows)}</button><button type="button" data-order-source="prod" aria-pressed="${orderSource === "prod"}">С производством ${count(mainRows.filter((x) => x.productionDate))}</button><button type="button" data-order-source="stock" aria-pressed="${orderSource === "stock"}">Из запаса ${count(mainRows.filter((x) => !x.productionDate))}</button></div>`}</div>`;
    const allOpenSelected = openShown.length > 0 && openShown.every((x) => orderSelected.has(x.orderId));
    const portfolio = `${quick}<div class="table-wrap order-table-wrap"><table class="order-table"><thead><tr><th scope="col"><input type="checkbox" data-order-select-all aria-label="Выбрать все открытые заказы" ${allOpenSelected ? "checked" : ""}></th><th scope="col">Заказ / клиент</th><th scope="col">Продукт</th><th scope="col">Кол-во, т</th><th scope="col">Требуемая дата</th><th scope="col">Запас доступен</th><th scope="col">Источник</th><th scope="col">Производство</th><th scope="col">Отгрузка</th><th scope="col">Поставка</th><th scope="col">Отклонение</th><th scope="col">OTIF</th><th scope="col">Статус</th></tr></thead><tbody>${orderRows || '<tr><td colspan="13">Нет заказов для выбранных фильтров</td></tr>'}</tbody></table></div>`;
    const productionRows = O.productionSchedule(all).filter((row) => !orderFilter.size || row.orders.some((id) => orderFilter.has(id)));
    const shipmentRows = [...filtered].sort((a, b) => a.shipDate.localeCompare(b.shipDate) || a.orderId.localeCompare(b.orderId)).map((x) => [
      orderDate(x.shipDate), orderDate(x.deliveryDate), x.orderId, esc(x.customer), esc(x.productName),
      x.shortQty > 0 ? `${fmt(x.deliveredQty)} из ${fmt(x.qty)}` : fmt(x.qty),
      esc(nodeName(x.sourceNode)),
      x.productionDate ? `${orderDate(x.productionDate)} · ${esc(x.machine)}` : "Из запаса",
      `${x.lateDays ? `<span class="delta-neg">+${x.lateDays} дн.</span>` : '<span class="delta-pos">В срок</span>'}${x.shortQty > 0 ? ' <span class="delta-neg">· недогруз</span>' : ""}`,
      x.shipped ? `<span class="pill ${x.otif ? "shipped" : "shipped-bad"}">Отгружено</span>` : '<span class="pill">План</span>',
    ]);
    const picker = `<div class="order-filter"><details class="order-picker"><summary><span>Номера заказов</span><b>${orderFilter.size ? `выбрано ${orderFilter.size}` : "все"}</b></summary><div class="order-picker-panel"><input type="search" data-order-search placeholder="Номер, клиент или продукт" aria-label="Поиск заказа"><div class="order-picker-list">${all.map((x) => `<label data-order-option="${esc(`${x.orderId} ${x.customer} ${x.productName}`.toLowerCase())}"><input type="checkbox" value="${x.orderId}" ${orderFilter.has(x.orderId) ? "checked" : ""}><b>${x.orderId}</b><span>${esc(x.customer)} · ${esc(x.productName)}${x.shipped ? " · отгружен" : ""}</span></label>`).join("")}</div><div class="order-picker-actions"><button type="button" class="button" data-order-filter-clear>Сбросить</button><button type="button" class="button primary" data-order-filter-apply>Применить</button></div></div></details><div class="order-chips">${[...orderFilter].map((id) => `<button type="button" class="order-chip" data-order-chip="${id}" aria-label="Убрать ${id} из фильтра">${id}<span aria-hidden="true">×</span></button>`).join("")}</div></div>`;
    return `<div class="order-heading">${picker}<div class="order-actions"><button type="button" class="button primary" data-order-recalc="all">↻ Пересчитать весь портфель</button><button type="button" class="button" data-order-recalc="selected">Пересчитать выбранные <span class="selection-count">${orderSelected.size}</span></button></div></div>
      <div class="kpis kpis-6">${kpi("Заказов в портфеле", s.orders, "", `${s.shipped} отгружено · ${s.open} в работе · ${fmt(s.shipmentQty)} т`, true)}${kpi("OTIF", fmt(s.otifRate * 100, 1), "%", `${s.otif} из ${s.orders} · факт ${s.factOtif}/${s.shipped} · план ${s.planOtif}/${s.open}`, s.otifRate >= 0.95 ? "accent" : "alert")}${kpi("Из запаса", s.fromStock, "заказов", `${fmt(S(all.filter((x) => !x.productionDate), "qty"))} т`)}${kpi("С производством", s.withProduction, "заказов", `${fmt(s.productionQty)} т к выпуску`)}${kpi("Not OTIF", notOtif, "заказов", `опоздание ${s.late} · недогруз ${s.notInFull}`, notOtif ? "alert" : "")}${kpi("Требуют решения S&OP", decisions, "заказов", `сверх квоты ${overQuotaOrders} · вне кампаний ${s.exceptions}`, decisions ? "alert" : "")}</div>
      ${panel("Портфель клиентских заказов и доступность", "", portfolio, "orders-portfolio-panel")}
      ${panel("Заполнение квоты S&OP", "", quotaChart(plan), "quota-panel")}
      ${panel("1 · План производства по суткам и агрегатам", "", table(["Дата", "Агрегат", "Кампания S&OP", "Продукт", "Заказы", "К выпуску, т", "Объём кампании, т", "Доля заказа", "Статус"], productionRows.map((row) => [orderDate(row.date), row.machine, esc(row.campaign), esc(row.productName), row.orders.join(", "), fmt(row.qty), row.campaignGood ? fmt(row.campaignGood) : "—", row.campaignGood ? pct(row.qty / row.campaignGood) : "—", row.fact ? '<span class="pill shipped">Выполнено</span>' : row.exceptions ? '<span class="pill red">Вне SOP</span>' : row.qty > row.campaignGood ? '<span class="pill warn">Нужен пересмотр</span>' : '<span class="pill">В кампании</span>'])), "daily-production-panel")}
      ${panel("2 · План отгрузок", "", table(["Отгрузка", "Поставка", "Заказ", "Клиент", "Продукт", "Кол-во, т", "Склад отгрузки", "Производство / запас", "Срок", "Статус"], shipmentRows), "shipment-plan-panel")}`;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     Графикование кампаний производства — диспетчерская на выбранный период.
     Гантт строится по плану кампаний раздела «Производство» (активная версия)
     и заказам раздела «Управление заказами». Период диаграммы берётся из
     фильтров шапки (ПЕРИОД / С / ПО, год, направление); агрегаты можно выбирать
     любым набором или группами «Картон» / «Бумага». Клик по кампании
     подсвечивает её цепочку переделов, остальные полосы приглушаются; завершённые
     кампании по умолчанию серые. Ручные сдвиги кампаний живут только в состоянии
     диспетчерской (dispatchMoves) и не меняют данные остальных разделов.
     ───────────────────────────────────────────────────────────────────────── */
  const GANTT = { label: 230, row: 50, head: 88, bar: 30 };
  const GANTT_UNIT_ORDER = { "МП-1": 0, "МП-2": 1, "КДМ-9": 2, "БДМ-7": 3, "ПРС-1": 4, "ПРС-2": 5, "УП-1": 6 };
  const GANTT_UNITS = Object.keys(GANTT_UNIT_ORDER).sort((a, b) => GANTT_UNIT_ORDER[a] - GANTT_UNIT_ORDER[b]);
  const dispatchStageFilter = {
    mass: { label: "Массоподготовка", units: ["МП-1", "МП-2"] },
    kdm: { label: "КДМ", units: ["КДМ-9"] },
    bdm: { label: "БДМ", units: ["БДМ-7"] },
    fin: { label: "Отделка", units: ["ПРС-1", "ПРС-2", "УП-1"] },
  };
  /* Быстрый выбор набора агрегатов: все или группа продукта. УП-1 упаковывает
     оба направления, поэтому входит и в «Картон», и в «Бумагу». */
  const dispatchUnitGroups = {
    all: { label: "Все агрегаты", units: GANTT_UNITS },
    carton: { label: "Картон", units: ["МП-1", "КДМ-9", "ПРС-1", "УП-1"] },
    paper: { label: "Бумага", units: ["МП-2", "БДМ-7", "ПРС-2", "УП-1"] },
  };
  const ganttColor = (c) =>
    c.stage === "Массоподготовка" ? "#8b5cf6"
    : c.machine === "КДМ-9" ? "#4769ff"
    : c.machine === "БДМ-7" ? "#19a27b"
    : "#ff8c00";
  const ganttPad = (n) => String(n).padStart(2, "0");
  /* Ширина суток подбирается под длину окна: месяц — крупно, год — обзорно.
     В любом случае SVG не сжимается мельче естественного размера: при нехватке
     места появляется горизонтальная прокрутка, а не уменьшение подписей. */
  const ganttDayWidth = (days) => (days <= 45 ? 42 : days <= 100 ? 26 : days <= 200 ? 18 : 12);
  const ganttMonthLabel = (m, y) => `${M.months[m]} ${y}`;
  const ganttPeriodLabel = (win) =>
    win.from === win.to
      ? ganttMonthLabel(win.from, win.year)
      : `${M.months[win.from]}–${M.months[win.to].toLowerCase()} ${win.year}`;
  function ganttWindow() {
    const from = Math.max(0, Math.min(11, fromMonth));
    const to = Math.max(from, Math.min(11, toMonth));
    const months = [];
    let days = 0;
    for (let m = from; m <= to; m++) {
      const len = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
      months.push({ month: m, start: days, len });
      days += len;
    }
    return { from, to, year, days, months, startUTC: Date.UTC(year, from, 1) };
  }
  /* Выбранный набор агрегатов: пустое множество — все агрегаты. */
  const dispatchChosenUnits = () => (dispatchUnits.size ? new Set(dispatchUnits) : new Set(GANTT_UNITS));
  function dispatchPresetOf(set) {
    for (const [id, def] of Object.entries(dispatchStageFilter)) {
      if (def.units.length === set.size && def.units.every((u) => set.has(u))) return id;
    }
    return "custom";
  }
  function dispatchGroupOf(set) {
    for (const [id, def] of Object.entries(dispatchUnitGroups)) {
      if (def.units.length === set.size && def.units.every((u) => set.has(u))) return id;
    }
    return "custom";
  }
  /* Все связанные кампании выбранной: обход связей обеспеченности в обе
     стороны (масса ↔ машина ↔ резка ↔ упаковка) — единая технологическая цепочка. */
  function dispatchNeighborhood(start, links) {
    const up = new Map(),
      down = new Map();
    for (const l of links) {
      if (!down.has(l.from)) down.set(l.from, []);
      down.get(l.from).push(l.to);
      if (!up.has(l.to)) up.set(l.to, []);
      up.get(l.to).push(l.from);
    }
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      for (const next of [...(down.get(id) || []), ...(up.get(id) || [])]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  }
  /* Завершённая кампания: факт прошлых месяцев или выполненная в текущем. */
  const campaignDone = (c) => {
    const status = campaignStatus(c, year);
    return status.label === "Факт" || status.label === "Выполнена";
  };
  let dispatchStructure = null,
    dispatchOrderIds = [],
    ganttDrag = null,
    ganttDragEndedAt = 0,
    ganttDocWired = false;

  function commitDispatchMove(key, delta) {
    const apply = (id, d) => dispatchMoves.set(id, (dispatchMoves.get(id) || 0) + d);
    apply(key, delta);
    if (dispatchCascade && dispatchStructure) {
      const seen = new Set([key]);
      const queue = [...(dispatchStructure.downstream.get(key) || [])];
      while (queue.length) {
        const id = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);
        apply(id, delta);
        queue.push(...(dispatchStructure.downstream.get(id) || []));
      }
    }
  }

  function dispatchView() {
    const r = results.get(active);
    const operations = unitOperations(r);
    const win = ganttWindow();
    const dayMs = 86400000;
    const periodLabel = ganttPeriodLabel(win);
    const chosen = dispatchChosenUnits();
    const campFamilies = (c) =>
      new Set((c.products || [c.product]).map((pid) => product(pid)?.family).filter(Boolean));
    const inFamily = (c) => family === "all" || campFamilies(c).has(family);
    const inWindow = (c) => c.month >= win.from && c.month <= win.to;

    /* Кампании года нужны для цепочек заказов: фильтр периода не должен
       обнулять колонки «кампании агрегатов» в таблице заказов. */
    const allById = new Map(operations.campaigns.map((c) => [c.id, c]));
    const windowCamps = operations.campaigns.filter((c) => inWindow(c) && inFamily(c));
    const byId = new Map(windowCamps.map((c) => [c.id, c]));
    const camps = windowCamps.filter((c) => chosen.has(c.machine));

    /* Связи обеспеченности: масса → машина → резка → упаковка. Строятся
       по всем видимым агрегатам окна, даже если часть строк скрыта, чтобы
       каскадный сдвиг и подсветка цепочки не теряли связанные кампании. */
    const links = [];
    for (const c of windowCamps) {
      if (c.stage === "Массоподготовка") {
        for (const mid of c.covers || []) if (byId.has(mid)) links.push({ from: c.id, to: mid, kind: "mass" });
      } else if (c.stage === "Отделка") {
        const upstream = c.dependsOn || c.id.slice(c.machine.length + 1);
        if (byId.has(upstream))
          links.push({ from: upstream, to: c.id, kind: c.machine === "УП-1" ? "pack" : "fin" });
      }
    }
    const downstream = new Map();
    for (const l of links) {
      if (!downstream.has(l.from)) downstream.set(l.from, []);
      downstream.get(l.from).push(l.to);
    }
    dispatchStructure = { byId, downstream };

    const monthOffset = new Map(win.months.map((mo) => [mo.month, mo.start]));
    /* Внутри суток сохраняем фактические часы. Прежнее округление старта вниз,
       а окончания вверх визуально накладывало соседние кампании почти на сутки,
       хотя исходная очередь агрегата была последовательной. */
    const hourOf = (c, which) => {
      const move = dispatchMoves.get(c.id) || 0;
      return (monthOffset.get(c.month) || 0) * 24 + (which === "start" ? c.start : c.end) + move * 24;
    };
    const dayOf = (c, which) => hourOf(c, which) / 24;
    const dateAt = (dayIdx) => {
      const clamped = Math.max(0, Math.min(win.days - 1, dayIdx));
      const dt = new Date(win.startUTC + clamped * dayMs);
      return `${ganttPad(dt.getUTCDate())}.${ganttPad(dt.getUTCMonth() + 1)}`;
    };
    const dateTimeAt = (hourIdx) => {
      const dt = new Date(win.startUTC + hourIdx * 3600000);
      return `${ganttPad(dt.getUTCDate())}.${ganttPad(dt.getUTCMonth() + 1)} ${ganttPad(dt.getUTCHours())}:${ganttPad(dt.getUTCMinutes())}`;
    };
    /* Подсветка выбранной мышью кампании: её технологическая цепочка. */
    const focusSet = dispatchFocus && allById.has(dispatchFocus) ? dispatchNeighborhood(dispatchFocus, links) : null;

    /* Заказы → цепочка кампаний по всем переделам (по всему году). */
    const plan = currentOrderPlan();
    const orderChain = (x) => {
      if (!x.productionDate || !x.campaign || x.campaign === "Вне кампании SOP") return { machine: [], mass: [], fin: [] };
      const parts = String(x.campaign).split(" + ");
      const prefix = parts[0].slice(0, parts[0].lastIndexOf("-"));
      const machine = [parts[0], ...parts.slice(1).map((n) => `${prefix}-${n}`)].filter((id) => allById.has(id));
      const mass = operations.campaigns
        .filter((c) => c.stage === "Массоподготовка" && (c.covers || []).some((id) => machine.includes(id)))
        .map((c) => c.id);
      const fin = machine.flatMap((mid) => [`ПРС-1-${mid}`, `ПРС-2-${mid}`, `УП-1-${mid}`].filter((id) => allById.has(id)));
      return { machine, mass, fin };
    };
    const ordersByCampaign = new Map();
    for (const x of plan.results) {
      const ch = orderChain(x);
      for (const id of [...ch.machine, ...ch.mass, ...ch.fin]) {
        if (!ordersByCampaign.has(id)) ordersByCampaign.set(id, []);
        ordersByCampaign.get(id).push(x.orderId);
      }
    }
    /* В диспетчерской — только заказы, покрываемые исключительно производством:
       ни склад регионального РЦ, ни запас завода, ни «производство + запас»
       в таблицу не попадают. */
    const productionOrders = plan.results.filter(
      (x) => x.productionDate && x.stockStatus === "no" && orderChain(x).machine.length > 0,
    );
    dispatchOrderIds = productionOrders.map((x) => x.orderId);
    const highlight = new Set();
    for (const oid of dispatchOrders) {
      const x = plan.results.find((res) => res.orderId === oid);
      if (!x) continue;
      const ch = orderChain(x);
      [...ch.machine, ...ch.mass, ...ch.fin].forEach((id) => highlight.add(id));
    }

    const unitRows = [...new Map(operations.capacities.map((x) => [x.machine, x])).values()]
      .filter((u) => chosen.has(u.machine))
      .sort((a, b) => (GANTT_UNIT_ORDER[a.machine] ?? 9) - (GANTT_UNIT_ORDER[b.machine] ?? 9));
    /* Finish-to-start: следующий передел начинается только после ОКОНЧАНИЯ
       upstream. Разрыв считаем в фактических часах (dayOf лишь переводит их
       в сутки), поэтому частичная накладка внутри одних суток также видна. */
    const scoredLinks = links
      .map((l) => ({ ...l, from: byId.get(l.from), to: byId.get(l.to) }))
      .map((l) => ({ ...l, gap: dayOf(l.to, "start") - dayOf(l.from, "end") }));
    const visibleLinks = scoredLinks.filter((l) => chosen.has(l.from.machine) && chosen.has(l.to.machine));
    const violations = visibleLinks.filter((l) => l.gap < -1e-9);
    const movedCount = windowCamps.filter((c) => dispatchMoves.has(c.id)).length;
    const preset = dispatchPresetOf(chosen);
    const group = dispatchGroupOf(chosen);

    /* ── Доступность мощностей: свободный фонд агрегатов после сдвигов ──
       Занятость считается по фактическим интервалам полос (сдвиг учитывается),
       фонд — по доступным часам месяца за вычетом плановых ремонтов. */
    const monthSpans = win.months.map((mo) => ({ month: mo.month, from: mo.start * 24, to: (mo.start + mo.len) * 24 }));
    const overlapHours = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
    const capacityHours = (machine, month) => {
      const cap = operations.capacities.find((x) => x.machine === machine && x.month === month);
      if (!cap) return new Date(Date.UTC(year, month + 1, 0)).getUTCDate() * 24;
      return Math.max(0, cap.available);
    };
    const capacityRows = [];
    const capacityProblems = [];
    for (const unit of unitRows) {
      const list = camps.filter((c) => c.machine === unit.machine);
      const spans = list.map((c) => ({ c, s: hourOf(c, "start"), e: hourOf(c, "end") }));
      let fund = 0,
        used = 0;
      for (const span of monthSpans) {
        const cap = capacityHours(unit.machine, span.month);
        let monthUsed = 0;
        for (const x of spans) monthUsed += overlapHours(x.s, x.e, span.from, span.to);
        fund += cap;
        used += monthUsed;
        const overload = monthUsed - cap;
        if (overload > 0.5) {
          capacityProblems.push({
            kind: "overload",
            unit: unit.machine,
            time: ganttMonthLabel(span.month, year),
            hours: overload,
            problem: `перегрузка фонда на ${fmt(overload, 1)} ч (${fmt(monthUsed, 1)} из ${fmt(cap)} ч)`,
            fix: `освободить ${fmt(overload, 1)} ч: перенести кампании в соседний месяц или сократить объём`,
          });
        }
      }
      /* Проверяем все фактические интервалы, а не только сдвинутые: базовый
         план должен быть чистым, но любой ручной сдвиг сразу проявится здесь.
         Активным считаем интервал с самым поздним окончанием — так не теряются
         вложенные конфликты, когда одна длинная кампания накрыла несколько. */
      const ordered = [...spans].sort((a, b) => a.s - b.s || a.e - b.e);
      let activeSpan = ordered[0] || null;
      for (let i = 1; i < ordered.length; i++) {
        const cur = ordered[i];
        const overlap = activeSpan.e - cur.s;
        if (overlap > 0.5) {
          capacityProblems.push({
            kind: "overlap",
            unit: unit.machine,
            time: dateAt(Math.floor(cur.s / 24)),
            hours: overlap,
            problem: `накладка ${activeSpan.c.id} ↔ ${cur.c.id}: ${fmt(overlap, 1)} ч`,
            fix: `сдвинуть ${cur.c.id} вправо минимум на ${Math.ceil(overlap / 24)} сут.`,
          });
        }
        if (cur.e > activeSpan.e) activeSpan = cur;
      }
      capacityRows.push({
        unit,
        campaigns: list.length,
        fund,
        used,
        free: fund - used,
        load: fund ? used / fund : 0,
        moved: list.filter((c) => dispatchMoves.has(c.id)).length,
      });
    }
    const overloads = capacityProblems.filter((p) => p.kind === "overload").length;
    const overlaps = capacityProblems.filter((p) => p.kind === "overlap").length;
    /* Переходы в выбранном периоде против цели бизнес-плана: коэффициент
       переходов плана масштабируется к целевому коэффициенту БП. */
    const setupHours = S(camps, "setup");
    const planSetupCoef = Number(r.config?.setup ?? 1) || 1;
    /* Цель — лучшая версия цикла: минимальный коэффициент переходов среди
       версий и бизнес-плана. Для V5 это 0,72; для базовой версии виден запас. */
    const cycleSetupCoefs = [M.businessPlan?.setup, ...M.scenarios.map((sc) => sc.setup)]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    const targetSetupCoef = cycleSetupCoefs.length ? Math.min(...cycleSetupCoefs) : planSetupCoef;
    const setupTargetHours = (setupHours / planSetupCoef) * targetSetupCoef;
    const fundHours = capacityRows.reduce((sum, row) => sum + row.fund, 0);
    const setupShare = fundHours ? setupHours / fundHours : 0;
    const setupTargetShare = fundHours ? setupTargetHours / fundHours : 0;
    const setupOverTarget = setupHours > setupTargetHours + 0.05;

    /* ── Диаграмма Ганта (SVG, гранулярность суток) ── */
    const day = ganttDayWidth(win.days);
    const tickEvery = day >= 22 ? 1 : 2;
    const width = win.days * day + 12;
    const height = GANTT.head + Math.max(1, unitRows.length) * GANTT.row + 12;
    const gridTop = GANTT.head - 34;
    const xOf = (d) => d * day;
    const todayIdx = year === NOW_YEAR ? Math.floor((Date.UTC(NOW_YEAR, NOW_MONTH, NOW_DAY) - win.startUTC) / dayMs) : -1;
    const todayVisible = todayIdx >= 0 && todayIdx < win.days;
    const todayX = todayVisible ? xOf(todayIdx) + day / 2 : 0;
    const windowKey = `${active}-${year}-${win.from}-${win.to}-${family}`;
    const rowY = new Map();
    unitRows.forEach((u, i) => rowY.set(u.machine, GANTT.head + i * GANTT.row));
    let svg = `<svg class="chart gantt-svg" width="${width}" height="${height}" data-w="${width}" data-h="${height}" data-day="${day}" data-row="${GANTT.row}" data-bar="${GANTT.bar}" data-label="0" data-days="${win.days}" data-today-x="${todayX}" data-window="${esc(windowKey)}" data-focus="${esc(dispatchFocus || "")}" role="img" aria-label="Диаграмма Ганта: кампании агрегатов, ${esc(periodLabel)}"><title>Графикование кампаний производства · ${esc(periodLabel)} · гранулярность суток</title>`;
    svg += `<defs><marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#8fa2c9"/></marker><marker id="gantt-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" fill="#e02442"/></marker><pattern id="gantt-changeover-pattern" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="7" height="7" fill="#fff7df"/><rect width="2.5" height="7" fill="#f4b740"/></pattern></defs>`;
    /* Строки агрегатов. */
    unitRows.forEach((unit, ri) => {
      const yTop = GANTT.head + ri * GANTT.row;
      const count = camps.filter((c) => c.machine === unit.machine).length;
      svg += `<rect class="gantt-rowbg${ri % 2 ? " alt" : ""}" x="0" y="${yTop}" width="${width}" height="${GANTT.row}"><title>${esc(unit.name)} · ${count} ${plural(count, "кампания", "кампании", "кампаний")} в окне</title></rect>`;
    });
    /* Фон: выходные, сетка суток, разделители месяцев, шапка. */
    for (let d = 0; d < win.days; d++) {
      const dt = new Date(win.startUTC + d * dayMs);
      const weekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
      if (weekend) svg += `<rect class="gantt-weekend" x="${xOf(d)}" y="${gridTop}" width="${day}" height="${height - gridTop}"/>`;
      svg += `<line class="gantt-grid${dt.getUTCDate() === 1 ? " month" : ""}" x1="${xOf(d)}" y1="${gridTop}" x2="${xOf(d)}" y2="${height}"/>`;
      if (d % tickEvery === 0 || dt.getUTCDate() === 1) {
        svg += `<text class="gantt-day" x="${xOf(d) + day / 2}" y="${GANTT.head - 12}" text-anchor="middle">${dt.getUTCDate()}</text>`;
      }
    }
    svg += `<line class="gantt-grid month" x1="${xOf(win.days)}" y1="${gridTop}" x2="${xOf(win.days)}" y2="${height}"/>`;
    for (const mo of win.months) {
      svg += `<text class="gantt-month" x="${xOf(mo.start + mo.len / 2)}" y="24" text-anchor="middle">${esc(ganttMonthLabel(mo.month, year))}</text>`;
    }
    /* Линия «сегодня» — ATP-дата заказов (23.10.2026). */
    if (todayVisible) {
      const flip = todayX > width - 90;
      svg += `<line class="gantt-today" x1="${todayX}" y1="6" x2="${todayX}" y2="${height}"><title>Сегодня ${orderDate(O.AS_OF)}</title></line><text class="gantt-today-label" x="${todayX + (flip ? -5 : 5)}" y="${gridTop - 4}" text-anchor="${flip ? "end" : "start"}">сегодня</text>`;
    }
    /* Связи между переделами (под полосами кампаний). */
    if (dispatchLinks) {
      const anchor = (c) => {
        const y = rowY.get(c.machine);
        if (y === undefined) return null;
        return {
          x0: xOf(Math.max(0, Math.min(win.days, dayOf(c, "start")))),
          x1: xOf(Math.max(0, Math.min(win.days, dayOf(c, "end")))),
          y: y + GANTT.row / 2,
        };
      };
      for (const l of visibleLinks) {
        const f = anchor(l.from), t = anchor(l.to);
        if (!f || !t) continue;
        const bad = l.gap < -1e-9;
        const dim = focusSet && !(focusSet.has(l.from.id) && focusSet.has(l.to.id));
        const bend = Math.max(14, (t.x0 - f.x1) / 2);
        svg += `<path class="gantt-link${bad ? " bad" : ""}${dim ? " dim" : ""}" data-gantt-from="${esc(l.from.id)}" data-gantt-to="${esc(l.to.id)}" data-gantt-kind="${l.kind}" marker-end="url(#gantt-arrow${bad ? "-bad" : ""})" d="M${f.x1},${f.y} C${f.x1 + bend},${f.y} ${t.x0 - bend},${t.y} ${t.x0},${t.y}"><title>${esc(l.from.id)} → ${esc(l.to.id)}${bad ? ` · нарушение: старт на ${fmt(-l.gap * 24, 1)} ч раньше окончания upstream` : ""}</title></path>`;
      }
    }
    /* Точная геометрия занятости. setup — отдельный переход перед выпуском,
       а цветная полоса показывает только работу кампании. Поэтому соседние
       кампании соприкасаются строго по времени и больше не перекрываются из-за
       округления к целым суткам. */
    const ganttItems = camps.map((c) => {
      const occupancyStart = hourOf(c, "start");
      const occupancyEnd = hourOf(c, "end");
      const runStart = Math.min(occupancyEnd, occupancyStart + Math.max(0, Number(c.setup) || 0));
      return { c, occupancyStart, runStart, occupancyEnd };
    });
    const previousById = new Map();
    for (const unit of unitRows) {
      const sequence = ganttItems
        .filter((item) => item.c.machine === unit.machine)
        .sort((a, b) => a.occupancyStart - b.occupancyStart || a.occupancyEnd - b.occupancyEnd);
      sequence.forEach((item, index) => previousById.set(item.c.id, index ? sequence[index - 1] : null));
    }
    const clippedGeometry = (startHour, endHour) => {
      const d0 = Math.max(0, startHour / 24), d1 = Math.min(win.days, endHour / 24);
      if (d1 <= d0) return null;
      return { x: xOf(d0), width: xOf(d1 - d0), d0, d1 };
    };

    /* Переходы / переналадки — янтарная штриховка между цветными кампаниями.
       Сегмент двигается вместе со своей кампанией и имеет отдельную подсказку. */
    for (const item of ganttItems) {
      const { c, occupancyStart, runStart } = item;
      const y = rowY.get(c.machine), geometry = clippedGeometry(occupancyStart, runStart);
      if (y === undefined || !geometry) continue;
      const previous = previousById.get(c.id);
      const moved = dispatchMoves.has(c.id), done = campaignDone(c);
      const inChain = !focusSet || focusSet.has(c.id);
      const dimmed = Boolean(focusSet) && !inChain;
      const title = previous
        ? `Переход ${previous.c.id} → ${c.id} · ${fmt(runStart - occupancyStart, 1)} ч · ${dateTimeAt(occupancyStart)}–${dateTimeAt(runStart)}`
        : `Пусковая настройка перед ${c.id} · ${fmt(runStart - occupancyStart, 1)} ч · ${dateTimeAt(occupancyStart)}–${dateTimeAt(runStart)}`;
      const cls = [
        "gantt-changeover",
        moved ? "moved" : "",
        done && dispatchDimDone && !focusSet ? "done" : "",
        highlight.has(c.id) ? "hl" : "",
        dimmed ? "dim" : "",
        dispatchFocus === c.id ? "focus" : inChain && focusSet ? "rel" : "",
      ].filter(Boolean).join(" ");
      const by = y + (GANTT.row - GANTT.bar) / 2;
      svg += `<rect class="${cls}" data-gantt-changeover="${esc(c.id)}" data-gantt-target="${esc(c.id)}" data-gantt-move="${esc(c.id)}" data-start-hour="${occupancyStart}" data-end-hour="${runStart}" x="${geometry.x}" y="${by}" width="${geometry.width}" height="${GANTT.bar}" rx="${Math.min(4, geometry.width / 2)}" fill="url(#gantt-changeover-pattern)" tabindex="0" role="button" aria-label="${esc(title)}"><title>${esc(title)}</title></rect>`;
    }

    /* Полосы выпуска: перетаскивание мышью, подсветка заказов и цепочек,
       серый цвет завершённых, ручные сдвиги. */
    for (const item of ganttItems) {
      const { c, occupancyStart, runStart, occupancyEnd } = item;
      const y = rowY.get(c.machine), geometry = clippedGeometry(runStart, occupancyEnd);
      if (y === undefined || !geometry) continue;
      const bx = geometry.x, bw = geometry.width;
      const by = y + (GANTT.row - GANTT.bar) / 2;
      const moved = dispatchMoves.has(c.id);
      const done = campaignDone(c);
      const inChain = !focusSet || focusSet.has(c.id);
      const dimmed = Boolean(focusSet) && !inChain;
      const greyed = focusSet ? dimmed : dispatchDimDone && done;
      const cls = [
        "gantt-bar",
        moved ? "moved" : "",
        done ? "done" : "",
        highlight.has(c.id) ? "hl" : "",
        dimmed ? "dim" : "",
        dispatchFocus === c.id ? "focus" : inChain && focusSet ? "rel" : "",
      ].filter(Boolean).join(" ");
      const st = campaignStatus(c, year);
      const ordersOf = ordersByCampaign.get(c.id) || [];
      const moveText = moved ? ` · сдвинута вручную на ${dispatchMoves.get(c.id) > 0 ? "+" : ""}${dispatchMoves.get(c.id)} сут.` : "";
      const focusText = !focusSet ? "" : dispatchFocus === c.id ? " · выбрана: подсвечена вся цепочка" : inChain ? " · в цепочке выбранной кампании" : " · вне цепочки выбранной кампании";
      const title = `${c.id} · ${c.name} · ${(c.products || [c.product]).map((pid) => product(pid).name).join(", ")} · ${(c.grams || [c.gram]).join(", ")} г/м² · выпуск ${fmt(c.good)} т · работа ${dateTimeAt(runStart)}–${dateTimeAt(occupancyEnd)} · переход перед запуском ${fmt(runStart - occupancyStart, 1)} ч · ${st.label}${done ? " (завершена)" : ""}${ordersOf.length ? ` · заказы: ${ordersOf.join(", ")}` : ""}${moveText}${focusText}`;
      svg += `<rect class="${cls}" data-gantt-key="${esc(c.id)}" data-gantt-move="${esc(c.id)}" data-done="${done ? "1" : "0"}" data-occupancy-start-hour="${occupancyStart}" data-run-start-hour="${runStart}" data-end-hour="${occupancyEnd}" x="${bx}" y="${by}" width="${bw}" height="${GANTT.bar}" rx="${Math.min(4, bw / 2)}" fill="${greyed ? (dimmed ? "#cfd6e1" : "#b9c2ce") : ganttColor(c)}"><title>${esc(title)}</title></rect>`;
      const shortId = c.stage === "Отделка" ? c.id.slice(c.machine.length + 1).replace(/^\d{4}-\d{1,2}-/, "") : c.id.replace(/^\d{4}-\d{1,2}-/, "");
      if (bw >= shortId.length * 6 + 10) svg += `<text class="gantt-barlabel" x="${bx + 6}" y="${by + GANTT.bar / 2 + 4}">${esc(shortId)}</text>`;
    }
    if (!camps.length) {
      svg += `<text class="gantt-empty" x="${width / 2}" y="${GANTT.head + Math.max(1, unitRows.length) * GANTT.row / 2 + 5}" text-anchor="middle">Нет кампаний в выбранном периоде</text>`;
    }
    svg += `</svg>`;

    /* Подписи агрегатов — отдельная неподвижная колонка: при горизонтальной
       прокрутке длинного Ганта строки всегда остаются подписанными. */
    const labels = `<div class="gantt-labels"><div class="gantt-labels-head"><span>АГРЕГАТ</span></div>${unitRows.map((unit, ri) => `<div class="gantt-rowlabel${ri % 2 ? " alt" : ""}" data-gantt-unit="${esc(unit.machine)}" title="${esc(unit.name)}">${esc(unit.name)}</div>`).join("")}</div>`;
    const selectedLabel = chosen.size === GANTT_UNITS.length
      ? "все агрегаты"
      : `${chosen.size} из ${GANTT_UNITS.length} · ${GANTT_UNITS.filter((u) => chosen.has(u)).join(", ")}`;
    const groupTitle = {
      all: "Показать все агрегаты",
      carton: "Только агрегаты направления «Картон»: МП-1, КДМ-9, ПРС-1, УП-1",
      paper: "Только агрегаты направления «Бумага»: МП-2, БДМ-7, ПРС-2, УП-1",
    };
    const focusLabel = focusSet
      ? `выбрана ${dispatchFocus} · в цепочке ${focusSet.size} ${plural(focusSet.size, "кампания", "кампании", "кампаний")} · остальные полосы серые`
      : `показано ${selectedLabel} · янтарная штриховка — переход · клик по кампании подсвечивает её цепочку · перетаскивайте кампании мышью`;
    const toolbar = `<div class="chart-toolbar dispatch-toolbar"><div class="dispatch-filter-row"><div class="flow-switch dispatch-group-switch" role="group" aria-label="Набор агрегатов по продукту">${Object.entries(dispatchUnitGroups).map(([id, g]) => `<button type="button" data-dispatch-group="${id}" aria-pressed="${group === id}" title="${groupTitle[id]}">${g.label}</button>`).join("")}</div><div class="flow-switch" role="group" aria-label="Группы переделов на диаграмме Ганта">${Object.entries(dispatchStageFilter).map(([id, s]) => `<button type="button" data-dispatch-stage="${id}" aria-pressed="${preset === id}">${s.label}</button>`).join("")}</div><div class="flow-switch dispatch-unit-switch" role="group" aria-label="Любой набор агрегатов на диаграмме Ганта" title="Включите любое сочетание агрегатов — не только один или все"><span class="dispatch-units-label">АГРЕГАТЫ</span>${GANTT_UNITS.map((u) => `<button type="button" data-dispatch-unit="${u}" aria-pressed="${chosen.has(u)}" title="Показать / скрыть агрегат ${u}">${u}</button>`).join("")}</div></div><div class="flow-switch" role="group" aria-label="Инструменты диспетчерской"><button type="button" data-dispatch-dim-done aria-pressed="${dispatchDimDone}" title="Завершённые кампании показываются серым; отожмите кнопку, чтобы вернуть цвет">⏹ Завершённые серым</button><button type="button" data-dispatch-links aria-pressed="${dispatchLinks}" title="Линии снабжения: масса → машина → резка → упаковка">Связи между переделами</button><button type="button" data-dispatch-cascade aria-pressed="${dispatchCascade}" title="Перетаскивание кампании сдвигает связанные кампании следующих переделов тем же сдвигом">Двигать связанные вместе</button>${focusSet ? `<button type="button" data-dispatch-clear-focus>Снять выделение</button>` : ""}<button type="button" class="dispatch-reset" data-dispatch-reset ${movedCount ? "" : "disabled"}>Сбросить сдвиги${movedCount ? ` (${movedCount})` : ""}</button></div><span class="chart-context">${focusLabel}</span></div>`;
    const legend = `<div class="flow-legend gantt-legend"><span><i style="background:#8b5cf6"></i>Массоподготовка</span><span><i style="background:#4769ff"></i>КДМ-9</span><span><i style="background:#19a27b"></i>БДМ-7</span><span><i style="background:#ff8c00"></i>Отделка</span><span><i class="gantt-changeover-swatch"></i>переход / переналадка</span><span><i class="gantt-done-swatch"></i>завершённые (серым)</span><span><i class="gantt-focus-swatch"></i>выбранная кампания и её цепочка</span><span><i class="gantt-moved-swatch"></i>сдвинута вручную</span><span><i class="gantt-hl-swatch"></i>кампании выбранных заказов</span><span><i class="gantt-link-swatch"></i>связь обеспеченности</span><span><i class="gantt-bad-swatch"></i>нарушение последовательности</span></div>`;

    const violationKind = { mass: "Масса → машина", fin: "Машина → резка", pack: "Резка → упаковка" };
    const violationsBody = violations.length
      ? `<p class="panel-note">Красные связи — кампания следующего передела стартует до окончания обеспечивающей кампании (масса → машина → резка → упаковка). Передвиньте полосы так, чтобы связи стали серыми, или сбросьте сдвиги.</p>${table(["Связь", "Обеспечивающая кампания", "Зависимая кампания", "Накладка, ч", "Как исправить"], violations.map((v) => [violationKind[v.kind], v.from.id, v.to.id, `<span class="delta-neg">${fmt(-v.gap * 24, 1)}</span>`, `сдвинуть ${v.to.id} вправо минимум на ${Math.ceil(-v.gap)} сут. или ${v.from.id} влево`]))}`
      : '<p class="muted">Нарушений нет: машина стартует после окончания кампании массы, резка — после кампании машины, упаковка — после резки. Внутри каждого агрегата кампании также идут последовательно.</p>';

    const capacityNote = capacityProblems.length
      ? `<p class="panel-note">Проверка учитывает переходы и ручные сдвиги: занятость агрегата считается по точным часовым интервалам на Ганте, фонд — по доступным часам месяца за вычетом плановых ремонтов. Перегрузка — кампаний больше, чем фонд; накладка — две кампании одновременно на одном агрегате.</p>`
      : '<p class="muted">Свободное место есть: ни один агрегат не перегружен, кампании не накладываются друг на друга в выбранном периоде.</p>';
    const capacityProblemsTable = capacityProblems.length
      ? table(
          ["Проверка", "Агрегат", "Период", "Проблема", "Как исправить"],
          capacityProblems.map((p) => [
            p.kind === "overload" ? '<span class="pill red">Перегрузка фонда</span>' : '<span class="pill warn">Накладка кампаний</span>',
            esc(p.unit),
            esc(p.time),
            `<span class="delta-neg">${esc(p.problem)}</span>`,
            esc(p.fix),
          ]),
        )
      : "";
    const capacitySummary = table(
      ["Агрегат", "Кампаний", "Фонд за период, ч", "Занято, ч", "Свободно, ч", "Загрузка", "Сдвинуто"],
      capacityRows.map((row) => [
        esc(row.unit.name),
        fmt(row.campaigns),
        fmt(row.fund),
        fmt(row.used, 1),
        `<span class="${row.free < -0.5 ? "delta-neg" : "delta-pos"}">${fmt(row.free, 1)}</span>`,
        pct(row.load),
        row.moved ? fmt(row.moved) : "—",
      ]),
    );

    const orderRows = productionOrders.map((x) => {
      const ch = orderChain(x);
      const coverage = `<span class="pill shipped">Только производство</span><small>${esc(x.sourceKind)}</small>`;
      return [
        `<input type="checkbox" data-dispatch-order="${x.orderId}" aria-label="Подсветить заказ ${x.orderId} на диаграмме Ганта" ${dispatchOrders.has(x.orderId) ? "checked" : ""}>`,
        `<b>${x.orderId}</b><small>${esc(x.customer)}</small>`,
        esc(x.productName),
        fmt(x.qty),
        orderDate(x.requestedDate),
        coverage,
        `${orderDate(x.productionDate)}<small>${esc(x.machine)}</small>`,
        ch.mass.length ? ch.mass.join(", ") : "—",
        ch.machine.length ? ch.machine.join(", ") : "—",
        ch.fin.length ? ch.fin.join(", ") : "—",
      ];
    });
    const ordersToolbar = `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Подсветка заказов на диаграмме"><button type="button" data-dispatch-order-all="prod">Выделить все из производства (${dispatchOrderIds.length})</button><button type="button" data-dispatch-order-all="clear">Снять выделение</button></div><span class="chart-context">${dispatchOrders.size ? `выбрано ${dispatchOrders.size} ${plural(dispatchOrders.size, "заказ", "заказа", "заказов")} · подсвечено ${highlight.size} ${plural(highlight.size, "кампания", "кампании", "кампаний")} на Ганте` : "выберите заказ — его кампании подсветятся во всех переделах"}</span></div>`;

    return `<div class="kpis kpis-6">${kpi("Кампаний в окне", fmt(camps.length), "", `${periodLabel} · ${selectedLabel}`, true)}${kpi("Заказов из производства", fmt(productionOrders.length), "", `${fmt(S(productionOrders, "qty"))} т · ATP на ${orderDate(O.AS_OF)}`)}${kpi("Переходы в периоде", fmt(setupHours, 1), "ч", `цель ≤ ${fmt(setupTargetHours, 1)} ч · ${setupOverTarget ? `<span class="delta-neg">превышение ${fmt(setupHours - setupTargetHours, 1)} ч</span>` : `<span class="delta-pos">остаток ${fmt(setupTargetHours - setupHours, 1)} ч</span>`} · лучшая версия цикла, коэф. ${fmt(targetSetupCoef, 2)} · план ${fmt(planSetupCoef, 2)}`, setupOverTarget ? "alert" : "accent")}${kpi("Доля переходов в фонде", pct(setupShare), "", `цель ≤ ${pct(setupTargetShare)} · фонд ${fmt(fundHours)} ч · ${setupShare > setupTargetShare ? `<span class="delta-neg">+${fmt((setupShare - setupTargetShare) * 100, 2)} п.п.</span>` : `<span class="delta-pos">${fmt((setupTargetShare - setupShare) * 100, 2)} п.п. в запасе</span>`}`, setupShare > setupTargetShare + 1e-6 ? "alert" : "")}${kpi("Нарушений последовательности", fmt(violations.length), "связей", violations.length ? "есть накладки между переделами" : "обеспеченность соблюдена", violations.length ? "alert" : "")}${kpi("Перегрузки мощностей", fmt(capacityProblems.length), "проблем", `${overloads} перегрузок фонда · ${overlaps} накладок кампаний`, capacityProblems.length ? "alert" : "")}</div>
      ${panel("Диаграмма Ганта · кампании по агрегатам", `${periodLabel} · ${chosen.size === GANTT_UNITS.length ? "все агрегаты" : GANTT_UNITS.filter((u) => chosen.has(u)).join(", ")} · шкала по суткам, точность до часа · переходы показаны отдельно · finish-to-start: масса → КДМ/БДМ → резка → упаковка`, `${toolbar}<div class="gantt-wrap" style="--gantt-head:${GANTT.head}px;--gantt-row:${GANTT.row}px;--gantt-label:${GANTT.label}px">${labels}<div class="chart-scroll gantt-scroll">${svg}</div></div>${legend}`, "dispatch-gantt-panel")}
      ${panel("Последовательность между переделами", "Проверка обеспеченности после ручных сдвигов", violationsBody, "dispatch-violations-panel")}
      ${panel("Доступность мощностей", `${periodLabel} · свободный фонд и накладки после ручных сдвигов`, `${capacityNote}${capacityProblemsTable}${capacitySummary}`, "dispatch-capacity-panel")}
      ${panel("Заказы из производства и их кампании", "Только заказы, покрываемые производством (не запасом) · в каких кампаниях агрегатов они запланированы", `${ordersToolbar}${paged("dispatch-orders", ["Выбор", "Заказ / клиент", "Продукт", "Кол-во, т", "Требуемая дата", "Покрытие", "Дата производства", "Кампании массоподготовки", "Кампании КДМ / БДМ", "Кампании отделки"], orderRows)}`, "dispatch-orders-panel")}`;
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

  /* Heat map: forecast error per client × reported month. The product-level
     lag-1 forecast error (M.forecastError) is weighted by each client's demand
     for that product, so a client cell shows the error of the actual mix it
     bought. Positive = over-forecast (stock build), negative = under-forecast. */
  function forecastErrorHeat(r) {
    const cr = r.customerRows.filter(eligible);
    const months = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const clients = M.clients;
    const cell = (client, m) => {
      const rows = cr.filter((x) => x.client === client.id && x.month === m);
      if (!rows.length) return null;
      let weighted = 0,
        wsum = 0;
      for (const row of rows) {
        const pid = sku(row.sku)?.product;
        const e = M.forecastError(pid, m);
        const w = row.demand || row.sales;
        weighted += e * w;
        wsum += w;
      }
      return wsum ? weighted / wsum : null;
    };
    const all = [];
    for (const c of clients)
      for (const m of months) {
        const v = cell(c, m);
        if (v != null) all.push(v);
      }
    const maxAbs = Math.max(0.05, ...all.map((v) => Math.abs(v)));
    const fmtErr = (v) =>
      v == null ? "" : `${v > 0 ? "+" : "−"}${fmt(Math.abs(v) * 100, 0)}%`;
    const color = (v) => {
      if (v == null) return "#eef2f6";
      const t = Math.min(1, Math.abs(v) / maxAbs);
      const a = (0.12 + t * 0.62).toFixed(2);
      return v > 0 ? `rgba(198,85,98,${a})` : `rgba(56,163,199,${a})`;
    };
    const header = `<span class="heat-rowhead">Клиент</span>${months
      .map((m) => `<span>${M.months[m]}</span>`)
      .join("")}<span class="heat-rowhead">∑</span>`;
    const body = clients
      .map((client) => {
        const vals = months.map((m) => cell(client, m));
        const valid = vals.filter((v) => v != null);
        const avg = valid.length
          ? valid.reduce((a, b) => a + b, 0) / valid.length
          : null;
        const cells = vals
          .map(
            (v, i) =>
              `<span class="heat-cell" title="${esc(client.name)} · ${M.months[i]} 2026: ошибка прогноза ${fmtErr(v) || "нет данных"}" style="background:${color(v)}">${fmtErr(v)}</span>`,
          )
          .join("");
        const avgCell = `<span class="heat-cell heat-avg" title="${esc(client.name)} · средняя ошибка прогноза: ${fmtErr(avg) || "нет данных"}" style="background:${color(avg)}">${fmtErr(avg)}</span>`;
        return `<span class="heat-rowhead" title="${esc(client.name)} · ${esc(client.segment)}">${esc(client.name)}</span>${cells}${avgCell}`;
      })
      .join("");
    return `<div class="chart-scroll"><div class="heat client-error-heat" style="grid-template-columns:150px repeat(9,minmax(36px,1fr)) 64px">${header}${body}</div></div><div class="heat-legend"><span><i style="background:rgba(198,85,98,0.7)"></i>перепрогноз (запас растёт)</span><span><i style="background:rgba(56,163,199,0.7)"></i>недопрогноз (риск дефицита)</span><span>∑ — средняя за янв–сен 2026</span></div>`;
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
      <div class="flow-legend"><span><i style="background:#4769ff"></i>Поток КДМ-9</span><span><i style="background:#19a27b"></i>Поток БДМ-7</span></div>
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

  /* Recipe reference for mass preparation, adapted from the example of layering
     bleached hardwood (ЛЦ), bleached softwood (ХЦ) and bleached CTMP (BCTMP).
     Shows how mass-prep campaigns are grouped by furnish and feed KDM-9 / БДМ-7. */
  function massRecipeReference() {
    const families = [
      { name: "Картон GC1 (мелованный)", ids: ["bright", "pharma", "tobacco1"] },
      { name: "Картон GC2", ids: ["strong", "project", "tobacco2"] },
      { name: "Бумага мелованная (LWC)", ids: ["lwc", "satin"] },
      { name: "Бумага немелованная (офсет / SC / PU)", ids: ["offset", "sc", "bulk", "medical"] },
    ];
    const rows = [
      ["Лиственная белёная (ЛЦ)", "lc"],
      ["Хвойная белёная (ХЦ)", "sc"],
      ["Белёная ХТММ (BCTMP)", "bctmp"],
      ["Мелование", "coat"],
    ];
    const body = rows.map(([label, key]) => [
      label,
      ...families.map((f) => {
        const vals = f.ids.map((id) => M.recipes[id]).filter(Boolean);
        if (!vals.length) return "—";
        const avg = vals.reduce((s, r) => s + r[key], 0) / vals.length;
        return pct(avg);
      }),
    ]);
    return `<div class="recipe-reference"><div class="recipe-note">Массоподготовка готовит <b>семейства массы</b> по рецептуре волокна и подаёт их на КДМ-9 (картон) и БДМ-7 (бумага). Кампании массоподготовки сгруппированы по рецептуре — по аналогии с примером композиции слоёв картона (ЛЦ / ХЦ / BCTMP). Ниже — усреднённая рецептура КАМА по семействам продукции.</div>${table(["Компонент массы", ...families.map((f) => f.name)], body)}</div>`;
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

  /* Компактная подпись списка кампаний: «10-КДМ-9-3 + 4» (как в заказах). */
  const coversLabel = (ids) =>
    ids && ids.length
      ? `${ids[0]}${ids.slice(1).map((id) => ` + ${id.split("-").pop()}`).join("")}`
      : "—";

  function campaignTimeline(operations, stage) {
    const isMass = stage === "Массоподготовка";
    const units = [...new Map(operations.capacities.map((c) => [c.machine, c])).values()].filter(
      (c) => c.stage === stage && (family === "all" || c.family === "all" || c.family === family),
    );
    const legendRecipes = [];
    if (isMass) {
      const seen = new Set();
      for (const unit of units)
        for (const c of operations.campaigns)
          if (
            c.machine === unit.machine &&
            c.month >= fromMonth && c.month <= toMonth &&
            !seen.has(recipeKey(c.recipe))
          ) {
            seen.add(recipeKey(c.recipe));
            legendRecipes.push(c.recipe);
          }
    }
    const legend = isMass
      ? `<div class="flow-legend mass-legend" aria-label="Рецептуры волокна на массоподготовке">${legendRecipes
          .map((rc) => `<span title="${esc(recipeClass(rc))}"><i style="background:${recipeColor(rc)}"></i>ЛЦ ${pct(rc.lc)} · ХЦ ${pct(rc.sc)}${rc.bctmp ? ` · BCTMP ${pct(rc.bctmp)}` : ""}${(rc.coat || 0) >= 0.05 ? ` · мел. ${pct(rc.coat)}` : ""}</span>`)
          .join("")}<span><i class="now-swatch"></i>линия «сегодня» — ${orderDate(O.AS_OF)}</span></div>`
      : "";
    const note = isMass
      ? '<p class="panel-note">Кампании массоподготовки сгруппированы по рецептуре волокна (ЛЦ / ХЦ / BCTMP): одна кампания массы одного рецепта покрывает несколько кампаний на КДМ-9 (картон) или БДМ-7 (бумага) — уровень агрегации на переделе массы выше, чем на машинах. Цвет полосы — вид рецептуры массы, а не машина-потребитель.</p>'
      : "";
    return `<section class="campaign-stage embedded"><h3>Последовательность кампаний · ${esc(stage)}${isMass ? " → КДМ-9 / БДМ-7" : ""}</h3>${note}${legend}${units.map((unit) => `<div class="campaign-machine"><h4>${esc(unit.name)}</h4>${M.months.map((mn, mi) => {
      if (mi < fromMonth || mi > toMonth) return "";
      const c = operations.capacities.find((x) => x.machine === unit.machine && x.month === mi);
      const cs = operations.campaigns.filter((x) => x.machine === unit.machine && x.month === mi);
      if (!c) return "";
      const isNowMonth = year === NOW_YEAR && mi === NOW_MONTH;
      const started = cs.filter((x) => x.start <= NOW_HOUR).length;
      return `<button class="campaign-month ${month === String(mi) ? "selected" : ""}" data-camp-month="${mi}" aria-label="Выбрать кампании ${mn} ${year}"><span>${mn}</span><div class="timeline">${cs.map((x) => {
        const cls = isNowMonth ? (x.end <= NOW_HOUR ? "done" : x.start <= NOW_HOUR ? "active" : "planned") : "";
        const colorStyle = isMass && x.recipe ? `background:${recipeColor(x.recipe)};` : "";
        const statusText = isNowMonth ? ` · статус: ${campaignStatus(x).label}` : "";
        const title = isMass
          ? `${x.id} · ${x.recipeClass} · состав: ${pct(x.recipe.lc)} ЛЦ / ${pct(x.recipe.sc)} ХЦ / ${pct(x.recipe.bctmp || 0)} BCTMP · мелование ${pct(x.recipe.coat || 0)} · ${(x.products || [x.product]).map((pid) => product(pid).name).join(", ")} · масса ${fmt(x.gross)} т (волокно ${fmt(x.fiber, 1)} т абс. сух.) · ${fmt(x.run + x.setup, 1)} ч · покрывает ${x.covers.length} ${plural(x.covers.length, "кампанию", "кампании", "кампаний")} ${x.supplies}: ${coversLabel(x.covers)}${statusText}`
          : `${product(x.product).name} · ${x.gram} г/м² · выпуск ${fmt(x.good)} т · ${fmt(x.run + x.setup, 1)} ч${statusText}`;
        return `<i class="${cls}" style="${colorStyle}width:${((x.run + x.setup) / c.calendar) * 100}%" title="${esc(title)}"></i>`;
      }).join("")}<i class="repair" style="width:${(c.repair / c.calendar) * 100}%" title="Плановый ремонт · ${fmt(c.repair)} ч"></i>${isNowMonth ? `<i class="now-line" style="left:${(NOW_HOUR / c.calendar) * 100}%" title="Сегодня ${orderDate(O.AS_OF)}: производство запущено, часть кампаний выполнена"></i>` : ""}</div><small>${isNowMonth ? `<b class="now-note">▶ запущено ${started} из ${cs.length}</b> · ` : ""}${fmt(c.run)} ч работы · ${fmt(c.setup)} ч переходов · ${c.used > c.available ? `<b class="delta-neg">дефицит ${fmt(c.used - c.available)} ч</b>` : `резерв ${fmt(c.available - c.used)} ч`}</small></button>`;
    }).join("")}</div>`).join("")}</section>`;
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  /* "1–6, 9, 11–12" for sorted batch numbers. */
  function numberRanges(list) {
    const parts = [];
    for (let i = 0; i < list.length; i++) {
      let j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
      parts.push(j > i ? `${list[i]}–${list[j]}` : String(list[i]));
      i = j;
    }
    return parts.join(", ");
  }

  /* One card per campaign. Identical patterns are grouped: a campaign is cut in
     batches of up to 100 t gross, and the same pattern is often repeated. */
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
    const schemeCount = S(campaigns, ([, rows]) => new Set(rows.map((cut) => cut.pattern)).size);
    const pageSize = 6, pageCount = Math.max(1, Math.ceil(campaigns.length / pageSize));
    cutPage = Math.max(0, Math.min(cutPage, pageCount - 1));
    const visible = campaigns.slice(cutPage * pageSize, (cutPage + 1) * pageSize);
    const cards = visible.map(([campaignId, rows]) => {
      const first = rows[0], p = product(first.product);
      const finishing = p.family === "Картон" ? "ПРС-1" : "ПРС-2";
      const gross = S(rows, "gross"), good = S(rows, "good");
      const trim = S(rows, (row) => row.gross * row.trim) / (gross || 1);
      const schemes = new Map();
      rows.forEach((cut, index) => {
        if (!schemes.has(cut.pattern)) schemes.set(cut.pattern, { cut, batches: [], gross: 0, good: 0 });
        const scheme = schemes.get(cut.pattern);
        scheme.batches.push(index + 1);
        scheme.gross += cut.gross;
        scheme.good += cut.good;
      });
      const patterns = [...schemes.values()].map((scheme, index) => {
        const cut = scheme.cut;
        const nums = cut.pattern.split(" + ").map((x) => x.split("×").map(Number));
        const n = scheme.batches.length;
        return `<div class="cut-map-row"><div class="cut-map-meta"><span>Схема ${index + 1} · ${n} ${plural(n, "партия", "партии", "партий")}</span><b>${esc(cut.pattern)} мм</b><small>${fmt(scheme.gross)} т брутто → ${fmt(scheme.good)} т годного · обрезь ${pct(cut.trim)}</small><small>партии № ${numberRanges(scheme.batches)}</small></div><div class="chart-scroll"><div class="cut-pattern" aria-label="Раскрой ${esc(cut.pattern)}">${nums.flatMap(([count, width]) => Array.from({ length: count }, () => `<span style="width:${(width / cut.deckle) * 100}%">${width}</span>`)).join("")}<span class="waste" style="width:${cut.trim * 100}%" title="Обрезь ${cut.deckle - cut.used} мм"></span></div></div></div>`;
      }).join("");
      return `<article class="cut-campaign"><div class="cut-campaign-head"><div><small>${finishing} · источник ${first.machine} · ${M.months[first.month]} ${year}</small><h4>${esc(p.name)} · ${first.gram} г/м²</h4><span>Кампания ${esc(campaignId)} · ${schemes.size} ${plural(schemes.size, "схема", "схемы", "схем")} · ${rows.length} ${plural(rows.length, "партия", "партии", "партий")} раскроя</span></div><div class="cut-total"><strong>${fmt(good)} т</strong><span>годный · брутто ${fmt(gross)} т · обрезь ${pct(trim)}</span></div></div>${patterns}</article>`;
    }).join("");
    return `<div class="cutting-plan"><div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Фильтр карт раскроя по машине">${[["all", "Все машины"], ["КДМ-9", "КДМ-9 → ПРС-1"], ["БДМ-7", "БДМ-7 → ПРС-2"]].map(([id, label]) => `<button type="button" data-cut-machine="${id}" aria-pressed="${cutMachine === id}">${label}</button>`).join("")}</div><span class="chart-context">${campaigns.length} ${plural(campaigns.length, "кампания", "кампании", "кампаний")} · ${schemeCount} ${plural(schemeCount, "схема", "схемы", "схем")} · ${cuts.length} ${plural(cuts.length, "партия", "партии", "партий")} раскроя</span></div><h3>План раскроя по каждой кампании</h3>${cards || '<p class="muted">Для выбранного фильтра карт раскроя нет.</p>'}<div class="pager"><button class="button" type="button" data-cut-page="-1" ${cutPage === 0 ? "disabled" : ""}>← Предыдущие кампании</button><span>${cutPage + 1} / ${pageCount}</span><button class="button" type="button" data-cut-page="1" ${cutPage >= pageCount - 1 ? "disabled" : ""}>Следующие кампании →</button></div></div>`;
  }

  /* Campaign registry across all four production streams: mass preparation,
     KDM, BDM and finishing. Buttons switch the stream (mass prep by default);
     every stream shows the campaigns of its stage for the selected period and
     the columns that stage actually carries (recipe and fibre for mass prep,
     gross/trim for the paper machines, source unit and good output for
     finishing). */
  const registryStreams = {
    mass: {
      label: "1 · Массоподготовка",
      note: "МП-1 / МП-2 · кампании массы по рецептуре волокна: одна покрывает несколько кампаний КДМ-9 / БДМ-7",
    },
    kdm: { label: "2 · КДМ", note: "КДМ-9 · картон" },
    bdm: { label: "3 · БДМ", note: "БДМ-7 · бумага" },
    fin: {
      label: "4 · Отделка",
      note: "ПРС-1 / ПРС-2 / УП-1 · резка, перемотка, упаковка",
    },
  };
  function campaignRegistry(operations) {
    const inPeriod = (c) =>
      c.month >= fromMonth &&
      c.month <= toMonth &&
      (family === "all" || product(c.product).family === family);
    const all = operations.campaigns.filter(inPeriod);
    const byStream = {
      mass: all.filter((c) => c.stage === "Массоподготовка"),
      kdm: all.filter((c) => c.machine === "КДМ-9"),
      bdm: all.filter((c) => c.machine === "БДМ-7"),
      fin: all.filter((c) => c.stage === "Отделка"),
    };
    const monthLabel = (c) => `${M.months[c.month]} ${year}`;
    const hours = (c) => [
      fmt(c.start, 1),
      fmt(c.end, 1),
      fmt(c.setup, 1),
      fmt(c.run, 1),
    ];
    const timeHead = ["Начало, ч", "Конец, ч", "Переход, ч", "Работа, ч"];
    const machineTable = {
      headers: [
        "Кампания",
        "Месяц",
        "Машина",
        "Продукт",
        "г/м²",
        ...timeHead,
        "Брутто, т",
        "Годный, т",
        "Обрезь, т",
        "Статус",
      ],
      rows: byStream[registryStream].map((c) => [
        c.id,
        monthLabel(c),
        c.machine,
        product(c.product).name,
        c.gram,
        ...hours(c),
        fmt(c.gross),
        fmt(c.good),
        fmt(c.trim, 1),
        statusPill(c),
      ]),
    };
    const tables = {
      mass: {
        headers: [
          "Кампания",
          "Месяц",
          "Агрегат",
          "Рецептура массы",
          "Состав: ЛЦ / ХЦ / BCTMP",
          "Мелование",
          "Продукты",
          "г/м²",
          "Покрывает кампании",
          "Волокно, т абс. сух.",
          "Масса на машину, т",
          "Снабжает",
          ...timeHead,
          "Статус",
        ],
        rows: byStream.mass.map((c) => [
          c.id,
          monthLabel(c),
          c.machine,
          `<i class="recipe-chip" style="background:${recipeColor(c.recipe)}"></i>${c.recipeClass}`,
          c.recipe
            ? `${pct(c.recipe.lc)} / ${pct(c.recipe.sc)} / ${pct(c.recipe.bctmp || 0)}`
            : "—",
          c.recipe ? pct(c.recipe.coat) : "—",
          (c.products || [c.product]).map((pid) => product(pid).name).join(", "),
          (c.grams || [c.gram]).join(", "),
          `${coversLabel(c.covers)} (${c.covers.length})`,
          fmt(c.fiber, 1),
          fmt(c.gross),
          c.supplies,
          ...hours(c),
          statusPill(c),
        ]),
      },
      kdm: machineTable,
      bdm: machineTable,
      fin: {
        headers: [
          "Кампания",
          "Месяц",
          "Агрегат",
          "Продукт",
          "г/м²",
          "Источник",
          ...timeHead,
          "Годный, т",
          "Статус",
        ],
        rows: byStream.fin.map((c) => [
          c.id,
          monthLabel(c),
          c.machine,
          product(c.product).name,
          c.gram,
          c.supplies,
          ...hours(c),
          fmt(c.good),
          statusPill(c),
        ]),
      },
    };
    const table = tables[registryStream] || tables.mass;
    const buttons = Object.entries(registryStreams)
      .map(
        ([id, s]) =>
          `<button type="button" data-registry-stream="${id}" aria-pressed="${registryStream === id}">${s.label} (${byStream[id].length})</button>`,
      )
      .join("");
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Поток реестра производственных кампаний">${buttons}</div><span class="chart-context">${registryStreams[registryStream].note}</span></div>${paged(`campaigns-${registryStream}`, table.headers, table.rows)}`;
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
    const bpt = totals(businessResults.get(year));
    return `<div class="kpis kpis-5">${kpi("Годный выпуск", fmt(t.production), "т", `БП ${fmt(bpt.production)} т · ${comparisonFoot(t.production, bpt.production, fmt, "т")}`, true)}${kpi("Кампании КДМ / БДМ", fmt(camps.length), "", `КДМ-9: ${camps.filter((c) => c.machine === "КДМ-9").length} · БДМ-7: ${camps.filter((c) => c.machine === "БДМ-7").length}`)}${kpi("Переналадки всех агрегатов", fmt(S(caps, "setup")), "ч", "КДМ, БДМ, массоподготовка, отделка")}${kpi("Обрезь по ширине", pct(trim / (gross || 1)), "", `${fmt(trim)} т из ${fmt(gross)} т брутто`)}${kpi("Узкие места", fmt(bottlenecks.length), "агрегат·мес.", bottlenecks.length ? "загрузка выше 100% фонда" : "загрузка в пределах фонда", bottlenecks.length > 0 ? "alert" : "")}</div>
      ${panel("Загрузка производственных агрегатов", "Использованные / доступные часы", heat(r, operations))}
      ${panel("Сквозной поток агрегатов", "Массоподготовка → КДМ / БДМ → отделка", processFlow(r, flowCamps), "flow-panel")}
      ${panel(
        "Этап 1 · Массоподготовка",
        "Волокно — т абс. сух.",
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
          "т",
          { width: 1120, height: 300 },
        )}${table(["Направление", "Брутто, т", "Волокно, т абс. сух.", "Годный, т", "Сквозной выход"], massRows)}${massRecipeReference()}${campaignTimeline(operations, "Массоподготовка")}`,
        "stage-panel",
      )}
      ${panel("Этап 2 · КДМ-9 и БДМ-7", "Брутто, годный выпуск, переходы", `<div class="grid equal machine-grid">${family === "Бумага" ? "" : machineDetail(r, "КДМ-9")}${family === "Картон" ? "" : machineDetail(r, "БДМ-7")}</div>${campaignTimeline(operations, "КДМ / БДМ")}`, "stage-panel")}
      ${panel(
        "Этап 3 · Отделка",
        "Продольная резка, перемотка, упаковка",
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
          "т",
          { width: 1120, height: 300 },
        )}${campaignTimeline(operations, "Отделка")}${cuttingPlan(r)}`,
        "stage-panel",
      )}
      ${panel(
        "Реестр производственных кампаний",
        "Потоки: массоподготовка → КДМ / БДМ → отделка · начало и конец — часы от начала месяца",
        campaignRegistry(operations),
      )}
      ${panel(
        "Карты раскроя",
        "Все партии раскроя",
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

  /* Actual purchase prices of the reported months against the tariff. */
  const resourceFactPrice = [1.018, 1.026, 1.012, 1.034, 1.021, 0.994, 1.008, 1.031, 1.019];
  function resourceCost(row, meta, fact = false) {
    const index =
      (row.priceIndex ?? 1) *
      (1 + row.month * 0.0015) *
      (fact ? resourceFactPrice[row.month] ?? 1 : 1);
    return row.used * meta.tariff * index;
  }

  function resourcesView(r) {
    const names = A.resourceMeta;
    const allResources = [...r.resources, ...(r.utilities || [])];
    const bp = businessResults.get(year);
    const bpResources = [...bp.resources, ...(bp.utilities || [])];
    const isActual = (m) => year === 2026 && m <= 8;
    const inPeriod = (x) => x.month >= fromMonth && x.month <= toMonth;
    const rr = allResources.filter(inPeriod);
    const cards = Object.entries(names).map(([id, meta]) => {
      const rows = rr.filter((x) => x.id === id);
      const bpRows = bpResources.filter((x) => x.id === id && inPeriod(x));
      const used = S(rows, "used"), cap = S(rows, "available"), bpUsed = S(bpRows, "used");
      const cost = S(rows, (x) => resourceCost(x, meta, isActual(x.month)));
      const bpCost = S(bpRows, (x) => resourceCost(x, meta));
      const load = cap ? used / cap : 0;
      return panel(meta.name, meta.unit, `<div class="resource-card-value"><strong>${fmt(used)}</strong><span>${meta.unit} · БП ${fmt(bpUsed)}</span></div><div class="progress"><span style="width:${Math.min(100, load * 100)}%"></span></div><div class="resource-card-grid"><span>Затраты <b>${money(cost)} млн ₽</b></span><span>БП <b>${money(bpCost)} млн ₽</b></span><span>Отклонение <b class="${cost <= bpCost ? "delta-pos" : "delta-neg"}">${cost - bpCost >= 0 ? "+" : ""}${money(cost - bpCost)} млн ₽</b></span><span>Использование лимита <b>${pct(load)}</b></span></div>`);
    }).join("");
    const monthlyBy = (source, id, fn, filter = () => true) => M.months.map((_, m) => {
      if (!filter(m)) return null;
      const rows = source.filter((x) => x.id === id && x.month === m);
      return rows.length ? S(rows, fn) : null;
    });
    /* Виды волокнистого сырья: доли ЛЦ / ХЦ / BCTMP берутся из рецептур
       кампаний того же месяца (активный план и бизнес-план — из своих). */
    const fiberTypeNames = {
      all: "Всё волокно",
      lc: "Лиственная белёная (ЛЦ)",
      sc: "Хвойная белёная (ХЦ)",
      bctmp: "Белёная ХТММ (BCTMP)",
    };
    const fiberTypeShare = (sourceCampaigns) => M.months.map((_, m) => {
      const cs = sourceCampaigns.filter(
        (c) => c.month === m && (family === "all" || product(c.product).family === family),
      );
      const total = S(cs, "fiber");
      return total ? S(cs, (c) => c.fiber * ((M.recipes[c.product] || {})[fiberType] || 0)) / total : 0;
    });
    const resourceCharts = Object.entries(names).map(([id, meta]) => {
      const cost = resourceModes[id] === "cost";
      const value = (fact) => (x) => (cost ? resourceCost(x, meta, fact) / 1e6 : x.used);
      const byType = id === "fiber" && fiberType !== "all";
      const activeShare = byType ? fiberTypeShare(r.campaigns) : null;
      const bpShare = byType ? fiberTypeShare(bp.campaigns) : null;
      const typedValue = (share, fact) => (x) => value(fact)(x) * (share[x.month] ?? 0);
      const series = (byType
        ? [
            { name: "БП", values: monthlyBy(bpResources, id, typedValue(bpShare, false)), color: "#b8c0cc", slot: 0 },
            { name: "Факт", values: monthlyBy(allResources, id, typedValue(activeShare, true), isActual), color: "#27364a", slot: 1 },
            { name: "План S&OP", values: monthlyBy(allResources, id, typedValue(activeShare, false), (m) => !isActual(m)), color: meta.color, slot: 1 },
          ]
        : [
            { name: "БП", values: monthlyBy(bpResources, id, value(false)), color: "#b8c0cc", slot: 0 },
            { name: "Факт", values: monthlyBy(allResources, id, value(true), isActual), color: "#27364a", slot: 1 },
            { name: "План S&OP", values: monthlyBy(allResources, id, value(false), (m) => !isActual(m)), color: meta.color, slot: 1 },
            ...(cost ? [] : [{ name: "Месячное ограничение снабжения", values: monthlyBy(allResources, id, (x) => x.available), color: "#ed0084", line: true }]),
          ]
      ).filter((s) => s.values.some(Number.isFinite));
      const typeToggle = id === "fiber"
        ? `<div class="flow-switch fiber-type-switch" role="group" aria-label="Вид волокнистого сырья">${Object.entries(fiberTypeNames).map(([tid, tname]) => `<button type="button" data-fiber-type="${tid}" title="${esc(tname)}" aria-pressed="${fiberType === tid}">${tid === "all" || tid === "bctmp" ? (tid === "all" ? "Всё волокно" : "BCTMP") : tid.toUpperCase()}</button>`).join("")}</div>`
        : "";
      const toggle = `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Показатель: ${esc(meta.name)}"><button type="button" data-resource-mode="${id}" data-value="volume" aria-pressed="${!cost}">Объём, ${esc(meta.unit)}</button><button type="button" data-resource-mode="${id}" data-value="cost" aria-pressed="${cost}">Затраты, млн ₽</button></div>${typeToggle}</div>`;
      const title = byType ? `${meta.name} · ${fiberTypeNames[fiberType]}` : meta.name;
      const context = byType
        ? "доля вида по рецептурам кампаний · БП · факт · план S&OP"
        : cost ? "БП · факт · план S&OP" : "БП · факт · план S&OP · лимит";
      return panel(`Динамика · ${title}`, "", `${toggle}${chart(`${title}: ${cost ? "затраты" : "объём"}`, series, cost ? "млн ₽" : meta.unit, { compare: true, split: true, context })}`, "resource-dynamic");
    }).join("");
    const productFiber = M.products.filter((p) => family === "all" || p.family === family).map((p) => ({
      name: p.name,
      value: S(r.campaigns.filter((c) => c.product === p.id && c.month >= fromMonth && c.month <= toMonth), "fiber"),
      color: p.family === "Картон" ? "#4769ff" : "#19a27b",
    })).sort((a, b) => b.value - a.value).slice(0, 6);
    /* План закупок по всему сырью и ресурсам: поставщики и их доли — из
       аналитики (как в плане перемещений), объёмы — потребность плана,
       энергия и вода — по тарифу с месячным индексом цены. */
    const tariffSource = {
      energy: { name: "Энергосбыт · сетевой тариф", freight: 0, lead: 0, share: 1 },
      water: { name: "Водоканал · тариф", freight: 0, lead: 0, share: 1 },
    };
    let procurementCost = 0;
    const procurementRows = rr.flatMap((x) => {
      const meta = names[x.id];
      const sups = A.suppliers.filter((s) => s.resource === x.id);
      const list = sups.length ? sups : [tariffSource[x.id]];
      const effPrice = (s) => (sups.length
        ? s.price + s.freight
        : x.used ? resourceCost(x, meta, isActual(x.month)) / x.used : meta.tariff);
      return list.map((s) => {
        const qty = x.used * s.share;
        const cost = (qty * effPrice(s)) / 1e6;
        procurementCost += cost;
        const deficit = x.used > x.available;
        return [
          `${M.months[x.month]} ${year}`,
          meta.name,
          s.name,
          fmt(qty, 1),
          meta.unit,
          fmt(effPrice(s)),
          s.freight ? fmt(s.freight) : "—",
          s.lead ? `${s.lead} дн.` : "—",
          pct(s.share),
          fmt(cost, 1),
          deficit ? '<span class="pill warn">Дефицит лимита</span>' : '<span class="pill">В лимите</span>',
        ];
      });
    });
    const procurementSummary = Object.entries(names)
      .map(([id, meta]) => `${meta.name}: <b>${fmt(S(rr.filter((x) => x.id === id), "used"))}</b> ${meta.unit}`)
      .join(" · ");
    return `<div class="catalog resource-catalog">${cards}</div>
      <div class="grid equal chart-grid resource-charts">${resourceCharts}</div>
      ${panel("Волокно по продуктовым группам", "Топ-6 · т абс. сух.", horizontalChart("Волокно по продуктам", productFiber, "т абс. сух.", 0, { width: 1120 }))}
      ${panel("Месячные ограничения снабжения", "", table(["Месяц", "Ресурс", "Ед.", "Лимит", "Потребность", "Резерв", "Использование"], rr.map((x) => [`${M.months[x.month]} ${year}`, names[x.id].name, names[x.id].unit, fmt(x.available), fmt(x.used), fmt(x.available - x.used), `<span class="${x.used / (x.available || 1) >= 0.97 ? "delta-neg" : ""}">${pct(x.used / (x.available || 1))}</span>`])))}
      ${panel(
        "План закупок сырья",
        "Поставщики, объёмы и затраты по месяцам выбранного периода",
        `<div class="chart-toolbar"><span class="chart-context">Потребность за период — ${procurementSummary} · закупки ≈ <b>${fmt(procurementCost, 1)} млн ₽</b> · цены поставщиков как в плане перемещений, энергия и вода — тариф с индексом</span></div>${paged(
          "procurement",
          ["Месяц", "Ресурс", "Поставщик", "Объём закупки", "Ед.", "Цена, ₽/ед.", "Логистика, ₽/ед.", "Лидтайм", "Доля поставщика", "Затраты, млн ₽", "Покрытие лимита"],
          procurementRows,
        )}`,
      )}
      ${panel("Коэффициенты потребления", "На 1 т брутто-выпуска", table(["Группа", "Волокно, т/т", "Мелование, т/т", "Энергия, МВт·ч/т", "Вода, м³/т"], M.products.filter((p) => family === "all" || p.family === family).map((p) => [p.name, fmt(p.fiber, 3), fmt(p.coat, 3), fmt(p.energy, 2), fmt(18 * Number(r.config.waterIntensity || 1), 1)])))}`;
  }

  /* Normatives of the supporting shops (targets for unit consumption and cost). */
  const utilityNorms = {
    energyIntensity: 1.2,
    energyCost: 5450,
    waterIntensity: 19.5,
    waterCost: 1700,
    tmcCost: 24,
    fiberIntensity: 0.86,
  };

  function utilityMetrics(source) {
    const inPeriod = (x) => x.month >= fromMonth && x.month <= toMonth;
    const rows = rowFilter(source.rows);
    const camps = source.campaigns.filter((c) => inPeriod(c) && (family === "all" || product(c.product).family === family));
    const good = S(camps, "good"), sales = S(rows, "sales");
    const resource = (id) => [...source.resources, ...(source.utilities || [])].filter((x) => x.id === id && inPeriod(x));
    const energyRows = resource("energy"), waterRows = resource("water"), fiberRows = resource("fiber");
    const peak = (list) => list.reduce((best, x) => (x.used / (x.available || 1) > best.load ? { load: x.used / (x.available || 1), month: x.month } : best), { load: 0, month: fromMonth });
    return {
      good,
      sales,
      energy: S(energyRows, "used"),
      energyLimit: S(energyRows, "available"),
      energyPeak: peak(energyRows),
      water: S(waterRows, "used"),
      waterLimit: S(waterRows, "available"),
      waterPeak: peak(waterRows),
      fiber: S(fiberRows, "used"),
      energyCost: S(rows, "energyCost"),
      waterCost: S(rows, "waterCost"),
      tmcCost: S(rows, "holding") * 0.14,
    };
  }

  function capacityView(r, t) {
    const plan = utilityMetrics(r), bp = utilityMetrics(businessResults.get(year));
    const per = (value, base) => (base ? value / base : 0);
    const energyLoad = per(plan.energy, plan.energyLimit), waterLoad = per(plan.water, plan.waterLimit);
    const monthLabel = (m) => `${M.months[m].toLowerCase()} ${year}`;
    const departments = [
      ["Энергоцех", energyLoad, `${fmt(plan.energy)} МВт·ч`, `Потребление / лимит ${fmt(plan.energyLimit)} МВт·ч · пик ${pct(plan.energyPeak.load)} (${monthLabel(plan.energyPeak.month)})`],
      ["ТМЦ и складское хозяйство", Math.min(1, t.end / Math.max(1, M.nodes.reduce((x, n) => x + n.cap, 0))), `${fmt(t.end)} т остатка`, "Остаток / ёмкость складов сети"],
      ["ЦОС / водооборотный цех", waterLoad, `${fmt(plan.water)} м³`, `Потребление / лимит ${fmt(plan.waterLimit)} м³ · пик ${pct(plan.waterPeak.load)} (${monthLabel(plan.waterPeak.month)})`],
    ];
    const deltaPct = (value, base, lowerIsBetter = true) => {
      const d = base ? (value - base) / Math.abs(base) : 0;
      const good = lowerIsBetter ? d <= 0.0005 : d >= -0.0005;
      return `<span class="${good ? "delta-pos" : "delta-neg"}">${signed(d * 100, 1)}%</span>`;
    };
    /* [label, unit, plan, bp, limit, digits, kind] — kind "limit": consumption vs supply limit; "norm": unit rate vs normative. */
    const lines = [
      ["Электроэнергия · потребление", "МВт·ч", plan.energy, bp.energy, plan.energyLimit, 0, "limit", plan.energyPeak],
      ["Энергоёмкость", "МВт·ч/т годного", per(plan.energy, plan.good), per(bp.energy, bp.good), utilityNorms.energyIntensity, 3, "norm"],
      ["Затраты на электроэнергию", "₽/т отгрузки", per(plan.energyCost, plan.sales), per(bp.energyCost, bp.sales), utilityNorms.energyCost, 0, "norm"],
      ["Оборотная вода · потребление", "тыс. м³", plan.water / 1000, bp.water / 1000, plan.waterLimit / 1000, 1, "limit", plan.waterPeak],
      ["Водоёмкость", "м³/т годного", per(plan.water, plan.good), per(bp.water, bp.good), utilityNorms.waterIntensity, 2, "norm"],
      ["Затраты на воду и ЦОС", "₽/т отгрузки", per(plan.waterCost, plan.sales), per(bp.waterCost, bp.sales), utilityNorms.waterCost, 0, "norm"],
      ["Содержание запасов ТМЦ", "₽/т отгрузки", per(plan.tmcCost, plan.sales), per(bp.tmcCost, bp.sales), utilityNorms.tmcCost, 1, "norm"],
      ["Удельный расход волокна", "т абс. сух./т годного", per(plan.fiber, plan.good), per(bp.fiber, bp.good), utilityNorms.fiberIntensity, 3, "norm"],
    ];
    const unitRows = lines.map(([label, unit, value, base, limit, digits, kind, peak]) => {
      const gap = value - limit;
      let status;
      if (kind === "limit") {
        status = peak.load >= 0.98
          ? `<span class="pill warn">Пик ${pct(peak.load)} лимита · ${monthLabel(peak.month)}</span>`
          : `<span class="pill">В пределах лимита</span>`;
      } else {
        status = gap > 1e-9
          ? `<span class="pill red">Выше норматива</span>`
          : `<span class="pill">В пределах норматива</span>`;
      }
      const limitDelta = kind === "limit"
        ? `<span class="delta-pos">резерв ${fmt(-gap, digits)}</span>`
        : `<span class="${gap > 1e-9 ? "delta-neg" : "delta-pos"}">${gap >= 0 ? "+" : ""}${fmt(gap, digits)} · ${gap >= 0 ? "+" : ""}${fmt(limit ? (gap / limit) * 100 : 0, 1)}%</span>`;
      return [label, unit, fmt(value, digits), fmt(base, digits), deltaPct(value, base), `${fmt(limit, digits)}<small>${kind === "limit" ? "лимит снабжения" : "норматив"}</small>`, limitDelta, status];
    });
    return `<div class="kpis">${kpi("Энергоёмкость", fmt(per(plan.energy, plan.good), 3), "МВт·ч/т", `Норматив ${fmt(utilityNorms.energyIntensity, 2)} · БП ${fmt(per(bp.energy, bp.good), 3)}`, per(plan.energy, plan.good) > utilityNorms.energyIntensity ? "alert" : "accent")}${kpi("Загрузка лимита энергии", pct(energyLoad), "", `Пик ${pct(plan.energyPeak.load)} · ${monthLabel(plan.energyPeak.month)}`, plan.energyPeak.load >= 0.98 ? "alert" : "")}${kpi("Энергоцех: затраты", money(plan.energyCost), "млн ₽", `БП ${money(bp.energyCost)} · ${comparisonFoot(plan.energyCost, bp.energyCost)}`)}${kpi("ТМЦ и содержание запасов", money(plan.tmcCost), "млн ₽", `БП ${money(bp.tmcCost)} · ${comparisonFoot(plan.tmcCost, bp.tmcCost)}`)}</div>${panel(
      "Загрузка обеспечивающих цехов",
      "",
      table(
        ["Цех", "Загрузка / индекс", "Объём периода", "Расчёт"],
        departments.map(([n, load, amount, detail]) => [
          n,
          `<div class="load-track"><i class="${load > 1 ? "overload" : ""}" style="width:${Math.min(100, load * 100)}%"></i></div><small>${pct(load)}</small>`,
          amount,
          detail,
        ]),
      ),
    )}<div class="grid equal">${panel(
      "Энергопотребление",
      "МВт·ч",
      chart(
        "Энергопотребление",
        [
          { name: "Потребление", values: M.months.map((_, m) => S(r.resources.filter((x) => x.id === "energy" && x.month === m), "used")), color: "#ff8c00" },
          { name: "Месячное ограничение снабжения", values: M.months.map((_, m) => S(r.resources.filter((x) => x.id === "energy" && x.month === m), "available")), color: "#ed0084", line: true },
        ],
        "МВт·ч",
      ),
    )}${panel(
      "Поток воды и выпуск",
      "тыс. т · тыс. м³",
      chart(
        "Водоёмкость производства",
        [
          { name: "Годный выпуск, тыс. т", values: monthly(r, "production").map((x) => x / 1000), color: "#4769ff" },
          { name: "Водооборот, тыс. м³", values: M.months.map((_, m) => S((r.utilities || []).filter((x) => x.id === "water" && x.month === m), "used") / 1000), color: "#19a27b" },
        ],
        "тыс. ед.",
      ),
    )}</div>${panel(
      "Удельные затраты обеспечивающих процессов",
      "План S&OP против бизнес-плана, нормативов и лимитов снабжения",
      table(["Показатель", "Ед.", "План S&OP", "БП", "Δ к БП", "Лимит / норматив", "Δ к лимиту / нормативу", "Статус"], unitRows),
      "utility-unit-panel",
    )}`;
  }

  function stockGroupDynamics(r) {
    const resources = [...r.resources, ...(r.utilities || [])];
    const valueMode = stockMode === "value";
    const isActual = (m) => year === 2026 && m <= 8;
    /* Raw-material stock is not in the S&OP ledger: coverage of consumption,
       the reported months carry the recorded deviation from that coverage. */
    const rawFactor = [1.04, 0.97, 1.02, 0.96, 1.06, 0.99, 1.03, 0.95, 1.01];
    const raw = (id) => {
      const meta = A.resourceMeta[id];
      const cover = id === "fiber" ? 0.22 : 0.26;
      const used = (m) => S(resources.filter((x) => x.id === id && x.month === m), "used");
      const convert = (v) => (Number.isFinite(v) ? (valueMode ? (v * meta.tariff) / 1e6 : v) : null);
      return {
        name: meta.name,
        actual: M.months.map((_, m) => convert(isActual(m) ? used(m) * cover * rawFactor[m] : null)),
        plan: M.months.map((_, m) => convert(isActual(m) ? null : used(m) * cover)),
        target: M.months.map((_, m) => convert(used(m) * (id === "fiber" ? 0.18 : 0.21))),
      };
    };
    const finished = (familyName) => {
      const filter = (m) => r.rows.filter((x) => x.month === m && x.family === familyName);
      const unitCost = (m) => {
        const rows = filter(m), qty = S(rows, "end");
        return qty ? S(rows, (x) => x.end * x.unitCost) / qty : 0;
      };
      const convert = (v, m) => (Number.isFinite(v) ? (valueMode ? (v * unitCost(m)) / 1e6 : v) : null);
      return {
        name: `Готовая продукция · ${familyName}`,
        actual: M.months.map((_, m) => convert(isActual(m) ? S(filter(m), "end") : null, m)),
        plan: M.months.map((_, m) => convert(isActual(m) ? null : S(filter(m), "end"), m)),
        target: M.months.map((_, m) => convert(S(filter(m), "target"), m)),
      };
    };
    const groups = [raw("fiber"), raw("coat"), ...["Картон", "Бумага"].filter((name) => family === "all" || family === name).map(finished)];
    const unit = valueMode ? "млн ₽" : "т";
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Единицы динамики запасов"><button type="button" data-stock-mode="volume" aria-pressed="${!valueMode}">Объём, т</button><button type="button" data-stock-mode="value" aria-pressed="${valueMode}">Стоимость, млн ₽</button></div></div><div class="stock-group-grid">${groups.map((group) => `<section class="stock-mini"><h3>${esc(group.name)}</h3>${chart(`${group.name}: запасы`, [
      { name: "Факт", values: group.actual, color: "#19a27b", slot: 0 },
      { name: "План S&OP", values: group.plan, color: "#4769ff", slot: 0 },
      { name: "Цель", values: group.target, color: "#ed0084", line: true },
    ].filter((s) => s.values.some(Number.isFinite)), unit, { compare: true, split: true, context: "Факт · план · цель" })}</section>`).join("")}</div>`;
  }

  /* Days of stock on hand vs the target level: product × month. */
  function turnoverHeatmap(r) {
    const data = A.stockTurnover(M, r, family);
    const inPeriod = (m) => m >= fromMonth && m <= toMonth;
    const level = (cell) => (cell.ratio > 1.5 ? "hot" : cell.ratio > 1.05 ? "warm" : cell.ratio < 0.5 ? "low" : "ok");
    const daysText = (cell) => (Number.isFinite(cell.doh) ? fmt(cell.doh, 0) : "∞");
    const rows = data.map(({ product: p, cells }) => {
      const scoped = cells.filter((cell) => inPeriod(cell.month));
      const above = scoped.filter((cell) => cell.ratio > 1.5).length;
      const peak = scoped.reduce((best, cell) => (cell.ratio > best.ratio ? cell : best), { ratio: 0, doh: 0, month: fromMonth });
      return `<tr><th scope="row">${esc(p.name)}<small>${p.family}</small></th>${cells.map((cell) => `<td class="turn-cell ${level(cell)} ${inPeriod(cell.month) ? "" : "outside"}" title="${esc(p.name)} · ${M.months[cell.month]} ${year}: ${daysText(cell)} дн. запаса при цели ${fmt(cell.targetDays, 1)} дн. (${fmt(cell.ratio * 100, 0)}% цели) · остаток ${fmt(cell.end)} т">${daysText(cell)}</td>`).join("")}<td class="turn-total ${above ? "hot" : ""}">${above}</td><td>${peak.ratio ? `${fmt(peak.ratio * 100, 0)}%<small>${M.months[peak.month]}</small>` : "—"}</td></tr>`;
    }).join("");
    return `<div class="heat-legend turn-legend"><span><i class="ok"></i>В пределах цели</span><span><i class="warm"></i>105–150% цели</span><span><i class="hot"></i>Выше 150% цели</span><span><i class="low"></i>Ниже 50% цели</span><span>Значение — дни запаса на конец месяца</span></div><div class="table-wrap turn-heat-wrap"><table class="turn-heat"><thead><tr><th scope="col">Продукт</th>${M.months.map((m) => `<th scope="col">${m}</th>`).join("")}<th scope="col">Мес. выше 150%</th><th scope="col">Пик к цели</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function obsoleteData() {
    const data = A.obsoleteStock(M, M.forYear(horizonResults.get(active), 2026));
    const lots = data.lots.filter((lot) => family === "all" || lot.family === family);
    return { ...data, lots };
  }

  /* Write-off risk of slow-moving and obsolete lots by month of the storage limit. */
  function obsoleteView() {
    const data = obsoleteData();
    const value = obsoleteMode === "value";
    const monthLabel = (abs) => `${M.months[abs % 12]} ${2026 + Math.floor(abs / 12)}`;
    const metric = (lot) => (value ? lot.valueAtRisk / 1e6 : lot.atRisk);
    const families = [["Картон", "#4769ff"], ["Бумага", "#19a27b"]].filter(([name]) => family === "all" || family === name);
    const bucket = (lot) => Math.max(data.asOf, lot.riskMonth);
    const columns = data.months.map((abs) => ({
      abs,
      parts: families.map(([name, color]) => ({ name, color, value: S(data.lots.filter((lot) => lot.family === name && bucket(lot) === abs), metric) })),
    }));
    const max = Math.max(1, ...columns.map((c) => S(c.parts, "value"))) * 1.18;
    const w = 1100, h = 300, left = 58, right = 20, top = 28, bottom = 48, plotW = w - left - right, plotH = h - top - bottom;
    const slotW = plotW / columns.length, barW = Math.min(110, slotW * 0.5);
    let svg = `<svg class="chart obsolete-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Неликвиды: риск списания по месяцам"><title>Риск списания неликвидов по месяцам, ${value ? "млн ₽" : "т"}</title>`;
    for (let i = 0; i <= 4; i++) {
      const gy = top + (plotH * i) / 4, v = max * (1 - i / 4);
      svg += `<line x1="${left}" x2="${w - right}" y1="${gy}" y2="${gy}" stroke="#e8edf1"/><text x="${left - 9}" y="${gy + 4}" text-anchor="end">${fmt(v, value ? 1 : 0)}</text>`;
    }
    columns.forEach((column, i) => {
      const cx = left + slotW * i + slotW / 2;
      let base = top + plotH;
      column.parts.forEach((part) => {
        if (part.value <= 0) return;
        const height = (part.value / max) * plotH;
        base -= height;
        svg += `<rect x="${cx - barW / 2}" y="${base}" width="${barW}" height="${height}" rx="3" fill="${part.color}"><title>${monthLabel(column.abs)} · ${part.name}: ${fmt(part.value, value ? 1 : 0)} ${value ? "млн ₽" : "т"}</title></rect>`;
      });
      const total = S(column.parts, "value");
      if (total > 0) svg += `<text x="${cx}" y="${base - 7}" text-anchor="middle" class="value">${fmt(total, value ? 1 : 0)}</text>`;
      svg += `<text x="${cx}" y="${h - 26}" text-anchor="middle">${monthLabel(column.abs)}</text>${i === 0 ? `<text x="${cx}" y="${h - 12}" text-anchor="middle" class="chart-note">с просрочкой</text>` : ""}`;
    });
    svg += "</svg>";
    const inWindow = data.lots.filter((lot) => lot.inWindow);
    const lots = [...data.lots].sort((x, y) => x.riskMonth - y.riskMonth || y.valueAtRisk - x.valueAtRisk);
    const lotRows = lots.map((lot) => [
      `<b>${lot.id}</b>`,
      `${esc(lot.productName)}<small>${lot.gram} г/м² · ${lot.width} мм</small>`,
      esc(nodeLabel(lot.node)),
      fmt(lot.qty),
      `${lot.age} мес.`,
      `<span class="${lot.overdue ? "delta-neg" : ""}">${monthLabel(lot.riskMonth)}</span>`,
      lot.sellRate ? `${fmt(lot.sellRate)} т/мес.` : "—",
      fmt(lot.atRisk),
      money(lot.valueAtRisk),
      esc(lot.reason),
      esc(lot.action),
      lot.overdue ? '<span class="pill red">Срок вышел</span>' : lot.inWindow ? '<span class="pill warn">Риск списания</span>' : '<span class="pill">Наблюдение</span>',
    ]);
    return `<div class="chart-toolbar"><div class="flow-switch" role="group" aria-label="Единицы неликвидов"><button type="button" data-obsolete-mode="value" aria-pressed="${value}">Сумма, млн ₽</button><button type="button" data-obsolete-mode="qty" aria-pressed="${!value}">Объём, т</button></div><span class="chart-context">${inWindow.length} партий · ${fmt(S(inWindow, "atRisk"))} т · ${money(S(inWindow, "valueAtRisk"))} млн ₽ до ${monthLabel(data.months[data.months.length - 1])}</span></div><div class="legend">${families.map(([name, color]) => `<span><i style="background:${color}"></i>${name}</span>`).join("")}</div><div class="chart-scroll">${svg}</div>${table(["Партия", "Продукт", "Склад", "Остаток, т", "Возраст", "Срок списания", "Ликвидация", "Под риском, т", "Сумма риска, млн ₽", "Причина", "Действие", "Статус"], lotRows)}`;
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
    const obsolete = obsoleteData();
    const obsoleteRisk = obsolete.lots.filter((lot) => lot.inWindow);
    const watch = obsolete.lots.filter((lot) => !lot.inWindow);
    return `<div class="kpis kpis-5">${kpi("Запас на конец периода", fmt(t.end), "т", `Средний запас: ${fmt(avgStock)} т`, true)}${kpi("Запас в днях продаж", fmt(days, 1), "дн.", "Средний запас ÷ суточные отгрузки")}${kpi("Риск дефицита", fmt(low.length), "SKU", "Остаток ниже 75% цели", low.length > 0 ? "alert" : "")}${kpi("Риск излишка", fmt(high.length), "SKU", "Остаток выше 150% цели", high.length > 0 ? "alert" : "")}${kpi("Неликвиды · риск списания", money(S(obsoleteRisk, "valueAtRisk")), "млн ₽", `${obsoleteRisk.length} партий · ${fmt(S(obsoleteRisk, "atRisk"))} т за 6 мес. · ещё ${money(S(watch, "valueAtRisk"))} млн ₽ под наблюдением`, obsoleteRisk.length ? "alert" : "")}</div><div class="grid equal">${panel(
      "Динамика запасов и целевой уровень",
      "т",
      chart("Остатки и целевой запас", [
        {
          name: "Остаток на конец месяца",
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
      "млн ₽",
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
      "Оборачиваемость запасов: дни запаса против цели",
      "Продукт × месяц · подсвечены запасы с оборачиваемостью выше целевого уровня",
      turnoverHeatmap(r),
      "turnover-panel",
    )}${panel(
      "Неликвиды · риск списания в ближайшие 6 месяцев",
      "Срок хранения 12 мес. с даты выпуска · остаток на 23.10.2026",
      obsoleteView(),
      "obsolete-panel",
    )}${panel(
      "Риски по ассортименту",
      "Остаток на конец периода против цели",
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
    )}${panel("Складская сеть и материальный баланс", "Заводской склад и шесть РЦ", table(["Склад", "Начало, т", "Производство, т", "Приход, т", "Перемещения, т", "Отгрузки, т", "Конец, т", "Ёмкость, т"], nr))}${panel("Запасы по группам: факт, план и цель", "Сырьё и готовая продукция", stockGroupDynamics(r), "stock-groups-panel")}${panel(
      "Реестр складских остатков",
      "SKU × склад × месяц",
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
    return chart(title, series, mode === "cost" ? "млн ₽" : "т", { compare: true, width: 1120, height: 300, context: `${keys.length} детализаций · ${mode === "cost" ? "затраты" : "объём"}` });
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
    return `<div class="kpis kpis-5">${kpi("Узлов сети", M.nodes.length, "", "Заводской склад + 6 региональных РЦ", true)}${kpi("Поставщиков сырья", A.suppliers.length, "", "Волокно и компоненты мелования")}${kpi("Пополнение РЦ", fmt(transfers), "т", "За выбранный год")}${kpi("Клиентов в плане", O.customers.length, "", "Именованные получатели")}${kpi("Логистика по S&OP", money(t.logistics), "млн ₽", "Магистраль + последняя миля")}</div>
      ${panel("Схема логистических потоков", "", `<div class="process-flow logistics-chain"><span>Поставщики сырья<small>6 контрагентов</small></span><b>→</b><span>Завод КАМА<small>Краснокамск</small></span><b>→</b><span>Внутризаводские этапы<small>Масса → КДМ/БДМ → отделка</small></span><b>→</b><span>Склад ГП<small>Единый выпуск</small></span><b>→</b><span>6 РЦ<small>Москва · Казань · СПб · Ростов · Екатеринбург · Новосибирск</small></span><b>→</b><span>12 клиентов<small>Продукт / склад / день</small></span></div>`)}
      ${panel("Поставщики сырья → завод", "Волокно и компоненты мелования", `${movementControls("inbound", "inboundDetail", [["supplier", "По поставщикам"], ["resource", "По видам сырья"]])}${movementMonthlyChart("Входящие поставки", supplierFlows, "inbound", (flow) => movementModes.inboundDetail === "supplier" ? flow.supplier : flow.item)}`)}
      ${panel("Внутризаводские перемещения", "Склад сырья → массоподготовка → КДМ-9 / БДМ-7 → отделка → склад ГП", `${movementControls("internal")}${movementMonthlyChart("Внутризаводские потоки", internalFlows, "internal", (flow) => flow.stage)}`)}
      ${panel("Склад готовой продукции → РЦ", "Шесть региональных складов", `${movementControls("rc", "rcDetail", [["node", "По РЦ"], ["family", "По направлениям"]])}${movementMonthlyChart("Пополнение региональных РЦ", rcFlows, "rc", (flow) => movementModes.rcDetail === "node" ? flow.to : product(flow.product).family)}`)}
      ${panel("Отгрузки клиентам", "12 клиентов", `${movementControls("customers", "customerDetail", [["customer", "По клиентам"], ["node", "По складам"], ["family", "По направлениям"]])}${movementMonthlyChart("Клиентские отгрузки", customerFlows, "customers", (flow) => movementModes.customerDetail === "customer" ? flow.to : movementModes.customerDetail === "node" ? flow.from : product(flow.product).family)}`)}
      ${panel("Затраты по узлам", "млн ₽ за выбранный год", nodeCostChart(data.nodeCosts), "node-cost-panel")}
      ${panel("Маршруты и стоимость узлов", "", table(["Узел", "Маршрут", "Пополнение, т", "Отгрузки, т", "Магистраль, млн ₽", "Обработка, млн ₽", "Хранение, млн ₽", "Последняя миля, млн ₽", "Итого, млн ₽"], routeRows))}
      ${panel("Сводный детальный план перемещений", "Месяц × маршрут × продукт", paged("movement-plan", ["Тип", "Месяц", "Откуда", "Куда", "Ресурс / продукт", "Объём, т", "Затраты, млн ₽", "Лидтайм"], detailRows))}`;
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

  /* Operating-profit bridge in the Russian P&L order: revenue − cost of sales
     = gross profit − commercial − administrative = operating profit. */
  function profitWaterfall(t) {
    const sumKey = (key) => S(t.rows, key);
    const productionFixed = sumKey("laborCost") + sumKey("maintenanceCost") + sumKey("depreciationCost");
    const grossProfit = sumKey("grossProfit");
    const steps = [
      { label: ["Выручка"], value: t.revenue, type: "start" },
      { label: ["Переменная", "себестоимость"], value: -t.variable, type: "cost", note: "сырьё, энергия, переделы" },
      { label: ["Постоянные", "производственные"], value: -productionFixed, type: "cost", note: "ФОТ, ремонты, амортизация" },
      { label: ["Валовая", "прибыль"], value: grossProfit, type: "subtotal" },
      { label: ["Логистика", "и хранение"], value: -(t.logistics + t.holding), type: "cost", note: "магистраль, последняя миля, склады" },
      { label: ["Коммерческие", "и управленческие"], value: -(sumKey("sellingCost") + sumKey("administrationCost")), type: "cost", note: "коммерческие, управление и IT" },
      { label: ["Операционная", "прибыль"], value: t.operatingProfit, type: "total" },
    ];
    let level = 0;
    const bars = steps.map((step) => {
      let from, to;
      if (step.type === "cost") {
        from = level;
        to = level + step.value;
        level = to;
      } else {
        from = 0;
        to = step.value;
        level = step.value;
      }
      return { ...step, from, to };
    });
    const values = bars.flatMap((bar) => [bar.from, bar.to]);
    const maxV = Math.max(1, ...values) * 1.12, minV = Math.min(0, ...values) * 1.12;
    const w = 940, h = 330, left = 64, right = 16, top = 34, bottom = 62;
    const plotW = w - left - right, plotH = h - top - bottom;
    const y = (v) => top + ((maxV - v) / (maxV - minV)) * plotH;
    const slotW = plotW / bars.length, barW = Math.min(86, slotW * 0.58);
    const colors = { start: "#4769ff", cost: "#ff8c00", subtotal: "#19a27b", total: "#087f64" };
    let svg = `<svg class="chart waterfall-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Waterfall операционной прибыли"><title>Выручка → валовая прибыль → операционная прибыль, млн ₽</title>`;
    for (let i = 0; i <= 4; i++) {
      const v = maxV - ((maxV - minV) * i) / 4, gy = top + (plotH * i) / 4;
      svg += `<line x1="${left}" x2="${w - right}" y1="${gy}" y2="${gy}" stroke="#eef1f5"/><text x="${left - 9}" y="${gy + 4}" text-anchor="end">${fmt(v / 1e6, 0)}</text>`;
    }
    if (minV < 0) svg += `<line x1="${left}" x2="${w - right}" y1="${y(0)}" y2="${y(0)}" stroke="#9eabb9"/>`;
    bars.forEach((bar, i) => {
      const cx = left + slotW * i + slotW / 2;
      const yTop = y(Math.max(bar.from, bar.to)), yBottom = y(Math.min(bar.from, bar.to));
      const share = t.revenue ? (Math.abs(bar.value) / t.revenue) * 100 : 0;
      svg += `<rect class="wf-${bar.type}" x="${cx - barW / 2}" y="${yTop}" width="${barW}" height="${Math.max(1.5, yBottom - yTop)}" rx="4" fill="${colors[bar.type]}"><title>${bar.label.join(" ")}: ${money(bar.value)} млн ₽ (${fmt(share, 1)}% выручки)${bar.note ? ` · ${bar.note}` : ""}</title></rect>`;
      svg += `<text x="${cx}" y="${yTop - 18}" text-anchor="middle" class="value">${bar.type === "cost" ? "−" : ""}${money(Math.abs(bar.value))}</text><text x="${cx}" y="${yTop - 5}" text-anchor="middle" class="chart-note">${fmt(share, 1)}%</text>`;
      if (i < bars.length - 1)
        svg += `<line x1="${cx + barW / 2}" x2="${cx + slotW - barW / 2}" y1="${y(bar.to)}" y2="${y(bar.to)}" stroke="#9aa6b5" stroke-dasharray="3 3"/>`;
      bar.label.forEach((line, k) => {
        svg += `<text x="${cx}" y="${h - bottom + 20 + k * 13}" text-anchor="middle" class="${bar.type === "subtotal" || bar.type === "total" ? "wf-label strong" : "wf-label"}">${line}</text>`;
      });
    });
    svg += "</svg>";
    return `<div class="legend"><span><i style="background:${colors.start}"></i>Выручка</span><span><i style="background:${colors.cost}"></i>Затраты</span><span><i style="background:${colors.subtotal}"></i>Валовая прибыль</span><span><i style="background:${colors.total}"></i>Операционная прибыль</span><span class="chart-context">млн ₽ · % от выручки</span></div><div class="chart-scroll">${svg}</div>`;
  }

  function financeView(r, t) {
    const bp = businessResults.get(year), bpt = totals(bp);
    const inFamily = (x) => family === "all" || x.family === family;
    const isActual = (m) => year === 2026 && m <= 8;
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
    const activeMonthly = (key, filter) => M.months.map((_, m) => (filter(m) ? S(r.rows.filter((x) => x.month === m && inFamily(x)), key) / 1e6 : null));
    const fact = (key) => activeMonthly(key, isActual), planned = (key) => activeMonthly(key, (m) => !isActual(m));
    const grossProfit = S(t.rows, "grossProfit"), bpGross = S(bpt.rows, "grossProfit");
    const fullCostDelta = t.fullCost - bpt.fullCost;
    const perTon = t.fullCost / (t.sales || 1), bpPerTon = bpt.fullCost / (bpt.sales || 1);
    return `<div class="kpis kpis-6">${kpi("Выручка", money(t.revenue), "млн ₽", `БП ${money(bpt.revenue)} · ${comparisonFoot(t.revenue, bpt.revenue)}`, true)}${kpi("Полная себестоимость", money(t.fullCost), "млн ₽", `БП ${money(bpt.fullCost)} · <span class="${fullCostDelta <= 0 ? "delta-pos" : "delta-neg"}">${fullCostDelta >= 0 ? "+" : ""}${money(fullCostDelta)} млн ₽</span> к БП`, true)}${kpi("Валовая прибыль", money(grossProfit), "млн ₽", `БП ${money(bpGross)} · ${comparisonFoot(grossProfit, bpGross)}`, true)}${kpi("Маржинальный доход", money(t.margin), "млн ₽", `БП ${money(bpt.margin)} · ${comparisonFoot(t.margin, bpt.margin)}`, true)}${kpi("Операционная прибыль", money(t.operatingProfit), "млн ₽", `БП ${money(bpt.operatingProfit)} · ${comparisonFoot(t.operatingProfit, bpt.operatingProfit)}`)}${kpi("Полная себестоимость на тонну", fmt(perTon), "₽/т", `БП ${fmt(bpPerTon)} ₽/т · <span class="${perTon <= bpPerTon ? "delta-pos" : "delta-neg"}">${perTon - bpPerTon >= 0 ? "+" : ""}${fmt(perTon - bpPerTon)} ₽/т</span>`)}</div>
      ${panel("Выручка и затраты по месяцам", "План S&OP, факт и бизнес-план · млн ₽", chart("Выручка, полная себестоимость и МД: план S&OP, факт и БП", [
        { name: "Выручка · БП", values: bpMonthly("revenue"), color: "#c3cdfb", slot: 0 },
        { name: "Выручка · факт", values: fact("revenue"), color: "#2f4fd8", slot: 1 },
        { name: "Выручка · план S&OP", values: planned("revenue"), color: "#7d95ff", slot: 1 },
        { name: "Себестоимость · БП", values: bpMonthly("fullCost"), color: "#dde2ea", slot: 2 },
        { name: "Себестоимость · факт", values: fact("fullCost"), color: "#55657c", slot: 3 },
        { name: "Себестоимость · план S&OP", values: planned("fullCost"), color: "#a1a9b7", slot: 3 },
        { name: "МД · БП", values: bpMonthly("margin"), color: "#7cd0ba", line: true },
        { name: "МД · факт", values: fact("margin"), color: "#087f64", line: true, dashed: false },
        { name: "МД · план S&OP", values: planned("margin"), color: "#19a27b", line: true, dashed: false },
      ].filter((s) => s.values.some(Number.isFinite)), "млн ₽", { compare: true, split: true, width: 1120, height: 320, context: "БП · факт · план S&OP" }), "finance-top-chart")}
      ${panel("Waterfall операционной прибыли", "", profitWaterfall(t), "waterfall-panel")}
      ${panel("Структура полной себестоимости", "млн ₽", horizontalChart("Полная себестоимость по статьям", costStructure, "млн ₽", 1, { width: 1120 }), "cost-structure-panel")}
      ${panel("Маржинальный доход по всем продуктам", "Продукт × месяц · млн ₽", marginHeatmap(r), "margin-heatmap-panel")}
      ${panel("Экономика по ассортименту", "млн ₽", table(["Продукт", "Отгрузки, т", "Ср. цена, ₽/т", "Выручка, млн ₽", "Полная себестоимость", "В т.ч. постоянные", "Валовая прибыль", "МД, млн ₽", "Опер. прибыль, млн ₽", "Рентабельность"], M.products.filter((p) => family === "all" || p.family === family).map((p) => {
        const rr = t.rows.filter((x) => x.product === p.id), revenue = S(rr, "revenue"), profit = S(rr, "operatingProfit");
        return [p.name, fmt(S(rr, "sales")), fmt(revenue / (S(rr, "sales") || 1)), money(revenue), money(S(rr, "fullCost")), money(S(rr, "fixedCost")), money(S(rr, "grossProfit")), money(S(rr, "margin")), money(profit), pct(revenue ? profit / revenue : 0)];
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
    return `<div class="compare-selects"><label>ВЕРСИЯ A · ТОЧКА ОТСЧЁТА<select id="compare-a">${options(a)}</select></label><label>ВЕРСИЯ B · КАНДИДАТ<select id="compare-b">${options(b)}</select></label></div><div class="compare-summary"><span class="status ${recommended ? "" : "bad"}" title="Максимальный МД среди версий с покрытием спроса не ниже 97% в текущем срезе">${recommended ? `Рекомендуемая версия: ${esc(recommended.r.config.name)}` : "Нет версии с покрытием ≥ 97%"}</span><span class="compare-chip">ΔМД B − A <b class="${bt.margin - at.margin >= 0 ? "delta-pos" : "delta-neg"}">${bt.margin - at.margin >= 0 ? "+" : ""}${money(bt.margin - at.margin)} млн ₽</b></span><span class="compare-chip">Δ покрытия <b class="${bt.coverage - at.coverage >= 0 ? "delta-pos" : "delta-neg"}">${bt.coverage - at.coverage >= 0 ? "+" : ""}${fmt((bt.coverage - at.coverage) * 100, 1)} п.п.</b></span></div>${panel(
      "Матрица всех версий",
      "",
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
      "",
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
    )}${panel("Мост изменения маржинального дохода", "B относительно A", changes.map(([name, value]) => `<div class="bridge-row"><span>${name}</span><div class="bridge-track"><div class="bridge-bar ${value < 0 ? "negative" : ""}" style="width:${(Math.abs(value) / max) * 100}%"></div></div><strong>${value > 0 ? "+" : ""}${money(value)} млн ₽</strong></div>`).join("") + `<hr style="border:0;border-top:1px solid #e3e9ef"><p><strong>Итого B − A: ${money(bt.margin - at.margin)} млн ₽.</strong></p>`)}</div>${panel("Маржинальный доход: продукт × месяц", "Δ B − A, млн ₽", table(["Продукт", ...M.months], heatRows))}${panel(
      "Профили сценариев",
      "",
      table(
        ["Версия", "Плановое решение"],
        [...results].map(([, r]) => [esc(r.config.name), esc(r.config.desc)]),
      ),
    )}`;
  }
  function closeExpandedPanel() {
    expandedPanel = null;
    expandedPanelTab = null;
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

  /* Разворачивает панель на весь экран. Используется и при обычном клике по
     «Развернуть», и после перерисовки раздела: режим не должен сбрасываться,
     пока пользователь работает с диаграммой Ганта. */
  function openExpandedPanel(id, { focus = true, scrollTop = 0 } = {}) {
    const panelEl = document.getElementById(id);
    if (!panelEl) return;
    expandedPanel = id;
    expandedPanelTab = tab;
    panelEl.classList.add("is-expanded");
    document.body.classList.add("has-expanded-panel");
    const btn = panelEl.querySelector(".panel-toggle");
    if (btn) {
      btn.setAttribute("aria-expanded", "true");
      btn.querySelector("span:last-child").textContent = "Свернуть";
      btn.setAttribute(
        "aria-label",
        `Свернуть в обычный вид: ${panelEl.querySelector("h2").textContent}`,
      );
      if (focus) btn.focus();
    }
    const body = panelEl.querySelector(".panel-body");
    if (body && scrollTop) body.scrollTop = scrollTop;
  }

  function toggleExpandedPanel(id) {
    const panelEl = document.getElementById(id);
    if (!panelEl) return;
    const opening = !panelEl.classList.contains("is-expanded");
    closeExpandedPanel();
    if (!opening) return;
    panelEl.scrollTop = 0;
    openExpandedPanel(id);
  }

  function render() {
    /* Запоминаем развёрнутую панель и положение прокрутки до перерисовки,
       чтобы действия на диаграмме (drag-and-drop, фильтры переделов) не
       выбрасывали пользователя из режима «Развернуто». */
    const restoreExpanded = expandedPanel && expandedPanelTab === tab ? expandedPanel : null;
    let restoreBodyScroll = 0;
    if (restoreExpanded) {
      const oldBody = document.querySelector(`#${restoreExpanded} .panel-body`);
      restoreBodyScroll = oldBody ? oldBody.scrollTop : 0;
    }
    const oldGanttScroll = document.querySelector(".gantt-scroll");
    if (oldGanttScroll) ganttScrollLeft = oldGanttScroll.scrollLeft;
    closeExpandedPanel();
    panelCounter = 0;
    tableSeq = 0;
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
    $("#delete-scenarios").disabled = !customs.length;
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
      dispatch: dispatchView,
    };
    $("#content").innerHTML = views[tab](r, t);
    wireContent();
    if (restoreExpanded && document.getElementById(restoreExpanded)) {
      openExpandedPanel(restoreExpanded, { focus: false, scrollTop: restoreBodyScroll });
    }
  }

  function wireContent() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      const trigger = () => {
        const key = th.dataset.tableKey;
        const col = Number(th.dataset.col);
        const cur = tableSorts.get(key);
        let dir = "asc";
        if (cur && cur.col === col) dir = cur.dir === "asc" ? "desc" : "asc";
        tableSorts.set(key, { col, dir });
        render();
      };
      th.onclick = trigger;
      th.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          trigger();
        }
      };
    });
    document.querySelectorAll("[data-overview-source]").forEach((btn) => (btn.onclick = () => {
      overviewSource = btn.dataset.overviewSource === "active" ? "active" : "previous";
      render();
      document.querySelector(`[data-overview-source="${overviewSource}"]`)?.focus();
    }));
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
    document.querySelectorAll("[data-registry-stream]").forEach((btn) => (btn.onclick = () => {
      registryStream = btn.dataset.registryStream;
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
      const visible = [...document.querySelectorAll("[data-order-select]")].map((input) => input.dataset.orderSelect);
      visible.forEach((id) => (selectAll.checked ? orderSelected.add(id) : orderSelected.delete(id)));
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
      render();
      toast(`${onlySelected ? `Пересчитано заказов: ${orderSelected.size}` : `Пересчитан весь портфель: ${O.openOrders.length} открытых заказов`} · ATP на ${orderDate(O.AS_OF)}`);
    }));
    document.querySelectorAll("[data-order-quick]").forEach((btn) => (btn.onclick = () => {
      orderQuick = btn.dataset.orderQuick;
      orderSource = "all";
      render();
    }));
    document.querySelectorAll("[data-order-source]").forEach((btn) => (btn.onclick = () => {
      orderSource = btn.dataset.orderSource;
      render();
    }));
    document.querySelectorAll("[data-quota-view]").forEach((btn) => (btn.onclick = () => {
      quotaView = btn.dataset.quotaView;
      render();
    }));
    const orderSearch = document.querySelector("[data-order-search]");
    if (orderSearch) orderSearch.oninput = () => {
      const query = orderSearch.value.trim().toLowerCase();
      document.querySelectorAll("[data-order-option]").forEach((label) => {
        label.hidden = Boolean(query) && !label.dataset.orderOption.includes(query);
      });
    };
    const applyFilter = document.querySelector("[data-order-filter-apply]");
    if (applyFilter) applyFilter.onclick = () => {
      orderFilter = new Set([...document.querySelectorAll(".order-picker-list input:checked")].map((input) => input.value));
      render();
    };
    const clearFilter = document.querySelector("[data-order-filter-clear]");
    if (clearFilter) clearFilter.onclick = () => {
      orderFilter = new Set();
      render();
    };
    document.querySelectorAll("[data-order-chip]").forEach((btn) => (btn.onclick = () => {
      orderFilter.delete(btn.dataset.orderChip);
      render();
    }));
    document.querySelectorAll("[data-resource-mode]").forEach((btn) => (btn.onclick = () => {
      resourceModes[btn.dataset.resourceMode] = btn.dataset.value;
      render();
    }));
    document.querySelectorAll("[data-fiber-type]").forEach((btn) => (btn.onclick = () => {
      fiberType = btn.dataset.fiberType;
      render();
    }));
    document.querySelectorAll("[data-dispatch-stage]").forEach((btn) => (btn.onclick = () => {
      const def = dispatchStageFilter[btn.dataset.dispatchStage];
      dispatchUnits = def ? new Set(def.units) : new Set();
      render();
    }));
    /* Быстрый выбор набора агрегатов: все либо группа продукта «Картон» / «Бумага». */
    document.querySelectorAll("[data-dispatch-group]").forEach((btn) => (btn.onclick = () => {
      const def = dispatchUnitGroups[btn.dataset.dispatchGroup];
      if (!def) return;
      const current = dispatchChosenUnits();
      const same = def.units.length === current.size && def.units.every((u) => current.has(u));
      dispatchUnits = same ? new Set() : new Set(def.units);
      render();
    }));
    /* Любой набор агрегатов: каждая кнопка включает / выключает один агрегат. */
    document.querySelectorAll("[data-dispatch-unit]").forEach((btn) => (btn.onclick = () => {
      const id = btn.dataset.dispatchUnit;
      const next = dispatchChosenUnits();
      if (next.has(id)) {
        if (next.size === 1) return; /* хотя бы один агрегат остаётся на диаграмме */
        next.delete(id);
      } else next.add(id);
      dispatchUnits = next.size === GANTT_UNITS.length ? new Set() : next;
      render();
    }));
    /* Завершённые кампании серым: по умолчанию включено. */
    document.querySelectorAll("[data-dispatch-dim-done]").forEach((btn) => (btn.onclick = () => {
      dispatchDimDone = !dispatchDimDone;
      render();
    }));
    const clearFocus = document.querySelector("[data-dispatch-clear-focus]");
    if (clearFocus) clearFocus.onclick = () => {
      dispatchFocus = null;
      render();
    };
    document.querySelectorAll("[data-dispatch-links]").forEach((btn) => (btn.onclick = () => {
      dispatchLinks = !dispatchLinks;
      render();
    }));
    document.querySelectorAll("[data-dispatch-cascade]").forEach((btn) => (btn.onclick = () => {
      dispatchCascade = !dispatchCascade;
      render();
    }));
    const dispatchReset = document.querySelector("[data-dispatch-reset]");
    if (dispatchReset) dispatchReset.onclick = () => {
      dispatchMoves.clear();
      render();
    };
    document.querySelectorAll("[data-dispatch-order]").forEach((input) => (input.onchange = () => {
      if (input.checked) dispatchOrders.add(input.dataset.dispatchOrder);
      else dispatchOrders.delete(input.dataset.dispatchOrder);
      render();
    }));
    document.querySelectorAll("[data-dispatch-order-all]").forEach((btn) => (btn.onclick = () => {
      dispatchOrders = new Set(btn.dataset.dispatchOrderAll === "prod" ? dispatchOrderIds : []);
      render();
    }));
    /* Перетаскивание кампаний на диаграмме Ганта: полосы двигаются «вживую»,
       сдвиг фиксируется в локальном состоянии диспетчерской на mouseup. */
    document.querySelectorAll(".gantt-bar").forEach((bar) => {
      bar.onmousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const key = bar.dataset.ganttKey;
        ganttDrag = {
          key,
          bar,
          startX: e.clientX,
          origX: Number(bar.getAttribute("x")),
          /* Переход визуально прикреплён к кампании и во время drag-and-drop
             движется вместе с ней, а не остаётся на старом месте до mouseup. */
          companions: [...document.querySelectorAll("[data-gantt-move]")]
            .filter((el) => el.dataset.ganttMove === key)
            .map((el) => ({ el, x: Number(el.getAttribute("x")) })),
          delta: 0,
        };
        bar.classList.add("dragging");
      };
      /* Клик без сдвига выбирает кампанию: подсвечивается вся её цепочка,
         остальные полосы становятся серыми. Повторный клик снимает выбор. */
      bar.onclick = (e) => {
        e.stopPropagation();
        const key = bar.dataset.ganttKey;
        dispatchFocus = dispatchFocus === key ? null : key;
        render();
      };
    });
    /* Переход выбирает ту кампанию, перед которой он выполняется. Это даёт
       одинаковую подсветку цепочки и мышью, и с клавиатуры. */
    document.querySelectorAll(".gantt-changeover").forEach((segment) => {
      const select = (e) => {
        e.stopPropagation();
        const key = segment.dataset.ganttTarget;
        dispatchFocus = dispatchFocus === key ? null : key;
        render();
      };
      segment.onclick = select;
      segment.onkeydown = (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        select(e);
      };
    });
    const ganttSvg = document.querySelector(".gantt-svg");
    if (ganttSvg) ganttSvg.onclick = (e) => {
      if (e.target.closest(".gantt-bar, .gantt-changeover") || !dispatchFocus) return;
      dispatchFocus = null;
      render();
    };
    if (!ganttDocWired) {
      ganttDocWired = true;
      document.addEventListener("mousemove", (e) => {
        if (!ganttDrag) return;
        const svg = document.querySelector(".gantt-svg");
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const chartW = Number(svg.getAttribute("data-w"));
        const chartH = Number(svg.getAttribute("data-h"));
        const day = Number(svg.dataset.day) || 20;
        const label = Number(svg.dataset.label) || 0;
        /* Переводим пиксели мыши в сутки с учётом фактического масштаба SVG
           (браузерный zoom, печать, нестандартный DPR). */
        const scale = rect.width && rect.height ? Math.min(rect.width / chartW, rect.height / chartH) : 1;
        const wanted = ganttDrag.origX + Math.round((e.clientX - ganttDrag.startX) / (scale * day)) * day;
        const maxX = chartW - 8 - Number(ganttDrag.bar.getAttribute("width"));
        const nx = Math.max(label, Math.min(wanted, maxX));
        const dx = nx - ganttDrag.origX;
        for (const companion of ganttDrag.companions) companion.el.setAttribute("x", String(companion.x + dx));
        ganttDrag.delta = Math.round(dx / day);
      });
      document.addEventListener("mouseup", () => {
        if (!ganttDrag) return;
        const { key, delta, bar } = ganttDrag;
        ganttDrag = null;
        bar.classList.remove("dragging");
        if (!delta) return; /* клик без сдвига обрабатывает onclick полосы */
        ganttDragEndedAt = Date.now();
        commitDispatchMove(key, delta);
        render();
      });
    }
    document.querySelectorAll("[data-obsolete-mode]").forEach((btn) => (btn.onclick = () => {
      obsoleteMode = btn.dataset.obsoleteMode;
      render();
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
    /* Горизонтальная прокрутка Ганта: при смене окна показываем «сегодня»,
       при остальных перерисовках (drag, фильтры переделов) сохраняем позицию. */
    const ganttScroll = document.querySelector(".gantt-scroll");
    if (ganttScroll) {
      const chart = ganttScroll.querySelector(".gantt-svg");
      const key = chart ? chart.dataset.window : null;
      if (key && key !== ganttWindowKey) {
        ganttWindowKey = key;
        const todayX = Number(chart.dataset.todayX) || 0;
        ganttScrollLeft = Math.max(0, todayX - Math.min(360, (ganttScroll.clientWidth || 0) / 3));
      }
      ganttScroll.scrollLeft = ganttScrollLeft;
      ganttScroll.addEventListener("scroll", () => {
        ganttScrollLeft = ganttScroll.scrollLeft;
      });
    }
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

  /* Name suggestion for a new scenario: "Сценарий N" (first free number). */
  function suggestedName() {
    const taken = new Set(customs.map((c) => c.name.toLowerCase()));
    let n = customs.length + 1;
    while (taken.has(`сценарий ${n}`)) n++;
    return `Сценарий ${n}`;
  }

  function editorTarget() {
    const name = $("#scenario-name").value.trim();
    const editing = isCustom(active) ? customById(active) : null;
    return { name, editing, update: Boolean(editing && editing.name.toLowerCase() === name.toLowerCase()) };
  }

  function refreshEditorAction() {
    const { update, editing } = editorTarget();
    $("#editor-submit").textContent = update ? "Сохранить и пересчитать" : "Создать и пересчитать";
    $("#editor-base").textContent = editing
      ? `Основа: ${customConfig(editing).name} (копия ${M.scenarios.find((c) => c.id === editing.base).name})`
      : `Основа: ${horizonResults.get(active).config.name}`;
  }

  function openEditor() {
    const editing = isCustom(active) ? customById(active) : null;
    populateEditor(horizonResults.get(active).config);
    $("#scenario-name").value = editing ? editing.name : suggestedName();
    refreshEditorAction();
    $("#editor").showModal();
  }

  $("#edit").onclick = openEditor;
  $("#scenario-name").oninput = refreshEditorAction;
  $("#cancel").onclick = () => $("#editor").close();
  $("#cancel-x").onclick = () => $("#editor").close();
  $("#editor-reset").onclick = () => {
    const base = isCustom(active) ? customById(active).base : active;
    populateEditor(horizonResults.get(base).config);
  };
  $("#editor-form").onsubmit = (e) => {
    e.preventDefault();
    const { name, editing, update } = editorTarget();
    if (name.length < 2) {
      $("#editor-error").textContent = "Введите название сценария (не короче 2 символов).";
      $("#scenario-name").focus();
      return;
    }
    if (M.scenarios.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      $("#editor-error").textContent = "Название совпадает со штатной версией — выберите другое.";
      return;
    }
    const duplicate = customs.find((c) => c.name.toLowerCase() === name.toLowerCase() && (!update || c.id !== editing.id));
    if (duplicate) {
      $("#editor-error").textContent = `Сценарий «${duplicate.name}» уже есть. Измените название или удалите старый сценарий.`;
      return;
    }
    if (!update && customs.length >= CUSTOM_LIMIT) {
      $("#editor-error").textContent = `Можно хранить до ${CUSTOM_LIMIT} пользовательских сценариев. Удалите ненужные кнопкой «Удалить сценарии».`;
      return;
    }
    const base = editing ? editing.base : active;
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
    let id = update ? editing.id : "custom";
    for (let n = 2; !update && (isCustom(id) || M.scenarios.some((c) => c.id === id)); n++) id = `custom-${n}`;
    const entry = { id, name, base, params, created: new Date().toISOString() };
    const result = M.runHorizon(customConfig(entry), params);
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
    if (update) customs = customs.map((c) => (c.id === id ? entry : c));
    else customs.push(entry);
    horizonResults.set(id, result);
    orderPlan = null;
    orderSelected.clear();
    active = id;
    b = id;
    const saved = saveCustoms();
    $("#editor").close();
    setYear(2026, true);
    render();
    toast(
      `«${name}» ${update ? "обновлён" : "создан"}${saved ? "" : " без локального сохранения"}. Окт 2026 – дек 2027 к основе: Δ МД ${marginDelta >= 0 ? "+" : ""}${money(marginDelta)} млн ₽.`,
    );
  };

  /* Separate deletion of user scenarios. */
  function renderScenarioManager() {
    const list = customs.map((entry) => {
      const cfg = customConfig(entry);
      const baseName = M.scenarios.find((c) => c.id === entry.base).name;
      const created = entry.created ? new Date(entry.created).toLocaleDateString("ru-RU") : "—";
      return `<label class="manager-row"><input type="checkbox" value="${entry.id}" data-manager-select><span><b>${esc(entry.name)}</b><small>Основа: ${esc(baseName)} · создан ${created}${entry.id === active ? " · активный план" : ""}</small><small>${esc(cfg.desc)}</small></span><button type="button" class="button danger" data-manager-delete="${entry.id}">Удалить</button></label>`;
    }).join("");
    $("#manager-list").innerHTML = list || '<p class="muted">Пользовательских сценариев нет.</p>';
    $("#manager-delete-selected").disabled = true;
    $("#manager-delete-all").disabled = !customs.length;
    document.querySelectorAll("[data-manager-select]").forEach((input) => (input.onchange = () => {
      $("#manager-delete-selected").disabled = !document.querySelector("[data-manager-select]:checked");
    }));
    document.querySelectorAll("[data-manager-delete]").forEach((btn) => (btn.onclick = () => deleteScenarios([btn.dataset.managerDelete])));
  }

  function deleteScenarios(ids) {
    const remove = new Set(ids.filter(isCustom));
    if (!remove.size) return;
    const names = customs.filter((c) => remove.has(c.id)).map((c) => c.name);
    customs = customs.filter((c) => !remove.has(c.id));
    remove.forEach((id) => {
      horizonResults.delete(id);
      results.delete(id);
    });
    if (remove.has(active)) {
      active = M.previousSopId;
      orderPlan = null;
      orderSelected.clear();
    }
    if (remove.has(a)) a = "base";
    if (remove.has(b)) b = M.previousSopId;
    saveCustoms();
    renderScenarioManager();
    render();
    toast(`Удалено сценариев: ${names.length} · ${names.map((n) => `«${n}»`).join(", ")}`);
  }

  $("#delete-scenarios").onclick = () => {
    renderScenarioManager();
    $("#scenario-manager").showModal();
  };
  $("#manager-close").onclick = () => $("#scenario-manager").close();
  $("#manager-close-x").onclick = () => $("#scenario-manager").close();
  $("#manager-delete-selected").onclick = () =>
    deleteScenarios([...document.querySelectorAll("[data-manager-select]:checked")].map((input) => input.value));
  $("#manager-delete-all").onclick = () => deleteScenarios(customs.map((c) => c.id));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && expandedPanel) closeExpandedPanel();
  });
  document.addEventListener("click", (e) => {
    /* Клик, завершающий перетаскивание полосы, не должен закрывать
       развёрнутую диаграмму: после mouseup DOM уже перерисован. */
    if (Date.now() - ganttDragEndedAt < 350) return;
    /* Кнопка могла перерисовать раздел и стать отсоединённой от DOM —
       это клик внутри панели, а не клик мимо неё. */
    if (!e.target.isConnected) return;
    if (
      expandedPanel &&
      !e.target.closest(".panel.is-expanded") &&
      !e.target.closest("[data-expand-panel]") &&
      /* фильтры шапки не закрывают развёрнутую диаграмму: можно менять
         период и сразу видеть результат на большом Ганте */
      !e.target.closest("header") &&
      !e.target.closest(".toolbar")
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
        { Поле: "Портфель заказов", Значение: `${O.orders.length} заказов (${O.shippedOrders.length} отгружено, ${O.openOrders.length} в работе) · ATP на ${orderDate(O.AS_OF)} · горизонт октябрь–декабрь 2026 независимо от выбранного года` },
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
          Себестоимость_продаж_руб: x.costOfSales,
          Валовая_прибыль_руб: x.grossProfit,
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
      const exportOrders = currentOrderPlan();
      add("Портфель заказов", exportOrders.results.map((x) => ({
        Заказ: x.orderId,
        Клиент: x.customer,
        Сегмент: x.segment,
        Продукт: x.productName,
        Количество_т: x.qty,
        Поставлено_т: x.deliveredQty,
        Требуемая_дата: x.requestedDate,
        Запас_доступен: x.stockStatus,
        Склад: x.sourceNode,
        Дата_производства: x.productionDate,
        Дата_отгрузки: x.shipDate,
        Дата_поставки: x.deliveryDate,
        Отклонение_дн: x.lateDays,
        В_срок: x.onTime ? "да" : "нет",
        В_полном_объеме: x.inFull ? "да" : "нет",
        OTIF: x.otif ? "OTIF" : "Not OTIF",
        Сверх_квоты_т: x.overQuota || 0,
        Статус: x.status,
      })));
      add("Производство заказов", O.productionSchedule(exportOrders.results));
      add("Отгрузки заказов", [...exportOrders.results].sort((a, b) => a.shipDate.localeCompare(b.shipDate)).map((x) => ({
        Дата_отгрузки: x.shipDate,
        Дата_поставки: x.deliveryDate,
        Заказ: x.orderId,
        Клиент: x.customer,
        Продукт: x.productName,
        Количество_т: x.deliveredQty,
        Склад: x.sourceNode,
        Статус: x.shipped ? "Отгружено" : "План",
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
  $("#scenario-name").value = suggestedName();
  refreshEditorAction();
  render();
})();
