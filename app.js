// ── STATE ──────────────────────────────────────────────
let sb = null;
let cfg = {};
let expenses = [];
let categories = [];
let selectedCat = null;
let selectedPaidBy = null;
let splitMode = 'equal';

const DEFAULT_CATS = [
  { emoji: '🍽️', name: 'Dining' },
  { emoji: '🧃', name: 'Snacks' },
  { emoji: '🛒', name: 'Groceries' },
  { emoji: '🏡', name: 'Household' },
  { emoji: '🚇', name: 'Transport' },
  { emoji: '🏠', name: 'Home' },
  { emoji: '🎉', name: 'Fun' },
  { emoji: '🏥', name: 'Health' },
  { emoji: '✈️', name: 'Travel' },
  { emoji: '🛍️', name: 'Shopping' },
  { emoji: '💡', name: 'Utilities' },
  { emoji: '📦', name: 'Other' },
];

const CAT_COLORS = ['#C17B3F','#1D7A4F','#2F6EBA','#7B4FA0','#C0392B','#16867A','#B5591C','#5A6478','#2D8A6A','#888580'];

// ── INIT ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('splitly_cfg');
  if (saved) {
    cfg = JSON.parse(saved);
    categories = cfg.categories || DEFAULT_CATS;
    initSupabase(cfg.url, cfg.key);
  }
  setTodayDate();
});

function setTodayDate() {
  const d = document.getElementById('f-date');
  if (d) d.value = new Date().toISOString().split('T')[0];
}

// ── SETUP ───────────────────────────────────────────────
async function setupApp() {
  const url = document.getElementById('sb-url').value.trim();
  const key = document.getElementById('sb-key').value.trim();
  const me = document.getElementById('my-name').value.trim();
  const partner = document.getElementById('partner-name').value.trim();
  const err = document.getElementById('setup-err');
  if (!url || !key || !me || !partner) { err.textContent = 'Please fill in all fields.'; return; }
  err.textContent = '';
  try {
    const client = supabase.createClient(url, key);
    const { error } = await client.from('expenses').select('id').limit(1);
    if (error) throw error;
    cfg = { url, key, me, partner, categories: DEFAULT_CATS };
    categories = DEFAULT_CATS;
    localStorage.setItem('splitly_cfg', JSON.stringify(cfg));
    sb = client;
    showApp();
  } catch (e) {
    err.textContent = 'Connection failed. Check your URL and key, and make sure the table is created.';
  }
}

function initSupabase(url, key) {
  sb = supabase.createClient(url, key);
  showApp();
}

function showApp() {
  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  renderPaidByPills();
  renderCatPills();
  updateSplitLabels();
  setTodayDate();
  loadExpenses();

  // realtime subscription
  sb.channel('expenses-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadExpenses())
    .subscribe();
}

// ── LOAD DATA ───────────────────────────────────────────
async function loadExpenses() {
  const { data, error } = await sb.from('expenses').select('*').order('date', { ascending: false }).order('created_at', { ascending: false });
  if (!error) {
    expenses = data || [];
    renderAll();
  }
}

function renderAll() {
  renderList();
  renderSplit();
  renderSummaryMonths();
  renderSummary();
  renderFilterMonths();
}

// ── ADD EXPENSE ─────────────────────────────────────────
async function addExpense() {
  const desc = document.getElementById('f-desc').value.trim();
  const amount = parseFloat(document.getElementById('f-amount').value);
  const date = document.getElementById('f-date').value;
  const note = document.getElementById('f-note').value.trim();

  if (!desc || isNaN(amount) || amount <= 0) {
    alert('Please enter a description and a valid amount.'); return;
  }
  if (!selectedCat) { alert('Please select a category.'); return; }
  if (!selectedPaidBy) { alert('Please select who paid.'); return; }
  if (!date) { alert('Please select a date.'); return; }

  let myShare = amount / 2;
  if (splitMode === 'custom') {
    const customVal = parseFloat(document.getElementById('f-custom-split').value);
    if (isNaN(customVal) || customVal < 0 || customVal > amount) {
      alert('Custom split amount must be between 0 and the total.'); return;
    }
    myShare = customVal;
  } else if (splitMode === 'me') {
    myShare = amount;
  } else if (splitMode === 'partner') {
    myShare = 0;
  }

  const record = {
    description: desc, amount, date, note,
    cat_emoji: selectedCat.emoji,
    cat_name: selectedCat.name,
    paid_by: selectedPaidBy,
    split_mode: splitMode,
    my_share: parseFloat(myShare.toFixed(2)),
  };

  const { error } = await sb.from('expenses').insert([record]);
  if (error) { alert('Failed to save: ' + error.message); return; }

  document.getElementById('f-desc').value = '';
  document.getElementById('f-amount').value = '';
  document.getElementById('f-note').value = '';
  document.getElementById('f-custom-split').value = '';
  setTodayDate();
  showToast();
}

function showToast() {
  const t = document.getElementById('add-toast');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 1800);
}

