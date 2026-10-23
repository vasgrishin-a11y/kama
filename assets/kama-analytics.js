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
    fiber: { name: "Волокнистое сырьё", unit: "т абс. сух.", scale: 1, tariff: 35000, color: "#4769ff", target: 0.9 },
    coat: { name: "Компоненты мелования", unit: "т", scale: 1, tariff: 51000, color: "#19a27b", target: 0.88 },
    energy: { name: "Электроэнергия", unit: "МВт·ч", scale: 1, tariff: 5400, color: "#ff8c00", target: 0.88 },
    water: { name: "Оборотная вода", unit: "м³", scale: 1, tariff: 42, color: "#38a3c7", target: 0.84 },
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

  const api = { suppliers, resourceMeta, movementData, sum };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KamaAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
