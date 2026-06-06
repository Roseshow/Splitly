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
  const t = document.getElementById('f-time');
  const now = new Date();
  if (d) d.value = now.toISOString().split('T')[0];
  if (t) t.value = now.toTimeString().slice(0,5);
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

  // pull-to-refresh
  initPullToRefresh();
}

function initPullToRefresh() {
  const el = document.querySelector('.content');
  let startY = 0, pulling = false;
  let indicator = document.getElementById('ptr-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'ptr-indicator';
    indicator.innerHTML = '↓ Pull to refresh';
    indicator.style.cssText = 'position:fixed;top:56px;left:0;right:0;text-align:center;padding:10px;font-size:13px;color:var(--ink3);background:var(--bg);transform:translateY(-100%);transition:transform .2s;z-index:50;font-family:var(--font)';
    document.getElementById('app-screen').prepend(indicator);
  }

  el.addEventListener('touchstart', e => {
    if (el.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dist = e.touches[0].clientY - startY;
    if (dist > 10) {
      const pct = Math.min(dist / 80, 1);
      indicator.style.transform = 'translateY(' + (pct * 100 - 100) + '%)';
      indicator.innerHTML = dist > 70 ? '↑ Release to refresh' : '↓ Pull to refresh';
    }
  }, { passive: true });

  el.addEventListener('touchend', e => {
    if (!pulling) return;
    pulling = false;
    const dist = e.changedTouches[0].clientY - startY;
    indicator.style.transform = 'translateY(-100%)';
    if (dist > 70) {
      indicator.innerHTML = 'Refreshing…';
      indicator.style.transform = 'translateY(0)';
      loadExpenses().then(() => {
        setTimeout(() => { indicator.style.transform = 'translateY(-100%)'; }, 800);
      });
    }
  }, { passive: true });
}

// ── LOAD DATA ───────────────────────────────────────────
async function loadExpenses() {
  const { data, error } = await sb.from('expenses').select('*').order('date', { ascending: false }).order('time', { ascending: false, nullsFirst: false });
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
  const time = document.getElementById('f-time').value || '00:00';
  const note = document.getElementById('f-note').value.trim();

  if (!desc || isNaN(amount) || amount <= 0) {
    alert('Please enter a description and a valid amount.'); return;
  }
  if (!selectedCat) { alert('Please select a category.'); return; }
  if (!selectedPaidBy) { alert('Please select who paid.'); return; }
  if (!date) { alert('Please select a date.'); return; }

  const me = cfg.me;
  const partner = cfg.partner;

  // Store split_mode as absolute: 'equal', 'custom', 'personal', or 'owes:NAME'
  // so both phones always interpret it the same way regardless of who logged it
  let absoluteSplitMode = splitMode;
  if (splitMode === 'me') absoluteSplitMode = 'owes:' + me;
  if (splitMode === 'partner') absoluteSplitMode = 'owes:' + partner;

  let loggerShare = amount / 2;
  if (splitMode === 'custom') {
    const customVal = parseFloat(document.getElementById('f-custom-split').value);
    if (isNaN(customVal) || customVal < 0 || customVal > amount) {
      alert('Custom split amount must be between 0 and the total.'); return;
    }
    loggerShare = customVal;
  } else if (splitMode === 'me') {
    loggerShare = amount;
  } else if (splitMode === 'partner') {
    loggerShare = 0;
  } else if (splitMode === 'personal') {
    loggerShare = (selectedPaidBy === me) ? amount : 0;
  }

  const shares = {};
  shares[me] = parseFloat(loggerShare.toFixed(2));
  shares[partner] = parseFloat((amount - loggerShare).toFixed(2));

  const record = {
    description: desc, amount, date, time, note,
    cat_emoji: selectedCat.emoji,
    cat_name: selectedCat.name,
    paid_by: selectedPaidBy,
    split_mode: absoluteSplitMode,
    share_data: JSON.stringify(shares),
    logged_by: me,
  };

  const { error } = await sb.from('expenses').insert([record]);
  if (error) { alert('Failed to save: ' + error.message); return; }

  document.getElementById('f-desc').value = '';
  document.getElementById('f-amount').value = '';
  document.getElementById('f-note').value = '';
  document.getElementById('f-custom-split').value = '';
  setTodayDate();
  showToast();
  loadExpenses();
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
  // Show actual names on buttons so it's always clear who owes all
  if (btnMe) btnMe.textContent = me + ' owes all';
  if (btnPartner) btnPartner.textContent = partner + ' owes all';
}

function updateCustomSplitLabel() {
  const me = cfg.me || 'Me';
  const partner = cfg.partner || 'Partner';
  const label = document.getElementById('custom-split-label');
  if (label) label.textContent = 'Amount ' + me + ' owes';
}

// ── SPLIT MODE ───────────────────────────────────────────
function setSplitMode(mode) {
  splitMode = mode;
  document.querySelectorAll('.split-tab').forEach(b => b.classList.toggle('active', b.dataset.split === mode));
  const customWrap = document.getElementById('custom-split-wrap');
  if (mode === 'custom') {
    customWrap.classList.remove('hidden');
    updateCustomSplitLabel();
    updateSplitHint();
    document.getElementById('f-custom-split').addEventListener('input', updateSplitHint);
  } else {
    customWrap.classList.add('hidden');
  }
}

function updateSplitHint() {
  const total = parseFloat(document.getElementById('f-amount').value) || 0;
  const myVal = parseFloat(document.getElementById('f-custom-split').value) || 0;
  const me = cfg.me || 'Me';
  const partner = cfg.partner || 'Partner';
  const hint = document.getElementById('split-hint');
  if (total > 0 && myVal >= 0 && myVal <= total) {
    hint.textContent = `${me}: €${myVal.toFixed(2)} · ${partner}: €${(total - myVal).toFixed(2)}`;
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
  const me = cfg.me || '';
  const partner = cfg.partner || '';
  wrap.innerHTML = list.map(e => {
    const amount = parseFloat(e.amount);
    const shares = getShares(e);
    const meAmt = shares[me] ?? amount / 2;
    const partnerAmt = shares[partner] ?? amount / 2;
    const timeStr = e.time ? ' ' + e.time : '';
    const splitLabel = splitLabelFromMode(e.split_mode, me, partner, meAmt, partnerAmt);

    return '<div class="exp-item" onclick="openEdit(' + e.id + ')">' +
      '<div class="exp-emoji">' + e.cat_emoji + '</div>' +
      '<div class="exp-body-full">' +
        '<div class="exp-row1">' +
          '<div class="exp-title">' + e.description + '</div>' +
          '<div class="exp-amount">€' + amount.toFixed(2) + '</div>' +
        '</div>' +
        '<div class="exp-row2">' +
          '<span class="exp-sub">' + e.cat_name + ' · ' + e.date + timeStr + ' · ' + e.paid_by + ' paid</span>' +
        '</div>' +
        (e.note ? '<div class="exp-row2"><span class="exp-sub">' + e.note + '</span></div>' : '') +
        '<div class="exp-split-row">' + splitLabel + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  await sb.from('expenses').delete().eq('id', id);
  document.getElementById('edit-modal').classList.add('hidden');
}

function openEdit(id) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  const me = cfg.me || '';
  const partner = cfg.partner || '';
  const shares = getShares(e);
  const meAmt = shares[me] ?? parseFloat(e.amount) / 2;
  const partnerAmt = shares[partner] ?? parseFloat(e.amount) / 2;

  document.getElementById('edit-id').value = id;
  document.getElementById('edit-desc').value = e.description || '';
  document.getElementById('edit-amount').value = parseFloat(e.amount).toFixed(2);
  document.getElementById('edit-date').value = e.date || '';
  document.getElementById('edit-time').value = e.time || '';
  document.getElementById('edit-note').value = e.note || '';

  // Populate paid-by select with actual names
  const paidBySel = document.getElementById('edit-paidby');
  paidBySel.innerHTML =
    '<option value="' + me + '">' + me + '</option>' +
    '<option value="' + partner + '">' + partner + '</option>';
  paidBySel.value = e.paid_by || me;

  // Populate category select
  const catSel = document.getElementById('edit-cat');
  catSel.innerHTML = categories.map(c => '<option value="' + c.emoji + '|' + c.name + '">' + c.emoji + ' ' + c.name + '</option>').join('');
  catSel.value = e.cat_emoji + '|' + e.cat_name;

  // Populate split select — normalise legacy modes
  const splitSel = document.getElementById('edit-split');
  splitSel.innerHTML =
    '<option value="equal">50/50</option>' +
    '<option value="owes:' + me + '">' + me + ' owes all</option>' +
    '<option value="owes:' + partner + '">' + partner + ' owes all</option>' +
    '<option value="personal">Personal</option>' +
    '<option value="custom">Custom €</option>';

  let modeVal = e.split_mode || 'equal';
  if (modeVal === 'me') modeVal = 'owes:' + (e.logged_by || me);
  if (modeVal === 'partner') modeVal = 'owes:' + (e.logged_by ? (e.logged_by === me ? partner : me) : partner);
  splitSel.value = modeVal;
  toggleEditCustom();

  document.getElementById('edit-custom-me').value = meAmt.toFixed(2);
  document.getElementById('edit-custom-partner').value = partnerAmt.toFixed(2);
  document.getElementById('edit-custom-me-label').textContent = me;
  document.getElementById('edit-custom-partner-label').textContent = partner;

  document.getElementById('edit-modal').classList.remove('hidden');
}

function toggleEditCustom() {
  const mode = document.getElementById('edit-split').value;
  document.getElementById('edit-custom-wrap').classList.toggle('hidden', mode !== 'custom');
}

function closeEdit() {
  document.getElementById('edit-modal').classList.add('hidden');
}

function closeEditOutside(ev) {
  if (ev.target === document.getElementById('edit-modal')) closeEdit();
}

async function saveEdit() {
  const id = parseInt(document.getElementById('edit-id').value);
  const desc = document.getElementById('edit-desc').value.trim();
  const amount = parseFloat(document.getElementById('edit-amount').value);
  const date = document.getElementById('edit-date').value;
  const time = document.getElementById('edit-time').value;
  const note = document.getElementById('edit-note').value.trim();
  const paidBy = document.getElementById('edit-paidby').value;
  const catVal = document.getElementById('edit-cat').value;
  const splitVal = document.getElementById('edit-split').value;
  const me = cfg.me || '';
  const partner = cfg.partner || '';

  if (!desc || isNaN(amount) || amount <= 0) { alert('Check description and amount.'); return; }

  const [catEmoji, catName] = catVal.split('|');

  let meShare = amount / 2;
  if (splitVal === 'owes:' + me) meShare = amount;
  else if (splitVal === 'owes:' + partner) meShare = 0;
  else if (splitVal === 'personal') meShare = paidBy === me ? amount : 0;
  else if (splitVal === 'custom') {
    meShare = parseFloat(document.getElementById('edit-custom-me').value) || 0;
  }

  const shares = {};
  shares[me] = parseFloat(meShare.toFixed(2));
  shares[partner] = parseFloat((amount - meShare).toFixed(2));

  const { error } = await sb.from('expenses').update({
    description: desc, amount, date, time, note,
    cat_emoji: catEmoji, cat_name: catName,
    paid_by: paidBy, split_mode: splitVal,
    share_data: JSON.stringify(shares),
  }).eq('id', id);

  if (error) { alert('Save failed: ' + error.message); return; }
  closeEdit();
}

// ── SPLIT HELPERS ─────────────────────────────────────────
function splitLabelFromMode(mode, me, partner, meAmt, partnerAmt) {
  if (mode === 'equal') return '50/50';
  if (mode === 'personal') return 'Personal';
  if (mode === 'custom') return me + ' €' + meAmt.toFixed(2) + ' · ' + partner + ' €' + partnerAmt.toFixed(2);
  if (mode && mode.startsWith('owes:')) {
    const who = mode.slice(5);
    return who + ' owes all';
  }
  // legacy 'me'/'partner' — shouldn't appear in new records
  if (mode === 'me') return me + ' owes all';
  if (mode === 'partner') return partner + ' owes all';
  return '50/50';
}

function splitModeForBalance(mode, me, partner) {
  // Normalise legacy modes to absolute
  if (mode === 'me') return 'owes:' + me;
  if (mode === 'partner') return 'owes:' + partner;
  return mode;
}

// ── SPLIT SECTION ─────────────────────────────────────────
function getShares(e) {
  // Parse share_data JSON — fallback to equal split if missing (old records)
  const a = parseFloat(e.amount);
  const me = cfg.me;
  const partner = cfg.partner;
  if (e.share_data) {
    try {
      const d = typeof e.share_data === 'string' ? JSON.parse(e.share_data) : e.share_data;
      // Try exact name match first, then case-insensitive
      const meShare = d[me] !== undefined ? d[me] :
        Object.entries(d).find(([k]) => k.toLowerCase() === me.toLowerCase())?.[1] ?? a / 2;
      return { [me]: parseFloat(meShare), [partner]: parseFloat((a - meShare).toFixed(2)) };
    } catch(err) {}
  }
  // Legacy: fall back to my_share if share_data missing
  if (e.my_share !== undefined) {
    const myShare = parseFloat(e.my_share);
    return { [me]: myShare, [partner]: parseFloat((a - myShare).toFixed(2)) };
  }
  return { [me]: a / 2, [partner]: a / 2 };
}

function calcBalance(list) {
  const me = cfg.me || 'Me';
  const partner = cfg.partner || 'Partner';
  let iOwe = 0, theyOwe = 0;
  list.forEach(e => {
    const mode = splitModeForBalance(e.split_mode, me, partner);
    if (mode === 'personal') return;
    const shares = getShares(e);
    const aShare = shares[me] ?? parseFloat(e.amount) / 2;
    const bShare = shares[partner] ?? parseFloat(e.amount) / 2;
    if (e.paid_by === me) {
      theyOwe += bShare;
    } else {
      iOwe += aShare;
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

  // net > 0 means partner owes me; net < 0 means I owe partner
  // Use actual names so both phones show the same text
  let heroClass = '', heroLabel = '', heroAmt = '', heroSub = '';
  if (Math.abs(bal.net) < 0.01) {
    heroClass = 'settled'; heroLabel = 'All settled!';
    heroAmt = '✓'; heroSub = me + ' & ' + partner + ' are even';
  } else if (bal.net > 0) {
    heroLabel = partner + ' owes ' + me;
    heroAmt = '€' + bal.net.toFixed(2);
    heroSub = 'across all time';
  } else {
    heroLabel = me + ' owes ' + partner;
    heroAmt = '€' + Math.abs(bal.net).toFixed(2);
    heroSub = 'across all time';
  }

  const months = getMonths();
  let monthsHtml = months.map(m => {
    const mList = expenses.filter(e => monthKey(e.date) === m);
    const mb = calcBalance(mList);
    const total = mList.reduce((s, e) => s + parseFloat(e.amount), 0);
    let balClass = 'even', balText = 'Settled';
    if (Math.abs(mb.net) >= 0.01) {
      if (mb.net > 0) { balClass = 'receive'; balText = partner + ' owes €' + mb.net.toFixed(2); }
      else { balClass = 'owe'; balText = me + ' owes €' + Math.abs(mb.net).toFixed(2); }
    }
    return '<div class="month-card">' +
      '<div><div class="month-name">' + formatMonth(m) + '</div><div class="month-meta">' + mList.length + ' expenses · €' + total.toFixed(2) + '</div></div>' +
      '<div class="month-bal ' + balClass + '">' + balText + '</div>' +
      '</div>';
  }).join('');

  wrap.innerHTML =
    '<div class="balance-hero ' + heroClass + '">' +
      '<div class="balance-label">' + heroLabel + '</div>' +
      '<div class="balance-amount">' + heroAmt + '</div>' +
      '<div class="balance-sub">' + heroSub + '</div>' +
    '</div>' +
    '<div class="metrics-row">' +
      '<div class="metric-card"><div class="metric-lbl">' + me + ' paid</div><div class="metric-val">€' + iPaid.toFixed(2) + '</div></div>' +
      '<div class="metric-card"><div class="metric-lbl">' + partner + ' paid</div><div class="metric-val">€' + theyPaid.toFixed(2) + '</div></div>' +
    '</div>' +
    '<div style="font-size:14px;font-weight:500;color:var(--ink2)">By month</div>' +
    (monthsHtml || '<div class="empty-state">No monthly data yet.</div>');
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

  // ── Personal spending: what each person actually consumed (their share of every expense)
  const me = cfg.me || '';
  const partner = cfg.partner || '';
  let meActual = 0, partnerActual = 0;
  list.forEach(e => {
    if (e.split_mode === 'personal') {
      // personal expense: only the payer consumed it
      if (e.paid_by === me) meActual += parseFloat(e.amount);
      else partnerActual += parseFloat(e.amount);
    } else {
      const shares = getShares(e);
      meActual += shares[me] ?? parseFloat(e.amount) / 2;
      partnerActual += shares[partner] ?? parseFloat(e.amount) / 2;
    }
  });

  // Category breakdown for me and partner actual spending
  const meCats = {}, partnerCats = {};
  list.forEach(e => {
    const key = e.cat_emoji + ' ' + e.cat_name;
    const shares = getShares(e);
    const myAmt = e.split_mode === 'personal'
      ? (e.paid_by === me ? parseFloat(e.amount) : 0)
      : (shares[me] ?? parseFloat(e.amount) / 2);
    const partnerAmt = e.split_mode === 'personal'
      ? (e.paid_by === partner ? parseFloat(e.amount) : 0)
      : (shares[partner] ?? parseFloat(e.amount) / 2);
    if (myAmt > 0) meCats[key] = (meCats[key] || 0) + myAmt;
    if (partnerAmt > 0) partnerCats[key] = (partnerCats[key] || 0) + partnerAmt;
  });

  function miniBar(cats, totalAmt, colors) {
    const sorted = Object.entries(cats).sort((a,b) => b[1]-a[1]);
    const mx = sorted[0]?.[1] || 1;
    return sorted.map(([cat, amt], i) =>
      '<div class="cat-bar-row">' +
        '<div class="cat-bar-top">' +
          '<span>' + cat + '</span>' +
          '<span style="font-family:var(--font-mono);font-size:12px">€' + amt.toFixed(2) +
            ' <span style="color:var(--ink3)">' + Math.round(amt/totalAmt*100) + '%</span></span>' +
        '</div>' +
        '<div class="cat-bar-bg"><div class="cat-bar-fill" style="width:' + (amt/mx*100).toFixed(1) + '%;background:' + colors[i % colors.length] + '"></div></div>' +
      '</div>'
    ).join('');
  }

  wrap.innerHTML =
    '<div class="summary-stat-grid">' +
      '<div class="metric-card"><div class="metric-lbl">Total</div><div class="metric-val" style="font-size:18px">€' + total.toFixed(2) + '</div></div>' +
      '<div class="metric-card"><div class="metric-lbl">Expenses</div><div class="metric-val" style="font-size:18px">' + list.length + '</div></div>' +
      '<div class="metric-card"><div class="metric-lbl">Balance</div><div class="metric-val" style="font-size:18px;color:' + balColor + '">' + balText + '</div></div>' +
    '</div>' +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px">' +
      '<div style="font-size:14px;font-weight:500;margin-bottom:14px">Spending by category</div>' +
      barsHtml +
    '</div>' +
    '<div class="summary-divider"></div>' +
    '<div style="font-size:14px;font-weight:600;color:var(--ink2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">Personal summary</div>' +
    '<div class="metrics-row" style="margin-bottom:12px">' +
      '<div class="metric-card"><div class="metric-lbl">' + me + ' spent</div><div class="metric-val" style="font-size:18px">€' + meActual.toFixed(2) + '</div></div>' +
      '<div class="metric-card"><div class="metric-lbl">' + partner + ' spent</div><div class="metric-val" style="font-size:18px">€' + partnerActual.toFixed(2) + '</div></div>' +
    '</div>' +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px">' +
      '<div style="font-size:13px;font-weight:500;margin-bottom:12px;color:var(--ink2)">' + me + ''s actual spending</div>' +
      (Object.keys(meCats).length ? miniBar(meCats, meActual, CAT_COLORS) : '<div style="font-size:13px;color:var(--ink3)">No spending</div>') +
    '</div>' +
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px">' +
      '<div style="font-size:13px;font-weight:500;margin-bottom:12px;color:var(--ink2)">' + partner + ''s actual spending</div>' +
      (Object.keys(partnerCats).length ? miniBar(partnerCats, partnerActual, CAT_COLORS) : '<div style="font-size:13px;color:var(--ink3)">No spending</div>') +
    '</div>';
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
