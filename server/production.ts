import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as proxyRequest } from "node:http";
import { createConnection } from "node:net";
import {
  assertTrustedProxyConfiguration,
  buildProxyHeaders,
  resolveExternalProtocol,
  resolveTrustedProxyAddresses,
  resolveTrustedProxyHops,
} from "./proxy-headers";

const publicPort = Number(process.env.PORT || 3000);
const webPort = publicPort === 3010 ? 3011 : 3010;
const apiPort = publicPort === 4010 ? 4011 : 4010;
const externalProtocol = resolveExternalProtocol(process.env.EXTERNAL_PROTOCOL, "production");
const trustedProxyHops = resolveTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
const trustedProxyAddresses = resolveTrustedProxyAddresses(process.env.TRUSTED_PROXY_ADDRESSES);
assertTrustedProxyConfiguration(trustedProxyHops, trustedProxyAddresses);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children: ChildProcess[] = [];
let shuttingDown = false;

function startChild(
  script: string,
  port: number,
  extraArguments: string[] = [],
  extraEnvironment: Record<string, string> = {},
) {
  const child = spawn(npmCommand, ["run", script, "--", ...extraArguments], {
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), ...extraEnvironment },
    stdio: "inherit",
  });
  children.push(child);
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`${script} stopped unexpectedly (${signal || code || 0})`);
      shutdown(1);
    }
  });
  return child;
}

function waitForPort(port: number, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise<void>((resolve, reject) => {
    const connect = () => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) reject(new Error(`Port ${port} did not become ready`));
        else setTimeout(connect, 250);
      });
    };
    connect();
  });
}

const web = startChild("start:web", webPort, ["--port", String(webPort), "--hostname", "127.0.0.1"]);
const api = startChild("start:api", apiPort, [], {
  API_HOST: "127.0.0.1",
  TRUST_PROXY: "loopback",
});

const gateway = createServer((incoming, outgoing) => {
  const path = incoming.url || "/";
  const targetPort = path === "/api" || path.startsWith("/api/") || path === "/uploads" || path.startsWith("/uploads/") ? apiPort : webPort;
  const upstream = proxyRequest({
    hostname: "127.0.0.1",
    port: targetPort,
    method: incoming.method,
    path,
    headers: buildProxyHeaders(
      incoming.headers,
      incoming.socket.remoteAddress,
      targetPort,
      externalProtocol,
      trustedProxyHops,
      trustedProxyAddresses,
    ),
  }, (response) => {
    outgoing.writeHead(response.statusCode || 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.once("error", (error) => {
    console.error("Gateway error:", error.message);
    if (!outgoing.headersSent) outgoing.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ error: "Сервис временно недоступен" }));
  });
  incoming.pipe(upstream);
});

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  if (gateway.listening) gateway.close(() => process.exit(exitCode));
  else process.exit(exitCode);
  setTimeout(() => process.exit(exitCode), 5_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => shutdown());

try {
  await Promise.all([waitForPort(webPort), waitForPort(apiPort)]);
  gateway.listen(publicPort, "0.0.0.0", () => {
    console.log(`DAANA SUSHI web + API: http://0.0.0.0:${publicPort}`);
  });
} catch (error) {
  console.error(error);
  shutdown(1);
}

void web;
void api;
