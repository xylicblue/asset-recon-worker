import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import type { TokenReconciliationResult } from "./types.js";

async function postWebhook(url: string | undefined, text: string): Promise<void> {
  if (!url) return;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
}

export async function publishReconciliationAlert(runId: string, blockNumber: bigint, results: TokenReconciliationResult[]): Promise<void> {
  const exceptions = results.filter((result) => result.status === "exception");
  if (exceptions.length === 0) return;
  const deficit = exceptions.some((result) => result.assetDifferenceRaw < 0n);
  const lines = exceptions.map((result) => `${result.token.symbol}: ${result.exceptionCodes.join(", ")} (difference ${result.assetDifferenceRaw.toString()} raw units)`);
  const text = [`ByteStrike client-asset reconciliation exception`, `Run: ${runId}`, `Finalized block: ${blockNumber.toString()}`, ...lines].join("\n");
  const deliveries = [postWebhook(env.ALERT_WEBHOOK_URL || undefined, text)];
  if (deficit) deliveries.push(postWebhook(env.URGENT_WEBHOOK_URL || undefined, `URGENT\n${text}\nTwo-hour remediation clock started.`));
  const outcomes = await Promise.allSettled(deliveries);
  for (const outcome of outcomes) if (outcome.status === "rejected") logger.error({ err: outcome.reason, runId }, "Reconciliation alert delivery failed");
}

export async function publishOperationalFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await postWebhook(env.ALERT_WEBHOOK_URL || undefined, `ByteStrike client-asset reconciliation worker failure\n${message.slice(0, 2_000)}`);
}
