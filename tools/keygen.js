// ライセンスキー発行: node tools/keygen.js [個数]
// config.js の licenseSalt と同じ値を LICENSE_SALT に設定して実行する。
const crypto = require("crypto");
const salt = process.env.LICENSE_SALT || "change-me-before-launch";
const n = Number(process.argv[2]) || 1;
const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const part = () => Array.from(crypto.randomBytes(4), (b) => chars[b % chars.length]).join("");
for (let i = 0; i < n; i++) {
  const body = part() + part();
  const sum = crypto.createHash("sha256").update(body + salt).digest("hex").slice(0, 4).toUpperCase();
  console.log(`FRM-${body.slice(0, 4)}-${body.slice(4)}-${sum}`);
}
