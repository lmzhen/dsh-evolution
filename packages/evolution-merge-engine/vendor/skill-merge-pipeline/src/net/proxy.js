// G7.2：零依赖代理适配（HTTP(S)_PROXY / NO_PROXY）。无代理时行为等同 fetch。
import net from "node:net";
import tls from "node:tls";
import { once } from "node:events";
import { Readable } from "node:stream";
import { UnavailableError } from "../errors.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PROXY_ENV = {
  http: ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"],
  https: ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
};
const NO_PROXY_ENV = ["NO_PROXY", "no_proxy"];

function envVal(env, names) {
  for (const n of names) { const v = env && env[n]; if (v) return String(v); }
  return "";
}

export function parseProxyUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw).includes("://") ? String(raw) : "http://" + String(raw));
    const protocol = u.protocol === "https:" ? "https:" : "http:";
    return {
      protocol: protocol,
      host: u.hostname,
      port: Number(u.port || (protocol === "https:" ? 443 : 80)),
      auth: u.username ? (decodeURIComponent(u.username) + ":" + decodeURIComponent(u.password || "")) : ""
    };
  } catch (e) { return null; }
}

export function getProxyFor(targetUrl, env) {
  const e = env || process.env;
  let u;
  try { u = new URL(targetUrl); } catch (err) { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (LOCAL_HOSTS.has(u.hostname)) return null;
  const noProxy = envVal(e, NO_PROXY_ENV);
  if (noProxy) {
    const hostPort = u.hostname + ":" + (u.port || (u.protocol === "https:" ? 443 : 80));
    for (const part of noProxy.split(",").map(s => s.trim()).filter(Boolean)) {
      if (part === "*") return null;
      const p = part.replace(/^\./, "");
      if (u.hostname === p || u.hostname.endsWith("." + p) || hostPort === part) return null;
    }
  }
  return parseProxyUrl(envVal(e, PROXY_ENV[u.protocol === "https:" ? "https" : "http"]));
}

function proxyAuthHeader(proxy) {
  return proxy.auth ? "Basic " + Buffer.from(proxy.auth).toString("base64") : "";
}

function connectRaw(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: host, port: port });
    const timer = timeoutMs ? setTimeout(() => { s.destroy(); reject(new UnavailableError("代理连接超时: " + host + ":" + port, { where: "proxy", retryable: true })); }, timeoutMs) : null;
    s.once("error", (err) => { if (timer) clearTimeout(timer); reject(new UnavailableError("代理连接失败: " + host + ":" + port + " (" + String(err && err.message ? err.message : err) + ")", { where: "proxy", retryable: true, cause: err })); });
    s.once("connect", () => { if (timer) clearTimeout(timer); resolve(s); });
  });
}

// 读 HTTP 响应/隧道头：返回 {status, headers, rest}（rest 是已读到的 body/握手剩余字节）。
function readHead(socket, limit) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const max = limit || 64 * 1024;
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf("\r\n\r\n");
      if (idx < 0) { if (buf.length > max) { cleanup(); reject(new UnavailableError("代理响应头过大", { where: "proxy" })); } return; }
      cleanup();
      const head = buf.slice(0, idx).toString("latin1");
      const rest = buf.slice(idx + 4);
      const lines = head.split("\r\n");
      const m = /^HTTP\/(\d\.\d)\s+(\d{3})/.exec(lines[0] || "");
      const headers = {};
      for (const line of lines.slice(1)) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status: m ? Number(m[2]) : 0, headers: headers, rest: rest });
    }
    function onErr(err) { cleanup(); reject(new UnavailableError("代理读取出错: " + String(err && err.message ? err.message : err), { where: "proxy", retryable: true, cause: err })); }
    function cleanup() { socket.removeListener("data", onData); socket.removeListener("error", onErr); socket.pause(); }
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

function toObjectHeaders(h) { const o = {}; for (const [k, v] of Object.entries(h || {})) o[k] = v; return o; }

