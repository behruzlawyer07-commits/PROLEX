-- PROLEX — Supabase PostgreSQL ma'lumotlar bazasi jadval skripti
-- Supabase Dashboard -> SQL Editor -> New query bo'limiga qo'yib Run tugmasini bosing.

create extension if not exists pgcrypto;

-- 1. Foydalanuvchilar jadvali (Asosiy administrator Prolex@admin va admin yaratgan foydalanuvchilar)
create table if not exists public.app_users (
  id text primary key,
  username text not null,
  password text not null,
  role text not null check (role in ('admin', 'user')) default 'user',
  full_name text not null,
  status text not null check (status in ('active', 'blocked')) default 'active',
  created_at timestamptz not null default now()
);

create unique index if not exists idx_app_users_username_lower
  on public.app_users (lower(btrim(username)));

-- 2. Qurilmalararo doimiy chatlar tarixi jadvali
create table if not exists public.chat_history (
  id text primary key,
  username text not null,
  title text not null default 'Yangi huquqiy tahlil',
  messages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_history_username_updated
  on public.chat_history (lower(btrim(username)), updated_at desc);

-- 3. Administrator yuklagan 50 MB gacha PDF huquqiy manbalar (ixtiyoriy, qurilmalararo sinxron)
create table if not exists public.prolex_documents (
  id text primary key,
  title text not null,
  category text not null,
  note text not null default '',
  original_file_name text not null,
  size_bytes bigint not null default 0,
  page_count integer not null default 0,
  extracted_chars integer not null default 0,
  indexed boolean not null default true,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_prolex_documents_created_at
  on public.prolex_documents (created_at desc);

create table if not exists public.prolex_doc_pages (
  doc_id text primary key references public.prolex_documents(id) on delete cascade,
  pages jsonb not null default '[]'::jsonb
);

-- @supabase/supabase-js (VITE_SUPABASE_ANON_KEY) orqali barcha qurilmalardan ishlashi uchun RLS ochiq qoidalar:
alter table public.app_users enable row level security;
alter table public.chat_history enable row level security;
alter table public.prolex_documents enable row level security;
alter table public.prolex_doc_pages enable row level security;

drop policy if exists "prolex_app_users_all" on public.app_users;
create policy "prolex_app_users_all"
  on public.app_users for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "prolex_chat_history_all" on public.chat_history;
create policy "prolex_chat_history_all"
  on public.chat_history for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "prolex_documents_all" on public.prolex_documents;
create policy "prolex_documents_all"
  on public.prolex_documents for all to anon, authenticated
  using (true) with check (true);

drop policy if exists "prolex_doc_pages_all" on public.prolex_doc_pages;
create policy "prolex_doc_pages_all"
  on public.prolex_doc_pages for all to anon, authenticated
  using (true) with check (true);
