/* ==========================================================================
 * app.js — Executive Finance Dashboard
 *
 * Data flow:
 *  - fetchDashboardData({ range, startDate, endDate }) is defined in
 *    data.js (see that file's header comment for the full API contract).
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
  logoutBtn: document.getElementById('logoutBtn'),
  usersTab: document.getElementById('usersTab'),
};

const usersState = { list: null, loading: false, error: null, resetTarget: null };

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

// A client may list its services as an array (new shape) or as flat serviceType/
// serviceName/method/notes fields (legacy/live-webhook shape) — normalize to an array.
function clientServices(c) {
  if (Array.isArray(c.services) && c.services.length) return c.services;
  if (c.serviceType || c.serviceName || c.method || c.notes) {
    return [{ serviceType: c.serviceType, serviceName: c.serviceName, method: c.method, notes: c.notes }];
  }
  return [];
}

// The webhook may send one row per client (with a services array or a single flat
// service) or one row per client+service (same client name repeated). Merge same-name
// rows into a single client with a combined services list, keeping only the first
// non-empty financial figures so repeated rows for one client aren't double-counted.
function groupClients(clients) {
  const order = [];
  const map = new Map();
  clients.forEach((c) => {
    const key = c.name || '';
    if (!map.has(key)) {
      map.set(key, { name: c.name, monthlyFee: 0, collected: 0, outstanding: 0, expense: 0, status: c.status, services: [], months: [] });
      order.push(key);
    }
    const g = map.get(key);
    if (!g.monthlyFee) g.monthlyFee = c.monthlyFee || 0;
    if (!g.collected) g.collected = c.collected || 0;
    if (!g.outstanding) g.outstanding = c.outstanding || 0;
    if (!g.expense) g.expense = c.expense || 0;
    g.services.push(...clientServices(c));
    if (Array.isArray(c.months)) g.months.push(...c.months);
  });
  return order.map((key) => map.get(key));
}

// Revenue/collected/outstanding for a client: prefer summing its monthly
// breakdown (c.months, the new per-month shape) when the webhook sends one,
// falling back to the flat client-level totals (legacy shape) otherwise.
function clientTotals(c) {
  if (Array.isArray(c.months) && c.months.length) {
    return c.months.reduce((acc, m) => {
      acc.revenue += m.revenue || 0;
      acc.collected += m.collected || 0;
      acc.outstanding += m.outstanding || 0;
      return acc;
    }, { revenue: 0, collected: 0, outstanding: 0 });
  }
  return { revenue: c.monthlyFee || 0, collected: c.collected || 0, outstanding: c.outstanding || 0 };
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

els.logoutBtn.addEventListener('click', async () => {
  els.logoutBtn.disabled = true;
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
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
  if (state.activeTab === 'users') return renderUsersTab();

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
    case 'as': return renderBrand('AS', 'AS', errorBanner);
    case 'oligenceai': return renderOligenceAI(errorBanner);
    case 'cashflow': return renderCashFlow(errorBanner);
  }
}

// -------------------------------------------------------------- Team Members

async function loadUsers() {
  usersState.loading = true;
  usersState.error = null;
  render();
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load members');
    usersState.list = data.users;
  } catch (err) {
    usersState.error = err.message;
  } finally {
    usersState.loading = false;
    render();
  }
}

function renderUsersTab() {
  if (usersState.list === null && !usersState.loading && !usersState.error) {
    loadUsers();
    return;
  }

  const rows = (usersState.list || [])
    .map((u) => {
      const added = new Date(u.addedAt).toLocaleDateString();
      const roleBadge = `<span class="role-badge ${u.role}">${u.role === 'owner' ? 'Owner' : 'Member'}</span>`;
      const removeAction = u.role === 'owner'
        ? `<span style="color:var(--text-faint);font-size:12px;">Protected</span>`
        : `<button class="users-remove-btn" data-email="${escapeHtml(u.email)}">Remove</button>`;
      const resetAction = `<button class="users-reset-btn" data-email="${escapeHtml(u.email)}">Reset password</button>`;
      return `<tr><td>${escapeHtml(u.email)}</td><td>${roleBadge}</td><td>${added}</td><td>${resetAction} ${removeAction}</td></tr>`;
    })
    .join('');

  const listBody = usersState.loading
    ? '<p>Loading…</p>'
    : usersState.error
      ? `<p class="users-error visible">${escapeHtml(usersState.error)}</p>`
      : `<table class="users-table">
           <thead><tr><th>Email</th><th>Role</th><th>Added</th><th>Actions</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`;

  const resetCard = usersState.resetTarget
    ? `<div class="users-card">
         <h3>Reset password</h3>
         <p>Set a new password for <strong>${escapeHtml(usersState.resetTarget)}</strong>. No need to know the old one.</p>
         <form class="users-form" id="resetPasswordForm">
           <label>New password
             <input type="password" id="resetPasswordValue" minlength="8" required placeholder="8 characters or more" />
           </label>
           <button type="submit" class="btn-primary" id="resetPasswordBtn">Save new password</button>
           <button type="button" class="btn-secondary" id="resetPasswordCancel">Cancel</button>
         </form>
         <div class="users-error" id="resetPasswordError"></div>
       </div>`
    : '';

  els.app.innerHTML = `
    <div class="users-panel">
      <div class="panel-header">
        <h1>Team Members</h1>
        <p>Everyone who can sign in to this dashboard.</p>
      </div>
      <div class="users-card">
        <h3>Add a member</h3>
        <p>They sign in at /login with this email and password.</p>
        <form class="users-form" id="addUserForm">
          <label>Email
            <input type="email" id="newUserEmail" required />
          </label>
          <label>Password
            <input type="password" id="newUserPassword" minlength="8" required placeholder="8 characters or more" />
          </label>
          <button type="submit" class="btn-primary" id="addUserBtn">Add member</button>
        </form>
        <div class="users-error" id="addUserError"></div>
      </div>
      ${resetCard}
      <div class="users-card">
        <h3>All members</h3>
        ${listBody}
      </div>
    </div>
  `;

  const form = document.getElementById('addUserForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('newUserEmail').value;
    const password = document.getElementById('newUserPassword').value;
    const errEl = document.getElementById('addUserError');
    const btn = document.getElementById('addUserBtn');
    errEl.classList.remove('visible');
    btn.disabled = true;
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add member');
      usersState.list = null;
      loadUsers();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.add('visible');
      btn.disabled = false;
    }
  });

  els.app.querySelectorAll('.users-remove-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Remove ${btn.dataset.email}?`)) return;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/users?email=${encodeURIComponent(btn.dataset.email)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove member');
        usersState.list = null;
        loadUsers();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });

  els.app.querySelectorAll('.users-reset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      usersState.resetTarget = btn.dataset.email;
      render();
    });
  });

  const resetForm = document.getElementById('resetPasswordForm');
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('resetPasswordValue').value;
      const errEl = document.getElementById('resetPasswordError');
      const btn = document.getElementById('resetPasswordBtn');
      errEl.classList.remove('visible');
      btn.disabled = true;
      try {
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: usersState.resetTarget, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reset password');
        usersState.resetTarget = null;
        render();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('visible');
        btn.disabled = false;
      }
    });

    document.getElementById('resetPasswordCancel').addEventListener('click', () => {
      usersState.resetTarget = null;
      render();
    });
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
      ${kpiCard('Total Cash in (EGP)', fmtMoney(k.totalRevenue), trendHtml(trends.totalRevenue))}
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
              <tr><th>Brand</th><th class="num">Cash in</th><th class="num">Expenses</th><th class="num">Net Profit</th><th class="num">Margin %</th></tr>
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

// Cash-in transactions count card: reads only the current brand's own kpis,
// so IMFND's card is fed by IMFND's sheet and A.S's card by A.S's sheet.
function txnCountCard(k) {
  const count = k.cashTransactionsCount;
  const value = count === undefined || count === null ? '—' : count.toLocaleString('en-US');

  return `
    <div class="kpi-card">
      <div class="kpi-label">Cash In — Number of Transactions</div>
      <div class="kpi-value">${value}</div>
      <span class="kpi-caption">Transactions behind Total Cash in (EGP)</span>
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
      <p>Training &amp; diploma business · Cash in, sales performance &amp; expenses</p>
    </div>

    <div class="kpi-row kpi-5">
      ${kpiCard('Tickets Sold', k.totalEnrollments === undefined || k.totalEnrollments === null ? '—' : k.totalEnrollments.toLocaleString('en-US'), `<span class="kpi-caption">${k.activeProgramsCount === undefined || k.activeProgramsCount === null ? '' : `Across ${k.activeProgramsCount} active programs`}</span>`)}
      ${kpiCard('Total New Tickets Revenue', fmtMoney(k.newTicketsRevenue), trendHtml(trends.newTicketsRevenue))}
      ${kpiCard('Avg.New Tickets', fmtMoney(k.avgRevenuePerEnrollment), `<span class="kpi-caption">Blended across all courses</span>`)}
      ${kpiCard('Total Cash in (EGP)', fmtMoney(k.totalRevenue), trendHtml(trends.totalRevenue))}
      ${txnCountCard(k)}
    </div>

    <div class="section">
      <h2 class="section-title">Cash in by Diploma / Course</h2>
      <div class="grid-2">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Course / Diploma</th><th class="num">Tickets Sold</th><th class="num">Cash in</th></tr></thead>
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
            <thead><tr><th>Sales Representative</th><th class="num">Cash in</th><th class="num">Tickets Sold</th></tr></thead>
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

// Legacy (flat) shape: one client-row per client, one row per service under it.
function clientOverviewRowsFlat(clients) {
  return clients.map((c) => {
    const rows = c.services.length ? c.services : [{}];
    return rows.map((s, i) => `
      <tr class="${i === 0 ? 'client-row' : ''}">
        <td>${i === 0 ? escapeHtml(c.name) : ''}</td>
        <td class="num">${i === 0 ? fmtMoney(c.monthlyFee) : ''}</td>
        <td class="num">${i === 0 ? fmtMoney(c.collected) : ''}</td>
        <td class="num">${i === 0 ? fmtMoney(c.outstanding) : ''}</td>
        <td>${escapeHtml(s.serviceType || '')}</td>
        <td>${escapeHtml(s.serviceName || '')}</td>
        <td>${escapeHtml(s.method || '')}</td>
        <td>${escapeHtml(s.notes || '')}</td>
      </tr>
    `).join('');
  }).join('');
}

// New (grouped) shape: per client — a TOTAL row, then one row-group per
// month (client.months[]), each month split into its service rows.
function clientOverviewRowsGrouped(clients) {
  return clients.map((c) => {
    const totals = clientTotals(c);
    const totalRow = `
      <tr class="client-row">
        <td>${escapeHtml(c.name)}</td>
        <td>TOTAL</td>
        <td class="num">${fmtMoney(totals.revenue)}</td>
        <td class="num">${fmtMoney(totals.collected)}</td>
        <td class="num">${fmtMoney(totals.outstanding)}</td>
        <td></td><td></td><td></td><td></td>
      </tr>
    `;
    const monthRows = (c.months || []).map((m, mi) => {
      const services = (m.services && m.services.length) ? m.services : [{}];
      const summaryRow = `
        <tr class="month-summary-row ${mi > 0 ? 'month-divider' : ''}">
          <td></td>
          <td>${escapeHtml(m.month || '')}</td>
          <td class="num">${fmtMoney(m.revenue)}</td>
          <td class="num">${fmtMoney(m.collected)}</td>
          <td class="num">${fmtMoney(m.outstanding)}</td>
          <td></td><td></td><td></td><td></td>
        </tr>
      `;
      const serviceRows = services.map((s) => `
        <tr>
          <td></td>
          <td></td>
          <td class="num"></td>
          <td class="num">${s.collected !== undefined && s.collected !== null ? fmtMoney(s.collected) : ''}</td>
          <td class="num"></td>
          <td>${escapeHtml(s.serviceType || '')}</td>
          <td>${escapeHtml(s.serviceName || '')}</td>
          <td>${escapeHtml(s.method || '')}</td>
          <td>${escapeHtml(s.notes || '')}</td>
        </tr>
      `).join('');
      return summaryRow + serviceRows;
    }).join('');
    return totalRow + monthRows;
  }).join('');
}

// ---------------------------------------------------------------- Oligence AI tab

function renderOligenceAI(errorBanner) {
  const b = (state.data.brands && state.data.brands.OligenceAI) || {};
  const k = b.kpis || {};
  const clients = groupClients(b.clients || []);
  const expenses = b.expenses || [];
  const paymentIn = (b.paymentMethods && b.paymentMethods.in) || [];
  const paymentOut = (b.paymentMethods && b.paymentMethods.out) || [];

  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const totalIn = paymentIn.reduce((s, p) => s + (p.amount || 0), 0);
  const totalOut = paymentOut.reduce((s, p) => s + (p.amount || 0), 0);
  const totalCollected = clients.reduce((s, c) => s + clientTotals(c).collected, 0);
  const totalOutstanding = clients.reduce((s, c) => s + clientTotals(c).outstanding, 0);
  const totalMonthlyRevenue = clients.reduce((s, c) => s + clientTotals(c).revenue, 0);
  const totalClientExpense = clients.reduce((s, c) => s + (c.expense || 0), 0);
  const totalClientNet = totalCollected - totalClientExpense;
  const hasMonthlyBreakdown = clients.some((c) => c.months && c.months.length);

  const serviceRevenue = [];
  clients.forEach((c) => {
    const list = c.services.length ? c.services : [{ serviceName: 'Other', revenue: c.monthlyFee || 0 }];
    list.forEach((s) => {
      const key = s.serviceName || 'Other';
      const amount = s.revenue || 0;
      const row = serviceRevenue.find((r) => r.serviceName === key);
      if (row) row.revenue += amount;
      else serviceRevenue.push({ serviceName: key, revenue: amount });
    });
  });
  const totalServiceRevenue = serviceRevenue.reduce((s, r) => s + r.revenue, 0);

  els.app.innerHTML = `
    ${errorBanner || ''}
    <div class="panel-header">
      <h1>Oligence AI — Brand Detail</h1>
      <p>AI agency · Client billing, collections &amp; expenses</p>
    </div>

    <div class="kpi-row">
      ${kpiCard('Monthly Revenue (EGP)', fmtMoney(totalMonthlyRevenue), `<span class="kpi-caption">Oligence AI</span>`)}
      ${kpiCard('Collected (EGP)', fmtMoney(k.collected), `<span class="kpi-caption">${k.collectionRate === undefined || k.collectionRate === null ? '' : `${fmtPct(k.collectionRate)} of billed`}</span>`)}
      ${kpiCard('Outstanding (EGP)', fmtMoney(k.outstanding), `<span class="kpi-caption">Needs follow-up</span>`)}
      ${kpiCard('Collection Rate %', fmtPct(k.collectionRate), `<span class="kpi-caption">Target: 95%+</span>`)}
    </div>

    <div class="section">
      <h2 class="section-title">Client Overview</h2>
      <div class="grid-2 stacked">
        <div class="table-scroll">
          <table>
            ${hasMonthlyBreakdown ? `
              <thead>
                <tr>
                  <th>Client Name</th><th>Month</th><th class="num">Monthly Revenue</th><th class="num">Collected</th><th class="num">Outstanding</th>
                  <th>Service Type</th><th>Service Name</th><th>Method</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${clients.length ? clientOverviewRowsGrouped(clients) : emptyRow(9)}
                ${clients.length ? `
                  <tr class="total-row">
                    <td>Total</td><td></td><td class="num">${fmtMoney(totalMonthlyRevenue)}</td><td class="num">${fmtMoney(totalCollected)}</td>
                    <td class="num">${fmtMoney(totalOutstanding)}</td><td></td><td></td><td></td><td></td>
                  </tr>
                ` : ''}
              </tbody>
            ` : `
              <thead>
                <tr>
                  <th>Client Name</th><th class="num">Monthly Revenue</th><th class="num">Collected</th><th class="num">Outstanding</th>
                  <th>Service Type</th><th>Service Name</th><th>Method</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${clients.length ? clientOverviewRowsFlat(clients) : emptyRow(8)}
                ${clients.length ? `
                  <tr class="total-row">
                    <td>Total</td><td class="num">${fmtMoney(totalMonthlyRevenue)}</td><td class="num">${fmtMoney(totalCollected)}</td>
                    <td class="num">${fmtMoney(totalOutstanding)}</td><td></td><td></td><td></td><td></td>
                  </tr>
                ` : ''}
              </tbody>
            `}
          </table>
        </div>
        <div class="chart-wrap">${clients.length ? '<canvas id="chartClientCollections"></canvas>' : emptyPanel()}</div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Client Cash in vs Expense</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Client Name</th><th class="num">Cash in</th><th class="num">Expense</th><th class="num">Net</th>
            </tr>
          </thead>
          <tbody>
            ${clients.length ? clients.map((c) => {
              const collected = clientTotals(c).collected;
              return `
              <tr>
                <td>${escapeHtml(c.name)}</td>
                <td class="num">${fmtMoney(collected)}</td>
                <td class="num">${fmtMoney(c.expense)}</td>
                <td class="num">${fmtMoney(collected - (c.expense || 0))}</td>
              </tr>
            `;
            }).join('') : emptyRow(4)}
            ${clients.length ? `
              <tr class="total-row">
                <td>Total</td><td class="num">${fmtMoney(totalCollected)}</td>
                <td class="num">${fmtMoney(totalClientExpense)}</td><td class="num">${fmtMoney(totalClientNet)}</td>
              </tr>
            ` : ''}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Cash in by Service</h2>
      <div class="grid-2">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Service Name</th><th class="num">Cash in</th>
              </tr>
            </thead>
            <tbody>
              ${serviceRevenue.length ? serviceRevenue.map((r) => `
                <tr>
                  <td>${escapeHtml(r.serviceName)}</td>
                  <td class="num">${fmtMoney(r.revenue)}</td>
                </tr>
              `).join('') : emptyRow(2)}
              ${serviceRevenue.length ? `
                <tr class="total-row">
                  <td>Total</td><td class="num">${fmtMoney(totalServiceRevenue)}</td>
                </tr>
              ` : ''}
            </tbody>
          </table>
        </div>
        <div class="chart-wrap">${serviceRevenue.length ? '<canvas id="chartServiceRevenue"></canvas>' : emptyPanel()}</div>
      </div>
    </div>

    <div class="section">
      <h2 class="section-title">Expenses</h2>
      <div class="grid-2">
        <div class="table-scroll">
          <table>
            <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
            <tbody>
              ${expenses.length ? expenses.map((e) => `<tr><td>${escapeHtml(e.description)}</td><td class="num">${fmtMoney(e.amount)}</td></tr>`).join('') : emptyRow(2)}
              ${expenses.length ? `<tr class="total-row"><td>Total</td><td class="num">${fmtMoney(totalExpenses)}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
        <div class="chart-wrap">${expenses.length ? '<canvas id="chartOligenceExpenses"></canvas>' : emptyPanel()}</div>
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
  if (serviceRevenue.length) drawServiceRevenueChart(serviceRevenue);
  if (expenses.length) drawExpensesPieChart('chartOligenceExpenses', expenses.map((e) => e.description), expenses.map((e) => e.amount));
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

const clientBarLabelPlugin = {
  id: 'clientBarLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta0 = chart.getDatasetMeta(0);
    const meta1 = chart.getDatasetMeta(1);
    const labels = chart.data.labels;
    ctx.save();
    ctx.font = '12px sans-serif';
    ctx.textBaseline = 'middle';
    meta0.data.forEach((bar, i) => {
      const label = labels[i];
      if (!label) return;
      const textWidth = ctx.measureText(label).width;
      const segWidth = bar.x - bar.base;
      const insideBar = segWidth > textWidth + 16;
      if (insideBar) {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(label, bar.base + 8, bar.y);
      } else {
        const endX = (meta1.data[i] ? meta1.data[i].x : bar.x);
        ctx.fillStyle = '#3a3a42';
        ctx.textAlign = 'left';
        ctx.fillText(label, endX + 8, bar.y);
      }
    });
    ctx.restore();
  },
};

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
        { label: 'Collected', data: clients.map((c) => clientTotals(c).collected), backgroundColor: '#1f9d55', borderRadius: 2 },
        { label: 'Outstanding', data: clients.map((c) => clientTotals(c).outstanding), backgroundColor: '#c0392b', borderRadius: 2 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 60 } },
      scales: {
        x: { stacked: true, grid: { color: '#e4e5e1' }, ticks: { callback: (v) => fmtMoney(v) } },
        y: { stacked: true, grid: { display: false }, ticks: { display: false } },
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
    plugins: [clientBarLabelPlugin],
  });
}

function drawServiceRevenueChart(serviceRevenue) {
  const canvasId = 'chartServiceRevenue';
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  charts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: serviceRevenue.map((r) => r.serviceName),
      datasets: [
        { label: 'Revenue', data: serviceRevenue.map((r) => r.revenue || 0), backgroundColor: '#2f6fed', borderRadius: 2 },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: '#e4e5e1' }, ticks: { callback: (v) => fmtMoney(v) } },
        y: { grid: { display: false }, ticks: { display: false } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${fmtMoney(item.raw)} EGP`,
          },
        },
      },
    },
    plugins: [barLabelPlugin],
  });
}

// ---------------------------------------------------------------- init

(function init() {
  // Default UI state visually matches "All Time" before any fetch happens.
  els.rangePreset.value = 'all';
  els.startDate.value = '';
  els.endDate.value = '';

  loadData({ range: 'all', startDate: null, endDate: null }); // <-- FETCH TRIGGER (initial load)

  fetch('/api/me')
    .then((res) => (res.ok ? res.json() : null))
    .then((me) => {
      if (me && me.role === 'owner') els.usersTab.hidden = false;
    })
    .catch(() => {});
})();
