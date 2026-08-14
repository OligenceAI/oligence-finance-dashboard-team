/* ==========================================================================
 * app.js — Executive Finance Dashboard
 *
 * Data flow:
 *  - fetchDashboardData({ range, startDate, endDate }) is defined in
 *    mock-data.js (see that file's header comment for the full API
 *    contract / Phase 2 webhook swap instructions).
 *  - This file calls it in exactly two places (search "FETCH TRIGGER"):
 *      1) on initial page load, always with { range: 'all' }
 *      2) when the Refresh button is clicked, with whatever range the
 *         date-filter UI currently holds
 *  - Everything else (tab switching, date-input edits) only reads the
 *    already-fetched `state.data` object and re-renders from it.
 * ========================================================================== */

const state = {
  data: null,       // last fetched payload (see data.js contract)
  activeTab: 'overview',
  loading: false,
  error: null,
};

const els = {
  app: document.getElementById('app'),
  tabbar: document.getElementById('tabbar'),
  rangePreset: document.getElementById('rangePreset'),
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  refreshBtn: document.getElementById('refreshBtn'),
  refreshSpinner: document.getElementById('refreshSpinner'),
  lastUpdated: document.getElementById('lastUpdated'),
};

const charts = {}; // keyed by canvas id, so we can destroy/recreate on re-render

// ---------------------------------------------------------------- formatting

function fmtMoney(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function fmtPct(n) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  return n.toFixed(1) + '%';
}

function trendHtml(value, opts) {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  opts = opts || {};
  const isUp = value >= 0;
  const arrow = isUp ? '▲' : '▼';
  // For metrics where a decrease is the good outcome (e.g. expenses), flip which
  // color/direction reads as positive without changing the displayed sign of the number.
  const isGood = opts.invert ? !isUp : isUp;
  const cls = isGood ? 'up' : 'down';
  const suffix = opts.suffix || ' vs last period';
  return `<span class="trend ${cls}">${arrow} ${isUp ? '+' : ''}${value.toFixed(1)}%${suffix}</span>`;
}

function emptyRow(colspan, label) {
  return `<tr><td colspan="${colspan}" class="empty-state">${label || 'No data'}</td></tr>`;
}

