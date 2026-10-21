import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { proxiedFetch, getProxyFor, parseProxyUrl } from "../src/net/proxy.js";

const target = http.createServer((req, res) => {
  if (req.url === "/r") { res.writeHead(302, { Location: "/hello" }); res.end(); return; }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("hi:" + req.url);
});
const proxyState = { hits: 0, connects: 0 };
const proxy = http.createServer((req, res) => {
  proxyState.hits += 1;
  const u = new URL(req.url);
  const host = u.hostname === "target.invalid" ? "127.0.0.1" : u.hostname;
  const up = http.request({ host: host, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end("bad"); });
  req.pipe(up);
});
proxy.on("connect", (req, socket, head) => {
  proxyState.connects += 1;
  const [host, port] = String(req.url || "").split(":");
  const up = net.connect(Number(port), host, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on("error", () => socket.destroy());
});
let TARGET = "";
let LOCAL_TARGET = "";
let PROXY = "";
after(() => { target.close(); proxy.close(); });
const envWith = (extra) => Object.assign({}, extra || {});

test("setup", async () => {
  await new Promise(r => target.listen(0, "127.0.0.1", r));
  await new Promise(r => proxy.listen(0, "127.0.0.1", r));
  TARGET = "http://target.invalid:" + target.address().port;
  LOCAL_TARGET = "http://127.0.0.1:" + target.address().port;
  PROXY = "http://127.0.0.1:" + proxy.address().port;
});

test("getProxyFor/parseProxyUrl 单元", () => {
  const p = parseProxyUrl("http://user:pass@127.0.0.1:7897");
  assert.equal(p.host, "127.0.0.1");
  assert.equal(p.port, 7897);
  assert.equal(p.auth, "user:pass");
  assert.equal(getProxyFor(TARGET, { HTTP_PROXY: PROXY }).host, "127.0.0.1");
  assert.equal(getProxyFor(TARGET, { HTTPS_PROXY: PROXY }), null, "http 目标不读 HTTPS_PROXY");
  assert.equal(getProxyFor("https://api.siliconflow.cn/x", { HTTPS_PROXY: PROXY }).port, proxy.address().port);
  assert.equal(getProxyFor(TARGET, { HTTP_PROXY: PROXY, NO_PROXY: "target.invalid" }), null);
  assert.equal(getProxyFor("https://a.example.com/x", { HTTPS_PROXY: PROXY, NO_PROXY: ".example.com" }), null);
  assert.equal(getProxyFor("http://localhost:1/x", { HTTP_PROXY: PROXY }), null, "localhost 永远直连");
});

test("无代理 env：直连（代理 0 命中）", async () => {
  proxyState.hits = 0;
  const resp = await proxiedFetch(LOCAL_TARGET + "/hello", undefined, { env: {} });
  assert.equal(resp.status, 200);
  assert.match(await resp.text(), /hi:\/hello/);
  assert.equal(proxyState.hits, 0);
});

test("HTTP_PROXY：经代理（绝对式）且跟随重定向", async () => {
  proxyState.hits = 0;
  const env = { HTTP_PROXY: PROXY };
  const resp = await proxiedFetch(TARGET + "/hello", undefined, { env });
  assert.equal(resp.status, 200);
  assert.match(await resp.text(), /hi:\/hello/);
  assert.ok(proxyState.hits >= 1);
  proxyState.hits = 0;
  const redir = await proxiedFetch(TARGET + "/r", undefined, { env });
  assert.equal(redir.status, 200);
  assert.match(await redir.text(), /hi:\/hello/);
  assert.ok(proxyState.hits >= 2, "重定向应再次经代理");
});

test("NO_PROXY / localhost：绕过代理", async () => {
  proxyState.hits = 0;
  // NO_PROXY 命中：直连（target.invalid 不可解析 ⇒ DNS 失败，但代理 0 命中可证明绕过了代理）
  await assert.rejects(proxiedFetch(TARGET + "/hello", undefined, { env: { HTTP_PROXY: PROXY, NO_PROXY: "target.invalid" } }), /fetch failed|ENOTFOUND/);
  assert.equal(proxyState.hits, 0);
  // localhost 永远直连
  const resp = await proxiedFetch(LOCAL_TARGET + "/hello", undefined, { env: { HTTP_PROXY: PROXY } });
  assert.equal(resp.status, 200);
  assert.equal(proxyState.hits, 0);
});

test("代理不可达：可操作错误", async () => {
  await assert.rejects(proxiedFetch(TARGET + "/hello", undefined, { env: { HTTP_PROXY: "http://127.0.0.1:1" }, timeoutMs: 800 }), /代理连接失败|代理连接超时/);
});