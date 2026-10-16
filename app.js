"use strict";
const CFG = window.FURIMA_CONFIG;
const C = window.FurimaCore;
const DB = window.FurimaDB;
// Google Play 版（Capacitor）。外部決済への導線を出さず、ファイル保存は共有メニューを使う
const IS_ANDROID = CFG.platform === "android";
const VERSION = "2.0.0";
const PAGE = 50;
const STALE_DAYS = 60;

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const yen = (n) => (n < 0 ? "-¥" : "¥") + Math.abs(Math.round(n)).toLocaleString("ja-JP");
const num = C.num;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STATUS_LABEL = { stock: "在庫", listed: "出品中", sold: "売却済" };

// ---------- state ----------
let state = null;
let isPro = false;

function normalize(s) {
  s = Object.assign({ items: [], expenses: [], platforms: structuredClone(C.DEFAULT_PLATFORMS), shipping: structuredClone(C.DEFAULT_SHIPPING), license: "", lastBackup: "", welcomed: false }, s || {});
  s.schema = 2;
  s.items = (s.items || []).map((i) => ({
    id: i.id || uid(), name: i.name || "名称未設定", status: STATUS_LABEL[i.status] ? i.status : "stock",
    platform: i.platform || s.platforms[0]?.id, shipping: i.shipping || s.shipping[0]?.id,
    cost: num(i.cost), price: num(i.price), extra: num(i.extra),
    boughtAt: i.boughtAt || "", listedAt: i.listedAt || "", soldAt: i.soldAt || "",
    supplier: i.supplier || "", memo: i.memo || "", hasPhoto: !!i.hasPhoto,
    createdAt: i.createdAt || (i.boughtAt ? i.boughtAt + "T00:00:00Z" : new Date().toISOString()), updatedAt: i.updatedAt || "",
  }));
  s.expenses = (s.expenses || []).map((e) => ({ id: e.id || uid(), date: e.date || today(), category: e.category || "その他", amount: num(e.amount), memo: e.memo || "" }));
  return s;
}
const save = () => DB.saveState(state);
const P = () => state.platforms, S = () => state.shipping;
const calc = (i) => C.calc(i, P(), S());
const platformOf = (id) => P().find((p) => p.id === id) || { name: "（削除された販売先）", fee: 0 };
const shippingOf = (id) => S().find((s) => s.id === id) || { name: "（削除された配送方法）", cost: 0 };

// ---------- 共通UI ----------
function toast(msg, action) {
  $$(".toast").forEach((t) => t.remove());
  const t = Object.assign(document.createElement("div"), { className: "toast" });
  t.append(msg);
  if (action) {
    const b = Object.assign(document.createElement("button"), { textContent: action.label, type: "button" });
    b.onclick = () => { action.run(); t.remove(); };
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), action ? 5000 : 2200);
}
function fillSelect(sel, list, extra = []) {
  const cur = sel.value;
  sel.innerHTML = [...extra, ...list].map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
  if ([...extra, ...list].some((x) => x.id === cur)) sel.value = cur;
}
function goTab(name) { $(`.tabs button[data-tab="${name}"]`).click(); }
function requirePro(feature) {
  if (isPro) return true;
  if (IS_ANDROID) toast(`${feature}はPRO機能です（アプリ内購入は準備中）`);
  else { toast(`${feature}はPRO機能です`); goTab("settings"); }
  return false;
}
const lockHtml = (what) => `<p class="hint">${what}は <b>PRO</b> で使えます。${IS_ANDROID ? "（アプリ内購入は準備中）" : `<button class="link" data-go="settings">PROについて</button>`}</p>`;

$$(".tabs button").forEach((b) => b.addEventListener("click", () => {
  $$(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  window.scrollTo(0, 0);
  render();
}));
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) goTab(g.dataset.go);
});
const activeTab = () => $(".tabs button.active").dataset.tab;

