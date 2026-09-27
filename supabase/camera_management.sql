create table if not exists public.cameras (
  camera_id text primary key,
  name text not null,
  track_name text not null,
  publisher_id text not null,
  enabled boolean not null default false,
  online boolean not null default false,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.cameras enable row level security;

revoke all on table public.cameras from anon, authenticated;

comment on table public.cameras is
  'Server-managed registry for Windows webcam LiveKit publications.';
