export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface RelatedAccountConfig {
  label: string;
  address: Address;
}

export type LedgerEventType = "deposit" | "withdraw" | "seize" | "external_credit" | "pnl_settled";

export interface LedgerEvent {
  eventKey: string;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  eventType: LedgerEventType;
  token: Address;
  user: Address;
  counterparty: Address | null;
  amountRaw: bigint;
  userDeltaRaw: bigint;
  counterpartyDeltaRaw: bigint;
  payload: Record<string, string>;
}

export interface IndexedAccount {
  account: Address;
  token: Address;
  balanceRaw: bigint;
}

export interface RelatedBalance {
  label: string;
  account: Address;
  balanceRaw: bigint;
}

export interface TokenReconciliationInput {
  token: TokenConfig;
  primaryVaultAssetsRaw: bigint;
  secondaryVaultAssetsRaw: bigint;
  indexedLiabilitiesRaw: bigint;
  primaryLedgerLiabilitiesRaw: bigint;
  secondaryLedgerLiabilitiesRaw: bigint;
  relatedBalances: RelatedBalance[];
}

export interface TokenReconciliationResult extends TokenReconciliationInput {
  assetDifferenceRaw: bigint;
  indexerDifferenceRaw: bigint;
  rpcAssetDifferenceRaw: bigint;
  rpcLiabilityDifferenceRaw: bigint;
  coverageBps: bigint | null;
  status: "passed" | "exception";
  exceptionCodes: string[];
}

export interface WorkerHealth {
  startedAt: string;
  ready: boolean;
  leader: boolean;
  running: boolean;
  lastRunAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastFinalizedBlock: string | null;
  lastError: string | null;
}