// ---------- 計算 ----------
const calcForm = $("#calcForm");
function calcValues() {
  const f = Object.fromEntries(new FormData(calcForm));
  return { ...f, price: num(f.price), cost: num(f.cost), extra: num(f.extra), target: num(f.target) };
}
function renderCalc() {
  fillSelect($("#platformSel"), P());
  fillSelect($("#shippingSel"), S());
  const v = calcValues();
  const r = calc(v);
  const sp = C.suggestPrice(v, P(), S());
  const be = C.breakEvenPrice(v, P(), S());
  $("#calcResult").innerHTML = `
    <div class="big ${r.profit < 0 ? "neg" : "pos"}">${yen(r.profit)}<small>利益率 ${r.margin.toFixed(1)}%</small></div>
    <dl>
      <dt>販売手数料（${platformOf(v.platform).fee}%）</dt><dd>${yen(r.fee)}</dd>
      <dt>送料</dt><dd>${yen(r.ship)}</dd>
      <dt>赤字にならない最低価格</dt><dd>${be != null ? yen(be) : "-"}</dd>
      <dt>利益率${v.target}%に必要な価格</dt><dd>${sp != null ? yen(sp) + " 以上" : "設定できません"}</dd>
    </dl>`;
  const list = C.compare(v, P(), S());
  $("#compare").innerHTML = v.price
    ? list.map((x, k) => `<div class="cmp ${k === 0 && list[0].profit > (list[1]?.profit ?? -Infinity) ? "best" : ""} ${x.platform.id === v.platform ? "cur" : ""}">
        <span class="name">${esc(x.platform.name)}${k === 0 && list[0].profit > (list[1]?.profit ?? -Infinity) ? "<small>いちばん得</small>" : ""}</span><span class="fee">手数料 ${yen(x.fee)}</span><b class="${x.profit < 0 ? "neg" : "pos"}">${yen(x.profit)}</b></div>`).join("")
    : `<p class="hint">販売価格を入れると、販売先ごとの利益を比べられます。</p>`;
  $("#welcome").hidden = state.welcomed;
}
calcForm.addEventListener("input", renderCalc);
$("#welcomeClose").onclick = () => { state.welcomed = true; save(); renderCalc(); };

function canAdd() {
  if (isPro || state.items.length < CFG.freeItemLimit) return true;
  alert(IS_ANDROID
    ? `無料版は${CFG.freeItemLimit}件まで登録できます。PRO（無制限）はアプリ内購入に対応する準備中です。`
    : `無料版は${CFG.freeItemLimit}件まで登録できます。PRO（買い切り）で無制限になります。`);
  if (!IS_ANDROID) goTab("settings");
  return false;
}
$$("[data-save]").forEach((b) => b.addEventListener("click", () => {
  if (!canAdd()) return;
  const v = calcValues(), status = b.dataset.save, d = today();
  state.items.unshift(normalize({ items: [{
    name: v.name.trim() || "名称未設定", status, platform: v.platform, shipping: v.shipping,
    cost: v.cost, price: v.price, extra: v.extra, boughtAt: d,
    listedAt: status !== "stock" ? d : "", soldAt: status === "sold" ? d : "", createdAt: new Date().toISOString(),
  }] }).items[0]);
  state.welcomed = true;
  save();
  for (const k of ["name", "cost", "price", "extra"]) calcForm[k].value = "";
  renderCalc();
  toast(status === "sold" ? "売上を記録しました" : status === "listed" ? "出品中として保存しました" : "在庫に保存しました", { label: "開く", run: () => openEdit(state.items[0].id) });
}));

// ---------- 在庫 ----------
let filterStatus = "all", shown = PAGE;
$("#statusChips").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  filterStatus = b.dataset.status; shown = PAGE;
  $$("#statusChips button").forEach((x) => x.classList.toggle("on", x === b));
  renderItems();
});
["#search", "#filterPlatform", "#sortBy"].forEach((s) => $(s).addEventListener("input", () => { shown = PAGE; renderItems(); }));
$("#moreItems").onclick = () => { shown += PAGE; renderItems(); };

