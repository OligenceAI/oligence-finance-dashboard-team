/* ============================================================================
 * mock-data.js — Mock data layer for the Executive Finance Dashboard
 * ============================================================================
 *
 * PHASE 2 INTEGRATION POINT
 * -------------------------
 * This file exports ONE async function, fetchDashboardData({ range, startDate,
 * endDate }), whose signature and returned JSON shape are designed to be
 * IDENTICAL to the future n8n webhook contract.
 *
 * The webhook URL itself lives in config.js (window.N8N_WEBHOOK_URL) —
 * edit it there, not here.
 *
 * To go live, flip USE_LIVE_WEBHOOK below to true. While it's false,
 * fetchDashboardData() always returns the mock/scaled data, even though
 * the live-fetch code path already exists and is ready.
 *
 * Nothing in app.js needs to change either way — it only ever calls
 * fetchDashboardData({ range, startDate, endDate }) and renders whatever
 * JSON comes back. The dashboard NEVER re-aggregates raw transaction rows
 * in the browser; all aggregation happens upstream (in n8n's Code node in
 * Phase 2, and in the seed-scaling logic below in Phase 1).
 *
 * REQUEST SHAPE (what the real fetch() will POST):
 * {
 *   "range": "all" | "custom",
 *   "startDate": "YYYY-MM-DD" | null,
 *   "endDate": "YYYY-MM-DD" | null
 * }
 *
 * RESPONSE SHAPE (this is the API contract Phase 2's n8n Code node must
 * produce — pre-aggregated, self-contained, ready to render as-is):
 * {
 *   "meta": { "range": "all", "startDate": null, "endDate": null, "generatedAt": ISOString },
 *
 *   "overview": {
 *     "kpis": {
 *       "totalRevenue": Number, "totalExpenses": Number, "netProfit": Number, "netMargin": Number,
 *       "trends": { "totalRevenue": Number, "totalExpenses": Number, "netProfit": Number, "netMargin": Number }
 *     },
 *     "brandTable": [ { "brand": String, "revenue": Number, "expenses": Number, "profit": Number, "margin": Number }, ... ]
 *   },
 *
 *   "brands": {
 *     "IMFND": {
 *       "kind": "training",
 *       "kpis": { "totalEnrollments": Number, "totalRevenue": Number, "avgRevenuePerEnrollment": Number,
 *                 "trends": { "totalRevenue": Number } },
 *       "courses": [ { "name": String, "tickets": Number, "revenue": Number }, ... ],
 *       "salesReps": [ { "name": String, "revenue": Number, "tickets": Number }, ... ],
 *       "expenses": [ { "description": String, "amount": Number }, ... ],
 *       "paymentMethods": { "in": [ { "method": String, "amount": Number }, ... ],
 *                            "out": [ { "method": String, "amount": Number }, ... ] }
 *     },
 *     "AS": { ...same shape as IMFND... },
 *     "OligenceAI": {
 *       "kind": "agency",
 *       "kpis": { "totalBilled": Number, "collected": Number, "outstanding": Number, "collectionRate": Number,
 *                 "activeClients": Number },
 *       "clients": [ { "name": String, "monthlyFee": Number, "collected": Number, "outstanding": Number,
 *                       "status": "Paid"|"Partially Paid"|"Overdue", "serviceType": String,
 *                       "method": String, "notes": String }, ... ],
 *       "expenses": [ { "description": String, "amount": Number }, ... ],
 *       "paymentMethods": { "in": [...], "out": [...] }
 *     }
 *   },
 *
 *   "cashFlow": {
 *     "kpis": { "totalIn": Number, "totalOut": Number, "netPosition": Number },
 *     "moneyIn": [ { "brand": String, "method": String, "amount": Number }, ... ],
 *     "moneyOut": [ { "brand": String, "method": String, "amount": Number }, ... ]
 *   }
 * }
 * ==========================================================================*/

