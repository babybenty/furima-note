// node --test test/  で実行
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
const P = C.DEFAULT_PLATFORMS, S = C.DEFAULT_SHIPPING;
const item = (o) => ({ platform: "mercari", shipping: "takkyu80", cost: 0, price: 0, extra: 0, status: "stock", ...o });

test("calc: 手数料・送料・梱包材を引いた利益", () => {
  const r = C.calc(item({ price: 9800, cost: 4200, extra: 30 }), P, S);
  assert.deepEqual([r.fee, r.ship, r.profit], [980, 850, 3740]);
  assert.equal(r.margin.toFixed(1), "38.2");
});

test("calc: 手数料は1円未満切り捨て", () => {
  assert.equal(C.calc(item({ price: 999, platform: "yahoo" }), P, S).fee, 49);
});

test("calc: 価格0でも利益率はNaNにならない", () => {
  assert.equal(C.calc(item({ price: 0 }), P, S).margin, 0);
});

test("suggestPrice: 目標利益率を必ず満たす100円単位の最小価格", () => {
  const q = { cost: 4200, extra: 30, platform: "mercari", shipping: "takkyu80", target: 30 };
  const p = C.suggestPrice(q, P, S);
  assert.equal(p, 8500);
  const r = C.calc(item({ ...q, price: p }), P, S);
  assert.ok(r.profit >= p * 0.3);
  assert.ok(C.calc(item({ ...q, price: p - 100 }), P, S).profit < (p - 100) * 0.3);
});

test("suggestPrice: 手数料+目標が100%以上なら null", () => {
  assert.equal(C.suggestPrice({ cost: 1, platform: "mercari", shipping: "buyer", target: 90 }, P, S), null);
});

test("breakEvenPrice: その価格で赤字にならず、10円下げると赤字", () => {
  const it = item({ cost: 1234, extra: 50, shipping: "nekopos" });
  const p = C.breakEvenPrice(it, P, S);
  assert.ok(C.calc({ ...it, price: p }, P, S).profit >= 0);
  assert.ok(C.calc({ ...it, price: p - 10 }, P, S).profit < 0);
});

test("compare: 手数料の安い販売先が上に来る", () => {
  const list = C.compare(item({ price: 5000, cost: 1000 }), P, S);
  assert.equal(list[0].platform.id, "jimoty");
  assert.equal(list.find((x) => x.platform.id === "yahoo").fee, 250);
  for (let k = 1; k < list.length; k++) assert.ok(list[k - 1].profit >= list[k].profit);
});

test("taxSummary: 売上原価＝期首＋仕入−期末、所得まで", () => {
  const state = {
    platforms: P, shipping: S,
    items: [
      item({ cost: 1000, price: 3000, boughtAt: "2025-11-01", status: "sold", soldAt: "2026-02-01" }), // 前年仕入→今年売却
      item({ cost: 2000, price: 5000, boughtAt: "2026-03-01", status: "sold", soldAt: "2026-04-01", extra: 100 }), // 今年仕入→今年売却
      item({ cost: 500, boughtAt: "2026-05-01", status: "listed" }),                                       // 今年仕入→売れ残り
      item({ cost: 700, boughtAt: "2025-06-01", status: "stock" }),                                        // 前年仕入→売れ残り
      item({ cost: 900, price: 2000, boughtAt: "2025-01-01", status: "sold", soldAt: "2025-12-31" }),    // 前年に売却済み（対象外）
      item({ cost: 300, price: 1000, boughtAt: "2026-12-01", status: "sold", soldAt: "2027-01-05" }),    // 今年仕入→来年売却
    ],
    expenses: [{ date: "2026-06-01", category: "梱包資材", amount: 1200 }, { date: "2025-06-01", category: "交通費", amount: 999 }, { date: "2026-07-01", category: "謎", amount: 50 }],
  };
  const t = C.taxSummary(state, 2026);
  assert.equal(t.sales, 8000);
  assert.equal(t.opening, 1000 + 700);          // 2026/1/1 時点で持っていた在庫
  assert.equal(t.purchases, 2000 + 500 + 300);  // 2026年の仕入
  assert.equal(t.closing, 500 + 700 + 300);     // 2026/12/31 時点の在庫
  assert.equal(t.cogs, 3000);                   // 売れた2品の仕入れ値
  assert.equal(t.fees, 800);
  assert.equal(t.ship, 1700);
  assert.equal(t.packing, 100);
  assert.equal(t.expenses["梱包資材"], 1200);
  assert.equal(t.expenses["その他"], 50);       // 未知の区分は「その他」
  assert.equal(t.otherExpenses, 1250);
  assert.equal(t.income, 8000 - 3000 - 800 - 1700 - 100 - 1250);
});

test("taxSummary: 仕入日が空の売れ残りを毎年の仕入に数えない", () => {
  const state = { platforms: P, shipping: S, expenses: [], items: [item({ cost: 400, createdAt: "2026-03-03T00:00:00Z" })] };
  assert.equal(C.taxSummary(state, 2026).purchases, 400);
  assert.equal(C.taxSummary(state, 2025).purchases, 0);
  assert.equal(C.taxSummary(state, 2027).opening, 400);
});

test("monthly: 月ごとの売上と利益", () => {
  const state = { platforms: P, shipping: S, items: [item({ price: 9800, cost: 4200, extra: 30, status: "sold", soldAt: "2026-10-05" })] };
  const m = C.monthly(state, 2026);
  assert.equal(m[9].sales, 9800); assert.equal(m[9].profit, 3740); assert.equal(m[0].count, 0);
});

test("toCsv: BOM付き、引用符をエスケープ", () => {
  assert.equal(C.toCsv([["a\"b", 1, null]]), '﻿"a""b","1",""');
});