const heldDays = (i) => C.daysBetween(i.boughtAt || i.createdAt.slice(0, 10), i.status === "sold" && i.soldAt ? i.soldAt : today());
function filteredItems() {
  const q = $("#search").value.trim().toLowerCase(), pf = $("#filterPlatform").value, sort = $("#sortBy").value;
  const list = state.items.filter((i) => (filterStatus === "all" || i.status === filterStatus)
    && (!pf || i.platform === pf)
    && (!q || `${i.name} ${i.memo} ${i.supplier}`.toLowerCase().includes(q)));
  const by = {
    new: (a, b) => b.createdAt.localeCompare(a.createdAt),
    old: (a, b) => heldDays(b) - heldDays(a),
    profit: (a, b) => calc(b).profit - calc(a).profit,
    price: (a, b) => b.price - a.price,
    sold: (a, b) => (b.soldAt || "").localeCompare(a.soldAt || ""),
  }[sort];
  return list.sort(by);
}
function renderItems() {
  fillSelect($("#filterPlatform"), P(), [{ id: "", name: "すべての販売先" }]);
  const list = filteredItems();
  const stockValue = list.filter((i) => i.status !== "sold").reduce((s, i) => s + i.cost, 0);
  $("#itemSummary").textContent = `${list.length}件` + (stockValue ? `・在庫金額 ${yen(stockValue)}` : "") +
    (isPro ? "" : `（登録 ${state.items.length} / ${CFG.freeItemLimit}件）`);
  const page = list.slice(0, shown);
  $("#itemList").innerHTML = page.length ? page.map((i) => {
    const r = calc(i), d = heldDays(i);
    const sub = [platformOf(i.platform).name, `仕入 ${yen(i.cost)} → ${yen(i.price)}`, i.status === "sold" ? i.soldAt.slice(5).replace("-", "/") + " 売却" : `${d}日目`].join(" ・ ");
    return `<li data-id="${i.id}">
      <div class="thumb" data-photo="${i.hasPhoto ? i.id : ""}">${i.hasPhoto ? "" : "📦"}</div>
      <div class="main"><strong>${esc(i.name)}</strong><div class="sub"><span class="st st-${i.status}">${STATUS_LABEL[i.status]}</span>${esc(sub)}</div></div>
      <div class="side ${r.profit < 0 ? "neg" : "pos"}">${yen(r.profit)}<small>${r.margin.toFixed(0)}%</small></div></li>`;
  }).join("") : `<li class="empty">${state.items.length ? "条件に合う商品がありません" : "まだ商品がありません。<br>「計算」タブで保存するか、右下の＋から追加できます。"}</li>`;
  $("#moreItems").hidden = list.length <= shown;
  loadThumbs($("#itemList"));
}
async function loadThumbs(root) {
  for (const el of $$("[data-photo]", root)) {
    const id = el.dataset.photo; if (!id) continue;
    const url = await DB.getPhoto(id);
    if (url) el.style.backgroundImage = `url("${url}")`;
  }
}
$("#itemList").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openEdit(li.dataset.id); });
$("#addItem").onclick = () => { if (canAdd()) openEdit(null); };

// ---------- 編集シート ----------
const dlg = $("#editDlg"), ef = $("#editForm");
let editing = null, photoDraft = undefined; // undefined=変更なし, null=削除, string=新しい写真
const FIELDS = ["name", "status", "platform", "shipping", "cost", "price", "extra", "boughtAt", "listedAt", "soldAt", "supplier", "memo"];
function openEdit(id) {
  const it = id ? state.items.find((i) => i.id === id) : normalize({ items: [{ boughtAt: today(), platform: $("#platformSel").value, shipping: $("#shippingSel").value }] }).items[0];
  if (!it) return;
  editing = { id, item: it };
  photoDraft = undefined;
  $("#editTitle").textContent = id ? "商品の編集" : "商品を追加";
  $("#delBtn").hidden = $("#dupBtn").hidden = !id;
  fillSelect(ef.platform, P());
  fillSelect(ef.shipping, S());
  for (const k of FIELDS) ef[k].value = it[k] ?? "";
  if (!id) ef.name.value = "";
  showPhoto(null);
  if (id && it.hasPhoto) DB.getPhoto(id).then(showPhoto);
  renderPreview();
  dlg.returnValue = "";
  dlg.showModal();
  dlg.scrollTop = 0;
}
function showPhoto(url) {
  $("#photoImg").hidden = !url; $("#photoEmpty").hidden = !!url; $("#photoRemove").hidden = !url;
  if (url) $("#photoImg").src = url; else $("#photoImg").removeAttribute("src");
}
function editValues() {
  const f = Object.fromEntries(new FormData(ef));
  return { ...f, cost: num(f.cost), price: num(f.price), extra: num(f.extra) };
}
function renderPreview() {
  const v = editValues(), r = calc(v), be = C.breakEvenPrice(v, P(), S());
  $("#editPreview").innerHTML = `<div><span>利益</span><b class="${r.profit < 0 ? "neg" : "pos"}">${yen(r.profit)}</b></div>
    <div><span>利益率</span><b>${r.margin.toFixed(1)}%</b></div><div><span>損益分岐</span><b>${be != null ? yen(be) : "-"}</b></div>`;
}
ef.addEventListener("input", renderPreview);
ef.status.addEventListener("change", () => {
  if (ef.status.value === "sold" && !ef.soldAt.value) ef.soldAt.value = today();
  if (ef.status.value !== "stock" && !ef.listedAt.value) ef.listedAt.value = today();
  if (ef.status.value !== "sold") ef.soldAt.value = "";
});
ef.soldAt.addEventListener("change", () => { if (ef.soldAt.value) ef.status.value = "sold"; });
$("#photoCamera").onclick = () => $("#photoCameraInput").click();
$("#photoAlbum").onclick = () => $("#photoInput").click();
async function onPhotoPicked(e) {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try { photoDraft = await DB.compressImage(file); showPhoto(photoDraft); }
  catch (err) { toast(err.message); }
}
$("#photoInput").onchange = onPhotoPicked;
$("#photoCameraInput").onchange = onPhotoPicked;
$("#photoRemove").onclick = () => { photoDraft = null; showPhoto(null); };

