"use strict";

const CFG = window.FURIMA_CONFIG;
const STORE_KEY = "furima-note:v1";

// 2026年10月時点の公開料金をもとにした初期値。改定時は設定画面から編集できる。
const DEFAULT_PLATFORMS = [
  { id: "mercari", name: "メルカリ", fee: 10 },
  { id: "rakuma", name: "楽天ラクマ", fee: 10 },
  { id: "yahoo", name: "Yahoo!フリマ", fee: 5 },
  { id: "yauc", name: "ヤフオク!", fee: 10 },
  { id: "jimoty", name: "ジモティー/手渡し", fee: 0 },
];
const DEFAULT_SHIPPING = [
  { id: "nekopos", name: "ネコポス", cost: 210 },
  { id: "yupacket", name: "ゆうパケット", cost: 230 },
  { id: "yupost", name: "ゆうパケットポスト", cost: 215 },
  { id: "compact", name: "宅急便コンパクト", cost: 450 },
  { id: "takkyu60", name: "宅急便 60サイズ", cost: 750 },
  { id: "takkyu80", name: "宅急便 80サイズ", cost: 850 },
  { id: "buyer", name: "着払い/手渡し", cost: 0 },
];

// ---------- state ----------
const state = load();

function load() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) {}
  return Object.assign({
    items: [],
    platforms: structuredClone(DEFAULT_PLATFORMS),
    shipping: structuredClone(DEFAULT_SHIPPING),
    license: "",
  }, data || {});
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const yen = (n) => (n < 0 ? "-¥" : "¥") + Math.abs(Math.round(n)).toLocaleString("ja-JP");
const num = (v) => Math.max(0, Number(v) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const platformOf = (id) => state.platforms.find((p) => p.id === id) || { name: "-", fee: 0 };
const shippingOf = (id) => state.shipping.find((s) => s.id === id) || { name: "-", cost: 0 };

function calc({ price, cost, extra, platform, shipping }) {
  const fee = Math.floor(num(price) * platformOf(platform).fee / 100);
  const ship = shippingOf(shipping).cost;
  const profit = num(price) - num(cost) - num(extra) - fee - ship;
  const margin = num(price) ? (profit / num(price)) * 100 : 0;
  return { fee, ship, profit, margin };
}

// 目標利益率を満たす最低販売価格（100円単位で切り上げ）
function suggestPrice({ cost, extra, platform, shipping, target }) {
  const rate = 1 - platformOf(platform).fee / 100 - num(target) / 100;
  if (rate <= 0) return null;
  const raw = (num(cost) + num(extra) + shippingOf(shipping).cost) / rate;
  return Math.ceil(raw / 100) * 100;
}

// ---------- license ----------
// FRM-AAAA-BBBB-CCCC : CCCC は AAAABBBB+salt のハッシュ先頭4桁
async function checksum(body) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body + CFG.licenseSalt));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 4).toUpperCase();
}
async function isValidLicense(key) {
  const m = /^FRM-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/.exec((key || "").trim().toUpperCase());
  if (!m) return false;
  return (await checksum(m[1] + m[2])) === m[3];
}
let isPro = false;

// ---------- UI: tabs ----------
$$(".tabs button").forEach((b) => b.addEventListener("click", () => {
  $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  render();
}));

function fillSelect(sel, list, valueKey = "id") {
  const cur = sel.value;
  sel.innerHTML = list.map((x) => `<option value="${esc(x[valueKey])}">${esc(x.name)}</option>`).join("");
  if (list.some((x) => x[valueKey] === cur)) sel.value = cur;
}

// ---------- UI: calculator ----------
const calcForm = $("#calcForm");
function calcValues() {
  const f = Object.fromEntries(new FormData(calcForm));
  return { ...f, price: num(f.price), cost: num(f.cost), extra: num(f.extra), target: num(f.target) };
}
function renderCalc() {
  const v = calcValues();
  const r = calc(v);
  const sp = suggestPrice(v);
  const cls = r.profit < 0 ? "neg" : "pos";
  $("#calcResult").innerHTML = `
    <div class="big ${cls}">${yen(r.profit)}<small>利益率 ${r.margin.toFixed(1)}%</small></div>
    <dl>
      <dt>販売手数料</dt><dd>${yen(r.fee)}</dd>
      <dt>送料</dt><dd>${yen(r.ship)}</dd>
      <dt>目標${v.target}%に必要な価格</dt><dd>${sp ? yen(sp) + " 以上" : "設定不可"}</dd>
    </dl>`;
}
calcForm.addEventListener("input", renderCalc);

