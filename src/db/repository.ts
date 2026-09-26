import { db } from "./client.js";
import { env } from "../config/env.js";
import type { Address, IndexedAccount, LedgerEvent, TokenReconciliationResult, WorkerHealth } from "../types.js";

export interface Checkpoint { lastBlock: bigint; lastBlockHash: `0x${string}` | null }

export async function getCheckpoint(): Promise<Checkpoint | null> {
  const { data, error } = await db.from("asset_reconciliation_checkpoints")
    .select("last_scanned_block,last_scanned_block_hash")
    .eq("chain_id", env.CHAIN_ID)
    .eq("vault_address", env.COLLATERAL_VAULT_ADDRESS)
    .maybeSingle();
  if (error) throw new Error(`Unable to load checkpoint: ${error.message}`);
  return data ? { lastBlock: BigInt(data.last_scanned_block), lastBlockHash: data.last_scanned_block_hash } : null;
}

export async function applyEventBatch(previousBlock: bigint, fromBlock: bigint, toBlock: bigint, toBlockHash: string, events: LedgerEvent[]): Promise<void> {
  const serialized = events.map((event) => ({
    event_key: event.eventKey,
    tx_hash: event.txHash,
    log_index: event.logIndex,
    block_number: event.blockNumber.toString(),
    block_hash: event.blockHash,
    event_type: event.eventType,
    token_address: event.token,
    account_address: event.user,
    counterparty_address: event.counterparty,
    amount_raw: event.amountRaw.toString(),
    account_delta_raw: event.userDeltaRaw.toString(),
    counterparty_delta_raw: event.counterpartyDeltaRaw.toString(),
    payload: event.payload,
  }));
  const { error } = await db.rpc("service_apply_asset_reconciliation_events", {
    p_chain_id: env.CHAIN_ID,
    p_vault_address: env.COLLATERAL_VAULT_ADDRESS,
    p_expected_previous_block: previousBlock.toString(),
    p_from_block: fromBlock.toString(),
    p_to_block: toBlock.toString(),
    p_to_block_hash: toBlockHash,
    p_events: serialized,
  });
  if (error) throw new Error(`Unable to persist event batch: ${error.message}`);
}

export async function listIndexedAccounts(): Promise<IndexedAccount[]> {
  const output: IndexedAccount[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from("asset_reconciliation_accounts")
      .select("account_address,token_address,balance_raw")
      .eq("chain_id", env.CHAIN_ID)
      .eq("vault_address", env.COLLATERAL_VAULT_ADDRESS)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to load indexed accounts: ${error.message}`);
    for (const row of data ?? []) output.push({ account: row.account_address as Address, token: row.token_address as Address, balanceRaw: BigInt(row.balance_raw) });
    if (!data || data.length < pageSize) break;
  }
  return output;
}

export async function recordRun(args: {
  runType: "hourly" | "ad_hoc" | "startup";
  blockNumber: bigint;
  blockHash: string;
  blockTimestamp: Date;
  startedAt: Date;
  results: TokenReconciliationResult[];
}): Promise<{ runId: string; status: string; exceptions: Array<{ code: string; token: string; severity: string }> }> {
  const results = args.results.map((result) => ({
    token_address: result.token.address,
    token_symbol: result.token.symbol,
    token_decimals: result.token.decimals,
    vault_assets_raw: result.primaryVaultAssetsRaw.toString(),
    client_liabilities_raw: result.primaryLedgerLiabilitiesRaw.toString(),
    indexed_liabilities_raw: result.indexedLiabilitiesRaw.toString(),
    secondary_assets_raw: result.secondaryVaultAssetsRaw.toString(),
    secondary_liabilities_raw: result.secondaryLedgerLiabilitiesRaw.toString(),
    asset_difference_raw: result.assetDifferenceRaw.toString(),
    indexer_difference_raw: result.indexerDifferenceRaw.toString(),
    rpc_asset_difference_raw: result.rpcAssetDifferenceRaw.toString(),
    rpc_liability_difference_raw: result.rpcLiabilityDifferenceRaw.toString(),
    coverage_bps: result.coverageBps?.toString() ?? null,
    status: result.status,
    exception_codes: result.exceptionCodes,
    related_balances: result.relatedBalances.map((balance) => ({ ...balance, balanceRaw: balance.balanceRaw.toString() })),
  }));
  const { data, error } = await db.rpc("service_record_asset_reconciliation_run", {
    p_run: {
      run_type: args.runType,
      chain_id: env.CHAIN_ID,
      vault_address: env.COLLATERAL_VAULT_ADDRESS,
      block_number: args.blockNumber.toString(),
      block_hash: args.blockHash,
      block_timestamp: args.blockTimestamp.toISOString(),
      started_at: args.startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      worker_instance_id: env.instanceId,
    },
    p_results: results,
    p_daily_due_hour_utc: env.DAILY_REVIEW_DUE_HOUR_UTC,
  });
  if (error) throw new Error(`Unable to record reconciliation run: ${error.message}`);
  return data as { runId: string; status: string; exceptions: Array<{ code: string; token: string; severity: string }> };
}

export async function writeHeartbeat(health: WorkerHealth): Promise<void> {
  const { error } = await db.from("asset_reconciliation_worker_heartbeats").upsert({
    instance_id: env.instanceId,
    is_leader: health.leader,
    ready: health.ready,
    running: health.running,
    last_run_at: health.lastRunAt,
    last_successful_run_at: health.lastSuccessfulRunAt,
    last_finalized_block: health.lastFinalizedBlock,
    last_error: health.lastError,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Unable to write worker heartbeat: ${error.message}`);
}

export async function recordWorkerFailure(task: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const { error: insertError } = await db.from("asset_reconciliation_worker_failures").insert({
    instance_id: env.instanceId,
    task,
    error_message: message.slice(0, 5_000),
  });
  if (insertError) throw new Error(`Unable to record worker failure: ${insertError.message}`);
}