// ── CAT PILLS ───────────────────────────────────────────
function renderCatPills() {
  const wrap = document.getElementById('cat-scroll');
  wrap.innerHTML = categories.map((c, i) => `
    <button class="cat-pill ${selectedCat && selectedCat.name===c.name ? 'active' : ''}"
      onclick="selectCat(${i})">${c.emoji} ${c.name}</button>
  `).join('') + `
    <button class="cat-pill cat-pill-add" onclick="quickAddCat()" title="Add category">＋</button>
  `;
}

function quickAddCat() {
  const emoji = prompt('Enter an emoji for the category:');
  if (!emoji) return;
  const name = prompt('Enter the category name:');
  if (!name || !name.trim()) return;
  categories.push({ emoji: emoji.trim(), name: name.trim() });
  cfg.categories = categories;
  localStorage.setItem('splitly_cfg', JSON.stringify(cfg));
  renderCatPills();
  renderCatSettings();
}

function selectCat(i) {
  selectedCat = categories[i];
  renderCatPills();
}

// ── PAID BY PILLS ────────────────────────────────────────
function renderPaidByPills() {
  const wrap = document.getElementById('paidby-pills');
  const me = cfg.me || 'Me';
  const partner = cfg.partner || 'Partner';
  if (!selectedPaidBy) selectedPaidBy = me;
  wrap.innerHTML = [me, partner].map(n => `
    <button class="person-pill ${selectedPaidBy===n ? 'active' : ''}"
      onclick="selectPaidBy('${n}')">${n}</button>
  `).join('');
}

function selectPaidBy(name) {
  selectedPaidBy = name;
  renderPaidByPills();
  updateSplitHint();
}

function updateSplitLabels() {
  const me = cfg.me || 'Me';
  const partner = cfg.partner || 'Partner';
  const btnMe = document.getElementById('split-btn-me');
  const btnPartner = document.getElementById('split-btn-partner');
  if (btnMe) btnMe.textContent = me + ' owes all';
  if (btnPartner) btnPartner.textContent = partner + ' owes all';
}

// ── SPLIT MODE ───────────────────────────────────────────
function setSplitMode(mode) {
  splitMode = mode;
  document.querySelectorAll('.split-tab').forEach(b => b.classList.toggle('active', b.dataset.split === mode));
  const customWrap = document.getElementById('custom-split-wrap');
  if (mode === 'custom') {
    customWrap.classList.remove('hidden');
    updateSplitHint();
    document.getElementById('f-custom-split').addEventListener('input', updateSplitHint);
  } else {
    customWrap.classList.add('hidden');
  }
}

function updateSplitHint() {
  const total = parseFloat(document.getElementById('f-amount').value) || 0;
  const myVal = parseFloat(document.getElementById('f-custom-split').value) || 0;
  const partner = cfg.partner || 'Partner';
  const hint = document.getElementById('split-hint');
  const label = document.getElementById('custom-split-label');
  label.textContent = `Amount ${cfg.me || 'I'} owe`;
  if (total > 0 && myVal >= 0 && myVal <= total) {
    hint.textContent = `→ ${partner} owes €${(total - myVal).toFixed(2)}`;
  } else {
    hint.textContent = '';
  }
}

// ── EXPENSE LIST ─────────────────────────────────────────
function renderFilterMonths() {
  const sel = document.getElementById('filter-month');
  const current = sel.value;
  const months = getMonths();
  sel.innerHTML = '<option value="all">All time</option>' +
    months.map(m => `<option value="${m}" ${current===m?'selected':''}>${formatMonth(m)}</option>`).join('');
}

function renderList() {
  const sel = document.getElementById('filter-month');
  const fm = sel ? sel.value : 'all';
  const list = fm === 'all' ? expenses : expenses.filter(e => monthKey(e.date) === fm);
  const wrap = document.getElementById('expense-list');
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state">No expenses yet.<br>Add your first one!</div>'; return;
  }
  wrap.innerHTML = list.map(e => `
    <div class="exp-item">
      <div class="exp-emoji">${e.cat_emoji}</div>
      <div class="exp-body">
        <div class="exp-title">${e.description}</div>
        <div class="exp-sub">${e.cat_name} · ${e.date}${e.note ? ' · ' + e.note : ''}</div>
      </div>
      <div class="exp-right">
        <div class="exp-amount">€${parseFloat(e.amount).toFixed(2)}</div>
        <div class="exp-who">${e.paid_by} paid</div>
      </div>
      <button class="exp-delete" onclick="deleteExpense(${e.id})" aria-label="Delete">✕</button>
    </div>
  `).join('');
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await sb.from('expenses').delete().eq('id', id);
}

