import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { env } from "../config/env.js";
import { erc20Abi, vaultReadAbi } from "./abi.js";
import type { Address, Hex } from "../types.js";

const chain = defineChain({
  id: env.CHAIN_ID,
  name: `ByteStrike reconciliation chain ${env.CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.PRIMARY_RPC_URL] } },
});

export const primaryClient = createPublicClient({ chain, transport: http(env.PRIMARY_RPC_URL) });
export const secondaryClient = createPublicClient({ chain, transport: http(env.SECONDARY_RPC_URL) });

export async function assertChainConfiguration(): Promise<void> {
  const [primaryChainId, secondaryChainId, vaultCode] = await Promise.all([
    primaryClient.getChainId(),
    secondaryClient.getChainId(),
    primaryClient.getCode({ address: env.COLLATERAL_VAULT_ADDRESS }),
  ]);
  if (primaryChainId !== env.CHAIN_ID || secondaryChainId !== env.CHAIN_ID) {
    throw new Error(`RPC chain mismatch: expected ${env.CHAIN_ID}, got ${primaryChainId}/${secondaryChainId}`);
  }
  if (!vaultCode || vaultCode === "0x") throw new Error("No contract code at COLLATERAL_VAULT_ADDRESS");
}

export async function getFinalizedReference(): Promise<{ number: bigint; hash: Hex; timestamp: Date }> {
  const latest = await primaryClient.getBlockNumber();
  const confirmations = BigInt(env.BLOCK_CONFIRMATIONS);
  if (latest <= confirmations) throw new Error("Chain head is below the configured confirmation depth");
  const number = latest - confirmations;
  const block = await primaryClient.getBlock({ blockNumber: number });
  if (!block.hash) throw new Error(`Finalized reference block ${number} has no hash`);
  return { number, hash: block.hash, timestamp: new Date(Number(block.timestamp) * 1_000) };
}

export async function getBlockHash(client: PublicClient, blockNumber: bigint): Promise<Hex> {
  const block = await client.getBlock({ blockNumber });
  if (!block.hash) throw new Error(`Block ${blockNumber} has no hash`);
  return block.hash;
}

export async function readVaultAssets(client: PublicClient, token: Address, blockNumber: bigint): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [env.COLLATERAL_VAULT_ADDRESS], blockNumber });
}

export async function readExternalBalance(client: PublicClient, token: Address, account: Address, blockNumber: bigint): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account], blockNumber });
}

export async function readLedgerBalance(client: PublicClient, account: Address, token: Address, blockNumber: bigint): Promise<bigint> {
  try {
    return await client.readContract({
      address: env.COLLATERAL_VAULT_ADDRESS,
      abi: vaultReadAbi,
      functionName: "balanceOf",
      args: [account, token],
      blockNumber,
    });
  } catch {
    return client.readContract({
      address: env.COLLATERAL_VAULT_ADDRESS,
      abi: vaultReadAbi,
      functionName: "userBalances",
      args: [account, token],
      blockNumber,
    });
  }
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) results[index] = await task(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => consume()));
  return results;
}