function emptyPanel(label) {
  return `<div class="empty-state">${label || 'No data'}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- date presets

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computePresetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case 'this-month':
      return [new Date(y, m, 1), new Date(y, m + 1, 0)];
    case 'last-month':
      return [new Date(y, m - 1, 1), new Date(y, m, 0)];
    case 'this-quarter': {
      const qStartMonth = Math.floor(m / 3) * 3;
      return [new Date(y, qStartMonth, 1), new Date(y, qStartMonth + 3, 0)];
    }
    case 'this-year':
      return [new Date(y, 0, 1), new Date(y, 11, 31)];
    case 'all':
    default:
      return null;
  }
}

function applyPreset(preset) {
  if (preset === 'all') {
    els.startDate.value = '';
    els.endDate.value = '';
    return;
  }
  if (preset === 'custom') return; // leave whatever dates are already set
  const range = computePresetRange(preset);
  if (range) {
    els.startDate.value = ymd(range[0]);
    els.endDate.value = ymd(range[1]);
  }
}

function currentRangeParams() {
  const preset = els.rangePreset.value;
  if (preset === 'all') {
    return { range: 'all', startDate: null, endDate: null };
  }
  // Any non-"all" preset (including "custom") resolves to explicit dates.
  return {
    range: 'custom',
    startDate: els.startDate.value || null,
    endDate: els.endDate.value || null,
  };
}

// ---------------------------------------------------------------- fetching

async function loadData(params) {
  state.loading = true;
  state.error = null;
  render(); // show skeleton
  toggleRefreshSpinner(true);

  try {
    const data = await fetchDashboardData(params); // <-- FETCH TRIGGER
    state.data = data;
    updateLastUpdated();
  } catch (err) {
    state.error = err.message || 'Failed to load dashboard data.';
  } finally {
    state.loading = false;
    toggleRefreshSpinner(false);
    render();
  }
}

function toggleRefreshSpinner(on) {
  els.refreshSpinner.hidden = !on;
  els.refreshBtn.disabled = on;
}

function updateLastUpdated() {
  const now = new Date();
  els.lastUpdated.textContent = 'Last updated: ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------------------------------------------------------------- events

els.rangePreset.addEventListener('change', () => {
  applyPreset(els.rangePreset.value);
  // Changing the filter alone does NOT trigger a fetch — only Refresh does.
});

[els.startDate, els.endDate].forEach((input) => {
  input.addEventListener('change', () => {
    els.rangePreset.value = 'custom';
    // Manual date edits also do not trigger a fetch on their own.
  });
});

els.refreshBtn.addEventListener('click', () => {
  loadData(currentRangeParams()); // <-- FETCH TRIGGER (Refresh)
});

els.tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  state.activeTab = btn.dataset.tab;
  [...els.tabbar.children].forEach((t) => t.classList.toggle('active', t === btn));
  render(); // tab switching never fetches, only re-renders from state.data
});

// ---------------------------------------------------------------- render root

function render() {
  if (state.loading) {
    els.app.innerHTML = document.getElementById('tpl-skeleton').innerHTML;
    return;
  }

  if (state.error && !state.data) {
    els.app.innerHTML = `<div class="error-banner">Could not load dashboard data: ${escapeHtml(state.error)}</div>`;
    return;
  }

  if (!state.data) {
    els.app.innerHTML = `<div class="empty-state">No data loaded yet.</div>`;
    return;
  }

  const errorBanner = state.error
    ? `<div class="error-banner">Could not refresh: ${escapeHtml(state.error)} — showing last successful data.</div>`
    : '';

  switch (state.activeTab) {
    case 'overview': return renderOverview(errorBanner);
    case 'imfnd': return renderBrand('IMFND', 'IMFND', errorBanner);
    case 'as': return renderBrand('AS', 'A.S', errorBanner);
    case 'oligenceai': return renderOligenceAI(errorBanner);
    case 'cashflow': return renderCashFlow(errorBanner);
  }
}

// ---------------------------------------------------------------- Overview

function renderOverview(errorBanner) {
  const d = state.data.overview || {};
  const k = d.kpis || {};
  const trends = k.trends || {};
  const brandTable = d.brandTable || [];

  els.app.innerHTML = `
    ${errorBanner || ''}
    <div class="panel-header">
      <h1>Executive Overview</h1>
      <p>Company-wide performance summary</p>
    </div>

    <div class="kpi-row">
      ${kpiCard('Total Revenue (EGP)', fmtMoney(k.totalRevenue), trendHtml(trends.totalRevenue))}
      ${kpiCard('Total Expenses (EGP)', fmtMoney(k.totalExpenses), trendHtml(trends.totalExpenses, { invert: true }))}
      ${kpiCard('Net Profit (EGP)', fmtMoney(k.netProfit), trendHtml(trends.netProfit))}
      ${kpiCard('Net Margin %', fmtPct(k.netMargin), `<span class="kpi-caption">${k.netMargin === undefined || k.netMargin === null ? '' : (k.netMargin >= 40 ? 'Healthy profitability' : 'Margin needs attention')}</span>`)}
    </div>

    <div class="grid-2">
      <div class="section">
        <h2 class="section-title">Brand Performance</h2>
        <div class="table-scroll">
          <table>
            <thead>
              <tr><th>Brand</th><th class="num">Revenue</th><th class="num">Expenses</th><th class="num">Net Profit</th><th class="num">Margin %</th></tr>
            </thead>
            <tbody>
              ${brandTable.length ? brandTable.map((b) => `
                <tr>
                  <td>${escapeHtml(b.brand)}</td>
                  <td class="num">${fmtMoney(b.revenue)}</td>
                  <td class="num">${fmtMoney(b.expenses)}</td>
                  <td class="num">${fmtMoney(b.profit)}</td>
                  <td class="num">${fmtPct(b.margin)}</td>
                </tr>
              `).join('') : emptyRow(5)}
              ${brandTable.length ? `
                <tr class="total-row">
                  <td>Total</td>
                  <td class="num">${fmtMoney(k.totalRevenue)}</td>
                  <td class="num">${fmtMoney(k.totalExpenses)}</td>
                  <td class="num">${fmtMoney(k.netProfit)}</td>
                  <td class="num">${fmtPct(k.netMargin)}</td>
                </tr>
              ` : ''}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">Revenue Contribution by Brand</h2>
        <div class="chart-wrap">${brandTable.length ? '<canvas id="chartBrandRevenue"></canvas>' : emptyPanel()}</div>
      </div>

      <div class="section">
        <h2 class="section-title">Revenue vs Expenses vs Net Profit by Brand</h2>
        <div class="chart-wrap">${brandTable.length ? '<canvas id="chartBrandComparison"></canvas>' : emptyPanel()}</div>
      </div>
    </div>
  `;

  if (brandTable.length) {
    drawDonutChart('chartBrandRevenue', brandTable.map((b) => b.brand), brandTable.map((b) => b.revenue));
    drawBrandComparisonChart(brandTable);
  }
}

function kpiCard(label, value, sub) {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${sub}
    </div>
  `;
}

