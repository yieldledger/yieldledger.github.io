-- Yield Ledger cloud accounts. Run once in the Supabase SQL editor.
create table if not exists public.portfolios (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.portfolios enable row level security;
-- Needed when "Automatically expose new tables" is off: signed-in users may reach this table (policies below still limit them to their own row).
grant select, insert, update, delete on public.portfolios to authenticated;

-- Each person can only see and change their own portfolio.
drop policy if exists "own portfolio read" on public.portfolios;
drop policy if exists "own portfolio write" on public.portfolios;
create policy "own portfolio read" on public.portfolios for select using (auth.uid() = user_id);
create policy "own portfolio write" on public.portfolios for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Lets a signed-in person delete their own login (their portfolio row is removed with it).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
