# ByteStrike client-asset reconciliation

This is an independent, read-only control service for the CollateralVault. It does not hold a private key, submit transactions, move collateral, pause contracts, modify trading state or participate in liquidation.

For every configured collateral token, each run compares values at one finalized block:

1. **Actual vault assets:** the ERC-20 `balanceOf(CollateralVault)`.
2. **Direct client liabilities:** the sum of every discovered account's on-chain `CollateralVault.balanceOf(account, token)`.
3. **Indexed client liabilities:** the event-reconstructed account ledger held in the control database.
4. **Independent verification:** the asset and direct-liability reads are repeated through a second RPC provider at the same block hash.

A run passes only when all four records agree exactly. The unexplained tolerance is zero. Position margin is not added separately because it remains reserved inside the client's existing vault ledger balance. Insurance Fund, Fee Router and treasury balances are captured separately and never netted against client liabilities.

## Event reconstruction

The indexer starts at `DEPLOYMENT_BLOCK` and applies confirmed CollateralVault events in block/log order:

- `Deposit`: credit `onBehalfOf` by the amount actually received.
- `Withdraw`: debit the client by the ledger amount withdrawn.
- `Seize`: debit one account and credit the other; aggregate liabilities do not change.
- `ExternalCredit`: credit the receiving client after the external funds enter the vault.
- `PnLSettled`: supported for vault versions that emit a signed ledger adjustment.

Every event is idempotent by transaction hash and log index. Each block batch and checkpoint is committed in one database transaction. A finalized checkpoint hash mismatch stops processing and requires a controlled rebuild; the service never guesses through a reorganisation.

## Control workflow

- Automated reconciliation: hourly and at startup.
- Daily formal control: Protocol Operations prepares the evidence by 10:00 UTC; Finance/Operations independently approves it. The preparer cannot approve their own review.
- Exceptions: any deficit, surplus, indexer difference or RPC difference opens an exception. A deficit is critical and receives a two-hour remediation deadline.
- Closure: Protocol Operations must document root cause and corrective action, and a later passing reconciliation must exist. Finance/Operations independently approves closure.
- Monthly attestation: Compliance/Risk can sign only when every calendar day's review is approved and no exception for the month remains open.

All runs, token results, source events and human actions are immutable. The Compliance portal provides the review interface under **Client assets**.

See [DEPLOYMENT.md](./DEPLOYMENT.md) and [RUNBOOK.md](./RUNBOOK.md).
