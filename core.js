"use strict";
// フリマ帳の計算ロジック（画面に依存しない純粋な関数）。ブラウザでは window.FurimaCore、Node では require で使う。
(function (root) {
  const num = (v) => Math.max(0, Number(v) || 0);
  const round = (n) => Math.round(n);

  // 2026年10月時点の公開料金をもとにした初期値。改定時は設定画面から編集できる。
  const DEFAULT_PLATFORMS = [
    { id: "mercari", name: "メルカリ", fee: 10 },
    { id: "rakuma", name: "楽天ラクマ(最大10%)", fee: 10 },
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
  const EXPENSE_CATEGORIES = ["梱包資材", "発送費", "交通費", "通信費", "消耗品", "支払手数料", "その他"];

  const find = (list, id, fallback) => (list || []).find((x) => x.id === id) || fallback;

  /** 1商品の損益。手数料は1円未満切り捨て（各フリマの計算方法に合わせる） */
  function calc(item, platforms, shipping) {
    const price = num(item.price);
    const feeRate = find(platforms, item.platform, { fee: 0 }).fee;
    const fee = Math.floor((price * feeRate) / 100);
    const ship = find(shipping, item.shipping, { cost: 0 }).cost;
    const cost = num(item.cost), extra = num(item.extra);
    const profit = price - cost - extra - fee - ship;
    return { price, fee, ship, cost, extra, profit, margin: price ? (profit / price) * 100 : 0 };
  }

  /** 目標利益率を満たす最低販売価格（step 円単位で切り上げ）。不可能なら null */
  function suggestPrice({ cost, extra, platform, shipping: shipId, target }, platforms, shipping, step = 100) {
    const rate = 1 - find(platforms, platform, { fee: 0 }).fee / 100 - num(target) / 100;
    if (rate <= 0) return null;
    const fixed = num(cost) + num(extra) + find(shipping, shipId, { cost: 0 }).cost;
    let p = Math.ceil(fixed / rate / step) * step;
    // 手数料の切り捨てで目標をわずかに下回らないよう確認
    while (calc({ price: p, cost, extra, platform, shipping: shipId }, platforms, shipping).profit < (p * num(target)) / 100) p += step;
    return p;
  }

  /** 赤字にならない最低価格（損益分岐点、10円単位で切り上げ） */
  function breakEvenPrice(item, platforms, shipping) {
    return suggestPrice({ ...item, target: 0 }, platforms, shipping, 10);
  }

  /** 同じ商品を各販売先で売ったときの比較（利益の大きい順） */
  function compare(item, platforms, shipping) {
    return platforms
      .map((p) => ({ platform: p, ...calc({ ...item, platform: p.id }, platforms, shipping) }))
      .sort((a, b) => b.profit - a.profit);
  }

  const inYear = (d, y) => !!d && d.slice(0, 4) === String(y);
  const daysBetween = (from, to) => Math.floor((Date.parse(to) - Date.parse(from)) / 864e5);

  /**
   * 確定申告の集計（年単位）。
   * 売上原価 ＝ 期首棚卸高 ＋ 当年仕入高 − 期末棚卸高（仕入れ値で評価）
   * 仕入日が空の商品は、売却済みなら売却日に、未売却なら登録日（なければ今日）に仕入れたものとみなす。
   */
  function taxSummary(state, year) {
    const y = Number(year), start = `${y}-01-01`, end = `${y}-12-31`;
    const { items = [], expenses = [], platforms, shipping } = state;
    const today = new Date().toISOString().slice(0, 10);
    const bought = (i) => i.boughtAt || (i.status === "sold" && i.soldAt) || (i.createdAt || "").slice(0, 10) || today;
    const heldAt = (i, date, inclusive) => {
      const b = bought(i);
      if (inclusive ? b > date : b >= date) return false;
      return !(i.status === "sold" && i.soldAt && (inclusive ? i.soldAt <= date : i.soldAt < date));
    };
    const sold = items.filter((i) => i.status === "sold" && inYear(i.soldAt, y));
    let sales = 0, fees = 0, ship = 0, packing = 0;
    for (const i of sold) {
      const r = calc(i, platforms, shipping);
      sales += r.price; fees += r.fee; ship += r.ship; packing += r.extra;
    }
    const opening = items.filter((i) => heldAt(i, start, false)).reduce((s, i) => s + num(i.cost), 0);
    const purchases = items.filter((i) => inYear(bought(i), y)).reduce((s, i) => s + num(i.cost), 0);
    const closing = items.filter((i) => heldAt(i, end, true)).reduce((s, i) => s + num(i.cost), 0);
    const cogs = opening + purchases - closing;
    const exp = {};
    for (const c of EXPENSE_CATEGORIES) exp[c] = 0;
    for (const e of expenses) if (inYear(e.date, y)) exp[e.category in exp ? e.category : "その他"] += num(e.amount);
    const otherExpenses = Object.values(exp).reduce((a, b) => a + b, 0);
    const grossProfit = sales - cogs;
    const income = grossProfit - fees - ship - packing - otherExpenses;
    return { year: y, count: sold.length, sales, opening, purchases, closing, cogs, grossProfit, fees, ship, packing, expenses: exp, otherExpenses, income };
  }

  /** 月別の売上・利益（1〜12月） */
  function monthly(state, year) {
    const out = Array.from({ length: 12 }, () => ({ sales: 0, profit: 0, count: 0 }));
    for (const i of state.items || []) {
      if (i.status !== "sold" || !inYear(i.soldAt, year)) continue;
      const m = Number(i.soldAt.slice(5, 7)) - 1, r = calc(i, state.platforms, state.shipping);
      out[m].sales += r.price; out[m].profit += r.profit; out[m].count++;
    }
    return out;
  }

  /** CSV（Excel で文字化けしないよう BOM 付き、全項目をダブルクォート） */
  function toCsv(rows) {
    return "﻿" + rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  }

  const api = { DEFAULT_PLATFORMS, DEFAULT_SHIPPING, EXPENSE_CATEGORIES, num, round, calc, suggestPrice, breakEvenPrice, compare, taxSummary, monthly, toCsv, daysBetween };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FurimaCore = api;
})(typeof window !== "undefined" ? window : globalThis);
