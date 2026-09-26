import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { assertDatabaseReady } from "./db/client.js";
import { AssetReconciliationWorker } from "./worker.js";

const worker = new AssetReconciliationWorker();

function authorized(value: string | undefined): boolean {
  const supplied = Buffer.from(value ?? "");
  const expected = Buffer.from(`Bearer ${env.MANUAL_RUN_TOKEN}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const server = createServer((request, response) => {
  if (request.method === "GET" && (request.url === "/healthz" || request.url === "/readyz")) {
    const status = request.url === "/readyz" && !worker.health.ready ? 503 : 200;
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ ok: status === 200, service: "client-asset-reconciliation-worker", ...worker.health }));
    return;
  }
  if (request.method === "POST" && request.url === "/runs") {
    if (!authorized(request.headers.authorization)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (!worker.health.leader || worker.health.running) {
      response.writeHead(409, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: worker.health.running ? "run_in_progress" : "not_leader" }));
      return;
    }
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ accepted: true }));
    void worker.run("ad_hoc").catch(() => undefined);
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown requested");
  server.close();
  await worker.stop();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (error) => logger.fatal({ err: error }, "Unhandled promise rejection"));

async function main(): Promise<void> {
  await assertDatabaseReady();
  server.listen(env.PORT, "0.0.0.0", () => logger.info({ port: env.PORT }, "Health server listening"));
  await worker.start();
}

main().catch((error) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
