-- Run each read-only query after deployment.

select instance_id, is_leader, ready, running, last_run_at,
       last_successful_run_at, last_finalized_block, last_error, updated_at
from public.asset_reconciliation_worker_heartbeats
order by updated_at desc;

select id, run_type, status, block_number, block_hash, block_timestamp,
       started_at, completed_at
from public.asset_reconciliation_runs
order by created_at desc
limit 20;

select r.block_number, tr.token_symbol,
       tr.vault_assets_raw, tr.client_liabilities_raw,
       tr.asset_difference_raw, tr.indexer_difference_raw,
       tr.rpc_asset_difference_raw, tr.rpc_liability_difference_raw,
       tr.coverage_bps, tr.status, tr.exception_codes
from public.asset_reconciliation_token_results tr
join public.asset_reconciliation_runs r on r.id = tr.run_id
order by r.block_number desc, tr.token_symbol
limit 50;

select id, code, severity, status, difference_raw, remediation_due_at,
       corrected_by_run_id, created_at
from public.asset_reconciliation_exceptions
where status <> 'resolved'
order by case severity when 'critical' then 0 else 1 end, created_at;

select control_date, status, due_at, prepared_at, reviewed_at
from public.asset_reconciliation_daily_reviews
order by control_date desc
limit 31;

select period_start, period_end, status, due_at, signed_at, summary
from public.asset_reconciliation_monthly_attestations
order by period_start desc
limit 12;