dlg.addEventListener("close", async () => {
  if (!editing) return;
  const action = dlg.returnValue, { id } = editing;
  editing = null;
  if (action === "cancel" || !action) return;
  if (action === "delete") {
    const idx = state.items.findIndex((i) => i.id === id), removed = state.items[idx];
    state.items.splice(idx, 1);
    save(); render();
    toast("削除しました", { label: "元に戻す", run: () => { state.items.splice(idx, 0, removed); save(); render(); } });
    if (removed.hasPhoto) setTimeout(() => { if (!state.items.includes(removed)) DB.setPhoto(id, null); }, 5500);
    return;
  }
  const v = editValues();
  if (v.status === "sold" && !v.soldAt) v.soldAt = today();
  if (v.soldAt && v.boughtAt && v.soldAt < v.boughtAt) { alert("売却日が仕入日より前になっています。日付を確認してください。"); return; }
  let target;
  if (!id || action === "duplicate") {
    if (action === "duplicate" && !canAdd()) return;
    target = normalize({ items: [{ ...v, createdAt: new Date().toISOString() }] }).items[0];
    if (action === "duplicate") Object.assign(target, { name: v.name + "（コピー）", status: "stock", soldAt: "", listedAt: "" });
    state.items.unshift(target);
  } else {
    target = state.items.find((i) => i.id === id);
    Object.assign(target, v, { updatedAt: new Date().toISOString() });
  }
  // 写真：複製では元の写真を引き継ぐ
  const srcPhoto = photoDraft !== undefined ? photoDraft : (action === "duplicate" && id ? await DB.getPhoto(id) : undefined);
  if (srcPhoto !== undefined) { await DB.setPhoto(target.id, srcPhoto); target.hasPhoto = !!srcPhoto; }
  save(); render();
  toast(action === "duplicate" ? "複製しました" : "保存しました");
});

// ---------- 経費 ----------
const expForm = $("#expForm");
function renderExpenses() {
  fillSelect($("#expCat"), C.EXPENSE_CATEGORIES.map((c) => ({ id: c, name: c })));
  if (!expForm.date.value) expForm.date.value = today();
  $("#expLock").hidden = isPro;
  $("#expLock").innerHTML = isPro ? "" : `<p><b>経費の記録はPRO機能です</b></p><p class="hint">まとめ買いした梱包資材、仕入れの交通費などを記録して、確定申告の集計に自動で反映します。</p>${IS_ANDROID ? `<p class="hint">（アプリ内購入は準備中です）</p>` : `<button data-go="settings">PROについて見る</button>`}`;
  $("#expBody").style.opacity = isPro ? "" : ".45";
  $("#expBody").style.pointerEvents = isPro ? "" : "none";
  const years = new Set([new Date().getFullYear(), ...state.expenses.map((e) => Number(e.date.slice(0, 4)))]);
  const ys = $("#expYear"), cur = Number(ys.value) || new Date().getFullYear();
  ys.innerHTML = [...years].sort((a, b) => b - a).map((y) => `<option ${y === cur ? "selected" : ""}>${y}</option>`).join("");
  const list = state.expenses.filter((e) => e.date.startsWith(String(cur))).sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((s, e) => s + e.amount, 0);
  $("#expSummary").textContent = `${cur}年：${list.length}件・合計 ${yen(total)}`;
  $("#expList").innerHTML = list.length ? list.map((e) => `<li data-exp="${e.id}"><div class="main"><strong><span class="exp-cat">${esc(e.category)}</span>${esc(e.memo || e.category)}</strong><div class="sub">${e.date.replaceAll("-", "/")}</div></div><div class="side">${yen(e.amount)}</div></li>`).join("")
    : `<li class="empty">この年の経費はまだありません</li>`;
}
$("#expYear").onchange = renderExpenses;
expForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!requirePro("経費の記録")) return;
  const f = Object.fromEntries(new FormData(expForm));
  state.expenses.push({ id: uid(), date: f.date, category: f.category, amount: num(f.amount), memo: f.memo.trim() });
  save();
  expForm.amount.value = ""; expForm.memo.value = "";
  $("#expYear").value = f.date.slice(0, 4);
  renderExpenses();
  toast("経費を記録しました");
});
$("#expList").addEventListener("click", (e) => {
  const li = e.target.closest("[data-exp]"); if (!li) return;
  const idx = state.expenses.findIndex((x) => x.id === li.dataset.exp), ex = state.expenses[idx];
  if (!confirm(`${ex.date} ${ex.category} ${yen(ex.amount)} を削除しますか？`)) return;
  state.expenses.splice(idx, 1); save(); renderExpenses();
  toast("削除しました", { label: "元に戻す", run: () => { state.expenses.splice(idx, 0, ex); save(); renderExpenses(); } });
});

