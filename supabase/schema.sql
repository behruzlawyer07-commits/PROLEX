-- PROLEX — Supabase Postgres ma'lumotlar bazasi jadval skripti
-- Supabase Dashboard -> SQL Editor -> New query bo'limiga qo'yib Run tugmasini bosing.

create extension if not exists pgcrypto;

-- 1. Foydalanuvchilar (Asosiy administrator va admin yaratgan xodim/tinglovchilar)
create table if not exists public.prolex_users (
  id text primary key,
  name text not null,
  login text not null,
  login_lower text generated always as (lower(btrim(login))) stored,
  role text not null check (role in ('admin', 'user')) default 'user',
  status text not null check (status in ('active', 'blocked')) default 'active',
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_prolex_users_login_lower
  on public.prolex_users (login_lower);

-- 2. Qurilmalararo va brauzer yangilanganda saqlanadigan sessiyalar
create table if not exists public.prolex_sessions (
  token_hash text primary key,
  user_id text not null references public.prolex_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists idx_prolex_sessions_user_id
  on public.prolex_sessions (user_id);

-- 3. Foydalanuvchilarning shaxsiy yozishmalar tarixi
create table if not exists public.prolex_chats (
  id text primary key,
  user_id text not null references public.prolex_users(id) on delete cascade,
  title text not null default 'Yangi huquqiy tahlil',
  messages jsonb not null default '[]'::jsonb,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prolex_chats_user_updated
  on public.prolex_chats (user_id, updated_at desc);

-- 4. Administrator yuklagan huquqiy PDF manbalar metama'lumotlari
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

-- 5. Yuklangan PDF hujjatlarning ajratib olingan sahifa matnlari
create table if not exists public.prolex_doc_pages (
  doc_id text primary key references public.prolex_documents(id) on delete cascade,
  pages jsonb not null default '[]'::jsonb
);

-- Xavfsizlik: RLS yoqiladi (barcha so'rovlar faqat Vercel serverless API orqali SERVICE_ROLE_KEY bilan bajariladi)
alter table public.prolex_users enable row level security;
alter table public.prolex_sessions enable row level security;
alter table public.prolex_chats enable row level security;
alter table public.prolex_documents enable row level security;
alter table public.prolex_doc_pages enable row level security;
