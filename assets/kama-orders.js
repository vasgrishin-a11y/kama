/* Daily available-to-promise and order scheduling for the KAMA S&OP demo. */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const AS_OF = "2026-10-23";
  const parseDate = (value) => {
    const [y, m, d] = String(value).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const iso = (date) => date.toISOString().slice(0, 10);
  const addDays = (value, days) => {
    const date = typeof value === "string" ? parseDate(value) : new Date(value);
    date.setUTCDate(date.getUTCDate() + days);
    return iso(date);
  };
  const diffDays = (a, b) => Math.round((parseDate(a) - parseDate(b)) / DAY);
  const maxDate = (a, b) => (a > b ? a : b);
  const monthKey = (value) => String(value).slice(0, 7);
  const sum = (rows, key) =>
    rows.reduce(
      (total, row) =>
        total + (typeof key === "function" ? key(row) : Number(row[key]) || 0),
      0,
    );

  const customers = [
    { id: "LC01", name: "МедиПак НН", segment: "Фармацевтическая упаковка", node: "volga", products: ["pharma", "medical", "bright"] },
    { id: "LC02", name: "ФармКартон", segment: "Фармацевтическая упаковка", node: "center", products: ["pharma", "bright"] },
    { id: "LC03", name: "Норд Фуд Пак", segment: "Пищевая упаковка", node: "north", products: ["strong", "project", "bright"] },
    { id: "LC04", name: "Юпак Ростов", segment: "Пищевая упаковка", node: "south", products: ["strong", "project"] },
    { id: "LC05", name: "УралУпак", segment: "Косметика и бытовая химия", node: "ural", products: ["bright", "pharma"] },
    { id: "LC06", name: "СибПринт", segment: "Издательства и типографии", node: "siberia", products: ["offset", "bulk", "sc"] },
    { id: "LC07", name: "Столица Пресс", segment: "Издательства и типографии", node: "center", products: ["lwc", "satin", "offset"] },
    { id: "LC08", name: "Волга Медиа", segment: "Издательства и типографии", node: "volga", products: ["lwc", "satin", "medical"] },
    { id: "LC09", name: "Табак Пак Поволжье", segment: "Табачная упаковка", node: "volga", products: ["tobacco1", "tobacco2"] },
    { id: "LC10", name: "Косметик Пак", segment: "Косметика и бытовая химия", node: "center", products: ["bright", "pharma"] },
    { id: "LC11", name: "Дистрибутор Урал", segment: "Дистрибьюторы", node: "ural", products: ["bright", "strong", "project", "lwc", "satin", "offset", "bulk", "sc"] },
    { id: "LC12", name: "Полиграф Альянс", segment: "Дистрибьюторы", node: "plant", products: ["lwc", "satin", "medical", "offset", "bulk", "sc"] },
  ];

  const orderSeed = [
    ["ЗК-261001", "LC02", "pharma", 450, "2026-10-27", 1],
    ["ЗК-261002", "LC07", "lwc", 630, "2026-10-28", 2],
    ["ЗК-261003", "LC03", "strong", 540, "2026-10-29", 1],
    ["ЗК-261004", "LC06", "offset", 390, "2026-10-30", 2],
    ["ЗК-261005", "LC09", "tobacco1", 285, "2026-11-02", 1],
    ["ЗК-261006", "LC11", "bright", 780, "2026-11-03", 2],
    ["ЗК-261007", "LC01", "medical", 225, "2026-11-04", 1],
    ["ЗК-261008", "LC12", "satin", 510, "2026-11-05", 3],
    ["ЗК-261009", "LC04", "project", 690, "2026-11-06", 2],
    ["ЗК-261010", "LC10", "bright", 345, "2026-11-09", 1],
    ["ЗК-261011", "LC05", "pharma", 435, "2026-11-10", 2],
    ["ЗК-261012", "LC08", "medical", 255, "2026-11-11", 3],
    ["ЗК-261013", "LC06", "bulk", 570, "2026-11-12", 2],
    ["ЗК-261014", "LC02", "pharma", 660, "2026-11-13", 1],
    ["ЗК-261015", "LC07", "satin", 405, "2026-11-16", 2],
    ["ЗК-261016", "LC09", "tobacco2", 315, "2026-11-17", 1],
    ["ЗК-261017", "LC03", "project", 840, "2026-11-18", 2],
    ["ЗК-261018", "LC11", "sc", 480, "2026-11-19", 3],
    ["ЗК-261019", "LC12", "offset", 720, "2026-11-20", 2],
    ["ЗК-261020", "LC04", "strong", 615, "2026-11-23", 1],
  ];
  const orders = orderSeed.map(([id, customer, product, qty, requestedDate, priority]) => ({
    id,
    customer,
    product,
    qty,
    requestedDate,
    priority,
  }));

  function buildContext(M, r) {
    const productBySku = new Map(M.skus.map((s) => [s.id, s.product]));
    const nodeById = new Map(M.nodes.map((n) => [n.id, n]));
    const productById = new Map(M.products.map((p) => [p.id, p]));
    const initial = new Map();
    const key = (product, node) => `${product}|${node}`;
    for (const ledger of r.ledgers.filter((l) => l.month === 9)) {
      const product = productBySku.get(ledger.sku);
      const k = key(product, ledger.node);
      initial.set(k, (initial.get(k) || 0) + ledger.start);
    }

    const events = [];
    const productionEvents = [];
    for (const campaign of r.campaigns.filter((c) => c.month >= 9)) {
      const date = addDays(
        `${campaign.year || r.year || 2026}-${String(campaign.month + 1).padStart(2, "0")}-01`,
        Math.min(27, Math.max(0, Math.floor(campaign.end / 24))),
      );
      const event = {
        type: "production",
        date,
        product: campaign.product,
        node: "plant",
        qty: campaign.good,
        machine: campaign.machine,
        campaign: campaign.id,
        campaignGood: campaign.good,
      };
      events.push({ ...event, sign: 1 });
      productionEvents.push(event);
    }

    const transferMap = new Map();
    for (const ledger of r.ledgers.filter((l) => l.month >= 9 && l.inbound > 0)) {
      const product = productBySku.get(ledger.sku);
      const k = `${ledger.month}|${product}|${ledger.node}`;
      if (!transferMap.has(k))
        transferMap.set(k, {
          month: ledger.month,
          year: ledger.year || r.year || 2026,
          product,
          node: ledger.node,
          qty: 0,
        });
      transferMap.get(k).qty += ledger.inbound;
    }
    for (const transfer of transferMap.values()) {
      [0.45, 0.55].forEach((share, index) => {
        const departure = addDays(
          `${transfer.year}-${String(transfer.month + 1).padStart(2, "0")}-01`,
          index ? 23 : 11,
        );
        const qty = transfer.qty * share;
        const lead = nodeById.get(transfer.node)?.days || 0;
        events.push({ type: "transfer-out", date: departure, product: transfer.product, node: "plant", qty, sign: -1 });
        events.push({ type: "transfer-in", date: addDays(departure, lead), product: transfer.product, node: transfer.node, qty, sign: 1, departure });
      });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    productionEvents.sort((a, b) => a.date.localeCompare(b.date));

    const quota = new Map();
    for (const row of r.rows.filter((x) => x.month >= 9)) {
      const k = `${row.year || r.year || 2026}-${String(row.month + 1).padStart(2, "0")}|${row.product}`;
      quota.set(k, (quota.get(k) || 0) + row.sales);
    }
    return { M, r, initial, events, productionEvents, quota, productBySku, productById, nodeById, key };
  }

  function planPortfolio(M, r, options = {}) {
    const context = buildContext(M, r);
    const selected = options.orderIds ? new Set(options.orderIds) : null;
    const previous = options.previousResults || [];
    const fixed = selected ? previous.filter((result) => !selected.has(result.orderId)) : [];
    const toPlan = orders.filter((order) => !selected || selected.has(order.id));
    const reservations = fixed.map((result) => ({
      date: result.reservationDate,
      product: result.product,
      node: result.reservationNode,
      qty: result.qty,
    }));
    const results = [];

    const balance = (product, node, date) => {
      let value = context.initial.get(context.key(product, node)) || 0;
      for (const event of context.events) {
        if (event.date > date) break;
        if (event.product === product && event.node === node)
          value += event.sign * event.qty;
      }
      for (const reservation of reservations)
        if (
          reservation.product === product &&
          reservation.node === node &&
          reservation.date <= date
        )
          value -= reservation.qty;
      return value;
    };

    const schedule = (order) => {
      const customer = customers.find((c) => c.id === order.customer);
      const node = context.nodeById.get(customer.node);
      const product = context.productById.get(order.product);
      const requested = order.requestedDate;
      const regionalShipDate = maxDate(AS_OF, addDays(requested, -1));
      const regionalAvailable = balance(order.product, customer.node, regionalShipDate);
      if (customer.node !== "plant" && regionalAvailable >= order.qty) {
        const shipDate = regionalShipDate;
        const deliveryDate = addDays(shipDate, 1);
        return {
          sourceNode: customer.node,
          sourceKind: "РЦ",
          stockStatus: "yes",
          availableQty: regionalAvailable,
          productionQty: 0,
          productionDate: null,
          shipDate,
          deliveryDate,
          reservationNode: customer.node,
          reservationDate: shipDate,
        };
      }

      const directDays = node.directDays || 2;
      const directShip = maxDate(AS_OF, addDays(requested, -directDays));
      const plantAvailable = balance(order.product, "plant", directShip);
      if (plantAvailable >= order.qty) {
        return {
          sourceNode: "plant",
          sourceKind: "Завод",
          stockStatus: "yes",
          availableQty: plantAvailable,
          productionQty: 0,
          productionDate: null,
          shipDate: directShip,
          deliveryDate: addDays(directShip, directDays),
          reservationNode: "plant",
          reservationDate: directShip,
        };
      }

      const candidates = [];
      for (const event of context.productionEvents.filter(
        (e) => e.product === order.product && e.date >= AS_OF,
      )) {
        const available = balance(order.product, "plant", event.date);
        if (available < order.qty) continue;
        const before = Math.max(0, balance(order.product, "plant", addDays(event.date, -1)));
        const productionQty = Math.max(0, order.qty - before);
        if (productionQty < 1e-6) continue;
        candidates.push({
          sourceNode: "plant",
          sourceKind: "Производство → завод",
          stockStatus: before > 0 ? "partial" : "no",
          availableQty: before,
          productionQty,
          productionDate: event.date,
          readyDate: addDays(event.date, 1),
          shipDate: addDays(event.date, 1),
          deliveryDate: addDays(event.date, 1 + directDays),
          reservationNode: "plant",
          reservationDate: event.date,
          machine: event.machine,
          campaign: event.campaign,
          campaignGood: event.campaignGood,
        });
        if (customer.node !== "plant") {
          const shipDate = addDays(event.date, 1 + node.days);
          candidates.push({
            sourceNode: customer.node,
            sourceKind: "Производство → РЦ",
            stockStatus: before > 0 ? "partial" : "no",
            availableQty: before,
            productionQty,
            productionDate: event.date,
            readyDate: addDays(event.date, 1),
            shipDate,
            deliveryDate: addDays(shipDate, 1),
            reservationNode: "plant",
            reservationDate: event.date,
            machine: event.machine,
            campaign: event.campaign,
            campaignGood: event.campaignGood,
          });
        }
      }
      candidates.sort(
        (a, b) =>
          a.deliveryDate.localeCompare(b.deliveryDate) ||
          (a.sourceNode === customer.node ? -1 : 1),
      );
      if (candidates.length) return candidates[0];

      /* No usable SOP campaign remains: create an explicit exception on the
         next available machine day instead of silently promising stock. */
      const event = context.productionEvents.find((e) => e.product === order.product);
      const productionDate = maxDate(AS_OF, event?.date || AS_OF);
      const shipDate = addDays(productionDate, 1 + (customer.node === "plant" ? 0 : node.days));
      return {
        sourceNode: customer.node,
        sourceKind: "Доп. производство → РЦ",
        stockStatus: "no",
        availableQty: 0,
        productionQty: order.qty,
        productionDate,
        readyDate: addDays(productionDate, 1),
        shipDate,
        deliveryDate: addDays(shipDate, 1),
        reservationNode: "plant",
        reservationDate: productionDate,
        machine: product.machine,
        campaign: "Вне кампании SOP",
        campaignGood: 0,
        exception: "Нет свободного объёма в оставшихся кампаниях SOP",
      };
    };

    const planned = [...toPlan].sort(
      (a, b) =>
        a.requestedDate.localeCompare(b.requestedDate) ||
        a.priority - b.priority ||
        a.id.localeCompare(b.id),
    );
    for (const order of planned) {
      const customer = customers.find((c) => c.id === order.customer);
      const product = context.productById.get(order.product);
      const scheduled = schedule(order);
      const result = {
        ...scheduled,
        orderId: order.id,
        customerId: customer.id,
        customer: customer.name,
        segment: customer.segment,
        product: order.product,
        productName: product.name,
        qty: order.qty,
        requestedDate: order.requestedDate,
        priority: order.priority,
        destinationNode: customer.node,
        lateDays: Math.max(0, diffDays(scheduled.deliveryDate, order.requestedDate)),
      };
      result.status = result.exception
        ? "Требует решения SOP"
        : result.lateDays
          ? "С отклонением"
          : result.productionDate
            ? "Через производство"
            : "Из запаса";
      results.push(result);
      reservations.push({
        date: result.reservationDate,
        product: result.product,
        node: result.reservationNode,
        qty: result.qty,
      });
    }

    const allResults = orders.map((order) =>
      selected
        ? results.find((result) => result.orderId === order.id) ||
          fixed.find((result) => result.orderId === order.id)
        : results.find((result) => result.orderId === order.id),
    ).filter(Boolean);

    const quotaUsage = [];
    for (const product of M.products) {
      for (const month of ["2026-10", "2026-11", "2026-12"]) {
        const monthOrders = allResults.filter(
          (result) => result.product === product.id && monthKey(result.requestedDate) === month,
        );
        if (!monthOrders.length) continue;
        const plannedSales = context.quota.get(`${month}|${product.id}`) || 0;
        const ordered = sum(monthOrders, "qty");
        quotaUsage.push({
          product: product.id,
          productName: product.name,
          month,
          plannedSales,
          ordered,
          usage: plannedSales ? ordered / plannedSales : 0,
          remaining: plannedSales - ordered,
        });
      }
    }
    return {
      asOf: AS_OF,
      results: allResults,
      quotaUsage,
      summary: {
        orders: allResults.length,
        fromStock: allResults.filter((result) => !result.productionDate).length,
        withProduction: allResults.filter((result) => result.productionDate).length,
        late: allResults.filter((result) => result.lateDays > 0).length,
        exceptions: allResults.filter((result) => result.exception).length,
        productionQty: sum(allResults, "productionQty"),
        shipmentQty: sum(allResults, "qty"),
      },
    };
  }

  function productionSchedule(results) {
    const map = new Map();
    for (const result of results.filter((r) => r.productionDate)) {
      const key = [result.productionDate, result.machine, result.campaign, result.product].join("|");
      if (!map.has(key))
        map.set(key, {
          date: result.productionDate,
          machine: result.machine,
          campaign: result.campaign,
          product: result.product,
          productName: result.productName,
          qty: 0,
          campaignGood: result.campaignGood || 0,
          orders: [],
          exceptions: 0,
        });
      const row = map.get(key);
      row.qty += result.productionQty;
      row.orders.push(result.orderId);
      row.exceptions += result.exception ? 1 : 0;
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  const api = {
    AS_OF,
    customers,
    orders,
    parseDate,
    iso,
    addDays,
    diffDays,
    buildContext,
    planPortfolio,
    productionSchedule,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KamaOrders = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