// ---------- 集計 ----------
function renderStats() {
  const years = new Set([new Date().getFullYear()]);
  state.items.forEach((i) => i.soldAt && years.add(Number(i.soldAt.slice(0, 4))));
  state.expenses.forEach((e) => years.add(Number(e.date.slice(0, 4))));
  const ysel = $("#yearSel"), y = Number(ysel.value) || new Date().getFullYear();
  ysel.innerHTML = [...years].sort((a, b) => b - a).map((v) => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("");

  const months = C.monthly(state, y);
  const sales = months.reduce((s, m) => s + m.sales, 0), profit = months.reduce((s, m) => s + m.profit, 0), count = months.reduce((s, m) => s + m.count, 0);
  const stock = state.items.filter((i) => i.status !== "sold");
  $("#kpis").innerHTML = [
    ["売上", yen(sales)], ["利益", yen(profit)], ["販売数", count + "点"],
    ["平均利益率", sales ? ((profit / sales) * 100).toFixed(1) + "%" : "-"], ["在庫", stock.length + "点"], ["在庫金額", yen(stock.reduce((s, i) => s + i.cost, 0))],
  ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("");
  const max = Math.max(1, ...months.map((m) => Math.max(m.sales, Math.abs(m.profit))));
  $("#monthChart").innerHTML = months.map((m, k) => `<div class="m" title="${k + 1}月 売上${yen(m.sales)} 利益${yen(m.profit)}"><div class="bars">
      <i class="s" style="height:${(m.sales / max) * 100}%"></i><i class="p ${m.profit < 0 ? "neg-bg" : ""}" style="height:${(Math.abs(m.profit) / max) * 100}%"></i></div><span>${k + 1}</span></div>`).join("");

  // 販売先別
  if (isPro) {
    const by = {};
    for (const i of state.items) if (i.status === "sold" && i.soldAt.startsWith(String(y))) {
      const r = calc(i), p = (by[i.platform] ||= { n: 0, sales: 0, profit: 0 });
      p.n++; p.sales += r.price; p.profit += r.profit;
    }
    const rows = Object.entries(by).sort((a, b) => b[1].profit - a[1].profit);
    $("#platformStats").innerHTML = rows.length ? `<table class="t"><tr><th>販売先</th><th>点数</th><th>売上</th><th>利益</th><th>利益率</th></tr>${rows.map(([id, p]) =>
      `<tr><td>${esc(platformOf(id).name)}</td><td>${p.n}</td><td>${yen(p.sales)}</td><td>${yen(p.profit)}</td><td>${p.sales ? ((p.profit / p.sales) * 100).toFixed(0) : 0}%</td></tr>`).join("")}</table>` : `<p class="hint">この年の販売データはまだありません。</p>`;
  } else $("#platformStats").innerHTML = lockHtml("販売先別の分析");

  // 売れ残り
  if (isPro) {
    const stale = stock.filter((i) => heldDays(i) >= STALE_DAYS).sort((a, b) => heldDays(b) - heldDays(a));
    $("#staleList").innerHTML = stale.length ? stale.map((i) => {
      const be = C.breakEvenPrice(i, P(), S());
      return `<li data-id="${i.id}"><div class="main"><strong>${esc(i.name)}</strong><div class="sub">${heldDays(i)}日 ・ 今の価格 ${yen(i.price)}</div></div><div class="side">${be != null ? yen(be) : "-"}<small>損益分岐</small></div></li>`;
    }).join("") : `<li class="empty">60日以上売れていない在庫はありません</li>`;
  } else $("#staleList").innerHTML = `<li class="empty" style="cursor:default">${lockHtml("売れ残り在庫の確認")}</li>`;

  renderTax(y);
  renderAffiliates();
}
$("#yearSel").addEventListener("change", renderStats);
$("#staleList").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openEdit(li.dataset.id); });