// ---------------------------------------------------------------- Brand tabs (IMFND / A.S)

function renderBrand(key, displayName, errorBanner) {
  const b = (state.data.brands && state.data.brands[key]) || {};
  const k = b.kpis || {};
  const courses = b.courses || [];
  const salesReps = b.salesReps || [];
  const expenses = b.expenses || [];
  const paymentIn = (b.paymentMethods && b.paymentMethods.in) || [];
  const paymentOut = (b.paymentMethods && b.paymentMethods.out) || [];
  const trends = k.trends || {};

  const totalTickets = courses.reduce((s, c) => s + (c.tickets || 0), 0);
  const totalRevenue = courses.reduce((s, c) => s + (c.revenue || 0), 0);
  const totalRepRevenue = salesReps.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalRepTickets = salesReps.reduce((s, r) => s + (r.tickets || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIn = paymentIn.reduce((s, p) => s + (p.amount || 0), 0);
  const totalOut = paymentOut.reduce((s, p) => s + (p.amount || 0), 0);

  els.app.innerHTML = `
    ${errorBanner || ''}
    <div class="panel-header">
      <h1>${displayName} — Brand Detail</h1>
      <p>Training &amp; diploma business · Revenue, sales performance &amp; expenses</p>
    </div>

    <div class="kpi-row kpi-3">
      ${kpiCard('Total Enrollments', k.totalEnrollments === undefined || k.totalEnrollments === null ? '—' : k.totalEnrollments.toLocaleString('en-US'), `<span class="kpi-caption">${k.activeProgramsCount === undefined || k.activeProgramsCount === null ? '' : `Across ${k.activeProgramsCount} active programs`}</span>`)}
      ${kpiCard('Total Revenue (EGP)', fmtMoney(k.totalRevenue), trendHtml(trends.totalRevenue))}
      ${kpiCard('Avg. Revenue per Enrollment (EGP)', fmtMoney(k.avgRevenuePerEnrollment), `<span class="kpi-caption">Blended across all courses</span>`)}
    </div>

    <div class="section">
      <h2 class="section-title">Revenue by Diploma / Course</h2>
      <div class="grid-2">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Course / Diploma</th><th class="num">Tickets Sold</th><th class="num">Revenue</th></tr></thead>
            <tbody>
              ${courses.length ? courses.map((c) => `
                <tr><td>${escapeHtml(c.name)}</td><td class="num">${(c.tickets || 0).toLocaleString('en-US')}</td><td class="num">${fmtMoney(c.revenue)}</td></tr>
              `).join('') : emptyRow(3)}
              ${courses.length ? `<tr class="total-row"><td>Total</td><td class="num">${totalTickets.toLocaleString('en-US')}</td><td class="num">${fmtMoney(totalRevenue)}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
        <div class="chart-wrap">${courses.length ? '<canvas id="chartCourseRevenue"></canvas>' : emptyPanel()}</div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Sales Representatives</h2>
      <div class="grid-2">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Sales Representative</th><th class="num">Revenue</th><th class="num">Tickets Sold</th></tr></thead>
            <tbody>
              ${salesReps.length ? salesReps.map((r) => `
                <tr><td>${escapeHtml(r.name)}</td><td class="num">${fmtMoney(r.revenue)}</td><td class="num">${(r.tickets || 0).toLocaleString('en-US')}</td></tr>
              `).join('') : emptyRow(3)}
              ${salesReps.length ? `<tr class="total-row"><td>Total</td><td class="num">${fmtMoney(totalRepRevenue)}</td><td class="num">${totalRepTickets.toLocaleString('en-US')}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
        <div class="chart-wrap">${salesReps.length ? '<canvas id="chartSalesRepRevenue"></canvas>' : emptyPanel()}</div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Expenses</h2>
      <div class="grid-2">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
            <tbody>
              ${expenses.length ? expenses.map((e) => `
                <tr><td>${escapeHtml(e.description)}</td><td class="num">${fmtMoney(e.amount)}</td></tr>
              `).join('') : emptyRow(2)}
              ${expenses.length ? `<tr class="total-row"><td>Total</td><td class="num">${fmtMoney(totalExpenses)}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
        <div class="chart-wrap">${expenses.length ? '<canvas id="chartExpenses"></canvas>' : emptyPanel()}</div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Payment Methods</h2>
      <div class="grid-2">
        ${paymentMiniTable('Incoming', paymentIn, totalIn)}
        ${paymentMiniTable('Outgoing', paymentOut, totalOut)}
      </div>
      <div class="chart-wrap">${(paymentIn.length || paymentOut.length) ? '<canvas id="chartPaymentMethods"></canvas>' : emptyPanel()}</div>
    </div>
  `;

  if (courses.length) drawHorizontalBarChart('chartCourseRevenue', courses.map((c) => c.name), courses.map((c) => c.revenue));
  if (salesReps.length) drawHorizontalBarChart('chartSalesRepRevenue', salesReps.map((r) => r.name), salesReps.map((r) => r.revenue));
  if (expenses.length) drawExpensesPieChart('chartExpenses', expenses.map((e) => e.description), expenses.map((e) => e.amount));
  if (paymentIn.length || paymentOut.length) drawPaymentMethodsChart('chartPaymentMethods', paymentIn, paymentOut);
}

function paymentMiniTable(title, rows, total) {
  return `
    <div>
      <h3 style="font-size:13px;font-weight:700;margin:0 0 10px;color:var(--text-muted);">${title}</h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Method</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((p) => `<tr><td>${escapeHtml(p.method)}</td><td class="num">${fmtMoney(p.amount)}</td></tr>`).join('') : emptyRow(2)}
            ${rows.length ? `<tr class="total-row"><td>Total</td><td class="num">${fmtMoney(total)}</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------- Oligence AI tab

function renderOligenceAI(errorBanner) {
  const b = (state.data.brands && state.data.brands.OligenceAI) || {};
  const k = b.kpis || {};
  const clients = b.clients || [];
  const expenses = b.expenses || [];
  const paymentIn = (b.paymentMethods && b.paymentMethods.in) || [];
  const paymentOut = (b.paymentMethods && b.paymentMethods.out) || [];

  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIn = paymentIn.reduce((s, p) => s + (p.amount || 0), 0);
  const totalOut = paymentOut.reduce((s, p) => s + (p.amount || 0), 0);
  const totalCollected = clients.reduce((s, c) => s + (c.collected || 0), 0);
  const totalOutstanding = clients.reduce((s, c) => s + (c.outstanding || 0), 0);

  els.app.innerHTML = `
    ${errorBanner || ''}
    <div class="panel-header">
      <h1>Oligence AI — Brand Detail</h1>
      <p>AI agency · Client billing, collections &amp; expenses</p>
    </div>

    <div class="kpi-row">
      ${kpiCard('Collected (EGP)', fmtMoney(k.collected), `<span class="kpi-caption">${k.collectionRate === undefined || k.collectionRate === null ? '' : `${fmtPct(k.collectionRate)} of billed`}</span>`)}
      ${kpiCard('Outstanding (EGP)', fmtMoney(k.outstanding), `<span class="kpi-caption">Needs follow-up</span>`)}
      ${kpiCard('Collection Rate %', fmtPct(k.collectionRate), `<span class="kpi-caption">Target: 95%+</span>`)}
    </div>

    <div class="section">
      <h2 class="section-title">Client Overview</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Client Name</th><th class="num">Collected</th><th class="num">Outstanding</th>
              <th>Service Type</th><th>Method</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${clients.length ? clients.map((c) => `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td class="num">${fmtMoney(c.collected)}</td>
                <td class="num">${fmtMoney(c.outstanding)}</td>
                <td>${escapeHtml(c.serviceType || '')}</td>
                <td>${escapeHtml(c.method || '')}</td>
                <td>${escapeHtml(c.notes || '')}</td>
              </tr>
            `).join('') : emptyRow(6)}
            ${clients.length ? `
              <tr class="total-row">
                <td>Total</td><td class="num">${fmtMoney(totalCollected)}</td>
                <td class="num">${fmtMoney(totalOutstanding)}</td><td></td><td></td><td></td>
              </tr>
            ` : ''}
          </tbody>
        </table>
      </div>
      <div class="chart-wrap">${clients.length ? '<canvas id="chartClientCollections"></canvas>' : emptyPanel()}</div>
    </div>

    <div class="section">
      <h2 class="section-title">Expenses</h2>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
          <tbody>
            ${expenses.length ? expenses.map((e) => `<tr><td>${escapeHtml(e.description)}</td><td class="num">${fmtMoney(e.amount)}</td></tr>`).join('') : emptyRow(2)}
            ${expenses.length ? `<tr class="total-row"><td>Total</td><td class="num">${fmtMoney(totalExpenses)}</td></tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Payment Methods</h2>
      <div class="grid-2">
        ${paymentMiniTable('Incoming', paymentIn, totalIn)}
        ${paymentMiniTable('Outgoing', paymentOut, totalOut)}
      </div>
      <div class="chart-wrap">${(paymentIn.length || paymentOut.length) ? '<canvas id="chartPaymentMethods"></canvas>' : emptyPanel()}</div>
    </div>
  `;

  if (clients.length) drawClientCollectionsChart(clients);
  if (paymentIn.length || paymentOut.length) drawPaymentMethodsChart('chartPaymentMethods', paymentIn, paymentOut);
}

// ---------------------------------------------------------------- Cash Flow tab

function renderCashFlow(errorBanner) {
  const cf = state.data.cashFlow || {};
  const k = cf.kpis || {};
  const moneyIn = cf.moneyIn || [];
  const moneyOut = cf.moneyOut || [];
  const brandOrder = ['IMFND', 'A.S', 'Oligence AI'];

  els.app.innerHTML = `
    ${errorBanner || ''}
    <div class="panel-header">
      <h1>Cash &amp; Payment Flow</h1>
      <p>Where money came from, where it went, and which section funded another</p>
    </div>

    <div class="kpi-row kpi-3">
      ${kpiCard('Total Money In (EGP)', fmtMoney(k.totalIn), `<span class="kpi-caption">Cash actually collected</span>`)}
      ${kpiCard('Total Money Out (EGP)', fmtMoney(k.totalOut), `<span class="kpi-caption">Cash actually paid out</span>`)}
      ${kpiCard('Net Cash Position (EGP)', fmtMoney(k.netPosition), `<span class="kpi-caption">In minus Out</span>`)}
    </div>

    <div class="section">
      <h2 class="section-title">Money In vs Money Out by Payment Method</h2>
      <div class="chart-wrap">${moneyIn.length ? '<canvas id="chartCashFlow"></canvas>' : emptyPanel()}</div>
    </div>

    <div class="grid-2">
      <div class="section">
        <h2 class="section-title">Money In</h2>
        ${cashFlowTable(moneyIn, brandOrder, k.totalIn)}
      </div>
      <div class="section">
        <h2 class="section-title">Money Out</h2>
        ${cashFlowTable(moneyOut, brandOrder, k.totalOut)}
      </div>
    </div>
  `;

  if (moneyIn.length) drawCashFlowChart(moneyIn, brandOrder);
}

function cashFlowTable(rows, brandOrder, total) {
  if (!rows.length) {
    return `<div class="table-scroll"><table><tbody>${emptyRow(3)}</tbody></table></div>`;
  }

  const grouped = brandOrder.map((brand) => ({
    brand,
    rows: rows.filter((r) => r.brand === brand),
  })).filter((g) => g.rows.length);

  return `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Brand / Section</th><th>Payment Method</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${grouped.map((g) => `
            <tr class="group-row"><td colspan="3">${escapeHtml(g.brand)}</td></tr>
            ${g.rows.map((r) => `
              <tr><td></td><td>${escapeHtml(r.method)}</td><td class="num">${fmtMoney(r.amount)}</td></tr>
            `).join('')}
          `).join('')}
          <tr class="total-row"><td>Total</td><td></td><td class="num">${fmtMoney(total)}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------- charts

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function chartColors() {
  return { accent: '#06aea3', accentSoft: '#5b49d3', warm: '#b7791f', rose: '#c23a3a', muted: '#94949c' };
}

const BRAND_COLORS = { IMFND: '#000000', 'A.S': '#06AEA3', 'Oligence AI': '#5B49D3' };

function drawDonutChart(canvasId, labels, values) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  charts[canvasId] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((l) => BRAND_COLORS[l] || '#94949c'),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, color: '#6b7076' } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
      cutout: '62%',
    },
  });
}

const pieLabelPlugin = {
  id: 'pieLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const total = chart.data.datasets[0].data.reduce((s, v) => s + (v || 0), 0);
    if (!total) return;
    ctx.save();
    ctx.font = '600 12px Arial, sans-serif';
    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    meta.data.forEach((arc, i) => {
      const value = chart.data.datasets[0].data[i] || 0;
      const pct = value / total;
      if (pct < 0.02) return;
      const { x, y } = arc.tooltipPosition();
      ctx.fillText(`${Math.round(pct * 100)}%`, x, y);
    });
    ctx.restore();
  },
};

const PIE_PALETTE = ['#5b49d3', '#3f6fb0', '#8a5fb0', '#c23a3a', '#b7791f', '#94949c', '#06aea3', '#2e9e8f', '#d18a3d', '#6b8e6b'];

function drawExpensesPieChart(canvasId, labels, values) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  charts[canvasId] = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => PIE_PALETTE[i % PIE_PALETTE.length]),
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 }, color: '#6b7076' } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
    plugins: [pieLabelPlugin],
  });
}

function drawBrandComparisonChart(brandTable) {
  const canvasId = 'chartBrandComparison';
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const c = chartColors();

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: brandTable.map((b) => b.brand),
      datasets: [
        { label: 'Revenue', data: brandTable.map((b) => b.revenue), backgroundColor: c.accent, borderRadius: 4 },
        { label: 'Expenses', data: brandTable.map((b) => b.expenses), backgroundColor: c.rose, borderRadius: 4 },
        { label: 'Net Profit', data: brandTable.map((b) => b.profit), backgroundColor: c.accentSoft, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: {
          ticks: { callback: (v) => fmtMoney(v) },
          grid: { color: '#e4e5e1' },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, color: '#6b7076' } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
  });
}

const barLabelPlugin = {
  id: 'barLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const labels = chart.data.labels;
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'middle';
    meta.data.forEach((bar, i) => {
      const label = labels[i];
      if (!label) return;
      const textWidth = ctx.measureText(label).width;
      const insideBar = (bar.x - bar.base) > textWidth + 16;
      if (insideBar) {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(label, bar.base + 8, bar.y);
      } else {
        ctx.fillStyle = '#3a3a42';
        ctx.textAlign = 'left';
        ctx.fillText(label, bar.x + 8, bar.y);
      }
    });
    ctx.restore();
  },
};

function drawHorizontalBarChart(canvasId, labels, values) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const paired = labels.map((label, i) => ({ label, value: values[i] || 0 })).sort((a, b) => a.value - b.value);

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: paired.map((p) => p.label),
      datasets: [{
        data: paired.map((p) => p.value),
        backgroundColor: '#5b49d3',
        borderRadius: 2,
        barPercentage: 0.7,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 60 } },
      scales: {
        x: { grid: { color: '#000000' }, ticks: { display: false } },
        y: { grid: { display: false }, ticks: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
    plugins: [barLabelPlugin],
  });
}

function drawPaymentMethodsChart(canvasId, paymentIn, paymentOut) {
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const c = chartColors();

  const methods = [...new Set([...paymentIn.map((p) => p.method), ...paymentOut.map((p) => p.method)])];
  const inByMethod = (method) => (paymentIn.find((p) => p.method === method) || {}).amount || 0;
  const outByMethod = (method) => (paymentOut.find((p) => p.method === method) || {}).amount || 0;

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: methods,
      datasets: [
        { label: 'Incoming', data: methods.map(inByMethod), backgroundColor: c.accent, borderRadius: 4 },
        { label: 'Outgoing', data: methods.map(outByMethod), backgroundColor: c.rose, borderRadius: 4 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: {
          ticks: { callback: (v) => fmtMoney(v) },
          grid: { color: '#e4e5e1' },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, color: '#6b7076' } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
  });
}

function drawCashFlowChart(moneyIn, brandOrder) {
  const canvasId = 'chartCashFlow';
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const methods = [...new Set(moneyIn.map((r) => r.method))];
  const palette = ['#06aea3', '#5b49d3', '#b7791f', '#c23a3a', '#94949c', '#3f6fb0', '#8a5fb0', '#2e9e8f', '#d18a3d', '#6b8e6b'];

  const datasets = methods.map((method, i) => ({
    label: method,
    data: brandOrder.map((brand) => {
      const row = moneyIn.find((r) => r.brand === brand && r.method === method);
      return row ? row.amount : 0;
    }),
    backgroundColor: palette[i % palette.length],
    borderRadius: 4,
  }));

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: { labels: brandOrder, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          ticks: { callback: (v) => fmtMoney(v) },
          grid: { color: '#e4e5e1' },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, color: '#6b7076' } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
  });
}

function drawClientCollectionsChart(clients) {
  const canvasId = 'chartClientCollections';
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: clients.map((c) => c.name),
      datasets: [
        { label: 'Collected', data: clients.map((c) => c.collected || 0), backgroundColor: '#1f9d55', borderRadius: 2 },
        { label: 'Outstanding', data: clients.map((c) => c.outstanding || 0), backgroundColor: '#c0392b', borderRadius: 2 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: '#e4e5e1' }, ticks: { callback: (v) => fmtMoney(v) } },
        y: { stacked: true, grid: { display: false } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 }, color: '#6b7076' } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------- init

(function init() {
  // Default UI state visually matches "All Time" before any fetch happens.
  els.rangePreset.value = 'all';
  els.startDate.value = '';
  els.endDate.value = '';

  loadData({ range: 'all', startDate: null, endDate: null }); // <-- FETCH TRIGGER (initial load)
})();
