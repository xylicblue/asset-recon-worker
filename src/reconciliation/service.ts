import type { Log } from "viem";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getBlockHash, getFinalizedReference, mapWithConcurrency, primaryClient, readExternalBalance, readLedgerBalance, readVaultAssets, secondaryClient } from "../chain/client.js";
import { applyEventBatch, getCheckpoint, listIndexedAccounts, recordRun } from "../db/repository.js";
import { publishReconciliationAlert } from "../alerts.js";
import { reconcileToken, sumRaw } from "./calculator.js";
import { decodeLedgerLog, sortLedgerEvents } from "./events.js";
import type { Address, TokenReconciliationResult } from "../types.js";

async function synchronizeLedger(targetBlock: bigint): Promise<number> {
  let checkpoint = await getCheckpoint();
  let previousBlock = checkpoint?.lastBlock ?? BigInt(env.DEPLOYMENT_BLOCK) - 1n;
  if (checkpoint?.lastBlockHash) {
    const canonicalHash = await getBlockHash(primaryClient, checkpoint.lastBlock);
    if (canonicalHash.toLowerCase() !== checkpoint.lastBlockHash.toLowerCase()) {
      throw new Error(`Confirmed-chain reorganisation detected at checkpoint ${checkpoint.lastBlock}; manual rollback is required`);
    }
  }
  if (previousBlock >= targetBlock) return 0;

  let totalEvents = 0;
  const chunk = BigInt(env.EVENT_CHUNK_SIZE);
  for (let from = previousBlock + 1n; from <= targetBlock; from += chunk) {
    const to = from + chunk - 1n > targetBlock ? targetBlock : from + chunk - 1n;
    const [logs, toHash] = await Promise.all([
      primaryClient.getLogs({ address: env.COLLATERAL_VAULT_ADDRESS, fromBlock: from, toBlock: to }),
      getBlockHash(primaryClient, to),
    ]);
    const events = sortLedgerEvents((logs as Log[]).map(decodeLedgerLog).filter((event) => event !== null));
    await applyEventBatch(previousBlock, from, to, toHash, events);
    previousBlock = to;
    totalEvents += events.length;
  }
  return totalEvents;
}

async function directLedgerTotal(client: typeof primaryClient, accounts: Address[], token: Address, blockNumber: bigint): Promise<bigint> {
  const balances = await mapWithConcurrency(accounts, env.RPC_READ_CONCURRENCY, (account) => readLedgerBalance(client, account, token, blockNumber));
  return sumRaw(balances);
}

export async function executeReconciliation(runType: "hourly" | "ad_hoc" | "startup"): Promise<{ runId: string; status: string; blockNumber: bigint }> {
  const startedAt = new Date();
  const reference = await getFinalizedReference();
  const secondaryHash = await getBlockHash(secondaryClient, reference.number);
  if (secondaryHash.toLowerCase() !== reference.hash.toLowerCase()) {
    throw new Error(`RPC providers disagree on finalized block hash ${reference.number}`);
  }

  const eventCount = await synchronizeLedger(reference.number);
  const indexedAccounts = await listIndexedAccounts();
  const results: TokenReconciliationResult[] = [];

  for (const token of env.tokens) {
    const tokenAccounts = indexedAccounts.filter((entry) => entry.token.toLowerCase() === token.address).map((entry) => entry.account);
    const indexedLiabilitiesRaw = sumRaw(indexedAccounts.filter((entry) => entry.token.toLowerCase() === token.address).map((entry) => entry.balanceRaw));
    const [primaryVaultAssetsRaw, secondaryVaultAssetsRaw, primaryLedgerLiabilitiesRaw, secondaryLedgerLiabilitiesRaw, relatedBalances] = await Promise.all([
      readVaultAssets(primaryClient, token.address, reference.number),
      readVaultAssets(secondaryClient, token.address, reference.number),
      directLedgerTotal(primaryClient, tokenAccounts, token.address, reference.number),
      directLedgerTotal(secondaryClient, tokenAccounts, token.address, reference.number),
      mapWithConcurrency(env.relatedAccounts, env.RPC_READ_CONCURRENCY, async (account) => ({
        label: account.label,
        account: account.address,
        balanceRaw: await readExternalBalance(primaryClient, token.address, account.address, reference.number),
      })),
    ]);
    results.push(reconcileToken({ token, primaryVaultAssetsRaw, secondaryVaultAssetsRaw, indexedLiabilitiesRaw, primaryLedgerLiabilitiesRaw, secondaryLedgerLiabilitiesRaw, relatedBalances }));
  }

  const recorded = await recordRun({ runType, blockNumber: reference.number, blockHash: reference.hash, blockTimestamp: reference.timestamp, startedAt, results });
  await publishReconciliationAlert(recorded.runId, reference.number, results);
  logger.info({ runId: recorded.runId, status: recorded.status, blockNumber: reference.number.toString(), eventCount, tokens: results.length }, "Client-asset reconciliation completed");
  return { runId: recorded.runId, status: recorded.status, blockNumber: reference.number };
}
