import { describe, expect, it } from "vitest";
import { reconcileToken } from "../src/reconciliation/calculator.js";

const token = { address: "0x1111111111111111111111111111111111111111" as const, symbol: "USDC", decimals: 6 };

describe("client asset reconciliation", () => {
  it("passes only when assets, the indexed ledger, direct ledger reads and both RPCs agree", () => {
    const result = reconcileToken({
      token,
      primaryVaultAssetsRaw: 1_000_000n,
      secondaryVaultAssetsRaw: 1_000_000n,
      indexedLiabilitiesRaw: 1_000_000n,
      primaryLedgerLiabilitiesRaw: 1_000_000n,
      secondaryLedgerLiabilitiesRaw: 1_000_000n,
      relatedBalances: [],
    });
    expect(result.status).toBe("passed");
    expect(result.coverageBps).toBe(10_000n);
  });

  it("treats any client-asset deficit as an exception", () => {
    const result = reconcileToken({
      token,
      primaryVaultAssetsRaw: 999_999n,
      secondaryVaultAssetsRaw: 999_999n,
      indexedLiabilitiesRaw: 1_000_000n,
      primaryLedgerLiabilitiesRaw: 1_000_000n,
      secondaryLedgerLiabilitiesRaw: 1_000_000n,
      relatedBalances: [],
    });
    expect(result.exceptionCodes).toContain("CLIENT_ASSET_DEFICIT");
    expect(result.status).toBe("exception");
  });

  it("does not net separately reported insurance or treasury balances into coverage", () => {
    const result = reconcileToken({
      token,
      primaryVaultAssetsRaw: 1_000_000n,
      secondaryVaultAssetsRaw: 1_000_000n,
      indexedLiabilitiesRaw: 1_000_000n,
      primaryLedgerLiabilitiesRaw: 1_000_000n,
      secondaryLedgerLiabilitiesRaw: 1_000_000n,
      relatedBalances: [{ label: "Insurance Fund", account: token.address, balanceRaw: 99_000_000n }],
    });
    expect(result.coverageBps).toBe(10_000n);
    expect(result.status).toBe("passed");
  });
});
