'use strict';

/* ── State ─────────────────────────────────────────────────────────── */
let DATA   = null; // loaded from data.json
let plan   = 'heating';
let usage  = 1000;
let season = 'summer';

/* ── Helpers ────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const fmt = n => '$' + Math.abs(n).toFixed(2);
const fmtRate = n => '$' + n.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');

function set(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

/* ── Core calculation ────────────────────────────────────────────────── */
function calculate(kwh, planId, billSeason) {
  const r = DATA.rates;
  const d = r.delivery;

  /* Base Distribution */
  const customer_charge   = d.customer_charge.value;
  const distribution      = d.distribution_energy.value * kwh;
  const base_dist_revenue = customer_charge + distribution;

  /* Fixed-per-bill charges */
  const storm_rider      = d.storm_rider.value;
  const proactive_rider  = d.proactive_reliability.value;

  /* Energy-based charges */
  const usf_rider = d.usf_rider.value * kwh;
  const tcrr_n    = d.tcrr_n.value * kwh;

  // Tiered excise tax
  let excise = 0;
  if (kwh <= d.excise_tax_tier1.threshold) {
    excise = d.excise_tax_tier1.value * kwh;
  } else if (kwh <= d.excise_tax_tier2.threshold) {
    excise  = d.excise_tax_tier1.value * d.excise_tax_tier1.threshold;
    excise += d.excise_tax_tier2.value * (kwh - d.excise_tax_tier1.threshold);
  } else {
    excise  = d.excise_tax_tier1.value * d.excise_tax_tier1.threshold;
    excise += d.excise_tax_tier2.value * (d.excise_tax_tier2.threshold - d.excise_tax_tier1.threshold);
    excise += d.excise_tax_tier3.value * (kwh - d.excise_tax_tier2.threshold);
  }

  /* Percentage-of-Base-Distribution riders */
  const infra_rider       = base_dist_revenue * d.infrastructure_rider.value;
  const tax_savings_cr    = base_dist_revenue * d.tax_savings_credit.value;
  const dist_invest_rider = base_dist_revenue * d.distribution_investment.value;
  const reg_compliance    = base_dist_revenue * d.regulatory_compliance.value;

  /* Other Delivery subtotal */
  const other_delivery = (
    distribution +
    usf_rider +
    storm_rider +
    excise +
    infra_rider +
    tcrr_n +
    tax_savings_cr +
    proactive_rider +
    dist_invest_rider +
    reg_compliance
  );

  const delivery_total = customer_charge + other_delivery;

  /* Supply */
  const isWinter = (planId === 'heating' && billSeason === 'winter');
  const sor_rate = isWinter ? r.supply.sor_heating_winter.value : r.supply.sor_non_heating.value;

  const supply = sor_rate * kwh;
  const total  = delivery_total + supply;
  const ptc    = kwh > 0 ? supply / kwh : 0;

  return {
    customer_charge, distribution,
    usf_rider, storm_rider, excise,
    infra_rider, tcrr_n, tax_savings_cr,
    proactive_rider, dist_invest_rider, reg_compliance,
    other_delivery, delivery_total,
    sor_rate, supply, total, ptc
  };
}