function canAdd() {
  if (isPro || state.items.length < CFG.freeItemLimit) return true;
  alert(`無料版は${CFG.freeItemLimit}件まで登録できます。PROで無制限になります。`);
  $('.tabs button[data-tab="settings"]').click();
  return false;
}
function addItem(status) {
  if (!canAdd()) return;
  const v = calcValues();
  state.items.unshift({
    id: uid(), name: v.name || "名称未設定", status,
    platform: v.platform, shipping: v.shipping,
    cost: v.cost, price: v.price, extra: v.extra,
    boughtAt: today(), soldAt: status === "sold" ? today() : "",
  });
  save();
  calcForm.reset();
  renderCalc();
  toast(status === "sold" ? "売上を記録しました" : "在庫に追加しました");
}
$("#saveStock").addEventListener("click", () => addItem("stock"));
$("#saveSold").addEventListener("click", () => addItem("sold"));

// ---------- UI: items ----------
const STATUS_LABEL = { stock: "在庫", listed: "出品中", sold: "売却済" };
function renderItems() {
  const f = $("#filterStatus").value;
  const q = $("#search").value.trim().toLowerCase();
  const list = state.items.filter((i) => (f === "all" || i.status === f) && (!q || i.name.toLowerCase().includes(q)));
  $("#limitHint").textContent = isPro ? `${state.items.length}件` : `${state.items.length} / ${CFG.freeItemLimit}件（無料版）`;
  $("#itemList").innerHTML = list.length ? list.map((i) => {
    const r = calc(i);
    return `<li data-id="${i.id}">
      <div><strong>${esc(i.name)}</strong><span class="st st-${i.status}">${STATUS_LABEL[i.status]}</span>
      <div class="sub">${esc(platformOf(i.platform).name)} ・ 仕入 ${yen(i.cost)} → ${yen(i.price)}</div></div>
      <div class="${r.profit < 0 ? "neg" : "pos"}">${yen(r.profit)}</div>
    </li>`;
  }).join("") : `<li class="empty">まだ商品がありません</li>`;
}
$("#filterStatus").addEventListener("change", renderItems);
$("#search").addEventListener("input", renderItems);
$("#itemList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) openEdit(li.dataset.id);
});

const dlg = $("#editDlg");
const editForm = $("#editForm");
let editingId = null;
function openEdit(id) {
  const it = state.items.find((i) => i.id === id);
  if (!it) return;
  editingId = id;
  fillSelect(editForm.platform, state.platforms);
  fillSelect(editForm.shipping, state.shipping);
  for (const k of ["name", "status", "platform", "shipping", "cost", "price", "extra", "boughtAt", "soldAt"]) editForm[k].value = it[k] ?? "";
  dlg.showModal();
}
editForm.status.addEventListener("change", () => {
  if (editForm.status.value === "sold" && !editForm.soldAt.value) editForm.soldAt.value = today();
});
dlg.addEventListener("close", () => {
  const it = state.items.find((i) => i.id === editingId);
  if (!it) return;
  if (dlg.returnValue === "delete") {
    if (confirm("削除しますか？")) state.items = state.items.filter((i) => i.id !== editingId);
  } else if (dlg.returnValue === "save") {
    const f = Object.fromEntries(new FormData(editForm));
    Object.assign(it, f, { cost: num(f.cost), price: num(f.price), extra: num(f.extra) });
  }
  save();
  render();
});

// ---------- UI: stats ----------
function soldInYear(y) {
  return state.items.filter((i) => i.status === "sold" && (i.soldAt || "").startsWith(String(y)));
}
function renderStats() {
  const years = new Set([new Date().getFullYear()]);
  state.items.forEach((i) => i.soldAt && years.add(Number(i.soldAt.slice(0, 4))));
  const ysel = $("#yearSel");
  const cur = Number(ysel.value) || new Date().getFullYear();
  ysel.innerHTML = [...years].sort((a, b) => b - a).map((y) => `<option ${y === cur ? "selected" : ""}>${y}</option>`).join("");

  const sold = soldInYear(cur);
  const t = sold.reduce((a, i) => {
    const r = calc(i);
    a.sales += i.price; a.profit += r.profit; a.fee += r.fee; a.ship += r.ship;
    return a;
  }, { sales: 0, profit: 0, fee: 0, ship: 0 });
  const stockValue = state.items.filter((i) => i.status !== "sold").reduce((a, i) => a + i.cost, 0);
  $("#kpis").innerHTML = [
    ["売上", yen(t.sales)], ["利益", yen(t.profit)], ["販売数", sold.length + "点"], ["在庫金額", yen(stockValue)],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");

  const months = Array(12).fill(0);
  sold.forEach((i) => { months[Number(i.soldAt.slice(5, 7)) - 1] += calc(i).profit; });
  const max = Math.max(1, ...months.map(Math.abs));
  $("#monthChart").innerHTML = months.map((v, m) =>
    `<div class="bar" title="${m + 1}月 ${yen(v)}"><i class="${v < 0 ? "neg-bg" : ""}" style="height:${(Math.abs(v) / max) * 100}%"></i><span>${m + 1}</span></div>`).join("");

  const proLock = (html) => isPro ? html : `<p class="hint">PROで利用できます</p>`;
  const byP = {};
  sold.forEach((i) => {
    const p = (byP[i.platform] ||= { n: 0, profit: 0 });
    p.n++; p.profit += calc(i).profit;
  });
  $("#platformStats").innerHTML = proLock(Object.entries(byP).map(([id, p]) =>
    `<div class="kv"><span>${esc(platformOf(id).name)}</span><span>${p.n}点 / ${yen(p.profit)}</span></div>`).join("") || `<p class="hint">データなし</p>`);

  const cutoff = Date.now() - 60 * 864e5;
  const stale = state.items.filter((i) => i.status !== "sold" && i.boughtAt && Date.parse(i.boughtAt) < cutoff);
  $("#staleList").innerHTML = proLock(stale.map((i) =>
    `<li data-id="${i.id}"><span>${esc(i.name)}</span><span class="sub">${Math.floor((Date.now() - Date.parse(i.boughtAt)) / 864e5)}日</span></li>`).join("") || `<li class="empty">なし</li>`);
}
$("#yearSel").addEventListener("change", renderStats);
$("#staleList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) openEdit(li.dataset.id);
});

