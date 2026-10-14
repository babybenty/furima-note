// 販売設定。公開前にここを書き換える。
window.FURIMA_CONFIG = {
  // Stripe Payment Links / Lemon Squeezy などの購入URL
  buyMonthlyUrl: "https://buy.stripe.com/REPLACE_MONTHLY",
  buyLifetimeUrl: "https://buy.stripe.com/REPLACE_LIFETIME",
  // ライセンスキー検証用のソルト。tools/keygen.js と同じ値にする。
  licenseSalt: "change-me-before-launch",
  freeItemLimit: 30,
};
