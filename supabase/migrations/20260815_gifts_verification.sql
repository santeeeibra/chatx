-- =============================================
-- Fase B: Regalos virtuales + Perfiles verificados
-- =============================================

-- Balances de monedas por fingerprint
create table if not exists user_balances (
  fingerprint   text primary key,
  coins         integer not null default 100,
  updated_at    timestamptz default now()
);

alter table user_balances enable row level security;
create policy "anon_select_balance" on user_balances for select using (true);
create policy "anon_insert_balance" on user_balances for insert with check (true);
create policy "anon_update_balance" on user_balances for update using (true);

-- Log de regalos enviados
create table if not exists gift_transactions (
  id               uuid primary key default gen_random_uuid(),
  from_fingerprint text not null,
  to_fingerprint   text not null,
  gift_id          text not null,
  coins_spent      integer not null,
  created_at       timestamptz default now()
);

alter table gift_transactions enable row level security;
create policy "anon_insert_gift" on gift_transactions for insert with check (true);
create policy "anon_select_gift" on gift_transactions for select using (true);

-- Log de compras de créditos (para webhook CCBill futuro)
create table if not exists credit_purchases (
  id          uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  coins       integer not null,
  amount_usd  numeric(10,2),
  payment_ref text,
  created_at  timestamptz default now()
);

alter table credit_purchases enable row level security;
create policy "anon_insert_purchase" on credit_purchases for insert with check (true);
create policy "anon_select_purchase" on credit_purchases for select using (true);

-- Columna verified en user_profiles (si no existe)
alter table user_profiles add column if not exists verified boolean default false;

-- Solicitudes de verificación
create table if not exists verification_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  fingerprint text,
  status      text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz default now()
);

alter table verification_requests enable row level security;
create policy "users_insert_verification" on verification_requests
  for insert with check (auth.uid() = user_id);
create policy "users_select_verification" on verification_requests
  for select using (auth.uid() = user_id);
