-- MercadoPago subscriptions: create user_profiles table
create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  is_premium boolean not null default false,
  premium_until timestamptz,
  mp_subscription_id text,
  mp_plan text,         -- 'monthly' | 'weekly' | '2day'
  mp_status text,       -- 'authorized' | 'paused' | 'cancelled'
  updated_at timestamptz default now(),
  unique (user_id)
);

alter table user_profiles enable row level security;

-- Users can read their own profile
create policy "select own profile"
  on user_profiles for select
  using (auth.uid() = user_id);

-- Only service role can insert/update (done via webhook with service key)
create policy "service role write"
  on user_profiles for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
