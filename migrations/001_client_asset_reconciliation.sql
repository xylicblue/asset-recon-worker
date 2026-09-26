-- ============================================================================
-- ByteStrike client-asset reconciliation control ledger.
--
-- The blockchain remains the book of record. This schema stores reconstructed
-- ledger state, immutable reconciliation evidence, exceptions, independent
-- daily reviews and monthly reserve-sufficiency attestations.
-- ============================================================================

begin;

create table if not exists public.asset_reconciliation_staff_roles (
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('protocol_operations', 'finance_operations', 'compliance_risk', 'executive', 'board_risk')),
  active        boolean not null default true,
  assigned_by   uuid references auth.users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.asset_reconciliation_worker_leases (
  lease_name    text primary key,
  instance_id   text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

create table if not exists public.asset_reconciliation_worker_heartbeats (
  instance_id             text primary key,
  is_leader               boolean not null default false,
  ready                   boolean not null default false,
  running                 boolean not null default false,
  last_run_at             timestamptz,
  last_successful_run_at  timestamptz,
  last_finalized_block    bigint,
  last_error              text,
  updated_at              timestamptz not null default now()
);

create table if not exists public.asset_reconciliation_worker_failures (
  id            uuid primary key default gen_random_uuid(),
  instance_id   text not null,
  task          text not null,
  error_message text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.asset_reconciliation_checkpoints (
  chain_id                 bigint not null,
  vault_address            text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  last_scanned_block       bigint not null,
  last_scanned_block_hash  text check (last_scanned_block_hash is null or last_scanned_block_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at               timestamptz not null default now(),
  primary key (chain_id, vault_address)
);

create table if not exists public.asset_reconciliation_accounts (
  chain_id        bigint not null,
  vault_address   text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  account_address text not null check (account_address ~ '^0x[0-9a-f]{40}$'),
  token_address   text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
  balance_raw     numeric(78,0) not null default 0 check (balance_raw >= 0),
  last_event_block bigint not null,
  updated_at      timestamptz not null default now(),
  primary key (chain_id, vault_address, account_address, token_address)
);

create table if not exists public.asset_reconciliation_chain_events (
  id                    uuid primary key default gen_random_uuid(),
  chain_id              bigint not null,
  vault_address         text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  event_key             text not null,
  transaction_hash      text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index             integer not null check (log_index >= 0),
  block_number          bigint not null,
  block_hash            text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  event_type            text not null check (event_type in ('deposit', 'withdraw', 'seize', 'external_credit', 'pnl_settled')),
  token_address         text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
  account_address       text not null check (account_address ~ '^0x[0-9a-f]{40}$'),
  counterparty_address  text check (counterparty_address is null or counterparty_address ~ '^0x[0-9a-f]{40}$'),
  amount_raw            numeric(78,0) not null check (amount_raw >= 0),
  account_delta_raw     numeric(78,0) not null,
  counterparty_delta_raw numeric(78,0) not null default 0,
  payload               jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at            timestamptz not null default now(),
  unique (chain_id, vault_address, event_key),
  unique (chain_id, vault_address, transaction_hash, log_index)
);

create index if not exists asset_reconciliation_chain_events_block_idx
  on public.asset_reconciliation_chain_events(chain_id, vault_address, block_number, log_index);

create table if not exists public.asset_reconciliation_runs (
  id                  uuid primary key default gen_random_uuid(),
  run_type            text not null check (run_type in ('hourly', 'daily', 'monthly', 'ad_hoc', 'startup')),
  status              text not null check (status in ('passed', 'exception', 'failed')),
  chain_id            bigint not null,
  vault_address       text not null check (vault_address ~ '^0x[0-9a-f]{40}$'),
  block_number        bigint not null,
  block_hash          text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  block_timestamp     timestamptz not null,
  worker_instance_id  text not null,
  started_at          timestamptz not null,
  completed_at        timestamptz not null,
  created_at          timestamptz not null default now(),
  unique (chain_id, vault_address, block_number)
);

create index if not exists asset_reconciliation_runs_created_idx
  on public.asset_reconciliation_runs(created_at desc);

create table if not exists public.asset_reconciliation_token_results (
  id                         uuid primary key default gen_random_uuid(),
  run_id                     uuid not null references public.asset_reconciliation_runs(id) on delete restrict,
  token_address              text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
  token_symbol               text not null,
  token_decimals             smallint not null check (token_decimals between 0 and 36),
  vault_assets_raw           numeric(78,0) not null check (vault_assets_raw >= 0),
  client_liabilities_raw     numeric(78,0) not null check (client_liabilities_raw >= 0),
  indexed_liabilities_raw    numeric(78,0) not null check (indexed_liabilities_raw >= 0),
  secondary_assets_raw       numeric(78,0) not null check (secondary_assets_raw >= 0),
  secondary_liabilities_raw  numeric(78,0) not null check (secondary_liabilities_raw >= 0),
  asset_difference_raw       numeric(78,0) not null,
  indexer_difference_raw     numeric(78,0) not null,
  rpc_asset_difference_raw   numeric(78,0) not null,
  rpc_liability_difference_raw numeric(78,0) not null,
  coverage_bps               numeric(78,0),
  status                     text not null check (status in ('passed', 'exception')),
  exception_codes            text[] not null default '{}',
  related_balances           jsonb not null default '[]' check (jsonb_typeof(related_balances) = 'array'),
  created_at                 timestamptz not null default now(),
  unique (run_id, token_address)
);

create table if not exists public.asset_reconciliation_exceptions (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.asset_reconciliation_runs(id) on delete restrict,
  token_result_id       uuid not null references public.asset_reconciliation_token_results(id) on delete restrict,
  code                  text not null,
  severity              text not null check (severity in ('critical', 'high')),
  status                text not null default 'open' check (status in ('open', 'investigating', 'pending_independent_review', 'resolved')),
  difference_raw        numeric(78,0) not null,
  remediation_due_at    timestamptz,
  assigned_to           uuid references auth.users(id) on delete set null,
  investigation_note    text,
  root_cause            text,
  resolution_note       text,
  resolution_proposed_by uuid references auth.users(id) on delete set null,
  resolution_proposed_at timestamptz,
  corrected_by_run_id   uuid references public.asset_reconciliation_runs(id) on delete restrict,
  resolved_by           uuid references auth.users(id) on delete set null,
  resolved_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (run_id, token_result_id, code)
);

create index if not exists asset_reconciliation_exceptions_open_idx
  on public.asset_reconciliation_exceptions(status, severity, created_at);

create table if not exists public.asset_reconciliation_daily_reviews (
  id              uuid primary key default gen_random_uuid(),
  control_date    date not null unique,
  run_id          uuid not null references public.asset_reconciliation_runs(id) on delete restrict,
  status          text not null default 'pending_preparation' check (status in ('pending_preparation', 'awaiting_independent_review', 'approved', 'rejected')),
  due_at          timestamptz not null,
  prepared_by     uuid references auth.users(id) on delete restrict,
  preparation_note text,
  prepared_at     timestamptz,
  reviewed_by     uuid references auth.users(id) on delete restrict,
  review_note     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.asset_reconciliation_monthly_attestations (
  id              uuid primary key default gen_random_uuid(),
  period_start    date not null unique check (period_start = date_trunc('month', period_start)::date),
  period_end      date not null,
  due_at          timestamptz not null,
  status          text not null default 'pending' check (status in ('pending', 'signed')),
  summary         jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  attestation_text text,
  signed_by       uuid references auth.users(id) on delete restrict,
  signed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'signed' and signed_by is not null and signed_at is not null) or status <> 'signed')
);

create table if not exists public.asset_reconciliation_actions (
  id            uuid primary key default gen_random_uuid(),
  action_type   text not null,
  subject_type  text not null,
  subject_id    uuid not null,
  actor_id      uuid not null references auth.users(id) on delete restrict,
  details       jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at    timestamptz not null default now()
);

create or replace function public.reject_asset_reconciliation_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Client-asset reconciliation evidence is immutable' using errcode = '55000';
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['asset_reconciliation_chain_events', 'asset_reconciliation_runs', 'asset_reconciliation_token_results', 'asset_reconciliation_actions'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || table_name || '_immutable', table_name);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.reject_asset_reconciliation_audit_mutation()', 'trg_' || table_name || '_immutable', table_name);
  end loop;
end $$;

create or replace function public.asset_reconciliation_has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.asset_reconciliation_staff_roles assignment
    where assignment.user_id = auth.uid() and assignment.role = p_role and assignment.active
  );
$$;

create or replace function public.require_asset_reconciliation_admin(p_required_role text default null)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Two-factor authentication is required' using errcode = '42501';
  end if;
  if p_required_role is not null and not public.asset_reconciliation_has_role(p_required_role) then
    raise exception 'The assigned % role is required', p_required_role using errcode = '42501';
  end if;
end;
$$;

create or replace function public.service_claim_asset_reconciliation_lease(p_instance_id text, p_lease_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare acquired boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_lease_seconds not between 30 and 900 then raise exception 'invalid lease duration' using errcode = '22023'; end if;
  insert into public.asset_reconciliation_worker_leases(lease_name, instance_id, expires_at)
  values ('primary', p_instance_id, now() + make_interval(secs => p_lease_seconds))
  on conflict (lease_name) do update set
    instance_id = excluded.instance_id,
    expires_at = excluded.expires_at,
    updated_at = now()
  where public.asset_reconciliation_worker_leases.expires_at < now()
     or public.asset_reconciliation_worker_leases.instance_id = excluded.instance_id
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create or replace function public.service_apply_asset_reconciliation_events(
  p_chain_id bigint,
  p_vault_address text,
  p_expected_previous_block bigint,
  p_from_block bigint,
  p_to_block bigint,
  p_to_block_hash text,
  p_events jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  checkpoint public.asset_reconciliation_checkpoints%rowtype;
  item jsonb;
  event_id uuid;
  applied integer := 0;
  account_delta numeric(78,0);
  counterparty_delta numeric(78,0);
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array' using errcode = '22023'; end if;
  if p_from_block <> p_expected_previous_block + 1 or p_to_block < p_from_block then raise exception 'invalid contiguous block range' using errcode = '22023'; end if;

  insert into public.asset_reconciliation_checkpoints(chain_id, vault_address, last_scanned_block)
  values (p_chain_id, lower(p_vault_address), p_expected_previous_block)
  on conflict do nothing;

  select * into checkpoint from public.asset_reconciliation_checkpoints
  where chain_id = p_chain_id and vault_address = lower(p_vault_address) for update;
  if checkpoint.last_scanned_block <> p_expected_previous_block then
    raise exception 'checkpoint changed concurrently (expected %, found %)', p_expected_previous_block, checkpoint.last_scanned_block using errcode = '40001';
  end if;

  for item in select value from jsonb_array_elements(p_events) loop
    event_id := null;
    account_delta := (item ->> 'account_delta_raw')::numeric;
    counterparty_delta := (item ->> 'counterparty_delta_raw')::numeric;
    insert into public.asset_reconciliation_chain_events(
      chain_id, vault_address, event_key, transaction_hash, log_index, block_number, block_hash,
      event_type, token_address, account_address, counterparty_address, amount_raw,
      account_delta_raw, counterparty_delta_raw, payload
    ) values (
      p_chain_id, lower(p_vault_address), item ->> 'event_key', lower(item ->> 'tx_hash'),
      (item ->> 'log_index')::integer, (item ->> 'block_number')::bigint, lower(item ->> 'block_hash'),
      item ->> 'event_type', lower(item ->> 'token_address'), lower(item ->> 'account_address'),
      case when item ->> 'counterparty_address' is null then null else lower(item ->> 'counterparty_address') end,
      (item ->> 'amount_raw')::numeric, account_delta, counterparty_delta, coalesce(item -> 'payload', '{}')
    ) on conflict do nothing returning id into event_id;

    if event_id is not null then
      insert into public.asset_reconciliation_accounts(chain_id, vault_address, account_address, token_address, balance_raw, last_event_block)
      values (p_chain_id, lower(p_vault_address), lower(item ->> 'account_address'), lower(item ->> 'token_address'), account_delta, (item ->> 'block_number')::bigint)
      on conflict (chain_id, vault_address, account_address, token_address) do update set
        balance_raw = public.asset_reconciliation_accounts.balance_raw + excluded.balance_raw,
        last_event_block = excluded.last_event_block,
        updated_at = now();

      if item ->> 'counterparty_address' is not null and counterparty_delta <> 0 then
        insert into public.asset_reconciliation_accounts(chain_id, vault_address, account_address, token_address, balance_raw, last_event_block)
        values (p_chain_id, lower(p_vault_address), lower(item ->> 'counterparty_address'), lower(item ->> 'token_address'), counterparty_delta, (item ->> 'block_number')::bigint)
        on conflict (chain_id, vault_address, account_address, token_address) do update set
          balance_raw = public.asset_reconciliation_accounts.balance_raw + excluded.balance_raw,
          last_event_block = excluded.last_event_block,
          updated_at = now();
      end if;
      applied := applied + 1;
    end if;
  end loop;

  update public.asset_reconciliation_checkpoints set
    last_scanned_block = p_to_block,
    last_scanned_block_hash = lower(p_to_block_hash),
    updated_at = now()
  where chain_id = p_chain_id and vault_address = lower(p_vault_address);
  return applied;
end;
$$;

create or replace function public.asset_reconciliation_add_business_days(p_start date, p_days integer)
returns date language plpgsql immutable set search_path = '' as $$
declare result date := p_start; added integer := 0;
begin
  while added < p_days loop
    result := result + 1;
    if extract(isodow from result) < 6 then added := added + 1; end if;
  end loop;
  return result;
end;
$$;

create or replace function public.service_record_asset_reconciliation_run(p_run jsonb, p_results jsonb, p_daily_due_hour_utc integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run_record public.asset_reconciliation_runs%rowtype;
  item jsonb;
  result_id uuid;
  overall_status text := 'passed';
  exception_code text;
  exception_list jsonb := '[]'::jsonb;
  severity text;
  v_control_date date;
  v_month_start date;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then raise exception 'results must be a non-empty array' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) value where value ->> 'status' = 'exception') then overall_status := 'exception'; end if;

  insert into public.asset_reconciliation_runs(run_type, status, chain_id, vault_address, block_number, block_hash, block_timestamp, worker_instance_id, started_at, completed_at)
  values (p_run ->> 'run_type', overall_status, (p_run ->> 'chain_id')::bigint, lower(p_run ->> 'vault_address'), (p_run ->> 'block_number')::bigint,
          lower(p_run ->> 'block_hash'), (p_run ->> 'block_timestamp')::timestamptz, p_run ->> 'worker_instance_id',
          (p_run ->> 'started_at')::timestamptz, (p_run ->> 'completed_at')::timestamptz)
  on conflict (chain_id, vault_address, block_number) do nothing
  returning * into run_record;

  if not found then
    select * into run_record from public.asset_reconciliation_runs
    where chain_id = (p_run ->> 'chain_id')::bigint
      and vault_address = lower(p_run ->> 'vault_address')
      and block_number = (p_run ->> 'block_number')::bigint;
    return jsonb_build_object('runId', run_record.id, 'status', run_record.status, 'exceptions', '[]'::jsonb);
  end if;

  for item in select value from jsonb_array_elements(p_results) loop
    result_id := null;
    insert into public.asset_reconciliation_token_results(
      run_id, token_address, token_symbol, token_decimals, vault_assets_raw, client_liabilities_raw,
      indexed_liabilities_raw, secondary_assets_raw, secondary_liabilities_raw, asset_difference_raw,
      indexer_difference_raw, rpc_asset_difference_raw, rpc_liability_difference_raw, coverage_bps,
      status, exception_codes, related_balances
    ) values (
      run_record.id, lower(item ->> 'token_address'), item ->> 'token_symbol', (item ->> 'token_decimals')::smallint,
      (item ->> 'vault_assets_raw')::numeric, (item ->> 'client_liabilities_raw')::numeric,
      (item ->> 'indexed_liabilities_raw')::numeric, (item ->> 'secondary_assets_raw')::numeric,
      (item ->> 'secondary_liabilities_raw')::numeric, (item ->> 'asset_difference_raw')::numeric,
      (item ->> 'indexer_difference_raw')::numeric, (item ->> 'rpc_asset_difference_raw')::numeric,
      (item ->> 'rpc_liability_difference_raw')::numeric, nullif(item ->> 'coverage_bps', '')::numeric,
      item ->> 'status', array(select jsonb_array_elements_text(item -> 'exception_codes')), coalesce(item -> 'related_balances', '[]')
    ) on conflict (run_id, token_address) do nothing returning id into result_id;

    if result_id is not null then
      for exception_code in select jsonb_array_elements_text(item -> 'exception_codes') loop
        severity := case when exception_code = 'CLIENT_ASSET_DEFICIT' then 'critical' else 'high' end;
        insert into public.asset_reconciliation_exceptions(run_id, token_result_id, code, severity, difference_raw, remediation_due_at)
        values (run_record.id, result_id, exception_code, severity, (item ->> 'asset_difference_raw')::numeric,
                case when severity = 'critical' then now() + interval '2 hours' else null end)
        on conflict do nothing;
        exception_list := exception_list || jsonb_build_array(jsonb_build_object('code', exception_code, 'token', item ->> 'token_symbol', 'severity', severity));
      end loop;
    end if;
  end loop;

  v_control_date := (run_record.block_timestamp at time zone 'UTC')::date;
  insert into public.asset_reconciliation_daily_reviews(control_date, run_id, due_at)
  values (v_control_date, run_record.id, v_control_date::timestamptz + make_interval(hours => p_daily_due_hour_utc))
  on conflict (control_date) do update set run_id = excluded.run_id, updated_at = now()
  where public.asset_reconciliation_daily_reviews.status = 'pending_preparation';

  v_month_start := (date_trunc('month', v_control_date) - interval '1 month')::date;
  insert into public.asset_reconciliation_monthly_attestations(period_start, period_end, due_at)
  values (v_month_start, (v_month_start + interval '1 month')::date,
          public.asset_reconciliation_add_business_days((v_month_start + interval '1 month')::date, 5)::timestamptz + interval '23 hours 59 minutes')
  on conflict (period_start) do nothing;

  return jsonb_build_object('runId', run_record.id, 'status', overall_status, 'exceptions', exception_list);
end;
$$;

create or replace function public.admin_asset_reconciliation_dashboard(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_asset_reconciliation_admin(null);
  return jsonb_build_object(
    'roles', coalesce((select jsonb_agg(role order by role) from public.asset_reconciliation_staff_roles where user_id = auth.uid() and active), '[]'::jsonb),
    'latest_run', (select to_jsonb(run) from public.asset_reconciliation_runs run order by run.created_at desc limit 1),
    'latest_results', coalesce((select jsonb_agg(to_jsonb(result) order by result.token_symbol) from public.asset_reconciliation_token_results result where result.run_id = (select id from public.asset_reconciliation_runs order by created_at desc limit 1)), '[]'::jsonb),
    'open_exceptions', coalesce((select jsonb_agg(to_jsonb(exception_row) order by exception_row.severity, exception_row.created_at) from public.asset_reconciliation_exceptions exception_row where exception_row.status <> 'resolved'), '[]'::jsonb),
    'daily_reviews', coalesce((select jsonb_agg(to_jsonb(review_row) order by review_row.control_date desc) from (select * from public.asset_reconciliation_daily_reviews order by control_date desc limit greatest(1, least(p_limit, 100))) review_row), '[]'::jsonb),
    'monthly_attestations', coalesce((select jsonb_agg(to_jsonb(attestation_row) order by attestation_row.period_start desc) from (select * from public.asset_reconciliation_monthly_attestations order by period_start desc limit 12) attestation_row), '[]'::jsonb),
    'recent_runs', coalesce((select jsonb_agg(to_jsonb(run_row) order by run_row.created_at desc) from (select * from public.asset_reconciliation_runs order by created_at desc limit greatest(1, least(p_limit, 100))) run_row), '[]'::jsonb),
    'recent_worker_failures', coalesce((select jsonb_agg(to_jsonb(failure_row) order by failure_row.created_at desc) from (select * from public.asset_reconciliation_worker_failures order by created_at desc limit 20) failure_row), '[]'::jsonb),
    'worker', (select to_jsonb(heartbeat) from public.asset_reconciliation_worker_heartbeats heartbeat order by heartbeat.updated_at desc limit 1)
  );
end;
$$;

create or replace function public.admin_prepare_asset_reconciliation_daily(p_review_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_asset_reconciliation_admin('protocol_operations');
  update public.asset_reconciliation_daily_reviews set status = 'awaiting_independent_review', prepared_by = auth.uid(), preparation_note = nullif(btrim(p_note), ''), prepared_at = now(), updated_at = now()
  where id = p_review_id and status = 'pending_preparation';
  if not found then raise exception 'Daily review is not awaiting preparation' using errcode = '23514'; end if;
  insert into public.asset_reconciliation_actions(action_type, subject_type, subject_id, actor_id, details)
  values ('daily_prepared', 'daily_review', p_review_id, auth.uid(), jsonb_build_object('note', nullif(btrim(p_note), '')));
end;
$$;

create or replace function public.admin_review_asset_reconciliation_daily(p_review_id uuid, p_approved boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare preparer uuid;
begin
  perform public.require_asset_reconciliation_admin('finance_operations');
  select prepared_by into preparer from public.asset_reconciliation_daily_reviews where id = p_review_id and status = 'awaiting_independent_review' for update;
  if not found then raise exception 'Daily review is not awaiting independent review' using errcode = '23514'; end if;
  if preparer = auth.uid() then raise exception 'The preparer cannot perform the independent review' using errcode = '42501'; end if;
  update public.asset_reconciliation_daily_reviews set status = case when p_approved then 'approved' else 'rejected' end, reviewed_by = auth.uid(), review_note = nullif(btrim(p_note), ''), reviewed_at = now(), updated_at = now() where id = p_review_id;
  insert into public.asset_reconciliation_actions(action_type, subject_type, subject_id, actor_id, details)
  values (case when p_approved then 'daily_approved' else 'daily_rejected' end, 'daily_review', p_review_id, auth.uid(), jsonb_build_object('note', nullif(btrim(p_note), '')));
end;
$$;

create or replace function public.admin_propose_asset_reconciliation_exception_resolution(p_exception_id uuid, p_investigation_note text, p_root_cause text, p_resolution_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare exception_record public.asset_reconciliation_exceptions%rowtype; correction_run uuid;
begin
  perform public.require_asset_reconciliation_admin('protocol_operations');
  if nullif(btrim(p_root_cause), '') is null or nullif(btrim(p_resolution_note), '') is null then raise exception 'Root cause and corrective action are required' using errcode = '22023'; end if;
  select * into exception_record from public.asset_reconciliation_exceptions where id = p_exception_id and status in ('open', 'investigating') for update;
  if not found then raise exception 'Exception is not open for resolution' using errcode = '23514'; end if;
  select later_result.run_id into correction_run
  from public.asset_reconciliation_token_results original_result
  join public.asset_reconciliation_runs original_run on original_run.id = original_result.run_id
  join public.asset_reconciliation_token_results later_result on later_result.token_address = original_result.token_address and later_result.status = 'passed'
  join public.asset_reconciliation_runs later_run on later_run.id = later_result.run_id and later_run.block_number > original_run.block_number
  where original_result.id = exception_record.token_result_id
  order by later_run.block_number desc limit 1;
  if correction_run is null then raise exception 'A later passing reconciliation is required before closure can be proposed' using errcode = '23514'; end if;
  update public.asset_reconciliation_exceptions set status = 'pending_independent_review', investigation_note = nullif(btrim(p_investigation_note), ''), root_cause = btrim(p_root_cause), resolution_note = btrim(p_resolution_note), resolution_proposed_by = auth.uid(), resolution_proposed_at = now(), corrected_by_run_id = correction_run, updated_at = now()
  where id = p_exception_id;
  insert into public.asset_reconciliation_actions(action_type, subject_type, subject_id, actor_id, details)
  values ('exception_resolution_proposed', 'exception', p_exception_id, auth.uid(), jsonb_build_object('root_cause', btrim(p_root_cause), 'resolution', btrim(p_resolution_note)));
end;
$$;

create or replace function public.admin_approve_asset_reconciliation_exception_resolution(p_exception_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare proposer uuid;
begin
  perform public.require_asset_reconciliation_admin('finance_operations');
  select resolution_proposed_by into proposer from public.asset_reconciliation_exceptions where id = p_exception_id and status = 'pending_independent_review' for update;
  if not found then raise exception 'Exception resolution is not awaiting review' using errcode = '23514'; end if;
  if proposer = auth.uid() then raise exception 'The resolution proposer cannot approve closure' using errcode = '42501'; end if;
  update public.asset_reconciliation_exceptions set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = concat_ws(E'\n', resolution_note, nullif(btrim(p_note), '')), updated_at = now() where id = p_exception_id;
  insert into public.asset_reconciliation_actions(action_type, subject_type, subject_id, actor_id, details)
  values ('exception_resolved', 'exception', p_exception_id, auth.uid(), jsonb_build_object('review_note', nullif(btrim(p_note), '')));
end;
$$;

create or replace function public.admin_sign_asset_reconciliation_attestation(p_attestation_id uuid, p_attestation_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare attestation public.asset_reconciliation_monthly_attestations%rowtype; incomplete integer; unresolved integer; approved_days integer; expected_days integer; summary jsonb;
begin
  perform public.require_asset_reconciliation_admin('compliance_risk');
  select * into attestation from public.asset_reconciliation_monthly_attestations where id = p_attestation_id and status = 'pending' for update;
  if not found then raise exception 'Monthly attestation is not pending' using errcode = '23514'; end if;
  if nullif(btrim(p_attestation_text), '') is null then raise exception 'Attestation wording is required' using errcode = '22023'; end if;
  select count(*) into incomplete from public.asset_reconciliation_daily_reviews where control_date >= attestation.period_start and control_date < attestation.period_end and status <> 'approved';
  select count(*) into approved_days from public.asset_reconciliation_daily_reviews where control_date >= attestation.period_start and control_date < attestation.period_end and status = 'approved';
  expected_days := attestation.period_end - attestation.period_start;
  select count(*) into unresolved from public.asset_reconciliation_exceptions e join public.asset_reconciliation_runs r on r.id = e.run_id where r.block_timestamp >= attestation.period_start and r.block_timestamp < attestation.period_end and e.status <> 'resolved';
  if incomplete > 0 or unresolved > 0 or approved_days <> expected_days then raise exception 'Cannot sign: % of % daily reviews approved, % incomplete records and % exceptions unresolved', approved_days, expected_days, incomplete, unresolved using errcode = '23514'; end if;
  select jsonb_build_object('run_count', count(distinct r.id), 'token_result_count', count(tr.id), 'minimum_coverage_bps', min(tr.coverage_bps), 'exception_run_count', count(distinct r.id) filter (where r.status = 'exception')) into summary
  from public.asset_reconciliation_runs r join public.asset_reconciliation_token_results tr on tr.run_id = r.id
  where r.block_timestamp >= attestation.period_start and r.block_timestamp < attestation.period_end;
  update public.asset_reconciliation_monthly_attestations set status = 'signed', summary = summary, attestation_text = btrim(p_attestation_text), signed_by = auth.uid(), signed_at = now(), updated_at = now() where id = p_attestation_id;
  insert into public.asset_reconciliation_actions(action_type, subject_type, subject_id, actor_id, details)
  values ('monthly_attestation_signed', 'monthly_attestation', p_attestation_id, auth.uid(), summary);
end;
$$;

alter table public.asset_reconciliation_staff_roles enable row level security;
alter table public.asset_reconciliation_worker_leases enable row level security;
alter table public.asset_reconciliation_worker_heartbeats enable row level security;
alter table public.asset_reconciliation_worker_failures enable row level security;
alter table public.asset_reconciliation_checkpoints enable row level security;
alter table public.asset_reconciliation_accounts enable row level security;
alter table public.asset_reconciliation_chain_events enable row level security;
alter table public.asset_reconciliation_runs enable row level security;
alter table public.asset_reconciliation_token_results enable row level security;
alter table public.asset_reconciliation_exceptions enable row level security;
alter table public.asset_reconciliation_daily_reviews enable row level security;
alter table public.asset_reconciliation_monthly_attestations enable row level security;
alter table public.asset_reconciliation_actions enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'asset_reconciliation_staff_roles', 'asset_reconciliation_worker_heartbeats', 'asset_reconciliation_worker_failures',
    'asset_reconciliation_checkpoints', 'asset_reconciliation_accounts',
    'asset_reconciliation_chain_events', 'asset_reconciliation_runs',
    'asset_reconciliation_token_results', 'asset_reconciliation_exceptions',
    'asset_reconciliation_daily_reviews', 'asset_reconciliation_monthly_attestations',
    'asset_reconciliation_actions'
  ] loop
    execute format('drop policy if exists "Admins read client asset reconciliation" on public.%I', table_name);
    execute format('create policy "Admins read client asset reconciliation" on public.%I for select to authenticated using (public.is_admin() and public.is_aal2())', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end $$;

revoke all on public.asset_reconciliation_worker_leases from public, anon, authenticated;
-- The worker uses direct reads for checkpoints/accounts and direct writes for
-- operational health records. Keep these grants explicit instead of relying on
-- project-wide service-role defaults.
grant select on public.asset_reconciliation_worker_leases to service_role;
grant select on public.asset_reconciliation_checkpoints to service_role;
grant select on public.asset_reconciliation_accounts to service_role;
grant select, insert, update on public.asset_reconciliation_worker_heartbeats to service_role;
grant select, insert on public.asset_reconciliation_worker_failures to service_role;
revoke execute on function public.asset_reconciliation_has_role(text) from public, anon;
revoke execute on function public.require_asset_reconciliation_admin(text) from public, anon, authenticated;
revoke execute on function public.service_claim_asset_reconciliation_lease(text, integer) from public, anon, authenticated;
revoke execute on function public.service_apply_asset_reconciliation_events(bigint, text, bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke execute on function public.service_record_asset_reconciliation_run(jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.service_claim_asset_reconciliation_lease(text, integer) to service_role;
grant execute on function public.service_apply_asset_reconciliation_events(bigint, text, bigint, bigint, bigint, text, jsonb) to service_role;
grant execute on function public.service_record_asset_reconciliation_run(jsonb, jsonb, integer) to service_role;
grant execute on function public.asset_reconciliation_has_role(text) to authenticated, service_role;
grant execute on function public.admin_asset_reconciliation_dashboard(integer) to authenticated;
grant execute on function public.admin_prepare_asset_reconciliation_daily(uuid, text) to authenticated;
grant execute on function public.admin_review_asset_reconciliation_daily(uuid, boolean, text) to authenticated;
grant execute on function public.admin_propose_asset_reconciliation_exception_resolution(uuid, text, text, text) to authenticated;
grant execute on function public.admin_approve_asset_reconciliation_exception_resolution(uuid, text) to authenticated;
grant execute on function public.admin_sign_asset_reconciliation_attestation(uuid, text) to authenticated;

revoke execute on function public.admin_asset_reconciliation_dashboard(integer) from public, anon;
revoke execute on function public.admin_prepare_asset_reconciliation_daily(uuid, text) from public, anon;
revoke execute on function public.admin_review_asset_reconciliation_daily(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_propose_asset_reconciliation_exception_resolution(uuid, text, text, text) from public, anon;
revoke execute on function public.admin_approve_asset_reconciliation_exception_resolution(uuid, text) from public, anon;
revoke execute on function public.admin_sign_asset_reconciliation_attestation(uuid, text) from public, anon;

notify pgrst, 'reload schema';
commit;
