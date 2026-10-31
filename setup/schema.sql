-- QueryHub database schema. Run once in the Supabase SQL editor
-- (Dashboard > SQL Editor > New query > paste > Run).
--
-- BEFORE RUNNING: replace you@example.com below with the email of the
-- account you will sign in with. Add more emails to the list to allow
-- more editors.

create table if not exists public.queries (
  id             text primary key,
  title          text not null check (char_length(title) between 1 and 200),
  status         text not null default 'mostly' check (status in ('works', 'mostly', 'broken')),
  tags           text[] not null default '{}',
  description    text not null default '',
  query          text not null check (char_length(query) between 1 and 20000),
  sample_results jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.queries enable row level security;

-- Who may write. Reads are open to everyone.
create or replace function public.is_editor()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'you@example.com'
  );
$$;

drop policy if exists "public read"    on public.queries;
drop policy if exists "editors insert" on public.queries;
drop policy if exists "editors update" on public.queries;
drop policy if exists "editors delete" on public.queries;

create policy "public read" on public.queries
  for select to anon, authenticated
  using (true);

create policy "editors insert" on public.queries
  for insert to authenticated
  with check (public.is_editor());

create policy "editors update" on public.queries
  for update to authenticated
  using (public.is_editor())
  with check (public.is_editor());

create policy "editors delete" on public.queries
  for delete to authenticated
  using (public.is_editor());