function renderTax(y) {
  if (!isPro) {
    $("#taxBody").innerHTML = `<p class="hint">売上・売上原価（期首と期末の在庫）・販売手数料・送料・経費から、<b>確定申告に必要な数字</b>を自動で集計します。CSV出力と印刷にも対応。</p>${lockHtml("確定申告の集計")}`;
    return;
  }
  const t = C.taxSummary(state, y);
  const row = (k, v, cls = "") => `<tr class="${cls}"><td>${k}</td><td>${yen(v)}</td></tr>`;
  $("#taxBody").innerHTML = `<p class="hint">${y}年1月1日〜12月31日（売却 ${t.count}点）</p>
    <table class="t" id="taxTable">
      ${row("売上（収入金額）", t.sales, "hl")}
      ${row("期首の在庫（1/1時点）", t.opening, "sub")}${row("＋ 当年の仕入", t.purchases, "sub")}${row("− 期末の在庫（12/31時点）", t.closing, "sub")}
      ${row("売上原価", t.cogs)}
      ${row("差引金額（売上 − 売上原価）", t.grossProfit)}
      ${row("販売手数料", t.fees)}${row("送料（荷造運賃）", t.ship)}${row("梱包材など（商品ごと）", t.packing)}
      ${Object.entries(t.expenses).filter(([, v]) => v).map(([k, v]) => row(`経費：${esc(k)}`, v)).join("")}
      ${row("所得の目安（売上 − 原価 − 経費）", t.income, "total")}
    </table>
    <div class="tax-actions">
      <button class="secondary" id="csvSales">売上明細CSV</button>
      <button class="secondary" id="csvExp">経費明細CSV</button>
      <button class="secondary" id="csvTax">集計表CSV</button>
      <button class="secondary" id="printTax">印刷・PDF</button>
    </div>
    <p class="note">※ 在庫は仕入れ値で評価しています。売上原価は「期首在庫＋仕入−期末在庫」で計算しています。<br>※ 申告が必要かどうか（給与所得者の副業は所得20万円超など）や、事業所得・雑所得の区分、家事按分などは、税務署や税理士にご確認ください。</p>`;
  $("#csvSales").onclick = () => {
    const rows = state.items.filter((i) => i.status === "sold" && i.soldAt.startsWith(String(y))).sort((a, b) => a.soldAt.localeCompare(b.soldAt)).map((i) => {
      const r = calc(i);
      return [i.soldAt, i.boughtAt, i.name, platformOf(i.platform).name, r.price, r.cost, r.fee, r.ship, r.extra, r.profit, i.supplier, i.memo];
    });
    download(`furima-売上明細-${y}.csv`, C.toCsv([["売却日", "仕入日", "商品名", "販売先", "販売価格", "仕入れ値", "販売手数料", "送料", "梱包材など", "利益", "仕入れ先", "メモ"], ...rows]), "text/csv");
  };
  $("#csvExp").onclick = () => {
    const rows = state.expenses.filter((e) => e.date.startsWith(String(y))).sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.category, e.amount, e.memo]);
    download(`furima-経費明細-${y}.csv`, C.toCsv([["日付", "区分", "金額", "メモ"], ...rows]), "text/csv");
  };
  $("#csvTax").onclick = () => {
    const rows = [["売上（収入金額）", t.sales], ["期首の在庫", t.opening], ["当年の仕入", t.purchases], ["期末の在庫", t.closing], ["売上原価", t.cogs], ["差引金額", t.grossProfit],
      ["販売手数料", t.fees], ["送料（荷造運賃）", t.ship], ["梱包材など（商品ごと）", t.packing], ...Object.entries(t.expenses).map(([k, v]) => [`経費：${k}`, v]), ["所得の目安", t.income]];
    download(`furima-集計表-${y}.csv`, C.toCsv([["項目", `${y}年`], ...rows]), "text/csv");
  };
  $("#printTax").onclick = () => window.print();
}