/* ── Render breakdown ────────────────────────────────────────────────── */
function render(b, kwh, planId, billSeason) {
  /* Line items */
  set('l_customer_charge',  fmt(b.customer_charge));
  set('l_distribution',     fmt(b.distribution));
  set('l_usf',              fmt(b.usf_rider));
  set('l_storm',            fmt(b.storm_rider));
  set('l_excise',           fmt(b.excise));
  set('l_infra',            fmt(b.infra_rider));
  set('l_tcrr',             fmt(b.tcrr_n));
  set('l_tax_savings',      fmt(b.tax_savings_cr));
  set('l_proactive',        fmt(b.proactive_rider));
  set('l_dist_invest',      fmt(b.dist_invest_rider));
  set('l_reg_compliance',   fmt(b.reg_compliance));
  set('l_other_delivery',   fmt(b.other_delivery));
  set('l_delivery_total',   fmt(b.delivery_total));

  /* Supply */
  const sorLabel = `($${b.sor_rate.toFixed(7).replace(/0+$/,'').replace(/\.$/,'')} /kWh)`;
  set('l_sor_rate',     sorLabel);
  set('l_supply',       fmt(b.supply));
  set('l_supply_total', fmt(b.supply));
  set('l_grand_total',  fmt(b.total));

  /* PTC */
  set('ptc_dollars', fmt(b.supply));
  set('ptc_rate',    '$' + b.ptc.toFixed(6).replace(/0+$/,'').replace(/\.$/,'') + '/kWh');

  /* Total card */
  const totalEl = $('totalAmount');
  totalEl.textContent = fmt(b.total);
  totalEl.classList.remove('bump');
  void totalEl.offsetWidth;
  totalEl.classList.add('bump');

  const planLabel = planId === 'heating'
    ? `Residential Heating · ${billSeason === 'winter' ? 'Winter' : 'Summer'}`
    : 'Residential Non-Heating';
  set('totalMeta', `${kwh.toLocaleString()} kWh · ${planLabel}`);
}

/* ── Sync URL ────────────────────────────────────────────────────────── */
function syncURL() {
  const url = new URL(location.href);
  url.searchParams.set('plan',   plan);
  url.searchParams.set('usage',  usage);
  url.searchParams.set('season', season);
  history.replaceState(null, '', url.toString());
}

function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.get('plan')  && ['non_heating','heating'].includes(p.get('plan')))  plan  = p.get('plan');
  if (p.get('usage') && !isNaN(+p.get('usage')))                            usage = Math.max(0, +p.get('usage'));
  if (p.get('season')&& ['summer','winter'].includes(p.get('season')))     season = p.get('season');
}

/* ── localStorage cache ──────────────────────────────────────────────── */
const CACHE_KEY = 'aes_calc_v1';

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ plan, usage, season }));
  } catch(_) {}
}

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    if (c.plan   && ['non_heating','heating'].includes(c.plan))  plan   = c.plan;
    if (c.usage  && !isNaN(+c.usage))                            usage  = Math.max(0, +c.usage);
    if (c.season && ['summer','winter'].includes(c.season))      season = c.season;
  } catch(_) {}
}

/* ── Update everything ───────────────────────────────────────────────── */
function update() {
  const b = calculate(usage, plan, season);
  render(b, usage, plan, season);
  syncURL();
  saveCache();
}

/* ── PDF / Print ──────────────────────────────────────────────────────── */
function exportPDF() {
  const b       = calculate(usage, plan, season);
  const dateStr = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  const planLabel = plan === 'heating'
    ? `Residential Heating · ${season === 'winter' ? 'Winter' : 'Summer'}`
    : 'Residential Non-Heating';

  $('printDate').textContent = `Generated: ${dateStr}`;
  $('printMeta').textContent = `Plan: ${planLabel} · Usage: ${usage.toLocaleString()} kWh · Supplier: AES Ohio`;

  const rows = [
    // [label, amount, class]
    ['AES Ohio Delivery Charges', '', 'section'],
    ['Customer Charge (per bill)',                  fmt(b.customer_charge), ''],
    ['Other Delivery Charges', '', 'subsection'],
    ['Distribution Charge',                         fmt(b.distribution), ''],
    ['PIPP Rider (previously USF Rider)',            fmt(b.usf_rider), ''],
    ['Storm Rider (per bill)',                       fmt(b.storm_rider), ''],
    ['Excise Tax',                                   fmt(b.excise), ''],
    ['Infrastructure Investment Rider',              fmt(b.infra_rider), ''],
    ['Transmission Cost Recovery Rider - N',         fmt(b.tcrr_n), ''],
    ['Tax Savings Credit Rider',                     fmt(b.tax_savings_cr), ''],
    ['Proactive Reliability Optimization Rider',     fmt(b.proactive_rider), ''],
    ['Distribution Investment Rider',                fmt(b.dist_invest_rider), ''],
    ['Regulatory Compliance Rider',                  fmt(b.reg_compliance), ''],
    ['Other Delivery Charges',                       fmt(b.other_delivery), 'subtotal'],
    ['AES Ohio Delivery Total',                      fmt(b.delivery_total), 'subtotal'],
    ['Supply Charges', '', 'section'],
    [`Standard Offer Rate ($${b.sor_rate.toFixed(6).replace(/0+$/,'')}/kWh)`, fmt(b.supply), ''],
    ['Supply Total',                                 fmt(b.supply), 'subtotal'],
    ['TOTAL',                                        fmt(b.total), 'total'],
    [`Price-To-Compare: $${b.ptc.toFixed(6).replace(/0+$/,'')}/kWh`, fmt(b.supply) + ' (supply)', 'ptc'],
  ];

  let html = '<table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>';
  rows.forEach(([label, amt, cls]) => {
    if (cls === 'section')    { html += `<tr class="subtotal"><td colspan="2"><strong>${label}</strong></td></tr>`; return; }
    if (cls === 'subsection') { html += `<tr><td colspan="2" style="padding-top:8px;color:#6b7280;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em">${label}</td></tr>`; return; }
    html += `<tr class="${cls}"><td>${label}</td><td style="text-align:right;font-family:monospace">${amt}</td></tr>`;
  });
  html += '</tbody></table>';
  $('printBody').innerHTML = html;

  window.print();
}

