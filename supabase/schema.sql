-- Reset existing tables so we can create the unified user model
DROP TABLE IF EXISTS public.dan_audit CASCADE;
DROP TABLE IF EXISTS public.dan_events CASCADE;
DROP TABLE IF EXISTS public.dan_keys CASCADE;
DROP TABLE IF EXISTS public.sales CASCADE;
DROP TABLE IF EXISTS public.stock_items CASCADE;
DROP TABLE IF EXISTS public.batches CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE public.users (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    username text UNIQUE NOT NULL,
    email text UNIQUE NOT NULL,
    password_hash text NOT NULL,
    display_name text NOT NULL,
    contact_email text,
    is_shop boolean NOT NULL DEFAULT false,
    is_customer boolean NOT NULL DEFAULT false,
    is_driver boolean NOT NULL DEFAULT false,
    is_supplier boolean NOT NULL DEFAULT false,
    qdrant_user_id uuid NOT NULL DEFAULT uuid_generate_v4(),
    shop_qdrant_id uuid,
    qdrant_namespace text,
    customer_qdrant_id uuid,
    driver_qdrant_id uuid,
    supplier_qdrant_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_username_idx ON public.users(username);
CREATE INDEX users_role_flags_idx ON public.users(is_shop, is_customer, is_driver, is_supplier);

CREATE TABLE public.products (
    id text PRIMARY KEY,
    name text NOT NULL,
    manufacturer text,
    category text,
    quantity_type text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.batches (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    supplier text NOT NULL,
    delivery_date date NOT NULL,
    inventory_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Note: stock_items table is kept for legacy compatibility only
-- Qdrant 'items' collection is the single source of truth for inventory
CREATE TABLE public.stock_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    product_id text REFERENCES public.products(id),
    batch_id bigint REFERENCES public.batches(id) ON DELETE CASCADE,
    expiration_date date,
    quantity integer NOT NULL,
    cost_per_unit numeric(10,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_items_shop_product_idx ON public.stock_items(shop_user_id, product_id);

-- Note: sales table is kept for legacy compatibility only
-- Qdrant 'sales' collection is the single source of truth for sales transactions
CREATE TABLE public.sales (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    timestamp timestamptz NOT NULL,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    total_amount numeric(12,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sales_shop_idx ON public.sales(shop_user_id, timestamp);

CREATE TABLE public.dan_keys (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    shop_id text NOT NULL,
    namespace text,
    public_key text NOT NULL,
    fingerprint text NOT NULL,
    capability_scope text[] NOT NULL DEFAULT ARRAY['local'],
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX dan_keys_shop_idx ON public.dan_keys(shop_id);

CREATE TABLE public.dan_events (
    event_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id text NOT NULL,
    namespace text,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    share_scope text[] NOT NULL DEFAULT ARRAY['local'],
    vector_context double precision[],
    proofs jsonb,
    actor_fingerprint text,
    actor_public_key text,
    actor_signature text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dan_events_type_idx ON public.dan_events(event_type, created_at);
CREATE INDEX dan_events_shop_idx ON public.dan_events(shop_id, created_at);

CREATE TABLE public.dan_audit (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id uuid REFERENCES public.dan_events(event_id) ON DELETE CASCADE,
    shop_id text NOT NULL,
    action text NOT NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.dan_policies (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id text NOT NULL,
    name text NOT NULL,
    description text,
    event_type text NOT NULL,
    scope text NOT NULL,
    version text NOT NULL DEFAULT '1.0',
    config jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    author text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dan_policies_shop_idx ON public.dan_policies(shop_id);

CREATE TABLE public.dan_policy_runs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    policy_id uuid REFERENCES public.dan_policies(id) ON DELETE CASCADE,
    shop_id text NOT NULL,
    event_type text NOT NULL,
    event_payload jsonb,
    outcome text NOT NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dan_policy_runs_shop_idx ON public.dan_policy_runs(shop_id, created_at);

-- Note: All data (products, batches, items/inventory, suppliers) is stored in Qdrant
-- Supabase is only used for user authentication and role management

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dan_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dan_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dan_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dan_policy_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='public_users_select'
  ) THEN
    CREATE POLICY public_users_select ON public.users FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='users' AND policyname='public_users_insert'
  ) THEN
    CREATE POLICY public_users_insert ON public.users FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='batches' AND policyname='public_batches_select'
  ) THEN
    CREATE POLICY public_batches_select ON public.batches FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='batches' AND policyname='public_batches_insert'
  ) THEN
    CREATE POLICY public_batches_insert ON public.batches FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_items' AND policyname='public_stock_items_select'
  ) THEN
    CREATE POLICY public_stock_items_select ON public.stock_items FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stock_items' AND policyname='public_stock_items_insert'
  ) THEN
    CREATE POLICY public_stock_items_insert ON public.stock_items FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales' AND policyname='public_sales_select'
  ) THEN
    CREATE POLICY public_sales_select ON public.sales FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sales' AND policyname='public_sales_insert'
  ) THEN
    CREATE POLICY public_sales_insert ON public.sales FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_keys' AND policyname='public_dan_keys_select'
  ) THEN
    CREATE POLICY public_dan_keys_select ON public.dan_keys FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_keys' AND policyname='public_dan_keys_insert'
  ) THEN
    CREATE POLICY public_dan_keys_insert ON public.dan_keys FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_events' AND policyname='public_dan_events_select'
  ) THEN
    CREATE POLICY public_dan_events_select ON public.dan_events FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_events' AND policyname='public_dan_events_insert'
  ) THEN
    CREATE POLICY public_dan_events_insert ON public.dan_events FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_audit' AND policyname='public_dan_audit_select'
  ) THEN
    CREATE POLICY public_dan_audit_select ON public.dan_audit FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_audit' AND policyname='public_dan_audit_insert'
  ) THEN
    CREATE POLICY public_dan_audit_insert ON public.dan_audit FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_policies' AND policyname='public_dan_policies_select'
  ) THEN
    CREATE POLICY public_dan_policies_select ON public.dan_policies FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_policies' AND policyname='public_dan_policies_insert'
  ) THEN
    CREATE POLICY public_dan_policies_insert ON public.dan_policies FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_policy_runs' AND policyname='public_dan_policy_runs_select'
  ) THEN
    CREATE POLICY public_dan_policy_runs_select ON public.dan_policy_runs FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dan_policy_runs' AND policyname='public_dan_policy_runs_insert'
  ) THEN
    CREATE POLICY public_dan_policy_runs_insert ON public.dan_policy_runs FOR INSERT WITH CHECK (true);
  END IF;
END
$$;
