create table if not exists public.receba_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null default 'usuario' check (role in ('usuario', 'admin')),
  access_area text not null default 'operacional' check (access_area in ('operacional', 'financeiro', 'ambos')),
  active boolean not null default true,
  permissions jsonb not null default '{
    "kpis": true,
    "cadastro": true,
    "financeiro": false,
    "atualizar_bi": false,
    "usuarios": false
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.receba_profiles enable row level security;

revoke all on public.receba_profiles from anon, authenticated;
grant all on public.receba_profiles to service_role;

create or replace function public.set_receba_profiles_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_receba_profiles_updated_at on public.receba_profiles;
create trigger set_receba_profiles_updated_at
before update on public.receba_profiles
for each row execute function public.set_receba_profiles_updated_at();
