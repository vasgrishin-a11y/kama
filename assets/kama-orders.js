/* Daily available-to-promise (ATP), S&OP quota control and order scheduling
   for the KAMA S&OP demo. ATP date 23.10.2026: shipped orders are recorded
   facts, open orders are promised against the active S&OP plan. */
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

  /* S&OP allocation ("квота"): the share of a product's monthly S&OP sales
     plan reserved for the named-customer portfolio and its split by customer
     segment. Orders above the quota stay physically promisable but are
     flagged for an S&OP decision. */
  const allocation = {
    pharma: { share: 0.3, segments: { "Фармацевтическая упаковка": 0.6, "Косметика и бытовая химия": 0.4 } },
    medical: { share: 0.6, segments: { "Фармацевтическая упаковка": 0.5, "Издательства и типографии": 0.35, Дистрибьюторы: 0.15 } },
    bright: { share: 0.35, segments: { "Фармацевтическая упаковка": 0.25, "Пищевая упаковка": 0.15, "Косметика и бытовая химия": 0.45, Дистрибьюторы: 0.15 } },
    strong: { share: 0.25, segments: { "Пищевая упаковка": 0.85, Дистрибьюторы: 0.15 } },
    project: { share: 0.45, segments: { "Пищевая упаковка": 0.8, Дистрибьюторы: 0.2 } },
    tobacco1: { share: 0.2, segments: { "Табачная упаковка": 1 } },
    tobacco2: { share: 0.2, segments: { "Табачная упаковка": 1 } },
    lwc: { share: 0.45, segments: { "Издательства и типографии": 0.7, Дистрибьюторы: 0.3 } },
    satin: { share: 0.6, segments: { "Издательства и типографии": 0.7, Дистрибьюторы: 0.3 } },
    offset: { share: 0.5, segments: { "Издательства и типографии": 0.65, Дистрибьюторы: 0.35 } },
    bulk: { share: 0.65, segments: { "Издательства и типографии": 0.6, Дистрибьюторы: 0.4 } },
    sc: { share: 0.5, segments: { "Издательства и типографии": 0.5, Дистрибьюторы: 0.5 } },
  };
  const allocationShare = (product) => allocation[product]?.share ?? 0.3;
  const segments = [
    "Фармацевтическая упаковка",
    "Пищевая упаковка",
    "Косметика и бытовая химия",
    "Табачная упаковка",
    "Издательства и типографии",
    "Дистрибьюторы",
  ];

  /* Shipments recorded before the ATP date. They are facts: never re-planned,
     always shown with actual dates and shipped quantity. */
  const shippedSeed = [
    {
      id: "ЗК-260996", customer: "LC10", product: "bright", qty: 320, requestedDate: "2026-10-09", priority: 1,
      fact: { sourceNode: "center", sourceKind: "РЦ", productionDate: null, shipDate: "2026-10-08", deliveryDate: "2026-10-09", shippedQty: 320, note: "Отгружено в срок и в полном объёме" },
    },
    {
      id: "ЗК-260997", customer: "LC04", product: "strong", qty: 450, requestedDate: "2026-10-13", priority: 2,
      fact: { sourceNode: "plant", sourceKind: "Производство → завод", productionDate: "2026-10-09", machine: "КДМ-9", campaign: "Факт · выпуск КДМ-9", shipDate: "2026-10-10", deliveryDate: "2026-10-17", shippedQty: 450, note: "Кампания сдвинута на 3 дня, поставка с опозданием" },
    },
    {
      id: "ЗК-260998", customer: "LC07", product: "lwc", qty: 400, requestedDate: "2026-10-16", priority: 2,
      fact: { sourceNode: "center", sourceKind: "РЦ", productionDate: null, shipDate: "2026-10-15", deliveryDate: "2026-10-16", shippedQty: 340, note: "Недогруз: в РЦ было 340 т, остаток клиент снял" },
    },
    {
      id: "ЗК-260999", customer: "LC01", product: "medical", qty: 180, requestedDate: "2026-10-20", priority: 1,
      fact: { sourceNode: "volga", sourceKind: "Производство → РЦ", productionDate: "2026-10-14", machine: "БДМ-7", campaign: "Факт · выпуск БДМ-7", shipDate: "2026-10-18", deliveryDate: "2026-10-19", shippedQty: 180, note: "Отгружено в срок и в полном объёме" },
    },
  ];

  const orderSeed = [
    ["ЗК-261001", "LC02", "pharma", 450, "2026-10-27", 1],
    ["ЗК-261002", "LC07", "lwc", 380, "2026-10-28", 2],
    ["ЗК-261003", "LC03", "strong", 540, "2026-10-29", 1],
    ["ЗК-261004", "LC06", "bulk", 360, "2026-10-29", 2],
    ["ЗК-261005", "LC09", "tobacco1", 450, "2026-11-06", 1],
    ["ЗК-261006", "LC11", "bright", 780, "2026-11-03", 2],
    ["ЗК-261007", "LC01", "medical", 225, "2026-11-04", 1],
    ["ЗК-261008", "LC12", "satin", 510, "2026-11-05", 3],
    ["ЗК-261009", "LC04", "project", 690, "2026-11-06", 2],
    ["ЗК-261010", "LC10", "bright", 345, "2026-11-09", 1],
    ["ЗК-261011", "LC05", "pharma", 435, "2026-11-10", 2],
    ["ЗК-261012", "LC08", "medical", 255, "2026-11-11", 3],
    ["ЗК-261013", "LC06", "bulk", 570, "2026-11-12", 2],
    ["ЗК-261014", "LC02", "pharma", 660, "2026-11-13", 1],
    ["ЗК-261015", "LC07", "satin", 405, "2026-11-19", 2],
    ["ЗК-261016", "LC09", "tobacco2", 315, "2026-11-17", 1],
    ["ЗК-261017", "LC03", "project", 840, "2026-11-18", 2],
    ["ЗК-261018", "LC11", "sc", 480, "2026-11-19", 3],
    ["ЗК-261019", "LC12", "offset", 720, "2026-11-25", 2],
    ["ЗК-261020", "LC04", "strong", 615, "2026-11-23", 1],
    ["ЗК-261021", "LC05", "pharma", 380, "2026-12-08", 2],
    ["ЗК-261022", "LC08", "lwc", 300, "2026-12-10", 3],
  ];
  const orders = [
    ...shippedSeed.map((order) => ({ ...order, shipped: true })),
    ...orderSeed.map(([id, customer, product, qty, requestedDate, priority]) => ({
      id,
      customer,
      product,
      qty,
      requestedDate,
      priority,
      shipped: false,
    })),
  ];
  const openOrders = orders.filter((order) => !order.shipped);

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
    /* Campaigns of the two grammages of a product often finish on the same
       day: one supply event per product and day, campaign ids joined. */
    const merged = new Map();
    const serial = (id) => Number(String(id).split("-").pop()) || 0;
    for (const event of productionEvents.sort((a, b) => a.date.localeCompare(b.date) || serial(a.campaign) - serial(b.campaign))) {
      const key = `${event.date}|${event.product}`;
      const item = merged.get(key);
      if (!item) merged.set(key, { ...event, campaigns: [event.campaign] });
      else {
        item.qty += event.qty;
        item.campaignGood += event.campaignGood;
        item.campaigns.push(event.campaign);
      }
    }
    productionEvents.length = 0;
    for (const item of merged.values()) {
      const [first, ...rest] = item.campaigns;
      item.campaign = rest.length ? `${first} + ${rest.map((id) => id.split("-").pop()).join(" + ")}` : first;
      productionEvents.push(item);
    }

    const quota = new Map();
    for (const row of r.rows.filter((x) => x.month >= 9)) {
      const k = `${row.year || r.year || 2026}-${String(row.month + 1).padStart(2, "0")}|${row.product}`;
      quota.set(k, (quota.get(k) || 0) + row.sales);
    }
    return { M, r, initial, events, productionEvents, quota, productBySku, productById, nodeById, key };
  }

  function shippedResult(order, context) {
    const customer = customers.find((c) => c.id === order.customer);
    const product = context.productById.get(order.product);
    const fact = order.fact;
    const deliveredQty = fact.shippedQty;
    const lateDays = Math.max(0, diffDays(fact.deliveryDate, order.requestedDate));
    return {
      orderId: order.id,
      shipped: true,
      customerId: customer.id,
      customer: customer.name,
      segment: customer.segment,
      product: order.product,
      productName: product.name,
      qty: order.qty,
      deliveredQty,
      quotaQty: deliveredQty,
      shortQty: Math.max(0, order.qty - deliveredQty),
      requestedDate: order.requestedDate,
      priority: order.priority,
      destinationNode: customer.node,
      sourceNode: fact.sourceNode,
      sourceKind: fact.sourceKind,
      stockStatus: fact.productionDate ? "no" : "yes",
      availableQty: fact.productionDate ? 0 : deliveredQty,
      productionQty: fact.productionDate ? deliveredQty : 0,
      productionDate: fact.productionDate,
      readyDate: fact.productionDate ? addDays(fact.productionDate, 1) : null,
      machine: fact.machine || null,
      campaign: fact.campaign || null,
      campaignGood: 0,
      shipDate: fact.shipDate,
      deliveryDate: fact.deliveryDate,
      reservationNode: fact.sourceNode,
      reservationDate: fact.shipDate,
      lateDays,
      note: fact.note,
    };
  }

  function finalize(result) {
    result.onTime = result.deliveryDate <= result.requestedDate;
    result.inFull = result.deliveredQty >= result.qty - 1e-9;
    result.otif = result.onTime && result.inFull;
    result.withProduction = Boolean(result.productionDate);
    result.status = result.shipped
      ? "Отгружено"
      : result.exception
        ? "Требует решения SOP"
        : result.lateDays
          ? "С отклонением"
          : result.productionDate
            ? "Через производство"
            : "Из запаса";
    return result;
  }

  function planPortfolio(M, r, options = {}) {
    const context = buildContext(M, r);
    const book = options.orders || orders;
    const shippedOrders = book.filter((order) => order.shipped);
    const open = book.filter((order) => !order.shipped);
    const selected = options.orderIds ? new Set(options.orderIds) : null;
    const previous = options.previousResults || [];
    const fixed = selected
      ? previous
          .filter((result) => !result.shipped && !selected.has(result.orderId))
          .map((result) => ({ ...result }))
      : [];
    const toPlan = open.filter((order) => !selected || selected.has(order.id));
    const shippedResults = shippedOrders.map((order) => finalize(shippedResult(order, context)));
    /* Shipped-from-stock orders consumed stock before the ATP date; orders
       produced for a shipment consumed their own output (net zero). */
    const reservations = [
      ...shippedResults
        .filter((result) => !result.productionDate)
        .map((result) => ({ date: result.shipDate, product: result.product, node: result.sourceNode, qty: result.deliveredQty })),
      ...fixed.map((result) => ({
        date: result.reservationDate,
        product: result.product,
        node: result.reservationNode,
        qty: result.qty,
      })),
    ];
    const results = [];

    /* Physical ATP: stock on 01.10 + campaign output and RC replenishment of
       the active S&OP plan − reservations of shipped and promised orders.
       The S&OP allocation (quota) is a separate commercial control below. */
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
      const regionalAvailable = customer.node !== "plant" ? balance(order.product, customer.node, regionalShipDate) : 0;
      if (customer.node !== "plant" && regionalAvailable >= order.qty) {
        return {
          sourceNode: customer.node,
          sourceKind: "РЦ",
          stockStatus: "yes",
          availableQty: regionalAvailable,
          productionQty: 0,
          productionDate: null,
          shipDate: regionalShipDate,
          deliveryDate: addDays(regionalShipDate, 1),
          reservationNode: customer.node,
          reservationDate: regionalShipDate,
        };
      }

      /* Plant stock counts as "from stock" only if it is on hand on the ATP
         date and still free on the shipping date (just-in-time dispatch). */
      const directDays = node.directDays || 2;
      const directShip = maxDate(AS_OF, addDays(requested, -directDays));
      const onHand = balance(order.product, "plant", AS_OF);
      const plantAvailable = balance(order.product, "plant", directShip);
      if (onHand >= order.qty && plantAvailable >= order.qty) {
        /* Клиент на самом заводе (LC12) — прямая отгрузка со склада завода.
           Для остальных клиентов место отгрузки — их РЦ: товар сначала
           перемещается со склада завода на РЦ (node.days дней), затем
           последняя миля до клиента (1 день). */
        if (customer.node === "plant") {
          return {
            sourceNode: "plant",
            sourceKind: "Завод",
            stockStatus: "yes",
            availableQty: onHand,
            productionQty: 0,
            productionDate: null,
            shipDate: directShip,
            deliveryDate: addDays(directShip, directDays),
            reservationNode: "plant",
            reservationDate: AS_OF < directShip ? AS_OF : directShip,
          };
        }
        const rcArrival = addDays(directShip, node.days);
        const shipDate = maxDate(rcArrival, addDays(requested, -1));
        return {
          sourceNode: customer.node,
          sourceKind: "Завод → РЦ",
          stockStatus: "yes",
          availableQty: onHand,
          productionQty: 0,
          productionDate: null,
          shipDate,
          deliveryDate: addDays(shipDate, 1),
          reservationNode: "plant",
          reservationDate: AS_OF < directShip ? AS_OF : directShip,
        };
      }

      const candidates = [];
      for (const event of context.productionEvents.filter(
        (e) => e.product === order.product && e.date >= AS_OF,
      )) {
        const available = balance(order.product, "plant", event.date);
        if (available < order.qty) continue;
        const before = Math.max(0, balance(order.product, "plant", addDays(event.date, -1)));
        const productionQty = Math.max(0, order.qty - Math.min(before, Math.max(0, onHand)));
        if (productionQty < 1e-6) continue;
        const readyDate = addDays(event.date, 1);
        const common = {
          stockStatus: Math.min(before, onHand) > 0 ? "partial" : "no",
          availableQty: Math.max(0, Math.min(before, onHand)),
          productionQty,
          productionDate: event.date,
          readyDate,
          reservationNode: "plant",
          reservationDate: event.date,
          machine: event.machine,
          campaign: event.campaign,
          campaignGood: event.campaignGood,
        };
        const plantShip = maxDate(readyDate, addDays(requested, -directDays));
        candidates.push({
          ...common,
          sourceNode: "plant",
          sourceKind: "Производство → завод",
          shipDate: plantShip,
          deliveryDate: addDays(plantShip, directDays),
        });
        if (customer.node !== "plant") {
          const arrival = addDays(readyDate, node.days);
          const shipDate = maxDate(arrival, addDays(requested, -1));
          candidates.push({
            ...common,
            sourceNode: customer.node,
            sourceKind: "Производство → РЦ",
            shipDate,
            deliveryDate: addDays(shipDate, 1),
          });
        }
      }
      const viaCustomerNode = (candidate) => (candidate.sourceNode === customer.node ? 0 : 1);
      candidates.sort(
        (a, b) =>
          a.deliveryDate.localeCompare(b.deliveryDate) ||
          a.productionDate.localeCompare(b.productionDate) ||
          viaCustomerNode(a) - viaCustomerNode(b),
      );
      if (candidates.length) return candidates[0];

      /* No allocated volume in the remaining SOP campaigns: an explicit
         exception on the next machine slot instead of a silent promise. */
      const event = context.productionEvents.find((e) => e.product === order.product && e.date >= AS_OF);
      const productionDate = maxDate(AS_OF, event?.date || AS_OF);
      const readyDate = addDays(productionDate, 1);
      const shipDate =
        customer.node === "plant"
          ? maxDate(readyDate, addDays(requested, -1))
          : maxDate(addDays(readyDate, node.days), addDays(requested, -1));
      return {
        sourceNode: customer.node,
        sourceKind: customer.node === "plant" ? "Доп. производство → завод" : "Доп. производство → РЦ",
        stockStatus: "no",
        availableQty: 0,
        productionQty: order.qty,
        productionDate,
        readyDate,
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
      const result = finalize({
        ...scheduled,
        orderId: order.id,
        shipped: false,
        customerId: customer.id,
        customer: customer.name,
        segment: customer.segment,
        product: order.product,
        productName: product.name,
        qty: order.qty,
        deliveredQty: order.qty,
        quotaQty: order.qty,
        shortQty: 0,
        requestedDate: order.requestedDate,
        priority: order.priority,
        destinationNode: customer.node,
        lateDays: Math.max(0, diffDays(scheduled.deliveryDate, order.requestedDate)),
      });
      results.push(result);
      reservations.push({
        date: result.reservationDate,
        product: result.product,
        node: result.reservationNode,
        qty: result.qty,
      });
    }

    const allResults = book
      .map((order) =>
        order.shipped
          ? shippedResults.find((result) => result.orderId === order.id)
          : results.find((result) => result.orderId === order.id) ||
            fixed.find((result) => result.orderId === order.id),
      )
      .filter(Boolean);

    const months = ["2026-10", "2026-11", "2026-12"];
    const quotaUsage = [];
    for (const product of M.products) {
      for (const month of months) {
        const monthOrders = allResults.filter(
          (result) => result.product === product.id && monthKey(result.requestedDate) === month,
        );
        if (!monthOrders.length) continue;
        const plannedSales = context.quota.get(`${month}|${product.id}`) || 0;
        const quota = plannedSales * allocationShare(product.id);
        const ordered = sum(monthOrders, "quotaQty");
        quotaUsage.push({
          view: "product",
          key: product.id,
          product: product.id,
          productName: product.name,
          label: product.name,
          month,
          plannedSales,
          share: allocationShare(product.id),
          quota,
          ordered,
          orders: monthOrders.map((result) => ({ id: result.orderId, qty: result.quotaQty })),
          usage: quota ? ordered / quota : 0,
          remaining: quota - ordered,
        });
      }
    }
    const segmentQuotaUsage = [];
    for (const segment of segments) {
      for (const month of months) {
        const monthOrders = allResults.filter(
          (result) => result.segment === segment && monthKey(result.requestedDate) === month,
        );
        if (!monthOrders.length) continue;
        const quota = sum(M.products, (product) =>
          (context.quota.get(`${month}|${product.id}`) || 0) *
          allocationShare(product.id) *
          (allocation[product.id]?.segments?.[segment] || 0),
        );
        const ordered = sum(monthOrders, "quotaQty");
        segmentQuotaUsage.push({
          view: "segment",
          key: segment,
          segment,
          label: segment,
          month,
          quota,
          ordered,
          orders: monthOrders.map((result) => ({ id: result.orderId, qty: result.quotaQty })),
          usage: quota ? ordered / quota : 0,
          remaining: quota - ordered,
        });
      }
    }
    /* Orders that push a product allocation over its quota (requested-date order). */
    for (const quota of quotaUsage) {
      let used = 0;
      const ordered = allResults
        .filter((result) => result.product === quota.product && monthKey(result.requestedDate) === quota.month)
        .sort((a, b) => a.requestedDate.localeCompare(b.requestedDate) || a.priority - b.priority || a.orderId.localeCompare(b.orderId));
      for (const result of ordered) {
        used += result.quotaQty;
        result.overQuota = used > quota.quota + 1e-6 ? Math.min(result.quotaQty, used - quota.quota) : 0;
      }
    }

    const openResults = allResults.filter((result) => !result.shipped);
    const shippedAll = allResults.filter((result) => result.shipped);
    return {
      asOf: AS_OF,
      results: allResults,
      quotaUsage,
      segmentQuotaUsage,
      summary: {
        orders: allResults.length,
        open: openResults.length,
        shipped: shippedAll.length,
        fromStock: allResults.filter((result) => !result.productionDate).length,
        withProduction: allResults.filter((result) => result.productionDate).length,
        late: allResults.filter((result) => result.lateDays > 0).length,
        notInFull: allResults.filter((result) => !result.inFull).length,
        otif: allResults.filter((result) => result.otif).length,
        otifRate: allResults.length ? allResults.filter((result) => result.otif).length / allResults.length : 0,
        factOtif: shippedAll.filter((result) => result.otif).length,
        planOtif: openResults.filter((result) => result.otif).length,
        exceptions: allResults.filter((result) => result.exception).length,
        overQuota: quotaUsage.filter((quota) => quota.usage > 1).length,
        productionQty: sum(openResults, "productionQty"),
        shipmentQty: sum(allResults, "qty"),
        shippedQty: sum(shippedAll, "deliveredQty"),
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
          fact: Boolean(result.shipped),
        });
      const row = map.get(key);
      row.qty += result.productionQty;
      row.orders.push(result.orderId);
      row.exceptions += result.exception ? 1 : 0;
      row.fact = row.fact && Boolean(result.shipped);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  const api = {
    AS_OF,
    customers,
    orders,
    openOrders,
    shippedOrders: orders.filter((order) => order.shipped),
    allocation,
    allocationShare,
    segments,
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
