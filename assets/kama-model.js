/* Autonomous, deterministic S&OP demonstration. Public facts and synthetic assumptions are separated in docs. */
(function (root) {
  "use strict";
  const months = [
    "Янв",
    "Фев",
    "Мар",
    "Апр",
    "Май",
    "Июн",
    "Июл",
    "Авг",
    "Сен",
    "Окт",
    "Ноя",
    "Дек",
  ];
  const products = [
    ["bright", "КАМА Bright GC1", "Картон", 190, 220, 89000, 57000, 49000],
    ["strong", "КАМА Strong GC2", "Картон", 250, 300, 82000, 53000, 65000],
    ["project", "КАМА Project GC2", "Картон", 250, 300, 79000, 51500, 44000],
    ["pharma", "КАМА Pharma GC1", "Картон", 250, 300, 98000, 60500, 38000],
    [
      "tobacco1",
      "Tobacco Premium GC1",
      "Картон",
      210,
      230,
      103000,
      64000,
      28000,
    ],
    [
      "tobacco2",
      "Tobacco Premium GC2",
      "Картон",
      210,
      230,
      94000,
      58500,
      25000,
    ],
    [
      "lwc",
      "LWC Урал Брайт · глянцевая",
      "Бумага",
      60,
      80,
      79000,
      53500,
      27000,
    ],
    [
      "satin",
      "LWC Урал Брайт · полуглянцевая",
      "Бумага",
      60,
      80,
      81500,
      55000,
      18000,
    ],
    [
      "medical",
      "Офсетная для мед. инструкций",
      "Бумага",
      45,
      50,
      85000,
      56500,
      10000,
    ],
    ["offset", "Офсетная+", "Бумага", 65, 80, 69000, 48000, 19000],
    ["bulk", "Офсетная пухлая+", "Бумага", 60, 70, 73500, 49500, 11000],
    ["sc", "Суперкаландрированная", "Бумага", 56, 60, 71000, 49000, 9000],
  ].map(([id, name, family, g1, g2, price, cost, annual], i) => ({
    id,
    name,
    family,
    grams: [g1, g2],
    price,
    cost,
    annual,
    machine: i < 6 ? "КДМ-9" : "БДМ-7",
    widths: i < 6 ? [700, 900, 1000] : [630, 840, 1050],
    deckle: i < 6 ? 3600 : 4200,
    rate: i < 6 ? 34 : 13.5,
    fiber: i < 6 ? 0.79 : 0.84,
    coat: i < 6 ? 0.15 : i < 8 ? 0.09 : 0.015,
    energy: i < 6 ? 1.1 : 1.25,
  }));
  const skus = products.flatMap((p) =>
    p.grams.flatMap((gram, g) =>
      p.widths.map((width, w) => ({
        id: `${p.id}-${gram}-${width}`,
        product: p.id,
        name: p.name,
        family: p.family,
        gram,
        width,
        g,
        w,
        share: [0.42, 0.33, 0.25][w] * [0.58, 0.42][g],
      })),
    ),
  );
  const nodes = [
    {
      id: "plant",
      name: "Склад готовой продукции · Краснокамск",
      cap: 16000,
      share: 0.55,
      freight: 0,
      last: 1650,
      days: 0,
    },
    {
      id: "center",
      name: "РЦ Москва",
      cap: 4200,
      share: 0.28,
      freight: 2400,
      last: 950,
      days: 4,
    },
    {
      id: "volga",
      name: "РЦ Казань",
      cap: 3000,
      share: 0.17,
      freight: 1550,
      last: 1050,
      days: 3,
    },
  ];
  const segments = [
    "Фармацевтическая упаковка",
    "Пищевая упаковка",
    "Косметика и бытовая химия",
    "Табачная упаковка",
    "Издательства и типографии",
    "Дистрибьюторы",
  ];
  const clientNames = [
    "Комус",
    "Логика",
    "Папирус",
    "Офсет Принт",
    "Гознак",
    "Печатный двор",
    "Типография Парето",
    "Полиграфкомбинат",
    "Гофромир",
    "УпакСервис",
    "ТараПак",
    "КартонПром",
    "Экопак",
    "Пакетти",
    "ФлексоПак",
    "Медиапак",
    "РегионКнига",
    "Издательский дом",
    "Книжный союз",
    "Пресса России",
    "Бумага-Трейд",
    "СнабКомплект",
    "УралСнаб",
    "ВолгаТрейд",
  ];
  const clients = Array.from({ length: 24 }, (_, i) => ({
    id: `C-${String(i + 1).padStart(2, "0")}`,
    name: clientNames[i],
    segment: segments[Math.floor(i / 4)],
    node: nodes[i % 3].id,
    weight: 1 + (i % 4) * 0.15,
  }));
  const scenarios = [
    {
      id: "base",
      name: "V1 · Базовый план",
      short: "Базовый",
      desc: "Продуктовый порядок, обычный страховой запас.",
      target: 0.2,
      priority: "base",
      setup: 1,
      cost: 1,
      extra: 0,
    },
    {
      id: "margin",
      name: "V2 · Приоритет маржинального дохода",
      short: "Маржа",
      desc: "Первый проход — целевое покрытие 65%, затем более доходные группы; выполнение минимума проверяется по результату.",
      target: 0.12,
      priority: "margin",
      setup: 1,
      cost: 1,
      extra: 0,
    },
    {
      id: "service",
      name: "V3 · Приоритет сервиса",
      short: "Сервис",
      desc: "Больше страхового запаса, приоритет покрытия спроса.",
      target: 0.48,
      priority: "service",
      setup: 1,
      cost: 1,
      extra: 0,
    },
    {
      id: "stress",
      stress: true,
      name: "V4 · Ремонт и ресурсный стресс",
      short: "Стресс",
      desc: "Дополнительные 144 ч ремонта КДМ-9 в мае, сырьё дороже на 12%, поставки волокна −8%.",
      target: 0.2,
      priority: "base",
      setup: 1,
      cost: 1.12,
      extra: 144,
    },
    {
      id: "balanced",
      name: "V5 · Сбалансированный план",
      short: "Баланс",
      desc: "Группировка кампаний, запас перед ремонтом, приоритет обязательств.",
      target: 0.3,
      priority: "balanced",
      setup: 0.72,
      cost: 1,
      extra: 0,
    },
  ];
  const sum = (a, k) =>
    a.reduce(
      (s, r, i) => s + (typeof k === "function" ? k(r, i) : r[k] || 0),
      0,
    );
  function demand(s, m, scale = 1, seasonalityStrength = 1) {
    const p = products.find((p) => p.id === s.product);
    const seasonal =
      p.family === "Картон"
        ? [0.87, 0.9, 0.99, 0.96, 0.98, 1, 1.02, 1.08, 1.13, 1.15, 1.06, 0.86]
        : [
            0.88, 0.91, 0.97, 1.02, 0.98, 0.87, 0.91, 1.12, 1.17, 1.16, 1.12,
            0.89,
          ];
    const monthIndex = ((m % 12) + 12) % 12;
    const average = sum(seasonal, (x) => x) / 12;
    const normalized = seasonal[monthIndex] / average;
    const adjusted = 1 + (normalized - 1) * seasonalityStrength;
    return ((p.annual * s.share) / 12) * adjusted * scale;
  }
  function patterns(widths, deckle) {
    const out = [];
    for (let a = 0; a <= Math.floor(deckle / widths[0]); a++)
      for (let b = 0; b <= Math.floor(deckle / widths[1]); b++)
        for (let c = 0; c <= Math.floor(deckle / widths[2]); c++) {
          const used = a * widths[0] + b * widths[1] + c * widths[2];
          if (used > 0 && used <= deckle)
            out.push({ counts: [a, b, c], used, trim: 1 - used / deckle });
        }
    return out;
  }
  const patternMap = Object.fromEntries(
    products.map((p) => [p.id, patterns(p.widths, p.deckle)]),
  );
  function run(config, overrides = {}) {
    const cfg = { ...config, ...overrides };
    const year = Number(cfg.year) || 2026;
    const initialStock = cfg.initialStock;
    delete cfg.initialStock;
    const bounded = (value, fallback, min, max) => {
      const number = Number(value);
      return Math.max(
        min,
        Math.min(max, Number.isFinite(number) ? number : fallback),
      );
    };
    cfg.demandScale = bounded(cfg.demandScale, 1, 0.75, 1.25);
    cfg.forecastGrowth = bounded(cfg.forecastGrowth, 0, -0.1, 0.2);
    cfg.extra = bounded(cfg.extra, 0, 0, 240);
    cfg.extraBdm = bounded(cfg.extraBdm, 0, 0, 240);
    cfg.cost = bounded(cfg.cost, 1, 0.8, 1.5);

    /* A custom scenario can be effective only for part of the forecast. Outside
       that window we read the copied base version, not a neutral/global default. */
    const hasPeriod =
      Number.isFinite(Number(cfg.periodFrom)) &&
      Number.isFinite(Number(cfg.periodTo));
    const inPeriod = (m) => {
      if (!hasPeriod) return true;
      const absolute = (year - 2026) * 12 + m;
      return (
        absolute >= Number(cfg.periodFrom) && absolute <= Number(cfg.periodTo)
      );
    };
    const readParam = (source, name, fallback, linked) =>
      source[name] ?? (linked ? source[linked] : undefined) ?? fallback;
    const param = (name, fallback = 1, m = 0, linked = "") =>
      Number(readParam(inPeriod(m) ? cfg : config, name, fallback, linked));
    const choice = (name, fallback, m = 0) =>
      String(readParam(inPeriod(m) ? cfg : config, name, fallback));
    const demandFor = (s, m) => {
      const growth = year === 2027 ? 1 + param("forecastGrowth", 0, m) : 1;
      return demand(
        s,
        m,
        param("demandScale", 1, m) * growth,
        param("seasonality", 1, m),
      );
    };

    const rows = [],
      campaigns = [],
      cuts = [],
      capacities = [],
      ledgers = [],
      resources = [],
      utilities = [],
      customerRows = [];
    const stock = {};
    for (const s of skus)
      stock[s.id] = initialStock?.[s.id]
        ? [...initialStock[s.id]]
        : nodes.map(
            (n) =>
              demandFor(s, 0) *
              0.32 *
              { plant: 0.65, center: 0.22, volga: 0.13 }[n.id],
          );
    const initial = sum(Object.values(stock), (a) => sum(a, (x) => x));
    const previous = {};
    for (let m = 0; m < 12; m++) {
      const start = Object.fromEntries(
        skus.map((s) => [s.id, [...stock[s.id]]]),
      );
      const made = Object.fromEntries(skus.map((s) => [s.id, 0]));
      const available = {
        fiber:
          (m === 4 ? 24400 : 26700) *
          (cfg.stress ? 0.92 : 1) *
          param("fiberSupply", 1, m),
        coat: 4100 * param("coatSupply", 1, m),
        energy: 38200 * param("energySupply", 1, m),
        water: 720000 * param("waterSupply", 1, m),
      };
      const used = { fiber: 0, coat: 0, energy: 0, water: 0 };
      const intensity = {
        fiber: param("fiberIntensity", 1, m),
        coat: param("coatIntensity", 1, m),
        energy: param("energyIntensity", 1, m),
        water: param("waterIntensity", 1, m),
      };
      for (const machine of ["КДМ-9", "БДМ-7"]) {
        const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
        const repairMonth = Number(cfg.repairMonth ?? 4);
        const repairMonthBdm = Number(cfg.repairMonthBdm ?? 6);
        const repair =
          (machine === "КДМ-9" ? (m === 4 ? 120 : 20) : m === 6 ? 72 : 16) +
          (machine === "КДМ-9" && m === repairMonth
            ? param("extra", 0, m)
            : 0) +
          (machine === "БДМ-7" && m === repairMonthBdm
            ? param("extraBdm", 0, m)
            : 0);
        const hours = Math.max(24, days * 24 - repair);
        let elapsed = 0,
          setupTotal = 0,
          runTotal = 0;
        let jobs = products
          .filter((p) => p.machine === machine)
          .flatMap((p) => p.grams.map((gram) => ({ p, gram })));
        const priority = choice("priority", "base", m);
        if (priority === "margin")
          jobs.sort(
            (a, b) =>
              (b.p.price - b.p.cost) * b.p.rate -
              (a.p.price - a.p.cost) * a.p.rate,
          );
        if (priority === "service")
          jobs.sort((a, b) =>
            a.p.id === "pharma"
              ? -1
              : b.p.id === "pharma"
                ? 1
                : a.gram - b.gram,
          );
        if (priority === "balanced")
          jobs.sort((a, b) => a.p.id.localeCompare(b.p.id) || a.gram - b.gram);
        // Minimum commitment pass prevents a high-margin mix from consuming the entire machine.
        const passes = priority === "margin" ? [0.65, 1] : [1];
        for (const pass of passes)
          for (const { p, gram } of jobs) {
            const ss = skus.filter(
              (s) => s.product === p.id && s.gram === gram,
            );
            const need = ss.map((s) => {
              const d = demandFor(s, m);
              const target =
                param("target", 0.2, m) +
                (priority === "balanced" &&
                ((machine === "КДМ-9" && m === 3) ||
                  (machine === "БДМ-7" && m === 5))
                  ? 0.3
                  : 0);
              return Math.max(
                0,
                d * pass +
                  (pass === 1
                    ? demandFor(s, Math.min(11, m + 1)) * target
                    : 0) -
                  sum(stock[s.id], (x) => x) -
                  made[s.id],
              );
            });
            const minCampaign = Math.max(2, param("minCampaign", 8, m));
            if (sum(need, (x) => x) < minCampaign) continue;
            const prev = previous[machine];
            const setup =
              (prev
                ? (prev.product !== p.id ? 4.5 : 1.5) +
                  Math.abs(prev.gram - gram) * 0.025
                : 4) *
              Number(cfg.setup ?? 1) *
              param("setupScale", 1, m);
            if (elapsed + setup + 1 > hours) continue;
            const begin = elapsed;
            let grossTotal = 0,
              goodTotal = 0,
              trimTotal = 0;
            const campaignCuts = [];
            const capacityLeft = hours - elapsed - setup;
            const rateFactor = param(
              machine === "КДМ-9" ? "kdmRate" : "bdmRate",
              1,
              m,
            );
            const rate = p.rate * rateFactor * (gram / p.grams[0]) ** 0.12;
            const yieldFactor = param(
              machine === "КДМ-9" ? "kdmYield" : "bdmYield",
              1,
              m,
            );
            const quality = Math.min(
              0.995,
              (p.family === "Картон" ? 0.985 : 0.98) * yieldFactor,
            );
            for (
              let iteration = 0;
              iteration < 150 && sum(need, (x) => x) > minCampaign;
              iteration++
            ) {
              let best = null,
                bestScore = -1;
              for (const pattern of patternMap[p.id]) {
                const outputs = pattern.counts.map(
                  (n, i) => ((n * p.widths[i]) / p.deckle) * quality,
                );
                const gross = Math.min(
                  100,
                  (capacityLeft - grossTotal / rate) * rate,
                  (available.fiber - used.fiber) / (p.fiber * intensity.fiber),
                  (available.coat - used.coat) / (p.coat * intensity.coat),
                  (available.energy - used.energy) /
                    (p.energy * intensity.energy),
                  (available.water - used.water) / (18 * intensity.water),
                );
                if (gross < 2) continue;
                const useful = sum(outputs, (f, i) =>
                  Math.min(need[i], f * gross),
                );
                const excess = sum(outputs, (f, i) =>
                  Math.max(0, f * gross - need[i]),
                );
                const score =
                  (useful - excess * 0.85) / gross - pattern.trim * 0.12;
                if (score > bestScore) {
                  bestScore = score;
                  best = { pattern, outputs, gross };
                }
              }
              if (!best || bestScore < 0.25) break;
              const { pattern, outputs } = best;
              let gross = best.gross;
              const ratios = outputs.map((f, i) =>
                f > 0 && need[i] > 0 ? need[i] / f : 0,
              );
              gross = Math.min(gross, Math.max(...ratios));
              if (gross < 2) break;
              outputs.forEach((f, i) => {
                made[ss[i].id] += gross * f;
                need[i] = Math.max(0, need[i] - gross * f);
              });
              const good = sum(outputs, (x) => x) * gross;
              const trim = gross * pattern.trim;
              grossTotal += gross;
              goodTotal += good;
              trimTotal += trim;
              used.fiber += gross * p.fiber * intensity.fiber;
              used.coat += gross * p.coat * intensity.coat;
              used.energy += gross * p.energy * intensity.energy;
              used.water += gross * 18 * intensity.water;
              campaignCuts.push({
                month: m,
                machine,
                product: p.id,
                gram,
                pattern: pattern.counts
                  .map((n, i) => (n ? `${n}×${p.widths[i]}` : ""))
                  .filter(Boolean)
                  .join(" + "),
                deckle: p.deckle,
                used: pattern.used,
                trim: pattern.trim,
                gross,
                good,
                qualityLoss: gross - trim - good,
                fiber: gross * p.fiber * intensity.fiber,
                coat: gross * p.coat * intensity.coat,
                energy: gross * p.energy * intensity.energy,
                water: gross * 18 * intensity.water,
              });
            }
            if (grossTotal) {
              const id = `${m + 1}-${machine}-${campaigns.length + 1}`;
              elapsed += setup + grossTotal / rate;
              setupTotal += setup;
              runTotal += grossTotal / rate;
              previous[machine] = { product: p.id, gram };
              campaigns.push({
                id,
                month: m,
                machine,
                product: p.id,
                gram,
                start: begin,
                end: elapsed,
                setup,
                run: grossTotal / rate,
                gross: grossTotal,
                good: goodTotal,
                trim: trimTotal,
                fiber: sum(campaignCuts, "fiber"),
                coat: sum(campaignCuts, "coat"),
                energy: sum(campaignCuts, "energy"),
                water: sum(campaignCuts, "water"),
              });
              cuts.push(...campaignCuts.map((c) => ({ ...c, campaign: id })));
            }
          }
        capacities.push({
          month: m,
          machine,
          calendar: days * 24,
          repair,
          available: hours,
          setup: setupTotal,
          run: runTotal,
          used: elapsed,
          load: elapsed / hours,
        });
      }
      resources.push(
        ...["fiber", "coat", "energy"].map((id) => ({
          month: m,
          id,
          available: available[id],
          used: used[id],
        })),
      );
      utilities.push({
        month: m,
        id: "water",
        available: available.water,
        used: used.water,
      });
      for (const s of skus) {
        const p = products.find((p) => p.id === s.product),
          d = demandFor(s, m),
          st = stock[s.id];
        st[0] += made[s.id];
        const transfers = [0, 0, 0],
          sales = [0, 0, 0];
        // Dispatch direct orders first; regional replenishment is same-month (3–4 day transit).
        sales[0] = Math.min(st[0], d * nodes[0].share);
        st[0] -= sales[0];
        for (let n = 1; n < 3; n++) {
          const target = d * nodes[n].share * param("target", 0.2, m);
          const maxNodeRoom = Math.max(
            0,
            nodes[n].cap * param("storageCap", 1, m) -
              sum(skus, (t) => stock[t.id][n]),
          );
          const req = Math.max(0, d * nodes[n].share + target - st[n]);
          const move = Math.min(st[0], req, maxNodeRoom);
          st[0] -= move;
          st[n] += move;
          transfers[n] = move;
          sales[n] = Math.min(st[n], d * nodes[n].share);
          st[n] -= sales[n];
        }
        const shipped = sum(sales, (x) => x),
          price = p.price * (1 + m * 0.002) * param("priceScale", 1, m);
        const fiberIndex = param("cost", 1, m);
        const coatIndex = param("coatCost", 1, m, "cost");
        const energyIndex = param("energyTariff", 1, m) * intensity.energy;
        const waterIndex = param("waterTariff", 1, m) * intensity.water;
        const costParts = {
          fiber: p.cost * 0.45 * fiberIndex * intensity.fiber,
          coat: p.cost * 0.2 * coatIndex * intensity.coat,
          energy: p.cost * 0.1 * energyIndex,
          water: p.cost * 0.03 * waterIndex,
          conversion: p.cost * 0.22,
        };
        const unitCost = sum(Object.values(costParts), (x) => x);
        const logistics = sum(
          nodes,
          (n, i) =>
            sales[i] * n.last * param("lastMileCost", 1, m) +
            transfers[i] * n.freight * param("freightCost", 1, m),
        );
        const holding =
          sum(
            nodes,
            (n, i) => ((start[s.id][i] + st[i]) / 2) * (i ? 680 : 420),
          ) * param("holdingCost", 1, m);
        const revenue = shipped * price,
          variable = shipped * unitCost;
        rows.push({
          month: m,
          sku: s.id,
          product: p.id,
          family: p.family,
          demand: d,
          production: made[s.id],
          sales: shipped,
          gap: d - shipped,
          start: sum(start[s.id], (x) => x),
          end: sum(st, (x) => x),
          target: d * param("target", 0.2, m),
          revenue,
          variable,
          fiberCost: shipped * costParts.fiber,
          coatCost: shipped * costParts.coat,
          energyCost: shipped * costParts.energy,
          waterCost: shipped * costParts.water,
          conversionCost: shipped * costParts.conversion,
          logistics,
          holding,
          margin: revenue - variable - logistics - holding,
          price,
          unitCost,
        });
        nodes.forEach((n, i) =>
          ledgers.push({
            month: m,
            sku: s.id,
            node: n.id,
            capacity: n.cap * (i === 0 ? 1 : param("storageCap", 1, m)),
            start: start[s.id][i],
            production: i === 0 ? made[s.id] : 0,
            inbound: i ? transfers[i] : 0,
            outbound: i === 0 ? sum(transfers, (x) => x) : 0,
            sales: sales[i],
            freightCost: i
              ? transfers[i] * n.freight * param("freightCost", 1, m)
              : 0,
            lastMileCost: sales[i] * n.last * param("lastMileCost", 1, m),
            logistics:
              (i ? transfers[i] * n.freight * param("freightCost", 1, m) : 0) +
              sales[i] * n.last * param("lastMileCost", 1, m),
            end: st[i],
          }),
        );
        const segment =
          p.id === "pharma" || p.id === "medical"
            ? 0
            : p.id.startsWith("tobacco")
              ? 3
              : p.family === "Бумага"
                ? 4
                : p.id === "bright"
                  ? 2
                  : 1;
        for (let n = 0; n < 3; n++) {
          const buyers = clients.filter(
            (c) =>
              c.node === nodes[n].id &&
              (c.segment === segments[segment] || c.segment === segments[5]),
          );
          const totalWeight = sum(buyers, "weight");
          buyers.forEach((c) =>
            customerRows.push({
              month: m,
              client: c.id,
              sku: s.id,
              node: c.node,
              demand: (d * nodes[n].share * c.weight) / totalWeight,
              sales: (sales[n] * c.weight) / totalWeight,
            }),
          );
        }
      }
    }
    const total = {
      demand: sum(rows, "demand"),
      sales: sum(rows, "sales"),
      production: sum(rows, "production"),
      revenue: sum(rows, "revenue"),
      margin: sum(rows, "margin"),
      variable: sum(rows, "variable"),
      logistics: sum(rows, "logistics"),
      holding: sum(rows, "holding"),
      gap: sum(rows, "gap"),
      initial,
      end: sum(
        rows.filter((r) => r.month === 11),
        "end",
      ),
      trim: sum(cuts, (c) => c.gross * c.trim),
      gross: sum(campaigns, "gross"),
    };
    total.coverage = total.sales / total.demand;
    const result = {
      config: cfg,
      year,
      rows,
      campaigns,
      cuts,
      capacities,
      ledgers,
      resources,
      utilities,
      customerRows,
      total,
    };
    result.checks = validate(result);
    return result;
  }
  function totalFor(rows, campaigns, cuts, initial, endMonth) {
    const total = {
      demand: sum(rows, "demand"),
      sales: sum(rows, "sales"),
      production: sum(rows, "production"),
      revenue: sum(rows, "revenue"),
      margin: sum(rows, "margin"),
      variable: sum(rows, "variable"),
      logistics: sum(rows, "logistics"),
      holding: sum(rows, "holding"),
      gap: sum(rows, "gap"),
      initial,
      end: sum(
        rows.filter((r) => r.month === endMonth),
        "end",
      ),
      trim: sum(cuts, (c) => c.gross * c.trim),
      gross: sum(campaigns, "gross"),
    };
    total.coverage = total.demand ? total.sales / total.demand : 0;
    return total;
  }

  let actual2026Cache = null;
  const horizonArrays = [
    "rows",
    "campaigns",
    "cuts",
    "capacities",
    "ledgers",
    "resources",
    "utilities",
    "customerRows",
  ];

  /* 2026 is a shared actual/rolling-estimate baseline. Scenario levers rebuild
     only the 2027 forecast, so changing a plan never rewrites reported actuals. */
  function runHorizon(config, overrides = {}) {
    if (!actual2026Cache) {
      actual2026Cache = run(
        scenarios.find((c) => c.id === "balanced"),
        { year: 2026 },
      );
    }
    const actual = actual2026Cache;
    const initialStock = {};
    for (const s of skus) {
      initialStock[s.id] = nodes.map(
        (n) =>
          actual.ledgers.find(
            (l) => l.month === 11 && l.sku === s.id && l.node === n.id,
          ).end,
      );
    }
    const forecast = run(config, { ...overrides, year: 2027, initialStock });
    const combineYear = (source, year, offset) => {
      const output = {};
      for (const key of horizonArrays) {
        output[key] = (source[key] || []).map((row) => {
          const clone = {
            ...row,
            month: row.month + offset,
            year,
            dataType:
              year === 2027
                ? "forecast"
                : row.month < 9
                  ? "actual"
                  : "estimate",
          };
          if (key === "campaigns") clone.id = `${year}-${row.id}`;
          if (key === "cuts") clone.campaign = `${year}-${row.campaign}`;
          return clone;
        });
      }
      return output;
    };
    const actualPart = combineYear(actual, 2026, 0);
    const forecastPart = combineYear(forecast, 2027, 12);
    const result = {
      config: { ...forecast.config },
      years: [2026, 2027],
      annual: { 2026: actual.total, 2027: forecast.total },
    };
    for (const key of horizonArrays)
      result[key] = [...actualPart[key], ...forecastPart[key]];
    result.total = totalFor(
      result.rows,
      result.campaigns,
      result.cuts,
      actual.total.initial,
      23,
    );
    result.checks = validate(result);
    result.checks.push({
      name: "Переход запасов 2026 → 2027",
      ok: skus.every((s) =>
        nodes.every((n) => {
          const end = result.ledgers.find(
            (l) => l.month === 11 && l.sku === s.id && l.node === n.id,
          ).end;
          const start = result.ledgers.find(
            (l) => l.month === 12 && l.sku === s.id && l.node === n.id,
          ).start;
          return Math.abs(end - start) < 1e-6;
        }),
      ),
    });
    return result;
  }

  function forYear(source, year) {
    const offset = year === 2027 ? 12 : 0;
    const result = {
      config: source.config,
      year,
      annual: source.annual,
    };
    for (const key of horizonArrays) {
      result[key] = (source[key] || [])
        .filter((row) => row.month >= offset && row.month < offset + 12)
        .map((row) => ({ ...row, month: row.month - offset }));
    }
    result.total =
      source.annual?.[year] ||
      totalFor(result.rows, result.campaigns, result.cuts, 0, 11);
    result.checks = validate(result);
    return result;
  }

  function validate(r) {
    const tol = 1e-6;
    return [
      [
        "Баланс каждого SKU / склада / месяца",
        r.ledgers.every(
          (l) =>
            Math.abs(
              l.start + l.production + l.inbound - l.outbound - l.sales - l.end,
            ) < tol,
        ),
      ],
      [
        "Годный выпуск кампаний сходится с планом SKU",
        Math.abs(sum(r.campaigns, "good") - r.total.production) < tol,
      ],
      [
        "Межскладские приход и расход сходятся",
        Math.abs(sum(r.ledgers, "inbound") - sum(r.ledgers, "outbound")) < tol,
      ],
      ["Неотрицательные остатки", r.ledgers.every((l) => l.end >= -tol)],
      [
        "Часы кампаний не превышают доступные",
        r.capacities.every((c) => c.used <= c.available + tol),
      ],
      [
        "Раскрой не превышает ширину полотна",
        r.cuts.every((c) => c.used <= c.deckle),
      ],
      [
        "Баланс массы: годный выпуск + обрезь + брак",
        Math.abs(
          sum(r.cuts, (c) => c.good + c.gross * c.trim + c.qualityLoss) -
            r.total.gross,
        ) < tol,
      ],
      [
        "Сырьё, вода и энергия в пределах лимита",
        [...r.resources, ...(r.utilities || [])].every(
          (x) => x.used <= x.available + tol,
        ),
      ],
      [
        "Отгрузки не превышают спрос",
        r.rows.every((x) => x.sales <= x.demand + tol),
      ],
      [
        "Клиентские отгрузки сходятся с итогом",
        Math.abs(sum(r.customerRows, "sales") - r.total.sales) < tol,
      ],
      [
        "Логистика складских проводок сходится с планом",
        Math.abs(sum(r.ledgers, "logistics") - sum(r.rows, "logistics")) < 1e-5,
      ],
      [
        "Финансовый баланс",
        r.rows.every(
          (x) =>
            Math.abs(
              x.revenue - x.variable - x.logistics - x.holding - x.margin,
            ) < tol,
        ),
      ],
      [
        "Баланс сети за год",
        Math.abs(
          r.total.initial + r.total.production - r.total.sales - r.total.end,
        ) < tol,
      ],
      [
        "Ёмкости складов",
        nodes.every((n) =>
          [...new Set(r.ledgers.map((l) => l.month))].every((m) => {
            const rows = r.ledgers.filter(
              (l) => l.node === n.id && l.month === m,
            );
            return sum(rows, "end") <= (rows[0]?.capacity ?? n.cap) + tol;
          }),
        ),
      ],
    ].map(([name, ok]) => ({ name, ok }));
  }
  const api = {
    months,
    products,
    skus,
    nodes,
    clients,
    segments,
    scenarios,
    sum,
    demand,
    patterns,
    run,
    runHorizon,
    forYear,
    validate,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KamaModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
