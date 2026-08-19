-- Prime Radiant — initial schema
-- Everything is written server-side with the service key. RLS is enabled with
-- zero policies, so the anon role has no direct access to any table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- jobs ----
create table public.jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  ip_hash       text not null,
  status        text not null default 'awaiting_upload'
                check (status in ('awaiting_upload','uploaded','inspected','running','done','error')),
  filename      text not null,
  storage_path  text not null,
  size_bytes    bigint not null default 0,
  n_rows        integer,
  n_cols        integer,
  col_meta      jsonb,
  target        text,
  task_type     text,
  n_context     integer,
  n_predicted   integer,
  result_path   text,
  result_bytes  bigint not null default 0,
  duration_ms   integer,
  error         text,
  -- null while the file still occupies storage; set once both the source and
  -- the result have been removed. Drives the global storage guard.
  cleaned_at    timestamptz
);

create index jobs_ip_hash_created_at_idx on public.jobs (ip_hash, created_at desc);
create index jobs_cleaned_at_idx         on public.jobs (cleaned_at) where cleaned_at is null;
create index jobs_created_at_idx         on public.jobs (created_at desc);

-- --------------------------------------------------------------- ideas ----
create table public.ideas (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  ip_hash          text not null,
  what_to_predict  text not null check (char_length(btrim(what_to_predict)) between 3 and 500),
  what_for         text not null check (char_length(btrim(what_for))        between 3 and 500),
  vote_count       integer not null default 0,
  hidden           boolean not null default false
);

create index ideas_ranking_idx on public.ideas (vote_count desc, created_at desc) where hidden = false;
create index ideas_recent_idx  on public.ideas (created_at desc)                  where hidden = false;
create index ideas_ip_hash_idx on public.ideas (ip_hash, created_at desc);

create table public.idea_votes (
  idea_id    uuid not null references public.ideas(id) on delete cascade,
  ip_hash    text not null,
  created_at timestamptz not null default now(),
  primary key (idea_id, ip_hash)
);

-- vote_count is denormalised so the board can sort without a join.
create or replace function public.sync_vote_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.ideas set vote_count = vote_count + 1 where id = new.idea_id;
  elsif tg_op = 'DELETE' then
    update public.ideas set vote_count = greatest(vote_count - 1, 0) where id = old.idea_id;
  end if;
  return null;
end $$;

create trigger idea_votes_sync
  after insert or delete on public.idea_votes
  for each row execute function public.sync_vote_count();

-- ----------------------------------------------------------- storage ------
-- Bytes currently occupied by job artefacts. Read before issuing an upload URL.
create or replace function public.live_storage_bytes() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(size_bytes + result_bytes), 0)::bigint
  from public.jobs where cleaned_at is null;
$$;

-- ---------------------------------------------------------------- rls -----
alter table public.jobs       enable row level security;
alter table public.ideas      enable row level security;
alter table public.idea_votes enable row level security;
-- No policies by design: only the service role (which bypasses RLS) may read
-- or write. The anon key is never used against these tables.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 10485760,
        array['text/csv','application/vnd.apache.parquet','application/octet-stream'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
