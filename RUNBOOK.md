# Exception runbook

## Any unexplained difference

1. Treat the automated run as failed; do not overwrite or delete it.
2. Confirm the finalized block hash and balances through the secondary RPC.
3. Trace the event ledger back to the first divergent transaction and log index.
4. Verify the vault address, accepted-token list, token decimals and deployment block.
5. Protocol Operations records the investigation, root cause and corrective action.
6. Run an ad-hoc reconciliation after correction.
7. Finance/Operations independently verifies the later passing run and approves closure.

## Confirmed client-asset deficit

A deficit is critical. In addition to the steps above:

1. Escalate immediately through the urgent-issues channel to the accountable CEO/COO and Compliance/Risk.
2. Assess whether affected deposits or new risk must be restricted using the existing controlled operational process. This read-only worker cannot pause trading or contracts.
3. Top up the deficit from approved proprietary funds within two hours.
4. Preserve transaction evidence for the top-up and link it in the resolution note.
5. Notify the Board Risk Committee for material exceptions.

## Worker or RPC failure

A worker failure is not a passing reconciliation. Restore the worker or replace the failed RPC, run an ad-hoc reconciliation, and document any missed daily deadline. Never substitute a cached balance or treat a missing source as zero.
