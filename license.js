"use strict";
// ライセンスキー = "FRM2." + base64url(内容JSON) + "." + base64url(ECDSA P-256 署名)
// アプリは公開鍵で検証するだけ。署名に使う秘密鍵は発行者のブラウザ(issuer.html)にしか存在しない。
window.FurimaLicense = (() => {
  const ALG = { name: "ECDSA", namedCurve: "P-256" };
  const SIG = { name: "ECDSA", hash: "SHA-256" };
  const PREFIX = "FRM2.";

  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64u = (s) => {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };
  const enc = (s) => new TextEncoder().encode(s);

  async function verify(key, publicKeyB64) {
    try {
      if (!publicKeyB64 || !key || !key.startsWith(PREFIX)) return null;
      const [body, sig] = key.slice(PREFIX.length).trim().split(".");
      const pub = await crypto.subtle.importKey("raw", unb64u(publicKeyB64), ALG, false, ["verify"]);
      if (!(await crypto.subtle.verify(SIG, pub, unb64u(sig), enc(body)))) return null;
      const data = JSON.parse(new TextDecoder().decode(unb64u(body)));
      if (data.exp && Date.parse(data.exp) < Date.now()) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function generateKeyPair() {
    const kp = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
    return {
      privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
      publicB64: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)),
    };
  }

  async function sign(data, privateJwk) {
    const priv = await crypto.subtle.importKey("jwk", privateJwk, ALG, false, ["sign"]);
    const body = b64u(enc(JSON.stringify(data)));
    return PREFIX + body + "." + b64u(await crypto.subtle.sign(SIG, priv, enc(body)));
  }

  async function publicFromPrivate(privateJwk) {
    const { d, key_ops, ...pubJwk } = privateJwk;
    const pub = await crypto.subtle.importKey("jwk", { ...pubJwk, key_ops: ["verify"] }, ALG, true, ["verify"]);
    return b64u(await crypto.subtle.exportKey("raw", pub));
  }

  return { verify, generateKeyPair, sign, publicFromPrivate };
})();
