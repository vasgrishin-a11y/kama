/* Connected analytical datasets for resources and the extended logistics network. */
(function (root) {
  "use strict";
  const sum = (rows, key) =>
    rows.reduce(
      (total, row) =>
        total + (typeof key === "function" ? key(row) : Number(row[key]) || 0),
      0,
    );
  const suppliers = [
    { id: "north-fiber", name: "Северное волокно", resource: "fiber", resourceName: "Волокнистое сырьё", share: 0.42, price: 34800, freight: 1450, lead: 4 },
    { id: "perm-pulp", name: "Пермь Целлюлоза", resource: "fiber", resourceName: "Волокнистое сырьё", share: 0.35, price: 35200, freight: 1100, lead: 2 },
    { id: "kama-les", name: "Кама Лес", resource: "fiber", resourceName: "Волокнистое сырьё", share: 0.23, price: 33900, freight: 850, lead: 2 },
    { id: "ural-pigment", name: "Урал Пигмент", resource: "coat", resourceName: "Компоненты мелования", share: 0.46, price: 51400, freight: 1350, lead: 3 },
    { id: "kazan-kaolin", name: "Казань Каолин", resource: "coat", resourceName: "Компоненты мелования", share: 0.34, price: 49800, freight: 1200, lead: 3 },
    { id: "him-complect", name: "ХимКомплект", resource: "coat", resourceName: "Компоненты мелования", share: 0.2, price: 53600, freight: 1650, lead: 5 },
  ];
  const resourceMeta = {
    fiber: { name: "Волокнистое сырьё", unit: "т абс. сух.", scale: 1, tariff: 35000, color: "#4769ff" },
    coat: { name: "Компоненты мелования", unit: "т", scale: 1, tariff: 51000, color: "#19a27b" },
    energy: { name: "Электроэнергия", unit: "МВт·ч", scale: 1, tariff: 5400, color: "#ff8c00" },
    water: { name: "Оборотная вода", unit: "м³", scale: 1, tariff: 42, color: "#38a3c7" },
  };

  function movementData(M, r, customers) {
    const productBySku = new Map(M.skus.map((s) => [s.id, s.product]));
    const products = new Map(M.products.map((p) => [p.id, p]));
    const nodes = new Map(M.nodes.map((n) => [n.id, n]));
    const supplierFlows = [];
    for (const resource of r.resources.filter((x) => x.id === "fiber" || x.id === "coat")) {
      for (const supplier of suppliers.filter((s) => s.resource === resource.id)) {
        const qty = resource.used * supplier.share;
        supplierFlows.push({
          category: "Поставка сырья",
          month: resource.month,
          year: resource.year || r.year,
          from: supplier.name,
          to: "Завод КАМА · Краснокамск",
          supplier: supplier.name,
          resource: resource.id,
          item: supplier.resourceName,
          product: null,
          node: "plant",
          qty,
          cost: qty * (supplier.price + supplier.freight),
          transportCost: qty * supplier.freight,
          handlingCost: qty * 180,
          lead: supplier.lead,
        });
      }
    }

    const internalFlows = [];
    for (let month = 0; month < 12; month++) {
      const campaigns = r.campaigns.filter((c) => c.month === month);
      const fiber = sum(campaigns, "fiber");
      const coat = sum(campaigns, "coat");
      const rawQty = fiber + coat;
      if (rawQty)
        internalFlows.push({ category: "Внутризаводское", stage: "Сырьё → массоподготовка", month, year: r.year, from: "Склад сырья", to: "Массоподготовка", item: "Волокно и мелование", qty: rawQty, cost: rawQty * 520, transportCost: rawQty * 180, handlingCost: rawQty * 340, lead: 0.25 });
      for (const machine of ["КДМ-9", "БДМ-7"]) {
        const machineRows = campaigns.filter((c) => c.machine === machine);
        const gross = sum(machineRows, "gross");
        const good = sum(machineRows, "good");
        if (gross)
          internalFlows.push({ category: "Внутризаводское", stage: `Массоподготовка → ${machine}`, month, year: r.year, from: "Массоподготовка", to: machine, item: machine === "КДМ-9" ? "Картонная масса" : "Бумажная масса", product: null, qty: gross, cost: gross * 780, transportCost: gross * 260, handlingCost: gross * 520, lead: 0.5 });
        if (good)
          internalFlows.push({ category: "Внутризаводское", stage: `${machine} → отделка`, month, year: r.year, from: machine, to: machine === "КДМ-9" ? "ПРС-1" : "ПРС-2", item: "Полотно на размотку", product: null, qty: good, cost: good * 610, transportCost: good * 210, handlingCost: good * 400, lead: 0.5 });
      }
      const good = sum(campaigns, "good");
      if (good)
        internalFlows.push({ category: "Внутризаводское", stage: "Отделка → склад ГП", month, year: r.year, from: "ПРС-1 / ПРС-2 / УП-1", to: "Склад ГП · Краснокамск", item: "Готовая продукция", product: null, qty: good, cost: good * 430, transportCost: good * 130, handlingCost: good * 300, lead: 0.25 });
    }

    const rcMap = new Map();
    for (const ledger of r.ledgers.filter((l) => l.inbound > 0)) {
      const product = productBySku.get(ledger.sku);
      const key = [ledger.month, ledger.node, product].join("|");
      if (!rcMap.has(key))
        rcMap.set(key, {
          category: "Пополнение РЦ",
          month: ledger.month,
          year: ledger.year || r.year,
          from: "Склад ГП · Краснокамск",
          to: nodes.get(ledger.node).name,
          node: ledger.node,
          product,
          item: products.get(product).name,
          qty: 0,
          cost: 0,
          transportCost: 0,
          handlingCost: 0,
          lead: nodes.get(ledger.node).days,
        });
      const row = rcMap.get(key);
      row.qty += ledger.inbound;
      row.transportCost += ledger.freightCost;
      row.handlingCost += ledger.inbound * 240;
      row.cost += ledger.freightCost + ledger.inbound * 240;
    }
    const rcFlows = [...rcMap.values()];

    /* First aggregate SKU ledgers to product × node × month, then distribute
       exactly that quantity across the named customer portfolio. */
    const salesMap = new Map();
    for (const ledger of r.ledgers.filter((l) => l.sales > 0)) {
      const product = productBySku.get(ledger.sku);
      const key = [ledger.month, ledger.node, product].join("|");
      if (!salesMap.has(key))
        salesMap.set(key, { month: ledger.month, year: ledger.year || r.year, node: ledger.node, product, qty: 0, lastMileCost: 0 });
      const row = salesMap.get(key);
      row.qty += ledger.sales;
      row.lastMileCost += ledger.lastMileCost;
    }
    const customerFlows = [];
    for (const sale of salesMap.values()) {
      let eligible = customers.filter((c) => c.node === sale.node && c.products.includes(sale.product));
      if (!eligible.length) eligible = customers.filter((c) => c.products.includes(sale.product));
      if (!eligible.length) eligible = customers.filter((c) => c.segment === "Дистрибьюторы");
      const weights = eligible.map((c, i) => 1 + ((c.id.charCodeAt(3) + i) % 4) * 0.18);
      const totalWeight = sum(weights, (x) => x);
      eligible.forEach((customer, index) => {
        const share = weights[index] / totalWeight;
        const qty = sale.qty * share;
        const node = nodes.get(sale.node);
        customerFlows.push({
          category: "Отгрузка клиенту",
          month: sale.month,
          year: sale.year,
          from: node.name,
          to: customer.name,
          customerId: customer.id,
          node: sale.node,
          product: sale.product,
          item: products.get(sale.product).name,
          qty,
          transportCost: sale.lastMileCost * share,
          handlingCost: qty * 180,
          cost: sale.lastMileCost * share + qty * 180,
          lead: sale.node === "plant" ? 2 : 1,
        });
      });
    }

    const nodeCosts = M.nodes.map((node) => {
      const inbound = rcFlows.filter((flow) => flow.node === node.id);
      const outbound = customerFlows.filter((flow) => flow.node === node.id);
      const ledgers = r.ledgers.filter((ledger) => ledger.node === node.id);
      const storage = sum(ledgers, (ledger) => ((ledger.start + ledger.end) / 2) * (node.id === "plant" ? 420 : 680));
      return {
        node: node.id,
        name: node.name,
        transport: sum(inbound, "transportCost"),
        handling: sum(inbound, "handlingCost") + sum(outbound, "handlingCost"),
        storage,
        lastMile: sum(outbound, "transportCost"),
      };
    });
    return {
      supplierFlows,
      internalFlows,
      rcFlows,
      customerFlows,
      nodeCosts,
      all: [...supplierFlows, ...internalFlows, ...rcFlows, ...customerFlows],
    };
  }

  /* Forecast accuracy = 1 − WAPE at product × month level for reported months
     only (rows with dataType "actual"); bias = (Σ forecast − Σ actual) / Σ actual. */
  function forecastAccuracy(rows, target = 0.9) {
    const groups = new Map();
    for (const row of rows) {
      if (row.dataType !== "actual" || !Number.isFinite(row.forecast)) continue;
      const key = `${row.product}|${row.month}`;
      const item = groups.get(key) || { product: row.product, month: row.month, actual: 0, forecast: 0 };
      item.actual += row.demand;
      item.forecast += row.forecast;
      groups.set(key, item);
    }
    const items = [...groups.values()];
    const actual = sum(items, "actual");
    const forecast = sum(items, "forecast");
    const absError = sum(items, (item) => Math.abs(item.forecast - item.actual));
    const months = [...new Set(items.map((item) => item.month))].sort((a, b) => a - b);
    const products = [...new Set(items.map((item) => item.product))].map((product) => {
      const own = items.filter((item) => item.product === product);
      const a = sum(own, "actual");
      return {
        product,
        accuracy: a ? 1 - sum(own, (item) => Math.abs(item.forecast - item.actual)) / a : null,
        bias: a ? (sum(own, "forecast") - a) / a : null,
      };
    });
    return {
      accuracy: actual ? 1 - absError / actual : null,
      bias: actual ? (forecast - actual) / actual : null,
      target,
      months,
      actual,
      forecast,
      products,
    };
  }

  /* Days of stock on hand at month end vs the target level, product × month. */
  function stockTurnover(M, r, family = "all") {
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return M.products
      .filter((p) => family === "all" || p.family === family)
      .map((p) => {
        const cells = M.months.map((_, m) => {
          const rows = r.rows.filter((x) => x.product === p.id && x.month === m);
          const end = sum(rows, "end"), sales = sum(rows, "sales");
          const demand = sum(rows, "demand"), target = sum(rows, "target");
          const doh = sales > 1e-9 ? end / (sales / days[m]) : end > 1e-9 ? Infinity : 0;
          const targetDays = demand > 1e-9 ? target / (demand / days[m]) : 0;
          return {
            month: m,
            end,
            sales,
            target,
            doh,
            targetDays,
            ratio: targetDays > 0 ? doh / targetDays : 0,
            dataType: rows[0]?.dataType || "plan",
          };
        });
        return { product: p, cells };
      });
  }

  /* Slow-moving and obsolete lots in the warehouses on 23.10.2026. They are
     off-grade, customer-specific or aged rolls that the S&OP sales plan does not
     consume. The storage limit is 12 months from production; the planned
     liquidation (discount channel) reduces the quantity until that month. */
  const obsoleteAsOf = "2026-10";
  const obsoleteLots = [
    { id: "НЛ-01", sku: "bulk-70-1050", node: "siberia", qty: 118, produced: "2025-10", reason: "Формат снят клиентом", sellRate: 0, action: "Возврат в массоподготовку" },
    { id: "НЛ-02", sku: "bright-220-1000", node: "south", qty: 96, produced: "2025-11", reason: "Отменённый заказ с индивидуальной спецификацией", sellRate: 8, action: "Уценка и продажа дистрибьютору" },
    { id: "НЛ-03", sku: "sc-56-1050", node: "siberia", qty: 182, produced: "2025-12", reason: "Падение спроса на SC", sellRate: 6, action: "Перемещение на завод и переработка" },
    { id: "НЛ-04", sku: "strong-300-700", node: "ural", qty: 74, produced: "2025-12", reason: "Пересорт: отклонение по белизне", sellRate: 4, action: "Уценка (2-й сорт)" },
    { id: "НЛ-05", sku: "lwc-60-840", node: "north", qty: 122, produced: "2026-01", reason: "Повреждение упаковки, влажность", sellRate: 10, action: "Переупаковка и продажа со скидкой" },
    { id: "НЛ-06", sku: "tobacco2-230-900", node: "volga", qty: 138, produced: "2026-02", reason: "Клиент сменил дизайн пачки", sellRate: 0, action: "Поиск покупателя / списание" },
    { id: "НЛ-07", sku: "offset-65-630", node: "plant", qty: 264, produced: "2026-03", reason: "Перепроизводство при завышенном прогнозе", sellRate: 22, action: "Приоритет в отгрузках, скидка 8%" },
    { id: "НЛ-08", sku: "medical-45-630", node: "plant", qty: 58, produced: "2026-03", reason: "Остаток после смены рецептуры", sellRate: 3, action: "Возврат в массоподготовку" },
    { id: "НЛ-09", sku: "pharma-300-700", node: "center", qty: 42, produced: "2026-04", reason: "Отменённый заказ", sellRate: 2, action: "Предложить ключевым клиентам" },
    { id: "НЛ-10", sku: "satin-80-630", node: "plant", qty: 86, produced: "2026-06", reason: "Пересорт по глянцу", sellRate: 5, action: "Уценка (2-й сорт)" },
  ];
  const monthIndex = (key) => {
    const [y, m] = key.split("-").map(Number);
    return (y - 2026) * 12 + (m - 1);
  };
  function obsoleteStock(M, actual, options = {}) {
    const limit = options.limitMonths || 12, windowMonths = options.windowMonths || 6;
    const asOf = monthIndex(obsoleteAsOf);
    const lots = obsoleteLots.map((lot) => {
      const s = M.skus.find((x) => x.id === lot.sku);
      const p = M.products.find((x) => x.id === s.product);
      /* Book value at production cost (absorption costing) of the latest reported month. */
      const rows = actual.rows.filter((x) => x.sku === lot.sku && x.month <= 8 && x.sales > 0);
      const last = rows[rows.length - 1];
      const unitValue = last ? last.costOfSales / last.sales : p.cost * 1.18;
      const riskMonth = monthIndex(lot.produced) + limit;
      const monthsLeft = Math.max(0, riskMonth - asOf);
      const atRisk = Math.max(0, lot.qty - lot.sellRate * monthsLeft);
      return {
        ...lot,
        product: p.id,
        productName: p.name,
        family: p.family,
        gram: s.gram,
        width: s.width,
        node: lot.node,
        age: asOf - monthIndex(lot.produced),
        riskMonth,
        monthsLeft,
        overdue: riskMonth <= asOf,
        inWindow: riskMonth < asOf + windowMonths,
        atRisk,
        unitValue,
        bookValue: lot.qty * unitValue,
        valueAtRisk: atRisk * unitValue,
      };
    });
    const months = Array.from({ length: windowMonths }, (_, i) => asOf + i);
    return { asOf, months, lots, windowMonths, limit };
  }

  const api = {
    suppliers,
    resourceMeta,
    movementData,
    forecastAccuracy,
    stockTurnover,
    obsoleteLots,
    obsoleteStock,
    sum,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KamaAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