/* ── Wire up UI ──────────────────────────────────────────────────────── */
function initUI() {
  const planSelect   = $('planSelect');
  const usageInput   = $('usageInput');
  const usageSlider  = $('usageSlider');
  const seasonGroup  = $('seasonGroup');
  const segBtns      = document.querySelectorAll('.seg-btn');
  const shareBtn     = $('shareBtn');
  const shareToast   = $('shareToast');
  const exportBtn    = $('exportBtn');
  const themeBtn     = $('themeBtn');

  /* --- Plan select --- */
  planSelect.value = plan;
  planSelect.addEventListener('change', () => {
    plan = planSelect.value;
    const isHeating = (plan === 'heating');
    seasonGroup.hidden = !isHeating;
    update();
  });
  seasonGroup.hidden = (plan !== 'heating');

  /* --- Season buttons --- */
  segBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.season === season);
    btn.addEventListener('click', () => {
      season = btn.dataset.season;
      segBtns.forEach(b => b.classList.toggle('active', b.dataset.season === season));
      update();
    });
  });

  /* --- Usage input --- */
  usageInput.value  = usage;
  usageSlider.value = Math.min(usage, +usageSlider.max);

  usageInput.addEventListener('input', () => {
    usage = Math.max(0, parseInt(usageInput.value, 10) || 0);
    usageSlider.value = Math.min(usage, +usageSlider.max);
    update();
  });

  usageSlider.addEventListener('input', () => {
    usage = +usageSlider.value;
    usageInput.value = usage;
    update();
  });

  /* --- Share --- */
  shareBtn.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('plan', plan);
    url.searchParams.set('usage', usage);
    url.searchParams.set('season', season);

    if (navigator.clipboard) {
      navigator.clipboard.writeText(url.toString()).then(() => {
        shareToast.textContent = 'Link copied!';
        setTimeout(() => { shareToast.textContent = ''; }, 2500);
      });
    } else {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url.toString();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      shareToast.textContent = 'Link copied!';
      setTimeout(() => { shareToast.textContent = ''; }, 2500);
    }
  });

  /* --- Export --- */
  exportBtn.addEventListener('click', exportPDF);

  /* --- Theme --- */
  const savedTheme = localStorage.getItem('aes_theme') || 'light';
  document.body.dataset.theme = savedTheme;

  themeBtn.addEventListener('click', () => {
    const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
    document.body.dataset.theme = next;
    localStorage.setItem('aes_theme', next);
  });
}

/* ── Boot ────────────────────────────────────────────────────────────── */
async function boot() {
  try {
    const res = await fetch('data.json');
    DATA = await res.json();
  } catch(e) {
    console.error('Failed to load data.json:', e);
    return;
  }

  // Priority: URL params > localStorage cache > defaults
  loadCache();
  readURL();

  initUI();
  update();
}

document.addEventListener('DOMContentLoaded', boot);