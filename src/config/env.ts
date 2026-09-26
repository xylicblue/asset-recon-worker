import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Address, RelatedAccountConfig, TokenConfig } from "../types.js";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const booleanFromEnv = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const schema = z.object({
  PRIMARY_RPC_URL: z.string().url(),
  SECONDARY_RPC_URL: z.string().url(),
  ALLOW_SAME_RPC_URL: booleanFromEnv,
  CHAIN_ID: z.coerce.number().int().positive(),
  COLLATERAL_VAULT_ADDRESS: address,
  DEPLOYMENT_BLOCK: z.coerce.number().int().nonnegative(),
  TOKENS_JSON: z.string().min(2),
  RELATED_ACCOUNTS_JSON: z.string().default("[]"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  RECONCILIATION_INTERVAL_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  BLOCK_CONFIRMATIONS: z.coerce.number().int().min(1).default(12),
  EVENT_CHUNK_SIZE: z.coerce.number().int().min(100).max(20_000).default(2_000),
  RPC_READ_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(900).default(120),
  DAILY_REVIEW_DUE_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(10),
  MANUAL_RUN_TOKEN: z.string().min(24),
  ALERT_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  URGENT_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  WORKER_INSTANCE_ID: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Invalid environment configuration: ${parsed.error.message}`);

function parseTokens(value: string): TokenConfig[] {
  const tokens = z.array(z.object({
    address,
    symbol: z.string().trim().min(1).max(20),
    decimals: z.number().int().min(0).max(36),
  })).min(1).parse(JSON.parse(value));
  const seen = new Set<string>();
  return tokens.map((token) => {
    const normalized = token.address.toLowerCase();
    if (seen.has(normalized)) throw new Error(`Duplicate token address: ${token.address}`);
    seen.add(normalized);
    return { ...token, address: normalized as Address };
  });
}

function parseRelatedAccounts(value: string): RelatedAccountConfig[] {
  return z.array(z.object({ label: z.string().trim().min(1).max(100), address })).parse(JSON.parse(value))
    .map((entry) => ({ ...entry, address: entry.address.toLowerCase() as Address }));
}

if (parsed.data.PRIMARY_RPC_URL === parsed.data.SECONDARY_RPC_URL && !parsed.data.ALLOW_SAME_RPC_URL) {
  throw new Error("PRIMARY_RPC_URL and SECONDARY_RPC_URL must use independent endpoints");
}

export const env = {
  ...parsed.data,
  COLLATERAL_VAULT_ADDRESS: parsed.data.COLLATERAL_VAULT_ADDRESS.toLowerCase() as Address,
  tokens: parseTokens(parsed.data.TOKENS_JSON),
  relatedAccounts: parseRelatedAccounts(parsed.data.RELATED_ACCOUNTS_JSON),
  instanceId: parsed.data.WORKER_INSTANCE_ID ?? randomUUID(),
};
