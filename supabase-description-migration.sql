-- Run once in the Supabase SQL Editor.
-- Safe to run more than once.
alter table public.properties
  add column if not exists description text;
