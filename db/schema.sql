-- Hardened Supabase schema for Campus Shuttle prototype
-- 1. USERS PROFILE TABLE
-- Links to Supabase Auth. 'id' matches auth.users UUID.
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'student' CHECK (role IN ('admin', 'student', 'driver')),
  reg_no TEXT UNIQUE,
  card_uid TEXT UNIQUE,
  passout_year INTEGER,
  needs_password_reset BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. WALLETS TABLE
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance DECIMAL(12, 2) DEFAULT 0.00
);

-- 3. DUES TABLE
CREATE TABLE public.dues (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) DEFAULT 0.00,
  since TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SHUTTLES TABLE
CREATE TABLE public.shuttles (
  id TEXT PRIMARY KEY,
  vehicle_no TEXT NOT NULL,
  driver_id UUID REFERENCES public.users(id),
  route TEXT DEFAULT 'A',
  status TEXT DEFAULT 'not started',
  lat FLOAT8,
  lng FLOAT8,
  heading FLOAT8 DEFAULT 0,
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TRANSACTIONS TABLE
CREATE TABLE public.transactions (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.users(id),
  driver_id UUID,
  shuttle_id TEXT,
  route TEXT,
  amount DECIMAL(10, 2),
  status TEXT DEFAULT 'success',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. HOTLIST TABLE
CREATE TABLE public.hotlist (
  card_uid TEXT PRIMARY KEY,
  expires_at BIGINT
);

-- 7. ALERTS TABLE
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  text TEXT NOT NULL,
  audience TEXT DEFAULT 'all',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. ENABLE REALTIME (all synced tables)
ALTER PUBLICATION supabase_realtime ADD TABLE shuttles;
ALTER PUBLICATION supabase_realtime ADD TABLE wallets;
ALTER PUBLICATION supabase_realtime ADD TABLE users;
ALTER PUBLICATION supabase_realtime ADD TABLE dues;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE hotlist;

-- 9. HELPER: Automatic Wallet Creation Trigger
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id, balance) VALUES (NEW.id, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_user_profile_created
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- 10. ROW LEVEL SECURITY (authenticated clients + Realtime)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shuttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own"
  ON public.users FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "users_select_authenticated"
  ON public.users FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "wallets_select_authenticated"
  ON public.wallets FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "dues_select_authenticated"
  ON public.dues FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "shuttles_select_authenticated"
  ON public.shuttles FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "transactions_select_authenticated"
  ON public.transactions FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "alerts_select_authenticated"
  ON public.alerts FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "hotlist_select_authenticated"
  ON public.hotlist FOR SELECT TO authenticated
  USING (true);

-- 11. INITIAL ADMIN SETUP
-- Create admin@gmail.com in Authentication > Users with password admin123 (min 6 chars).
-- Use that user's UUID from Authentication for the id below, or run signup once and paste the id.
INSERT INTO public.users (id, name, role, reg_no, needs_password_reset)
VALUES ('0cfdebc4-14de-45eb-b20a-9c2f66e2cdc7', 'Campus Admin', 'admin', 'ADMIN', false)
ON CONFLICT (id) DO UPDATE 
SET role = 'admin', reg_no = 'ADMIN';

INSERT INTO public.wallets (user_id, balance)
VALUES ('0cfdebc4-14de-45eb-b20a-9c2f66e2cdc7', 0)
ON CONFLICT (user_id) DO NOTHING;

-- 12. REFUND STORED PROCEDURE (admin reverses a fare charge)
CREATE OR REPLACE FUNCTION public.sp_refund_transaction(
  p_tx_id TEXT,
  p_admin_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
  v_balance DECIMAL(12, 2);
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  IF v_tx.status = 'refunded' THEN
    RAISE EXCEPTION 'Transaction already refunded';
  END IF;

  UPDATE public.transactions
  SET
    status = 'refunded',
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'refunded_at', NOW(),
      'refunded_by', p_admin_id,
      'refund_reason', p_reason
    )
  WHERE id = p_tx_id;

  INSERT INTO public.wallets (user_id, balance)
  VALUES (v_tx.user_id, COALESCE(v_tx.amount, 0))
  ON CONFLICT (user_id) DO UPDATE
  SET balance = public.wallets.balance + COALESCE(v_tx.amount, 0);

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_tx.user_id;

  RETURN jsonb_build_object('tx_id', p_tx_id, 'wallet_balance', v_balance);
END;
$$;

-- 13. FAST TAP (one DB round-trip: validate card, charge fare, hotlist)
CREATE OR REPLACE FUNCTION public.sp_process_tap(
  p_card_uid TEXT,
  p_driver_id UUID,
  p_shuttle_id TEXT,
  p_route TEXT,
  p_vehicle_no TEXT,
  p_tx_id TEXT,
  p_fare DECIMAL DEFAULT 15,
  p_hotlist_ms BIGINT DEFAULT 10000,
  p_queue_id TEXT DEFAULT NULL,
  p_queued_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now BIGINT;
  v_hot_exp BIGINT;
  v_user_id UUID;
  v_user_name TEXT;
  v_user_reg TEXT;
  v_balance DECIMAL(12, 2);
  v_due_amount DECIMAL(12, 2);
  v_due_since TIMESTAMPTZ;
  v_created_at TIMESTAMPTZ := NOW();
BEGIN
  IF p_card_uid IS NULL OR trim(p_card_uid) = '' THEN
    RAISE EXCEPTION 'card_uid required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.transactions WHERE id = p_tx_id) THEN
    SELECT u.name, u.reg_no, t.created_at
    INTO v_user_name, v_user_reg, v_created_at
    FROM public.transactions t
    JOIN public.users u ON u.id = t.user_id
    WHERE t.id = p_tx_id;
    RETURN jsonb_build_object(
      'ok', true,
      'synced', true,
      'user_name', v_user_name,
      'user_reg_no', v_user_reg,
      'tap_time', v_created_at,
      'card_uid', p_card_uid
    );
  END IF;

  v_now := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  SELECT expires_at INTO v_hot_exp FROM public.hotlist WHERE card_uid = p_card_uid;
  IF v_hot_exp IS NOT NULL AND v_now < v_hot_exp THEN
    RAISE EXCEPTION 'Card is hotlisted. Please wait % seconds.',
      ceil((v_hot_exp - v_now)::numeric / 1000);
  END IF;

  SELECT id, name, reg_no INTO v_user_id, v_user_name, v_user_reg
  FROM public.users
  WHERE card_uid = p_card_uid AND role = 'student'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Card not mapped to any user';
  END IF;

  SELECT balance INTO v_balance FROM public.wallets WHERE user_id = v_user_id;
  v_balance := COALESCE(v_balance, 0);

  SELECT amount, since INTO v_due_amount, v_due_since FROM public.dues WHERE user_id = v_user_id;

  IF v_balance < p_fare THEN
    v_due_amount := COALESCE(v_due_amount, 0) + (p_fare - v_balance);
    INSERT INTO public.dues (user_id, amount, since)
    VALUES (v_user_id, v_due_amount, COALESCE(v_due_since, NOW()))
    ON CONFLICT (user_id) DO UPDATE
    SET amount = EXCLUDED.amount, since = COALESCE(public.dues.since, EXCLUDED.since);
    INSERT INTO public.wallets (user_id, balance) VALUES (v_user_id, 0)
    ON CONFLICT (user_id) DO UPDATE SET balance = 0;
  ELSE
    INSERT INTO public.wallets (user_id, balance)
    VALUES (v_user_id, v_balance - p_fare)
    ON CONFLICT (user_id) DO UPDATE SET balance = v_balance - p_fare;
  END IF;

  INSERT INTO public.transactions (id, user_id, driver_id, shuttle_id, route, amount, status, metadata, created_at)
  VALUES (
    p_tx_id,
    v_user_id,
    p_driver_id,
    p_shuttle_id,
    COALESCE(p_route, 'A'),
    p_fare,
    'success',
    jsonb_build_object(
      'card_uid', p_card_uid,
      'vehicle_no', COALESCE(p_vehicle_no, 'Vehicle'),
      'route', COALESCE(p_route, 'A'),
      'queue_id', p_queue_id,
      'queued_at', p_queued_at,
      'offline_sync', p_queue_id IS NOT NULL
    ),
    v_created_at
  );

  INSERT INTO public.hotlist (card_uid, expires_at)
  VALUES (p_card_uid, v_now + p_hotlist_ms)
  ON CONFLICT (card_uid) DO UPDATE SET expires_at = EXCLUDED.expires_at;

  RETURN jsonb_build_object(
    'ok', true,
    'user_name', v_user_name,
    'user_reg_no', v_user_reg,
    'tap_time', v_created_at,
    'card_uid', p_card_uid,
    'tx_id', p_tx_id
  );
END;
$$;
