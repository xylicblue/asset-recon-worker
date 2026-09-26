import { assertChainConfiguration } from "./chain/client.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { publishOperationalFailure } from "./alerts.js";
import { claimLease } from "./db/client.js";
import { recordWorkerFailure, writeHeartbeat } from "./db/repository.js";
import { executeReconciliation } from "./reconciliation/service.js";
import type { WorkerHealth } from "./types.js";

export class AssetReconciliationWorker {
  readonly health: WorkerHealth = {
    startedAt: new Date().toISOString(), ready: false, leader: false, running: false,
    lastRunAt: null, lastSuccessfulRunAt: null, lastFinalizedBlock: null, lastError: null,
  };
  private timers: NodeJS.Timeout[] = [];
  private stopping = false;

  async start(): Promise<void> {
    await assertChainConfiguration();
    await this.renewLease();
    this.health.ready = true;
    if (this.health.leader) await this.run("startup");
    this.timers.push(setInterval(() => void this.renewLease(), Math.max(10_000, Math.floor(env.WORKER_LEASE_SECONDS * 1_000 / 3))));
    this.timers.push(setInterval(() => void this.run("hourly"), env.RECONCILIATION_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.heartbeat(), 60_000));
    await this.heartbeat();
    logger.info({ instanceId: env.instanceId, chainId: env.CHAIN_ID, vault: env.COLLATERAL_VAULT_ADDRESS }, "Client-asset reconciliation worker started");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.health.ready = false;
    await this.heartbeat().catch(() => undefined);
  }

  async run(runType: "hourly" | "ad_hoc" | "startup"): Promise<{ runId: string; status: string; blockNumber: bigint } | null> {
    if (this.stopping || this.health.running || !this.health.leader) return null;
    this.health.running = true;
    this.health.lastRunAt = new Date().toISOString();
    try {
      const result = await executeReconciliation(runType);
      this.health.lastSuccessfulRunAt = new Date().toISOString();
      this.health.lastFinalizedBlock = result.blockNumber.toString();
      this.health.lastError = null;
      return result;
    } catch (error) {
      this.health.lastError = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, "Client-asset reconciliation failed");
      await Promise.allSettled([
        recordWorkerFailure("reconciliation", error),
        publishOperationalFailure(error),
      ]);
      throw error;
    } finally {
      this.health.running = false;
      await this.heartbeat().catch(() => undefined);
    }
  }

  private async renewLease(): Promise<void> {
    if (this.stopping) return;
    try {
      this.health.leader = await claimLease();
      this.health.lastError = null;
    } catch (error) {
      this.health.leader = false;
      this.health.lastError = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, "Unable to renew reconciliation worker lease");
    }
  }

  private async heartbeat(): Promise<void> {
    await writeHeartbeat(this.health);
  }
}
