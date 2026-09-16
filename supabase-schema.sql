-- =====================================================================
-- NEWS SRI LANKA 24 — Supabase Schema Setup
-- මෙය ධාවනය කරන්න: Supabase Dashboard -> SQL Editor -> New query -> Run
-- (සියල්ල idempotent නිසා මෙම script එක ඕනෑම වාරයකදී නැවතත් run කළ හැක)
-- =====================================================================

-- 1) profiles (admin authorization)
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- signup වූ විට profile row එක auto-create
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) news table
create table if not exists public.news (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  short_description text default '',
  content           text default '',
  image_url         text default '',
  category          text default 'general',
  language          text default 'si',
  author            text default 'News Sri Lanka 24',
  published_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  status            text not null default 'draft',
  is_breaking       boolean not null default false,
  is_featured       boolean not null default false,
  source            text not null default 'manual',
  slug              text
);

-- updated_at auto update
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists news_set_updated_at on public.news;
create trigger news_set_updated_at
  before update on public.news
  for each row execute function public.set_updated_at();

-- 3) Row Level Security
alter table public.profiles enable row level security;
alter table public.news enable row level security;

-- current user admin ද? (RLS policies සඳහා)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

-- profiles policies: user ට own row read; admin ට all read
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- news policies:
--   Public: published පමණක් read (RLS දත්ත අතෘප්තියෙන් filter කරයි)
--   Admin : all CRUD
drop policy if exists "news_public_read" on public.news;
create policy "news_public_read" on public.news
  for select using (status = 'published' or public.is_admin());

drop policy if exists "news_admin_insert" on public.news;
create policy "news_admin_insert" on public.news
  for insert with check (public.is_admin());

drop policy if exists "news_admin_update" on public.news;
create policy "news_admin_update" on public.news
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "news_admin_delete" on public.news;
create policy "news_admin_delete" on public.news
  for delete using (public.is_admin());

-- 4) Storage: news images (public bucket)
insert into storage.buckets (id, name, public)
values ('news', 'news', true)
on conflict (id) do nothing;

-- public read
drop policy if exists "news_images_public_read" on storage.objects;
create policy "news_images_public_read" on storage.objects
  for select using (bucket_id = 'news');

-- admin upload / delete
drop policy if exists "news_images_admin_insert" on storage.objects;
create policy "news_images_admin_insert" on storage.objects
  for insert with check (bucket_id = 'news' and public.is_admin());

drop policy if exists "news_images_admin_delete" on storage.objects;
create policy "news_images_admin_delete" on storage.objects
  for delete using (bucket_id = 'news' and public.is_admin());

-- =====================================================================
-- පළමු admin mark කිරීමට (auth.users හි ඇති email එකක්):
--
--   update public.profiles p
--   set is_admin = true
--   from auth.users u
--   where p.id = u.id
--     and u.email = 'admin@newssrilanka24.com.lk';
--
-- (අළුත් user ලව signup වූ විට trigger එකෙන් profile auto-create වේ;
--  දැනටමත් login වී ඇත්නම් logout/login කරන්න)
-- =====================================================================