$("#exportCsv").addEventListener("click", () => {
  if (!isPro) { alert("CSVエクスポートはPRO機能です。"); $('.tabs button[data-tab="settings"]').click(); return; }
  const y = $("#yearSel").value;
  const head = ["売却日", "仕入日", "商品名", "販売先", "販売価格", "仕入れ値", "販売手数料", "送料", "梱包材など", "利益"];
  const rows = soldInYear(y).sort((a, b) => a.soldAt.localeCompare(b.soldAt)).map((i) => {
    const r = calc(i);
    return [i.soldAt, i.boughtAt, i.name, platformOf(i.platform).name, i.price, i.cost, r.fee, r.ship, i.extra, r.profit];
  });
  const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  download(`furima-${y}.csv`, "﻿" + csv, "text/csv");
});

// ---------- UI: settings ----------
function presetEditor(el, list, key, suffix) {
  el.innerHTML = list.map((x, idx) =>
    `<div class="kv"><span>${esc(x.name)}</span><span><input type="number" min="0" step="${key === "fee" ? "0.1" : "1"}" data-idx="${idx}" value="${x[key]}"> ${suffix}</span></div>`).join("");
  el.oninput = (e) => {
    const i = e.target.dataset.idx;
    if (i == null) return;
    list[i][key] = num(e.target.value);
    save();
    renderCalc();
  };
}
function renderSettings() {
  presetEditor($("#platformEditor"), state.platforms, "fee", "%");
  presetEditor($("#shippingEditor"), state.shipping, "cost", "円");
  $("#buyMonthly").href = CFG.buyMonthlyUrl;
  $("#buyLifetime").href = CFG.buyLifetimeUrl;
  $("#licenseInput").value = state.license;
  $("#licenseMsg").textContent = isPro ? "PRO有効です。ありがとうございます！" : "";
}
$("#resetPresets").addEventListener("click", () => {
  if (!confirm("手数料と送料を初期値に戻しますか？")) return;
  state.platforms = structuredClone(DEFAULT_PLATFORMS);
  state.shipping = structuredClone(DEFAULT_SHIPPING);
  save(); render();
});
$("#activate").addEventListener("click", async () => {
  const key = $("#licenseInput").value.trim().toUpperCase();
  if (await isValidLicense(key)) {
    state.license = key; save(); await refreshPlan(); toast("PROを有効化しました");
  } else {
    $("#licenseMsg").textContent = "ライセンスキーが正しくありません。";
  }
});
$("#backup").addEventListener("click", () => download(`furima-backup-${today()}.json`, JSON.stringify(state, null, 2), "application/json"));
$("#restore").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.items)) throw new Error();
    if (!confirm(`${data.items.length}件のデータで上書きしますか？`)) return;
    Object.assign(state, data);
    save(); await refreshPlan(); toast("復元しました");
  } catch (_) { alert("バックアップファイルを読み込めませんでした。"); }
  e.target.value = "";
});

// ---------- misc ----------
function download(name, text, type) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function toast(msg) {
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
}

function render() {
  fillSelect($("#platformSel"), state.platforms);
  fillSelect($("#shippingSel"), state.shipping);
  renderCalc();
  renderItems();
  renderStats();
  renderSettings();
}
async function refreshPlan() {
  isPro = await isValidLicense(state.license);
  $("#planBadge").textContent = isPro ? "PRO" : "FREE";
  $("#planBadge").classList.toggle("pro", isPro);
  $("#adSlot").hidden = isPro;
  render();
}

refreshPlan();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
