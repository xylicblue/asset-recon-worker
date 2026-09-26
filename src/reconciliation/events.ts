import { decodeEventLog, type Log } from "viem";
import { vaultEventAbi } from "../chain/abi.js";
import type { Address, Hex, LedgerEvent } from "../types.js";

const asAddress = (value: unknown): Address => String(value).toLowerCase() as Address;
const asBigInt = (value: unknown): bigint => typeof value === "bigint" ? value : BigInt(String(value));

export function decodeLedgerLog(log: Log): LedgerEvent | null {
  if (!log.transactionHash || log.logIndex == null || !log.blockHash || log.blockNumber == null) return null;
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({ abi: vaultEventAbi, data: log.data, topics: log.topics, strict: false });
  } catch {
    return null;
  }
  const args = decoded.args as unknown as Record<string, unknown>;
  const common = {
    eventKey: `${log.transactionHash.toLowerCase()}:${log.logIndex}`,
    txHash: log.transactionHash.toLowerCase() as Hex,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash.toLowerCase() as Hex,
  };

  if (decoded.eventName === "Deposit") {
    const received = asBigInt(args.received);
    return { ...common, eventType: "deposit", token: asAddress(args.token), user: asAddress(args.onBehalfOf), counterparty: null, amountRaw: received, userDeltaRaw: received, counterpartyDeltaRaw: 0n, payload: { requestedAmountRaw: String(args.amount), operator: String(args.user).toLowerCase() } };
  }
  if (decoded.eventName === "Withdraw") {
    const amount = asBigInt(args.amount);
    return { ...common, eventType: "withdraw", token: asAddress(args.token), user: asAddress(args.user), counterparty: null, amountRaw: amount, userDeltaRaw: -amount, counterpartyDeltaRaw: 0n, payload: { operator: String(args.operator).toLowerCase(), destination: String(args.to).toLowerCase(), ...(args.received == null ? {} : { receivedRaw: String(args.received) }) } };
  }
  if (decoded.eventName === "Seize") {
    const amount = asBigInt(args.amount);
    return { ...common, eventType: "seize", token: asAddress(args.token), user: asAddress(args.from), counterparty: asAddress(args.to), amountRaw: amount, userDeltaRaw: -amount, counterpartyDeltaRaw: amount, payload: {} };
  }
  if (decoded.eventName === "ExternalCredit") {
    const amount = asBigInt(args.amount);
    return { ...common, eventType: "external_credit", token: asAddress(args.token), user: asAddress(args.user), counterparty: null, amountRaw: amount, userDeltaRaw: amount, counterpartyDeltaRaw: 0n, payload: { pool: String(args.pool).toLowerCase() } };
  }
  if (decoded.eventName === "PnLSettled") {
    const signed = asBigInt(args.amount);
    return { ...common, eventType: "pnl_settled", token: asAddress(args.token), user: asAddress(args.user), counterparty: null, amountRaw: signed < 0n ? -signed : signed, userDeltaRaw: signed, counterpartyDeltaRaw: 0n, payload: { signedAmountRaw: signed.toString() } };
  }
  return null;
}

export function sortLedgerEvents(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((left, right) => left.blockNumber === right.blockNumber
    ? left.logIndex - right.logIndex
    : left.blockNumber < right.blockNumber ? -1 : 1);
}
