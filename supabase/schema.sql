-- Yield Ledger cloud accounts. Run once in the Supabase SQL editor.
create table if not exists public.portfolios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.portfolios enable row level security;

-- Each person can only see and change their own portfolio.
drop policy if exists "own portfolio read" on public.portfolios;
drop policy if exists "own portfolio write" on public.portfolios;
create policy "own portfolio read" on public.portfolios for select using (auth.uid() = user_id);
create policy "own portfolio write" on public.portfolios for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
