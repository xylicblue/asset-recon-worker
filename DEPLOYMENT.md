# Deployment

## 1. Apply the control schema

Run `migrations/001_client_asset_reconciliation.sql` once in the production Supabase SQL Editor.

Assign duties using confirmed `auth.users.id` values. Keep preparer and reviewer assignments separate:

```sql
insert into public.asset_reconciliation_staff_roles (user_id, role)
values
  ('PROTOCOL_OPERATIONS_USER_UUID', 'protocol_operations'),
  ('FINANCE_OPERATIONS_USER_UUID', 'finance_operations'),
  ('COMPLIANCE_RISK_USER_UUID', 'compliance_risk');
```

## 2. Configure the service

Deploy this directory with Node.js 20+ or the included Dockerfile. Copy every value from `.env.example` into the hosting provider's secret/environment settings.

Before starting, confirm:

- `COLLATERAL_VAULT_ADDRESS` is the live vault.
- `DEPLOYMENT_BLOCK` is at or before its first client-balance event. Starting later makes reconstruction incomplete and intentionally causes the control to fail.
- `TOKENS_JSON` includes every accepted collateral token with the correct decimals.
- the primary and secondary URLs are archive-capable endpoints from independent RPC providers;
- `RELATED_ACCOUNTS_JSON` lists the Insurance Fund, Fee Router, treasury and any settlement reserve;
- `MANUAL_RUN_TOKEN` is a newly generated high-entropy secret; and
- `ALERT_WEBHOOK_URL` and `URGENT_WEBHOOK_URL` point to the approved operational and urgent Slack channels.

No blockchain signing key is required or permitted.

## 3. Validate and start

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run start:built
```

Confirm `/healthz` and `/readyz` return HTTP 200. Then run `operations/verify_rollout.sql`. The first complete run must show:

- status `passed`;
- 100.00% coverage for every token;
- zero asset, indexer and RPC differences;
- a current worker heartbeat; and
- no open exception.

An authorised ad-hoc run can be requested after an upgrade, collateral/oracle change or incident:

```bash
curl -X POST https://RECONCILIATION_SERVICE/runs \
  -H "Authorization: Bearer MANUAL_RUN_TOKEN"
```

## 4. Deploy the portal

Rebuild and deploy the `overhaul` frontend. No additional frontend environment variable is required. Administrators need AAL2 and an assigned reconciliation role to perform controlled actions.

Do not enable production reliance until the deployment block, token universe, two independent RPCs and first passing run have been independently checked.
