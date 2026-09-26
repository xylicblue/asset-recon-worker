# Railway deployment

The repository is deployable as a Railway persistent service. Railway detects the root `Dockerfile`, builds the TypeScript application with Node.js 22, and starts the compiled worker with the image's `CMD`.

## 1. Prepare Supabase first

Run `migrations/001_client_asset_reconciliation.sql` in the target Supabase project and assign the required staff roles as described in `DEPLOYMENT.md`. This service depends on Supabase Auth, RLS and RPC functions; a generic Railway PostgreSQL database is not a substitute for the Supabase project.

## 2. Create the Railway service

Create a persistent service from this GitHub repository. Keep the repository root as the service root so Railway detects `Dockerfile` automatically.

Configure these service settings:

- Healthcheck path: `/readyz`
- Healthcheck timeout: `300` seconds
- Restart policy: `On Failure`
- Replicas: `1` initially
- Serverless/app sleeping: disabled

The process listens on Railway's injected `PORT` and binds to `0.0.0.0`. A public domain is optional unless operators need to call `POST /runs` from outside the Railway private network.

Do not add a cron schedule. The process must remain running because it performs its own startup and hourly scheduling, lease renewal and heartbeats.

## 3. Add variables

Copy the variables from `.env.example` into Railway's Variables tab, replacing every placeholder with the production value. Do not set `PORT`; Railway supplies it.

Required values are:

- `PRIMARY_RPC_URL`
- `SECONDARY_RPC_URL`
- `ALLOW_SAME_RPC_URL` (set to `true` only when intentionally using one endpoint)
- `CHAIN_ID`
- `COLLATERAL_VAULT_ADDRESS`
- `DEPLOYMENT_BLOCK`
- `TOKENS_JSON`
- `RELATED_ACCOUNTS_JSON`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MANUAL_RUN_TOKEN`

The two RPC URLs should be archive-capable endpoints from independent providers. If only one endpoint is available, set both URL variables to it and set `ALLOW_SAME_RPC_URL=true`. The worker will start, but the second read is no longer independent and a startup warning will be logged. Store the Supabase service-role key and manual-run token as secrets. Alert webhook variables are optional but strongly recommended for production.

## 4. Verify the deployment

After Railway reports the deployment healthy:

```bash
curl -fsS https://YOUR_RAILWAY_DOMAIN/healthz
curl -fsS https://YOUR_RAILWAY_DOMAIN/readyz
```

Both endpoints must return HTTP 200. The readiness response should show `"ready":true`, and the Railway logs should contain `Client-asset reconciliation completed` for the startup run.

Then run `operations/verify_rollout.sql` in Supabase. Do not rely on the control until the first run is `passed`, every configured token has 100.00% coverage, all differences are zero, the worker heartbeat is current, and there are no open exceptions.

An authorised manual run can be started with:

```bash
curl -X POST https://YOUR_RAILWAY_DOMAIN/runs \
  -H "Authorization: Bearer YOUR_MANUAL_RUN_TOKEN"
```

The endpoint returns HTTP 202 when accepted. HTTP 409 means a run is already active or the request reached a non-leader replica.

## Operational notes

- Railway healthchecks are deployment-time checks, not continuous monitoring. Configure an external monitor for `/readyz` and alerts for stale heartbeats.
- The filesystem is disposable; durable reconciliation state remains in Supabase, so no Railway volume is required.
- The database lease supports multiple replicas, but only the elected leader performs reconciliations. Start with one replica unless a tested failover requirement justifies more.
- A failed startup caused by missing variables, an unavailable schema, a chain mismatch or a missing vault contract intentionally exits the process and prevents a healthy deployment.
