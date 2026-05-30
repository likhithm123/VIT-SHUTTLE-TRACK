-- Hardened Supabase schema for Campus Shuttle prototype

-- extensions
create extension if not exists pgcrypto;

-- users
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  name text,
  role text not null check (role in ('student','driver','admin')),
  reg_no text,
  passout_year integer,
  wallet numeric(12,2) default 0,
  created_at timestamptz default now()
);

-- nfc cards
create table nfc_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  card_uid text unique not null,
  created_at timestamptz default now()
);

-- shuttles with cached latest location for fast reads
create table shuttles (
  id uuid primary key default gen_random_uuid(),
  vehicle_number text unique,
  driver_id uuid references users(id),
  route text check (route in ('A','B')),
  status text check (status in ('running','maintenance','not started')) default 'not started',
  color text,
  active boolean default true,
  current_lat double precision,
  current_lng double precision,
  last_seen timestamptz
);

-- historical locations (time-series)
create table locations (
  id uuid primary key default gen_random_uuid(),
  shuttle_id uuid references shuttles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz default now()
);

-- transactions (payments)
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  shuttle_id uuid references shuttles(id),
  driver_id uuid references users(id),
  amount numeric(12,2) not null,
  status text check (status in ('pending','success','failed','refunded')) default 'pending',
  balance_before numeric(12,2),
  balance_after numeric(12,2),
  payment_method text,
  created_at timestamptz default now(),
  metadata jsonb
);

-- wallet ledger for auditable wallet changes
create table wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  transaction_id uuid references transactions(id),
  amount numeric(12,2) not null,
  balance_before numeric(12,2),
  balance_after numeric(12,2),
  type text check (type in ('debit','credit','adjustment')),
  created_at timestamptz default now(),
  metadata jsonb
);

-- hotlist to prevent duplicate taps (temporary)
create table hotlist (
  id uuid primary key default gen_random_uuid(),
  card_uid text,
  until timestamptz
);

-- admin audit log
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references users(id),
  action text not null,
  object_type text,
  object_id uuid,
  details jsonb,
  created_at timestamptz default now()
);

create table alerts (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  audience text check (audience in ('all','student','driver')) default 'all',
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Indexes for fast queries
create index if not exists idx_locations_shuttle_recorded on locations (shuttle_id, recorded_at desc);
create index if not exists idx_transactions_user_created on transactions (user_id, created_at desc);
create index if not exists idx_hotlist_card_until on hotlist (card_uid, until desc);
create index if not exists idx_nfc_card_uid on nfc_cards (card_uid);
create index if not exists idx_alerts_expires on alerts (expires_at desc);

do $$
declare
  green_driver uuid;
  blue_driver uuid;
begin
  select id into green_driver from users where reg_no = 'DRV01' limit 1;
  if green_driver is null then
    insert into users (name, role, reg_no) values ('Ravi Green', 'driver', 'DRV01') returning id into green_driver;
  end if;

  select id into blue_driver from users where reg_no = 'DRV02' limit 1;
  if blue_driver is null then
    insert into users (name, role, reg_no) values ('Kumar Blue', 'driver', 'DRV02') returning id into blue_driver;
  end if;

  if not exists (select 1 from shuttles where vehicle_number = 'VIT-A-101') then
    insert into shuttles (vehicle_number, driver_id, route, status, active, current_lat, current_lng, last_seen)
    values ('VIT-A-101', green_driver, 'A', 'running', true, 12.9729, 79.1586, now());
  end if;

  if not exists (select 1 from shuttles where vehicle_number = 'VIT-B-202') then
    insert into shuttles (vehicle_number, driver_id, route, status, active, current_lat, current_lng, last_seen)
    values ('VIT-B-202', blue_driver, 'B', 'running', true, 12.9724, 79.1552, now());
  end if;
end $$;

-- Function: process a transaction atomically
create or replace function sp_process_transaction(p_user_id uuid, p_shuttle_id uuid, p_amount numeric, p_card_uid text default null)
returns json as $$
declare
  v_wallet numeric(12,2);
  v_new numeric(12,2);
  v_txid uuid;
  v_driver uuid;
  v_until timestamptz := now() + interval '10 seconds';
begin
  -- lock user row
  select wallet into v_wallet from users where id = p_user_id for update;
  if not found then
    raise exception 'user not found';
  end if;

  select driver_id into v_driver from shuttles where id = p_shuttle_id;

  v_new := v_wallet - p_amount;

  insert into transactions (user_id, shuttle_id, driver_id, amount, status, balance_before, balance_after, metadata)
    values (
      p_user_id,
      p_shuttle_id,
      v_driver,
      p_amount,
      'success',
      v_wallet,
      v_new,
      json_build_object(
        'card_uid', p_card_uid,
        'route', (select route from shuttles where id = p_shuttle_id),
        'vehicle_number', (select vehicle_number from shuttles where id = p_shuttle_id)
      )
    )
    returning id into v_txid;

  insert into wallet_ledger (user_id, transaction_id, amount, balance_before, balance_after, type, metadata)
    values (p_user_id, v_txid, p_amount, v_wallet, v_new, 'debit', json_build_object('shuttle_id', p_shuttle_id));

  update users set wallet = v_new where id = p_user_id;

  if p_card_uid is not null then
    insert into hotlist (card_uid, until) values (p_card_uid, v_until);
  end if;

  return json_build_object('ok', true, 'tx', v_txid, 'new_wallet', v_new);
end;
$$ language plpgsql security definer;

-- Function: refund a transaction (admin action)
create or replace function sp_refund_transaction(p_tx_id uuid, p_admin_id uuid, p_reason text default null)
returns json as $$
declare
  t record;
  v_wallet numeric(12,2);
  v_new numeric(12,2);
begin
  select * into t from transactions where id = p_tx_id for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if t.status = 'refunded' then
    return json_build_object('ok', true, 'message', 'already refunded');
  end if;

  select wallet into v_wallet from users where id = t.user_id for update;
  v_new := v_wallet + t.amount;

  update transactions set status = 'refunded' where id = p_tx_id;
  update users set wallet = v_new where id = t.user_id;

  insert into wallet_ledger (user_id, transaction_id, amount, balance_before, balance_after, type, metadata)
    values (t.user_id, p_tx_id, t.amount, v_wallet, v_new, 'credit', json_build_object('admin_id', p_admin_id, 'reason', p_reason));

  insert into audit_log (admin_id, action, object_type, object_id, details)
    values (p_admin_id, 'refund', 'transaction', p_tx_id, json_build_object('reason', p_reason));

  return json_build_object('ok', true, 'new_wallet', v_new);
end;
$$ language plpgsql security definer;
