-- QueryHub database schema (v2: accounts, ownership, votes, comments).
-- Safe to run on a fresh project AND on top of the v1 schema: it only adds.
-- Run in the Supabase SQL editor (Dashboard > SQL Editor > New query).
--
-- BEFORE RUNNING, replace the two placeholders:
--   CHANGE-ME-INVITE-CODE   the invite code people must enter to sign up
--   you@example.com         the email of your own (admin) account

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

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

alter table public.queries
  add column if not exists owner_id uuid references public.profiles (id) on delete set null default auth.uid();

create table if not exists public.query_votes (
  query_id   text not null references public.queries (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  vote       text not null check (vote in ('works', 'broken')),
  updated_at timestamptz not null default now(),
  primary key (query_id, user_id)
);

create table if not exists public.query_comments (
  id         uuid primary key default gen_random_uuid(),
  query_id   text not null references public.queries (id) on delete cascade,
  user_id    uuid references public.profiles (id) on delete set null,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

-- Private settings. RLS on, no policies: unreadable through the API.
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------
-- Invite code (stored as a bcrypt hash) and admin account
-- ---------------------------------------------------------------------

insert into public.app_config (key, value)
values ('invite_code_hash', extensions.crypt('qhInvite2026kql', extensions.gen_salt('bf')))
on conflict (key) do update set value = excluded.value;

-- Give accounts that already exist (created from the dashboard) a profile.
insert into public.profiles (id, username)
select u.id, regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict do nothing;

update public.profiles
set is_admin = true
where id in (select id from auth.users where email = 'you@example.com');

-- Queries that predate ownership belong to the admin.
update public.queries
set owner_id = (select id from auth.users where email = 'you@example.com')
where owner_id is null;

-- ---------------------------------------------------------------------
-- Sign-up trigger: enforces the invite code and creates the profile.
-- Runs for every new auth user, so the check cannot be skipped by calling
-- the auth API directly.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uname  text := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  code   text := coalesce(new.raw_user_meta_data ->> 'invite_code', '');
  stored text;
begin
  select value into stored from public.app_config where key = 'invite_code_hash';
  if stored is null or code = '' or extensions.crypt(code, stored) <> stored then
    raise exception 'invalid invite code';
  end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid username';
  end if;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Keep updated_at honest on votes.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists query_votes_touch on public.query_votes;
create trigger query_votes_touch
  before update on public.query_votes
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------

alter table public.profiles       enable row level security;
alter table public.queries        enable row level security;
alter table public.query_votes    enable row level security;
alter table public.query_comments enable row level security;
alter table public.app_config     enable row level security;

-- Remove v1 policies and function.
drop policy if exists "public read"    on public.queries;
drop policy if exists "editors insert" on public.queries;
drop policy if exists "editors update" on public.queries;
drop policy if exists "editors delete" on public.queries;
drop function if exists public.is_editor();

-- Re-creatable v2 policies.
drop policy if exists "profiles read"    on public.profiles;
drop policy if exists "queries read"     on public.queries;
drop policy if exists "queries insert"   on public.queries;
drop policy if exists "queries update"   on public.queries;
drop policy if exists "queries delete"   on public.queries;
drop policy if exists "votes read"       on public.query_votes;
drop policy if exists "votes insert"     on public.query_votes;
drop policy if exists "votes update"     on public.query_votes;
drop policy if exists "votes delete"     on public.query_votes;
drop policy if exists "comments read"    on public.query_comments;
drop policy if exists "comments insert"  on public.query_comments;
drop policy if exists "comments delete"  on public.query_comments;

-- Everyone can read usernames, queries, votes, and comments.
create policy "profiles read" on public.profiles
  for select to anon, authenticated using (true);

create policy "queries read" on public.queries
  for select to anon, authenticated using (true);

create policy "votes read" on public.query_votes
  for select to anon, authenticated using (true);

create policy "comments read" on public.query_comments
  for select to anon, authenticated using (true);

-- Queries: anyone signed in can add; only the owner or an admin can change or remove.
create policy "queries insert" on public.queries
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "queries update" on public.queries
  for update to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

create policy "queries delete" on public.queries
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- Votes: one per user per query, and only your own.
create policy "votes insert" on public.query_votes
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "votes update" on public.query_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "votes delete" on public.query_votes
  for delete to authenticated
  using (user_id = auth.uid());

-- Comments: post as yourself; delete your own, or anything if admin.
create policy "comments insert" on public.query_comments
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "comments delete" on public.query_comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());
