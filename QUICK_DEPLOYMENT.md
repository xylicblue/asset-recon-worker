# Quick deployment guide

This service performs read-only blockchain reconciliation. It does not require a wallet private key and cannot move client assets.

## 1. Prepare Supabase

Run `migrations/001_client_asset_reconciliation.sql` in the production Supabase SQL Editor. Then assign separate staff accounts to the operational roles using their `auth.users.id` values:

```sql
insert into public.asset_reconciliation_staff_roles (user_id, role)
values
  ('PROTOCOL_OPERATIONS_USER_UUID', 'protocol_operations'),
  ('FINANCE_OPERATIONS_USER_UUID', 'finance_operations'),
  ('COMPLIANCE_RISK_USER_UUID', 'compliance_risk');
```

The preparer and independent reviewer must be different users.

## 2. Configure environment variables

Copy `.env.example` into the deployment platform's environment settings. Do not commit a populated `.env` file.

The values that must be confirmed before launch are:

- `PRIMARY_RPC_URL`: archive-capable primary RPC.
- `SECONDARY_RPC_URL`: archive-capable RPC from an independent provider.
- `CHAIN_ID`: network chain ID.
- `COLLATERAL_VAULT_ADDRESS`: deployed client collateral vault.
- `DEPLOYMENT_BLOCK`: block at or before the vault's first client-balance event.
- `TOKENS_JSON`: every supported collateral token, symbol and decimals.
- `RELATED_ACCOUNTS_JSON`: Insurance Fund, Fee Router, treasury and other separately reported reserve accounts.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: production Supabase credentials. Keep the service-role key secret.
- `MANUAL_RUN_TOKEN`: a new long random secret for authenticated manual runs.
- `ALERT_WEBHOOK_URL` and `URGENT_WEBHOOK_URL`: approved operational alert destinations.

Never provide a blockchain private key to this service.

## 3. Build and start

Use Node.js 22.12 or later:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run start:built
```

Alternatively, build and run the included `Dockerfile` while supplying the same environment variables through the hosting platform.

## 4. Verify production readiness

Confirm that `/healthz` and `/readyz` return HTTP 200, then run `operations/verify_rollout.sql` in Supabase. Do not rely on the service operationally until the first complete reconciliation shows:

- `passed` status;
- 100.00% coverage for every collateral token;
- zero asset, indexer and RPC differences;
- a current worker heartbeat; and
- no unresolved exception.

The Compliance Portal frontend must be deployed separately from the `feature/funding-disclosures` branch to expose the Client Assets review interface.

For exception handling and recovery procedures, see `RUNBOOK.md`. For the complete deployment notes, see `DEPLOYMENT.md`.
