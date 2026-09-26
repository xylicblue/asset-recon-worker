import type { TokenReconciliationInput, TokenReconciliationResult } from "../types.js";

export function reconcileToken(input: TokenReconciliationInput): TokenReconciliationResult {
  const assetDifferenceRaw = input.primaryVaultAssetsRaw - input.primaryLedgerLiabilitiesRaw;
  const indexerDifferenceRaw = input.indexedLiabilitiesRaw - input.primaryLedgerLiabilitiesRaw;
  const rpcAssetDifferenceRaw = input.primaryVaultAssetsRaw - input.secondaryVaultAssetsRaw;
  const rpcLiabilityDifferenceRaw = input.primaryLedgerLiabilitiesRaw - input.secondaryLedgerLiabilitiesRaw;
  const coverageBps = input.primaryLedgerLiabilitiesRaw === 0n
    ? null
    : (input.primaryVaultAssetsRaw * 10_000n) / input.primaryLedgerLiabilitiesRaw;
  const exceptionCodes: string[] = [];

  if (assetDifferenceRaw < 0n) exceptionCodes.push("CLIENT_ASSET_DEFICIT");
  if (assetDifferenceRaw > 0n) exceptionCodes.push("UNEXPLAINED_VAULT_SURPLUS");
  if (indexerDifferenceRaw !== 0n) exceptionCodes.push("INDEXER_LEDGER_MISMATCH");
  if (rpcAssetDifferenceRaw !== 0n) exceptionCodes.push("RPC_ASSET_MISMATCH");
  if (rpcLiabilityDifferenceRaw !== 0n) exceptionCodes.push("RPC_LEDGER_MISMATCH");

  return {
    ...input,
    assetDifferenceRaw,
    indexerDifferenceRaw,
    rpcAssetDifferenceRaw,
    rpcLiabilityDifferenceRaw,
    coverageBps,
    status: exceptionCodes.length === 0 ? "passed" : "exception",
    exceptionCodes,
  };
}

export function sumRaw(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}
