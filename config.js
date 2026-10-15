// 販売設定。公開前にここを書き換える。
window.FURIMA_CONFIG = {
  // Stripe Payment Link の URL。空にするとボタンを隠す。
  buyLifetimeUrl: "https://buy.stripe.com/9B6fZi1JWcH4e8cdh4bII00",
  buyMonthlyUrl: "",
  // issuer.html で作った公開鍵（公開しても安全）。秘密鍵は絶対にここへ書かない。
  licensePublicKey: "BJQYx7gcgKRNLL1qxXdZP733Q6BAyovy3u9gwpLP-x_VOKCEWJ_VkqZaCBEHpJ-IED4L1H2iIUcrxY9KJRnK-sI",
  freeItemLimit: 30,
  // 確定申告に使える会計ソフトの紹介（アフィリエイト）。url が空のものは表示しない。
  // A8.net などで発行されたリンクの URL を url に、計測用の画像があれば pixel に貼る。
  affiliates: [
    { name: "freee会計", note: "スマホで確定申告まで完結", url: "", pixel: "" },
    { name: "マネーフォワード クラウド確定申告", note: "銀行・カードの明細を自動で取り込み", url: "", pixel: "" },
    { name: "やよいの白色申告 オンライン", note: "白色申告ならずっと無料プランあり", url: "", pixel: "" },
  ],
};
