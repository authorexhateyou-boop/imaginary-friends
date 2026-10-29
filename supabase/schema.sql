-- Kravitas — Supabase schema.
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  credits integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.friends (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  note text default '',
  photos jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  image text not null,
  price text default '',
  link text default '',
  benefits text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tool text not null,
  status text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists jobs_user_created on public.jobs (user_id, created_at desc);
create index if not exists jobs_running on public.jobs (status) where status = 'running';

create table if not exists public.ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now(),
  what text not null,
  credits integer not null,
  job text
);
create index if not exists ledger_user_at on public.ledger (user_id, at desc);

create table if not exists public.payments (
  session_id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  credits integer not null,
  amount integer not null,
  currency text not null,
  created_at timestamptz not null default now()
);

-- Monthly plan + Stripe customer (for the billing portal).
alter table public.profiles add column if not exists plan text;
alter table public.profiles add column if not exists stripe_customer text;

-- Cloned voices (MiniMax custom voice ids).
create table if not exists public.voices (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  voice_id text not null,
  sample_url text,
  preview_url text,
  created_at timestamptz not null default now()
);

-- Scheduled / published social posts.
create table if not exists public.posts (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

-- Only the server (service role) touches these tables. RLS on + no policies = no browser access.
alter table public.profiles enable row level security;
alter table public.friends enable row level security;
alter table public.products enable row level security;
alter table public.jobs enable row level security;
alter table public.ledger enable row level security;
alter table public.payments enable row level security;
alter table public.voices enable row level security;
alter table public.posts enable row level security;

-- Create the profile on first visit and grant welcome credits exactly once.
create or replace function public.ensure_profile(p_user uuid, p_free integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into profiles (id, credits) values (p_user, p_free)
  on conflict (id) do nothing
  returning credits into v;
  if v is not null then
    if p_free <> 0 then
      insert into ledger (user_id, what, credits) values (p_user, 'Welcome credits', p_free);
    end if;
    return v;
  end if;
  select credits into v from profiles where id = p_user;
  return v;
end $$;

-- Atomic credit change + ledger entry. Raises INSUFFICIENT_CREDITS unless p_allow_negative.
create or replace function public.adjust_credits(p_user uuid, p_delta integer, p_what text, p_job text, p_allow_negative boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  update profiles set credits = credits + p_delta
  where id = p_user and (p_allow_negative or credits + p_delta >= 0)
  returning credits into v;
  if v is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;
  insert into ledger (user_id, what, credits, job) values (p_user, p_what, p_delta, p_job);
  return v;
end $$;

revoke execute on function public.ensure_profile(uuid, integer) from public, anon, authenticated;
revoke execute on function public.adjust_credits(uuid, integer, text, text, boolean) from public, anon, authenticated;
grant execute on function public.ensure_profile(uuid, integer) to service_role;
grant execute on function public.adjust_credits(uuid, integer, text, text, boolean) to service_role;

-- Public bucket for generated media (URLs are unguessable; fal.ai fetches inputs from here).
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;
