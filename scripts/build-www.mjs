// Android アプリに同梱する Web ファイルを www/ にまとめる。
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

const FILES = ["index.html", "app.js", "styles.css", "config.js", "license.js", "core.js", "db.js", "manifest.json", "icon.svg"];
rmSync("www", { recursive: true, force: true });
mkdirSync("www");
for (const f of FILES) cpSync(f, `www/${f}`);

// アプリ版では Google Play のポリシーに合わせて外部決済(Stripe)への導線を出さない
const cfg = readFileSync("www/config.js", "utf8").replace(
  /window\.FURIMA_CONFIG = \{/,
  "window.FURIMA_CONFIG = {\n  platform: \"android\","
).replace(/freeItemLimit: \d+/, "freeItemLimit: 100")
  .replace(/buy(Lifetime|Monthly)Url: "[^"]*"/g, 'buy$1Url: ""'); // アプリ内購入に対応するまでは上限を緩める
writeFileSync("www/config.js", cfg);

// Android には日本語フォント(Noto Sans CJK)が標準で入っているので、Google Fonts を読み込まない（通信なし）
const html = readFileSync("www/index.html", "utf8").replace(/<link rel="(preconnect|stylesheet)" href="https:\/\/fonts\.[^>]*>\n/g, "");
writeFileSync("www/index.html", html);
console.log("www/ ready:", FILES.join(", "));