function renderAffiliates() {
  const list = (CFG.affiliates || []).filter((a) => a.url);
  $("#affCard").hidden = !list.length;
  $("#affList").innerHTML = list.map((a) =>
    `<li><a href="${esc(a.url)}" target="_blank" rel="nofollow sponsored noopener"><b>${esc(a.name)}</b><span>${esc(a.note || "")}</span></a>` +
    (a.pixel ? `<img src="${esc(a.pixel)}" width="1" height="1" alt="" style="border:0">` : "") + `</li>`).join("");
}

// ---------- 設定 ----------
function editorRows(el, list, key, unit, step) {
  el.innerHTML = list.map((x, k) => `<div class="er" data-k="${k}">
    <input data-f="name" value="${esc(x.name)}" maxlength="30" aria-label="名前">
    <span class="unit" data-unit="${unit}"><input data-f="${key}" type="number" inputmode="decimal" min="0" step="${step}" value="${x[key]}" aria-label="${unit}"></span>
    <button class="rm" data-rm="${k}" aria-label="削除" ${list.length <= 1 ? "disabled" : ""}>×</button></div>`).join("");
  el.oninput = (e) => {
    const r = e.target.closest(".er"); if (!r) return;
    const f = e.target.dataset.f, x = list[r.dataset.k];
    x[f] = f === "name" ? e.target.value : num(e.target.value);
    save();
  };
  el.onclick = (e) => {
    const k = e.target.dataset.rm; if (k == null) return;
    const used = state.items.some((i) => i[key === "fee" ? "platform" : "shipping"] === list[k].id);
    if (used && !confirm(`「${list[k].name}」を使っている商品があります。削除すると、その商品の利益計算でこの項目が0円になります。削除しますか？`)) return;
    list.splice(k, 1); save(); render();
  };
}
function renderSettings() {
  editorRows($("#platformEditor"), P(), "fee", "%", "0.1");
  editorRows($("#shippingEditor"), S(), "cost", "円", "1");
  $("#limitNum").textContent = CFG.freeItemLimit;
  $("#buyMonthly").hidden = !CFG.buyMonthlyUrl;
  if (CFG.buyMonthlyUrl) $("#buyMonthly").href = CFG.buyMonthlyUrl;
  $("#proBuy").hidden = IS_ANDROID;
  $("#proSoon").hidden = !IS_ANDROID || isPro;
  const buy = $("#buyLifetime");
  if (CFG.buyLifetimeUrl) buy.href = CFG.buyLifetimeUrl;
  else { buy.removeAttribute("href"); buy.textContent = "PROは近日販売開始"; buy.classList.add("disabled"); }
  buy.hidden = isPro;
  $("#licenseInput").value = state.license;
  $("#licenseMsg").textContent = isPro ? "PRO有効です。ご購入ありがとうございます！" : "";
  const photos = state.items.filter((i) => i.hasPhoto).length;
  $("#dataInfo").textContent = `商品 ${state.items.length}件（写真 ${photos}枚）・経費 ${state.expenses.length}件。最後のバックアップ：${state.lastBackup ? state.lastBackup.replaceAll("-", "/") : "まだありません"}` + (DB.usingLocalStorage ? "（簡易保存モード）" : "");
  $("#version").textContent = `バージョン ${VERSION}`;
  renderBackupReminder();
}
function backupDue() {
  if (state.items.length < 5) return false;
  return !state.lastBackup || C.daysBetween(state.lastBackup, today()) >= 30;
}
function renderBackupReminder() {
  const due = backupDue();
  $("#settingsDot").hidden = !due;
  $("#backupReminder").hidden = !due;
  $("#backupReminder").innerHTML = due ? `<b>バックアップをおすすめします</b><br>${state.lastBackup ? "前回から30日以上たちました。" : "まだ一度もバックアップしていません。"}端末の故障や機種変更に備えて、下の「バックアップを保存」を押してください。` : "";
}
$("#addPlatform").onclick = () => { P().push({ id: "p" + uid(), name: "新しい販売先", fee: 10 }); save(); render(); };
$("#addShipping").onclick = () => { S().push({ id: "s" + uid(), name: "新しい配送方法", cost: 0 }); save(); render(); };
$("#resetPresets").onclick = () => {
  if (!confirm("販売先と配送方法を初期値に戻しますか？（追加した項目は消えます）")) return;
  state.platforms = structuredClone(C.DEFAULT_PLATFORMS);
  state.shipping = structuredClone(C.DEFAULT_SHIPPING);
  save(); render();
};
$("#activate").onclick = () => activate($("#licenseInput").value.trim());
async function activate(key) {
  if (await FurimaLicense.verify(key, CFG.licensePublicKey)) {
    state.license = key; save(); await refreshPlan(); toast("PROを有効化しました");
    return true;
  }
  $("#licenseMsg").textContent = "ライセンスキーが正しくありません。メールのキーをすべてコピーして貼り付けてください。";
  return false;
}