// ── SPLIT SECTION ─────────────────────────────────────────
function calcBalance(list) {
  const me = cfg.me || 'Me';
  let iOwe = 0, theyOwe = 0;
  list.forEach(e => {
    const a = parseFloat(e.amount);
    const myShare = parseFloat(e.my_share);
    const partnerShare = a - myShare;
    if (e.paid_by === me) {
      theyOwe += partnerShare;
    } else {
      iOwe += myShare;
    }
  });
  return { iOwe: parseFloat(iOwe.toFixed(2)), theyOwe: parseFloat(theyOwe.toFixed(2)), net: parseFloat((theyOwe - iOwe).toFixed(2)) };
}

function renderSplit() {
  const wrap = document.getElementById('split-content');
  if (!wrap) return;
  const me = cfg.me || 'Me';
  const partner = cfg.partner || 'Partner';
  if (!expenses.length) { wrap.innerHTML = '<div class="empty-state">No expenses yet.</div>'; return; }

  const bal = calcBalance(expenses);
  const totalAll = expenses.reduce((s, e) => s + parseFloat(e.amount), 0);
  const iPaid = expenses.filter(e => e.paid_by === me).reduce((s, e) => s + parseFloat(e.amount), 0);
  const theyPaid = totalAll - iPaid;

  let heroClass = '', heroLabel = '', heroAmt = '', heroSub = '';
  if (Math.abs(bal.net) < 0.01) {
    heroClass = 'settled'; heroLabel = 'All settled!';
    heroAmt = '✓'; heroSub = "You're even";
  } else if (bal.net > 0) {
    heroLabel = `${partner} owes you`;
    heroAmt = `€${bal.net.toFixed(2)}`;
    heroSub = 'across all time';
  } else {
    heroLabel = `You owe ${partner}`;
    heroAmt = `€${Math.abs(bal.net).toFixed(2)}`;
    heroSub = 'across all time';
  }

  const months = getMonths();
  let monthsHtml = months.map(m => {
    const mList = expenses.filter(e => monthKey(e.date) === m);
    const mb = calcBalance(mList);
    const total = mList.reduce((s, e) => s + parseFloat(e.amount), 0);
    let balClass = 'even', balText = 'Settled';
    if (Math.abs(mb.net) >= 0.01) {
      if (mb.net > 0) { balClass = 'receive'; balText = `${partner} owes €${mb.net.toFixed(2)}`; }
      else { balClass = 'owe'; balText = `You owe €${Math.abs(mb.net).toFixed(2)}`; }
    }
    return `<div class="month-card">
      <div><div class="month-name">${formatMonth(m)}</div><div class="month-meta">${mList.length} expenses · €${total.toFixed(2)}</div></div>
      <div class="month-bal ${balClass}">${balText}</div>
    </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="balance-hero ${heroClass}">
      <div class="balance-label">${heroLabel}</div>
      <div class="balance-amount">${heroAmt}</div>
      <div class="balance-sub">${heroSub}</div>
    </div>
    <div class="metrics-row">
      <div class="metric-card"><div class="metric-lbl">You paid</div><div class="metric-val">€${iPaid.toFixed(2)}</div></div>
      <div class="metric-card"><div class="metric-lbl">${partner} paid</div><div class="metric-val">€${theyPaid.toFixed(2)}</div></div>
    </div>
    <div style="font-size:14px;font-weight:500;color:var(--ink2)">By month</div>
    ${monthsHtml || '<div class="empty-state">No monthly data yet.</div>'}
  `;
}

// ── SUMMARY ───────────────────────────────────────────────
function renderSummaryMonths() {
  const sel = document.getElementById('summary-month-sel');
  if (!sel) return;
  const cur = sel.value;
  const months = getMonths();
  sel.innerHTML = months.map(m => `<option value="${m}" ${m===cur?'selected':''}>${formatMonth(m)}</option>`).join('');
}

function renderSummary() {
  const sel = document.getElementById('summary-month-sel');
  const wrap = document.getElementById('summary-content');
  if (!sel || !wrap) return;
  const m = sel.value;
  if (!m) { wrap.innerHTML = '<div class="empty-state">No data yet.</div>'; return; }
  const list = expenses.filter(e => monthKey(e.date) === m);
  if (!list.length) { wrap.innerHTML = '<div class="empty-state">No expenses this month.</div>'; return; }

  const total = list.reduce((s, e) => s + parseFloat(e.amount), 0);
  const bal = calcBalance(list);
  const catTotals = {};
  list.forEach(e => {
    const key = e.cat_emoji + ' ' + e.cat_name;
    catTotals[key] = (catTotals[key] || 0) + parseFloat(e.amount);
  });
  const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;

  let balText = 'Settled ✓', balColor = 'var(--success)';
  if (Math.abs(bal.net) >= 0.01) {
    if (bal.net > 0) { balText = `+€${bal.net.toFixed(2)}`; balColor = 'var(--success)'; }
    else { balText = `-€${Math.abs(bal.net).toFixed(2)}`; balColor = 'var(--danger)'; }
  }

  const barsHtml = sorted.map(([cat, amt], i) => `
    <div class="cat-bar-row">
      <div class="cat-bar-top">
        <span>${cat}</span>
        <span style="font-family:var(--font-mono);font-size:12px">€${amt.toFixed(2)} <span style="color:var(--ink3)">${Math.round(amt/total*100)}%</span></span>
      </div>
      <div class="cat-bar-bg">
        <div class="cat-bar-fill" style="width:${(amt/max*100).toFixed(1)}%;background:${CAT_COLORS[i % CAT_COLORS.length]}"></div>
      </div>
    </div>
  `).join('');

  wrap.innerHTML = `
    <div class="summary-stat-grid">
      <div class="metric-card"><div class="metric-lbl">Total</div><div class="metric-val" style="font-size:18px">€${total.toFixed(2)}</div></div>
      <div class="metric-card"><div class="metric-lbl">Expenses</div><div class="metric-val" style="font-size:18px">${list.length}</div></div>
      <div class="metric-card"><div class="metric-lbl">Balance</div><div class="metric-val" style="font-size:18px;color:${balColor}">${balText}</div></div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
      <div style="font-size:14px;font-weight:500;margin-bottom:14px">Spending by category</div>
      ${barsHtml}
    </div>
  `;
}

// ── SETTINGS ─────────────────────────────────────────────
function openSettings() {
  document.getElementById('s-myname').value = cfg.me || '';
  document.getElementById('s-partnername').value = cfg.partner || '';
  renderCatSettings();
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  cfg.me = document.getElementById('s-myname').value.trim() || cfg.me;
  cfg.partner = document.getElementById('s-partnername').value.trim() || cfg.partner;
  cfg.categories = categories;
  localStorage.setItem('splitly_cfg', JSON.stringify(cfg));
  renderPaidByPills();
  renderCatPills();
  updateSplitLabels();
  renderSplit();
  document.getElementById('settings-modal').classList.add('hidden');
}

function closeSettingsOutside(e) {
  if (e.target === document.getElementById('settings-modal')) closeSettings();
}

function renderCatSettings() {
  const wrap = document.getElementById('cat-list-settings');
  wrap.innerHTML = categories.map((c, i) => `
    <div class="cat-settings-item">
      <span class="cat-settings-emoji">${c.emoji}</span>
      <span class="cat-settings-name">${c.name}</span>
      ${categories.length > 1 ? `<button class="btn-sm" style="padding:4px 10px;color:var(--danger);background:var(--danger-light)" onclick="removeCat(${i})">✕</button>` : ''}
    </div>
  `).join('');
}

function addCategory() {
  const emoji = document.getElementById('new-cat-emoji').value.trim();
  const name = document.getElementById('new-cat-name').value.trim();
  if (!emoji || !name) { alert('Enter both an emoji and a name.'); return; }
  categories.push({ emoji, name });
  document.getElementById('new-cat-emoji').value = '';
  document.getElementById('new-cat-name').value = '';
  renderCatSettings();
}

function removeCat(i) {
  categories.splice(i, 1);
  if (selectedCat && selectedCat.name === categories[i]?.name) selectedCat = null;
  renderCatSettings();
}

function resetApp() {
  if (!confirm('This will disconnect from Supabase and clear all local settings. Your expense data in Supabase is kept safe.')) return;
  localStorage.removeItem('splitly_cfg');
  location.reload();
}

// ── TAB SWITCHING ─────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-section').forEach(s => s.classList.toggle('hidden', !s.id.endsWith(name)));
  if (name === 'split') renderSplit();
  if (name === 'summary') { renderSummaryMonths(); renderSummary(); }
  if (name === 'expenses') renderFilterMonths();
}

// ── HELPERS ───────────────────────────────────────────────
function monthKey(date) { return date ? date.slice(0, 7) : ''; }
function getMonths() { return [...new Set(expenses.map(e => monthKey(e.date)).filter(Boolean))].sort().reverse(); }
function formatMonth(key) {
  const [y, m] = key.split('-');
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}