function makeResponse(status, headers, rest, socket, finalUrl) {
  const stream = new Readable({
    read() { /* 数据由 socket 推入 */ },
    destroy(err, cb) { try { socket.destroy(); } catch (e) { /* 忽略 */ } cb(err); }
  });
  if (rest && rest.length) stream.push(rest);
  socket.on("data", (c) => stream.push(c));
  socket.on("end", () => stream.push(null));
  socket.on("close", () => { try { stream.push(null); } catch (e) { /* 忽略 */ } });
  const resp = new Response(Readable.toWeb(stream), { status: status, headers: toObjectHeaders(headers) });
  try { Object.defineProperty(resp, "url", { value: finalUrl, configurable: true }); } catch (e) { /* 忽略 */ }
  return resp;
}

async function viaTunnel(targetUrl, init, proxy, timeoutMs) {
  const u = new URL(targetUrl);
  const raw = await connectRaw(proxy.host, proxy.port, timeoutMs);
  const auth = proxyAuthHeader(proxy);
  raw.write("CONNECT " + u.hostname + ":" + (u.port || 443) + " HTTP/1.1\r\nHost: " + u.hostname + ":" + (u.port || 443) + "\r\n" + (auth ? "Proxy-Authorization: " + auth + "\r\n" : "") + "\r\n");
  const head = await readHead(raw, 64 * 1024);
  if (head.status !== 200) { raw.destroy(); throw new UnavailableError("代理 CONNECT 失败: HTTP " + head.status, { where: "proxy", retryable: false }); }
  const secure = tls.connect({ socket: raw, servername: u.hostname, rejectUnauthorized: true });
  await once(secure, "secureConnect");
  return { socket: secure, targetUrl: targetUrl, absolute: false };
}

async function viaPlainProxy(targetUrl, init, proxy, timeoutMs) {
  const socket = proxy.protocol === "https:"
    ? await (async () => {
      const raw = await connectRaw(proxy.host, proxy.port, timeoutMs);
      const secure = tls.connect({ socket: raw, servername: proxy.host, rejectUnauthorized: true });
      await once(secure, "secureConnect");
      return secure;
    })()
    : await connectRaw(proxy.host, proxy.port, timeoutMs);
  return { socket: socket, targetUrl: targetUrl, absolute: true };
}

async function sendRequest(conn, init, proxy) {
  const u = new URL(conn.targetUrl);
  const method = String((init && init.method) || "GET").toUpperCase();
  const headers = Object.assign({}, (init && init.headers) || {});
  headers.Host = u.host;
  headers.Connection = "close";
  const body = init && init.body !== undefined && init.body !== null ? (Buffer.isBuffer(init.body) ? init.body : Buffer.from(String(init.body))) : null;
  if (body) headers["Content-Length"] = String(body.length);
  const pathPart = conn.absolute ? conn.targetUrl : u.pathname + u.search;
  const lines = [method + " " + pathPart + " HTTP/1.1"];
  for (const [k, v] of Object.entries(headers)) lines.push(k + ": " + v);
  const auth = conn.absolute ? proxyAuthHeader(proxy) : "";
  if (auth && !headers["Proxy-Authorization"]) lines.push("Proxy-Authorization: " + auth);
  conn.socket.write(lines.join("\r\n") + "\r\n\r\n");
  if (body) conn.socket.write(body);
}

export async function proxiedFetch(targetUrl, init, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const proxy = getProxyFor(targetUrl, env);
  if (!proxy) return fetch(targetUrl, init);
  const timeoutMs = Number(o.timeoutMs || 0);
  const signal = init && init.signal;
  let current = targetUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    if (signal && signal.aborted) throw new UnavailableError("请求已取消", { where: "proxy" });
    const conn = new URL(current).protocol === "https:"
      ? await viaTunnel(current, init, proxy, timeoutMs)
      : await viaPlainProxy(current, init, proxy, timeoutMs);
    await sendRequest(conn, init, proxy);
    const head = await readHead(conn.socket);
    const method = String((init && init.method) || "GET").toUpperCase();
    if ([301, 302, 303, 307, 308].includes(head.status) && head.headers.location && method === "GET") {
      const next = new URL(head.headers.location, current).href;
      try { conn.socket.destroy(); } catch (e) { /* 忽略 */ }
      current = next;
      continue;
    }
    return makeResponse(head.status, head.headers, head.rest, conn.socket, current);
  }
  throw new UnavailableError("代理重定向过多: " + targetUrl, { where: "proxy" });
}