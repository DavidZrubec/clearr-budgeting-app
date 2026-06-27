-- Rate limiting table
create table if not exists public.rate_limit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  action text not null,
  attempted_at timestamptz default now()
);

create index if not exists idx_rate_limit_user_action
  on public.rate_limit_log(user_id, action, attempted_at);

alter table public.rate_limit_log enable row level security;

-- Cleanup old entries (older than 24 hours)
create or replace function public.cleanup_rate_limits()
returns void as $$
begin
  delete from public.rate_limit_log
  where attempted_at < now() - interval '24 hours';
end;
$$ language plpgsql security definer;
