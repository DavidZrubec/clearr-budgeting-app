-- ============================================
-- Clearr Budgeting — Supabase Schema
-- Phase 1: Core tables, indexes, RLS policies
-- ============================================

-- 0. Extensions
create extension if not exists "pg_net" with schema "extensions";

-- 1. User Profiles (extends auth.users)
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text,
  created_at timestamptz default now()
);
alter table public.user_profiles enable row level security;

create policy "Users can read own profile"
  on public.user_profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.user_profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.user_profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Transactions
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  merchant text,
  category text not null,
  budget_category text not null check (budget_category in ('Needs', 'Wants', 'Investments')),
  amount numeric not null,
  type text not null check (type in ('Income', 'Expense')),
  time text,
  date date not null,
  payment_source text,
  notes text,
  tags text[] default '{}',
  is_excluded boolean default false,
  is_recurring boolean default false,
  recurring_interval text check (recurring_interval in ('weekly', 'monthly', 'yearly')),
  receipt_url text,
  created_at timestamptz default now()
);
alter table public.transactions enable row level security;

create index if not exists idx_transactions_user_date
  on public.transactions(user_id, date desc);

create index if not exists idx_transactions_recurring
  on public.transactions(is_recurring)
  where is_recurring = true;

create policy "Users can read own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Users can insert own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own transactions"
  on public.transactions for update
  using (auth.uid() = user_id);

create policy "Users can delete own transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);

-- 3. User Preferences
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text default 'INR',
  dark_mode boolean default false,
  notifications boolean default true,
  bank_sync boolean default false,
  budget_targets jsonb default '{"needs": 50, "wants": 30, "investments": 20}',
  budget_tolerance numeric default 10,
  default_payment_source text,
  default_budget_category text,
  monthly_income numeric default 0,
  filter_max_amount numeric default 100000,
  hold_hint_shown boolean default false
);
alter table public.user_preferences enable row level security;

create policy "Users can read own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can upsert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);

-- 4. Onboarding
create table if not exists public.user_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed boolean default false,
  completed_at timestamptz,
  income numeric default 0,
  goals text[] default '{}',
  quiz_correct integer default 0
);
alter table public.user_onboarding enable row level security;

create policy "Users can read own onboarding"
  on public.user_onboarding for select
  using (auth.uid() = user_id);

create policy "Users can upsert own onboarding"
  on public.user_onboarding for insert
  with check (auth.uid() = user_id);

create policy "Users can update own onboarding"
  on public.user_onboarding for update
  using (auth.uid() = user_id);

-- 5. Device Tokens (push notifications)
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text default 'web',
  created_at timestamptz default now()
);
alter table public.device_tokens enable row level security;

create index if not exists idx_device_tokens_user
  on public.device_tokens(user_id);

create policy "Users can read own device tokens"
  on public.device_tokens for select
  using (auth.uid() = user_id);

create policy "Users can insert own device tokens"
  on public.device_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own device tokens"
  on public.device_tokens for delete
  using (auth.uid() = user_id);

-- 6. Storage: receipts bucket
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "Users can read own receipts"
  on storage.objects for select
  using (auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload receipts"
  on storage.objects for insert
  with check (auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own receipts"
  on storage.objects for delete
  using (auth.uid()::text = (storage.foldername(name))[1]);
