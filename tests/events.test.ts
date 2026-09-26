import { describe, expect, it } from "vitest";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import { decodeLedgerLog } from "../src/reconciliation/events.js";
import { vaultEventAbi } from "../src/chain/abi.js";

describe("vault event decoder", () => {
  it("credits the beneficiary by the received deposit amount", () => {
    const operator = "0x1111111111111111111111111111111111111111" as const;
    const token = "0x2222222222222222222222222222222222222222" as const;
    const beneficiary = "0x3333333333333333333333333333333333333333" as const;
    const event = vaultEventAbi.find((item) => item.type === "event" && item.name === "Deposit");
    if (!event) throw new Error("Deposit ABI missing");
    const topics = encodeEventTopics({ abi: [event], eventName: "Deposit", args: { user: operator, token, onBehalfOf: beneficiary } });
    const decoded = decodeLedgerLog({
      address: operator,
      topics: topics as [`0x${string}`, ...`0x${string}`[]],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1_100n, 1_000n]),
      blockNumber: 10n,
      blockHash: `0x${"ab".repeat(32)}`,
      transactionHash: `0x${"cd".repeat(32)}`,
      transactionIndex: 0,
      logIndex: 2,
      removed: false,
    });
    expect(decoded?.user).toBe(beneficiary);
    expect(decoded?.userDeltaRaw).toBe(1_000n);
  });
});