(function (global) {
  // ---- Baseline ("All Time") seed data, from the design mockup ----------
  const BASELINE = {
    overview: {
      totalRevenue: 3610000,
      totalExpenses: 1980000,
      netProfit: 1630000,
      netMargin: 45.15,
    },
    brandTotals: {
      IMFND: { revenue: 1850000, expenses: 980000, profit: 870000, margin: 47.03 },
      AS: { revenue: 1240000, expenses: 690000, profit: 550000, margin: 44.35 },
      OligenceAI: { revenue: 520000, expenses: 310000, profit: 210000, margin: 40.38 },
    },
    IMFND: {
      courses: [
        { name: 'Diploma in Digital Marketing', tickets: 145, revenue: 580000 },
        { name: 'Diploma in Finance & Investment', tickets: 98, revenue: 490000 },
        { name: 'Diploma in HR Management', tickets: 110, revenue: 385000 },
        { name: 'Diploma in Data Analytics', tickets: 75, revenue: 337500 },
        { name: 'Executive Leadership Program', tickets: 12, revenue: 57500 },
      ],
      salesReps: [
        { name: 'Ahmed Hassan', revenue: 620000, tickets: 145 },
        { name: 'Sara Mostafa', revenue: 540000, tickets: 128 },
        { name: 'Youssef Adel', revenue: 410000, tickets: 98 },
        { name: 'Nourhan Fathy', revenue: 280000, tickets: 69 },
      ],
      expenses: [
        { description: 'Sales Commissions', amount: 310000 },
        { description: 'Marketing & Ads', amount: 245000 },
        { description: 'Instructor Fees', amount: 220000 },
        { description: 'Venue & Logistics', amount: 120000 },
        { description: 'Software & Tools', amount: 45000 },
        { description: 'Office & Admin', amount: 40000 },
      ],
      paymentMethods: {
        in: [
          { method: 'Bank Transfer', amount: 1050000 },
          { method: 'Credit Card', amount: 520000 },
          { method: 'Instapay', amount: 280000 },
        ],
        out: [
          { method: 'Bank Transfer', amount: 650000 },
          { method: 'Cash', amount: 210000 },
          { method: 'Vodafone Cash', amount: 120000 },
        ],
      },
    },
    AS: {
      courses: [
        { name: 'Advanced Sales Diploma', tickets: 88, revenue: 440000 },
        { name: 'Certified Trainer Program', tickets: 62, revenue: 372000 },
        { name: 'Leadership Diploma', tickets: 54, revenue: 270000 },
        { name: 'Negotiation Skills Workshop', tickets: 40, revenue: 120000 },
        { name: 'Public Speaking Mastery', tickets: 13, revenue: 38000 },
      ],
      salesReps: [
        { name: 'Karim Nabil', revenue: 450000, tickets: 92 },
        { name: 'Mona Aziz', revenue: 380000, tickets: 79 },
        { name: 'Tarek Younis', revenue: 260000, tickets: 54 },
        { name: 'Dina Samir', revenue: 150000, tickets: 32 },
      ],
      expenses: [
        { description: 'Sales Commissions', amount: 210000 },
        { description: 'Marketing & Ads', amount: 180000 },
        { description: 'Instructor Fees', amount: 165000 },
        { description: 'Venue & Logistics', amount: 85000 },
        { description: 'Software & Tools', amount: 30000 },
        { description: 'Office & Admin', amount: 20000 },
      ],
      paymentMethods: {
        in: [
          { method: 'Bank Transfer', amount: 700000 },
          { method: 'Credit Card', amount: 340000 },
          { method: 'Instapay', amount: 200000 },
        ],
        out: [
          { method: 'Bank Transfer', amount: 460000 },
          { method: 'Cash', amount: 150000 },
          { method: 'Instapay', amount: 80000 },
        ],
      },
    },
    OligenceAI: {
      clients: [
        { name: 'Red', monthlyFee: 23800, collected: 10000, outstanding: 13800, status: 'Partially Paid', serviceType: 'AI Automation', method: 'Bank Transfer', notes: 'Follow up on remaining balance' },
        { name: 'Bright Retail Co', monthlyFee: 72000, collected: 72000, outstanding: 0, status: 'Paid', serviceType: 'AI Chatbot & Automation', method: 'Bank Transfer', notes: 'On schedule' },
        { name: 'Delta Logistics', monthlyFee: 98000, collected: 49000, outstanding: 49000, status: 'Partially Paid', serviceType: 'Workflow Automation', method: 'Credit Card', notes: 'Second installment pending' },
        { name: 'Prime Health Group', monthlyFee: 110000, collected: 0, outstanding: 110000, status: 'Overdue', serviceType: 'AI Consulting', method: 'Bank Transfer', notes: 'Escalate to account manager' },
        { name: 'Vertex Studios', monthlyFee: 65000, collected: 65000, outstanding: 0, status: 'Paid', serviceType: 'AI Content Pipeline', method: 'Instapay', notes: 'On schedule' },
        { name: 'NorthStar Capital', monthlyFee: 90000, collected: 45000, outstanding: 45000, status: 'Partially Paid', serviceType: 'AI Automation', method: 'Bank Transfer', notes: 'Awaiting Q3 invoice payment' },
      ],
      expenses: [
        { description: 'Salaries', amount: 180000 },
        { description: 'Software & Tools', amount: 45000 },
        { description: 'Marketing', amount: 35000 },
        { description: 'Office & Admin', amount: 25000 },
        { description: 'Freelancers/Contractors', amount: 25000 },
      ],
      paymentMethods: {
        in: [
          { method: 'Bank Transfer', amount: 202000 },
          { method: 'Credit Card', amount: 49000 },
          { method: 'Instapay', amount: 65000 },
        ],
        out: [
          { method: 'Bank Transfer', amount: 220000 },
          { method: 'Cash', amount: 50000 },
          { method: 'Instapay', amount: 40000 },
        ],
      },
    },
    cashFlow: {
      totalIn: 3406000,
      totalOut: 1980000,
      netPosition: 1426000,
    },
  };

  // ---- Helpers -------------------------------------------------------------
  function round(n) {
    return Math.round(n);
  }

  function scaleRows(rows, factor, amountKeys) {
    return rows.map((row) => {
      const scaled = { ...row };
      amountKeys.forEach((key) => {
        if (typeof scaled[key] === 'number') scaled[key] = round(scaled[key] * factor);
      });
      return scaled;
    });
  }

  // Deterministic pseudo-random trend value in a plausible range, seeded by a string.
  function seededTrend(seed, min, max) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    const t = (hash % 1000) / 1000;
    return +(min + t * (max - min)).toFixed(1);
  }

  // Compute a scale factor from a custom date range relative to a "full" ~1 year window.
  function factorForRange(range, startDate, endDate) {
    if (range !== 'custom' || !startDate || !endDate) return 1;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
    const FULL_WINDOW_DAYS = 365;
    let factor = days / FULL_WINDOW_DAYS;
    // Clamp so tiny/huge ranges still produce sane, visibly-different numbers.
    factor = Math.max(0.03, Math.min(1, factor));
    return factor;
  }

  function buildBrandBlock(brandKey, brandData, totals, factor, kind) {
    const revenue = round(totals.revenue * factor);
    const expenses = round(totals.expenses * factor);
    const profit = revenue - expenses;
    const margin = revenue > 0 ? +((profit / revenue) * 100).toFixed(2) : 0;

    if (kind === 'agency') {
      const clients = scaleRows(brandData.clients, factor, ['monthlyFee', 'collected', 'outstanding']).map((c) => {
        // Re-derive status from scaled numbers so it stays consistent.
        let status = c.status;
        if (c.outstanding === 0) status = 'Paid';
        else if (c.collected === 0) status = 'Overdue';
        else status = 'Partially Paid';
        return { ...c, status };
      });
      const totalBilled = clients.reduce((s, c) => s + c.monthlyFee, 0);
      const totalCollected = clients.reduce((s, c) => s + c.collected, 0);
      const totalOutstanding = clients.reduce((s, c) => s + c.outstanding, 0);
      const collectionRate = totalBilled > 0 ? +((totalCollected / totalBilled) * 100).toFixed(2) : 0;

      return {
        kind: 'agency',
        kpis: {
          totalBilled,
          collected: totalCollected,
          outstanding: totalOutstanding,
          collectionRate,
          activeClients: clients.length,
          trends: {
            totalBilled: seededTrend(brandKey + 'billed', -4, 14),
            collected: seededTrend(brandKey + 'collected', -6, 12),
          },
        },
        clients,
        expenses: scaleRows(brandData.expenses, factor, ['amount']),
        paymentMethods: {
          in: scaleRows(brandData.paymentMethods.in, factor, ['amount']),
          out: scaleRows(brandData.paymentMethods.out, factor, ['amount']),
        },
      };
    }

    const courses = scaleRows(brandData.courses, factor, ['tickets', 'revenue']);
    const salesReps = scaleRows(brandData.salesReps, factor, ['revenue', 'tickets']);
    const totalTickets = courses.reduce((s, c) => s + c.tickets, 0);
    const totalRevenue = courses.reduce((s, c) => s + c.revenue, 0);
    const avgRevenuePerEnrollment = totalTickets > 0 ? round(totalRevenue / totalTickets) : 0;

    return {
      kind: 'training',
      kpis: {
        totalEnrollments: totalTickets,
        totalRevenue,
        avgRevenuePerEnrollment,
        activeProgramsCount: courses.length,
        trends: {
          totalRevenue: seededTrend(brandKey + 'rev', -5, 16),
        },
      },
      courses,
      salesReps,
      expenses: scaleRows(brandData.expenses, factor, ['amount']),
      paymentMethods: {
        in: scaleRows(brandData.paymentMethods.in, factor, ['amount']),
        out: scaleRows(brandData.paymentMethods.out, factor, ['amount']),
      },
    };
  }

  async function fetchDashboardDataMock({ range, startDate, endDate }) {
    // Simulate network latency.
    const delay = 500 + Math.floor(Math.random() * 300);
    await new Promise((resolve) => setTimeout(resolve, delay));

    const factor = factorForRange(range, startDate, endDate);

    // ---- Brands ----
    const imfnd = buildBrandBlock('IMFND', BASELINE.IMFND, BASELINE.brandTotals.IMFND, factor, 'training');
    const as = buildBrandBlock('AS', BASELINE.AS, BASELINE.brandTotals.AS, factor, 'training');
    const oligenceAI = buildBrandBlock('OligenceAI', BASELINE.OligenceAI, BASELINE.brandTotals.OligenceAI, factor, 'agency');

    // ---- Overview ----
    const brandTable = [
      { brand: 'IMFND', revenue: imfnd.kpis.totalRevenue, expenses: imfnd.expenses.reduce((s, e) => s + e.amount, 0), profit: 0, margin: 0 },
      { brand: 'A.S', revenue: as.kpis.totalRevenue, expenses: as.expenses.reduce((s, e) => s + e.amount, 0), profit: 0, margin: 0 },
      { brand: 'Oligence AI', revenue: oligenceAI.kpis.collected, expenses: oligenceAI.expenses.reduce((s, e) => s + e.amount, 0), profit: 0, margin: 0 },
    ].map((row) => {
      const profit = row.revenue - row.expenses;
      const margin = row.revenue > 0 ? +((profit / row.revenue) * 100).toFixed(2) : 0;
      return { ...row, profit, margin };
    });

    const totalRevenue = brandTable.reduce((s, b) => s + b.revenue, 0);
    const totalExpenses = brandTable.reduce((s, b) => s + b.expenses, 0);
    const netProfit = totalRevenue - totalExpenses;
    const netMargin = totalRevenue > 0 ? +((netProfit / totalRevenue) * 100).toFixed(2) : 0;

    // ---- Cash Flow ----
    const moneyIn = [
      ...imfnd.paymentMethods.in.map((p) => ({ brand: 'IMFND', method: p.method, amount: p.amount })),
      ...as.paymentMethods.in.map((p) => ({ brand: 'A.S', method: p.method, amount: p.amount })),
      ...oligenceAI.paymentMethods.in.map((p) => ({ brand: 'Oligence AI', method: p.method, amount: p.amount })),
    ];
    const moneyOut = [
      ...imfnd.paymentMethods.out.map((p) => ({ brand: 'IMFND', method: p.method, amount: p.amount })),
      ...as.paymentMethods.out.map((p) => ({ brand: 'A.S', method: p.method, amount: p.amount })),
      ...oligenceAI.paymentMethods.out.map((p) => ({ brand: 'Oligence AI', method: p.method, amount: p.amount })),
    ];
    const totalIn = moneyIn.reduce((s, r) => s + r.amount, 0);
    const totalOut = moneyOut.reduce((s, r) => s + r.amount, 0);
    const netPosition = totalIn - totalOut;

    return {
      meta: {
        range,
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString(),
      },
      overview: {
        kpis: {
          totalRevenue,
          totalExpenses,
          netProfit,
          netMargin,
          trends: {
            totalRevenue: seededTrend('ovRev' + range + startDate + endDate, -3, 15),
            totalExpenses: seededTrend('ovExp' + range + startDate + endDate, -8, 9),
            netProfit: seededTrend('ovProfit' + range + startDate + endDate, -2, 18),
            netMargin: seededTrend('ovMargin' + range + startDate + endDate, -3, 6),
          },
        },
        brandTable,
      },
      brands: {
        IMFND: imfnd,
        AS: as,
        OligenceAI: oligenceAI,
      },
      cashFlow: {
        kpis: { totalIn, totalOut, netPosition },
        moneyIn,
        moneyOut,
      },
    };
  }

  // ---- Live/mock switch -----------------------------------------------
  // Flip to true to call the real n8n webhook (URL comes from config.js,
  // window.N8N_WEBHOOK_URL). Leave false to keep using mock data.
  const USE_LIVE_WEBHOOK = true;

  async function fetchDashboardDataLive({ range, startDate, endDate }) {
    const url = global.N8N_WEBHOOK_URL;
    if (!url) throw new Error('N8N_WEBHOOK_URL is not set — check config.js');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range, startDate, endDate }),
    });
    if (!res.ok) throw new Error('Failed to fetch dashboard data: ' + res.status);
    return res.json();
  }

  async function fetchDashboardData(params) {
    return USE_LIVE_WEBHOOK ? fetchDashboardDataLive(params) : fetchDashboardDataMock(params);
  }

  global.fetchDashboardData = fetchDashboardData;
})(window);
