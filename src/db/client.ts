import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function assertDatabaseReady(): Promise<void> {
  const { error } = await db.from("asset_reconciliation_worker_leases").select("lease_name").limit(1);
  if (error) throw new Error(`Reconciliation schema is unavailable: ${error.message}`);
}

export async function claimLease(): Promise<boolean> {
  const { data, error } = await db.rpc("service_claim_asset_reconciliation_lease", {
    p_instance_id: env.instanceId,
    p_lease_seconds: env.WORKER_LEASE_SECONDS,
  });
  if (error) throw new Error(`Unable to claim worker lease: ${error.message}`);
  return data === true;
}