$("#backup").onclick = async () => {
  await DB.flush();
  // 今ある商品の写真だけを入れる（削除直後の写真などは含めない）
  const ids = new Set(state.items.filter((i) => i.hasPhoto).map((i) => i.id));
  const photos = Object.fromEntries(Object.entries(await DB.allPhotos()).filter(([id]) => ids.has(id)));
  const data = { app: "furima-note", version: 2, exportedAt: new Date().toISOString(), state, photos };
  const ok = await download(`furima-backup-${today()}.json`, JSON.stringify(data), "application/json");
  if (ok !== false) { state.lastBackup = today(); save(); renderSettings(); }
};
$("#restore").onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const s = data.state || data; // version 1 は状態そのもの
    if (!Array.isArray(s.items)) throw new Error();
    if (!confirm(`商品${s.items.length}件・経費${(s.expenses || []).length}件のデータで、今のデータを置き換えます。よろしいですか？`)) return;
    const keepLicense = state.license;
    state = normalize(s);
    if (!state.license) state.license = keepLicense;
    await DB.clearPhotos();
    for (const [id, url] of Object.entries(data.photos || {})) await DB.setPhoto(id, url);
    save(); await refreshPlan(); toast("復元しました");
  } catch (_) { alert("バックアップファイルを読み込めませんでした。フリマ帳で保存したファイルか確認してください。"); }
};

// ---------- ファイル保存 ----------
async function download(name, text, type) {
  if (IS_ANDROID) {
    const { Filesystem, Share } = window.Capacitor.Plugins;
    try {
      const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" });
      await Share.share({ title: name, files: [uri] });
      return true;
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message))) alert("ファイルを保存できませんでした。");
      return false;
    }
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

// ---------- PRO 紹介 ----------
function renderPromo() {
  const t = activeTab();
  $("#adSlot").hidden = isPro || IS_ANDROID || t === "settings" || t === "expenses";
  const left = CFG.freeItemLimit - state.items.length;
  $("#promoText").textContent = left <= 10 ? `無料版はあと${Math.max(0, left)}件まで。PROなら登録無制限` : "経費と確定申告の集計・登録無制限";
}
$("#promoBtn").onclick = () => goTab("settings");

// ---------- 描画 ----------
function render() {
  const t = activeTab();
  if (t === "calc") renderCalc();
  if (t === "items") renderItems();
  if (t === "expenses") renderExpenses();
  if (t === "stats") renderStats();
  if (t === "settings") renderSettings();
  renderPromo();
  renderBackupReminder();
}
async function refreshPlan() {
  isPro = await FurimaLicense.verify(state.license, CFG.licensePublicKey).then(Boolean);
  $("#planBadge").textContent = isPro ? "PRO" : "FREE";
  $("#planBadge").classList.toggle("pro", isPro);
  render();
}

// 購入メールの有効化リンク (…/#license=FRM2.xxx) から開いたら自動で有効化する
async function activateFromHash() {
  if (location.hash === "#pro") { history.replaceState(null, "", location.pathname); goTab("settings"); return false; }
  const m = /[#&]license=([^&]+)/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, "", location.pathname);
  goTab("settings");
  return activate(decodeURIComponent(m[1]));
}
window.addEventListener("hashchange", activateFromHash);

(async () => {
  state = normalize(await DB.loadState());
  save();
  if (!(await activateFromHash())) await refreshPlan();
})();
if (!IS_ANDROID && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
