-- Isaac Ranking: esquema base
-- appid 250900 (The Binding of Isaac: Rebirth + DLCs)

-- pg_cron y pg_net NO se crean aca: en Supabase se habilitan desde
-- Database > Extensions en el dashboard. Solo hacen falta para el cron (0002).

-- ---------------------------------------------------------------------------
-- Catalogo de logros. bit_index se asigna una sola vez y NUNCA se reasigna,
-- porque es la posicion dentro del bitmask de cada jugador.
-- ---------------------------------------------------------------------------
create table if not exists achievements (
  apiname     text primary key,
  bit_index   int  not null unique,
  name        text not null,
  description text,
  icon        text,
  global_pct  numeric(6,3) not null default 100,
  -- peso de rareza: log10(100/pct). 84.5% -> 0.073 ; 2.4% -> 1.62
  weight      numeric(10,6) generated always as (log(100.0 / greatest(global_pct, 0.001))) stored,
  updated_at  timestamptz not null default now()
);

create index if not exists achievements_bit_idx on achievements (bit_index);

-- ---------------------------------------------------------------------------
-- Jugadores
-- ---------------------------------------------------------------------------
create table if not exists players (
  steamid64       text primary key,
  custom_url      text,
  display_name    text,
  avatar          text,
  unlocked        bit varying not null,          -- 1 bit por logro, indexado por bit_index
  unlocked_count  int not null default 0,        -- lo calcula el trigger
  rarity_score    numeric(12,4) not null default 0, -- lo calcula el trigger
  first_unlock_at timestamptz,
  last_unlock_at  timestamptz,                   -- si esta completo, es la fecha de Dead God
  is_complete     boolean not null default false,   -- 641/641 en Steam
  dead_god        boolean not null default false,   -- el logro Dead God del juego (apiname 637)
  dead_god_at     timestamptz,
  private         boolean not null default false,
  last_sync       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- El orden del ranking, tal cual: cantidad primero, rareza como desempate.
-- Los completos empatan en ambas (tienen exactamente los mismos logros) asi que
-- caen todos en rank 1 solos, y adentro se ordenan por quien lo hizo primero.
create index if not exists players_rank_idx
  on players (unlocked_count desc, rarity_score desc, last_unlock_at asc);

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
create or replace function compute_rarity(mask bit varying) returns numeric
language sql stable as $$
  select coalesce(sum(a.weight), 0)
  from achievements a
  where a.bit_index < length(mask) and get_bit(mask, a.bit_index) = 1;
$$;

create or replace function compute_count(mask bit varying) returns int
language sql stable as $$
  select count(*)::int
  from achievements a
  where a.bit_index < length(mask) and get_bit(mask, a.bit_index) = 1;
$$;

-- Dead God (apiname 637, lo tiene el 3,4%) es el logro que da el juego al completar
-- todas las marcas. NO es lo mismo que 641/641 en Steam: entre los 641 hay logros
-- que no son de completado, como Win Online Daily (2,4%), que pide ganar una daily
-- online. Se puede ser Dead God sin tener los 641.
create or replace function players_derive() returns trigger
language plpgsql as $$
declare total int; dg int;
begin
  select count(*) into total from achievements;
  select bit_index into dg from achievements where apiname = '637';

  new.unlocked_count := compute_count(new.unlocked);
  new.rarity_score   := compute_rarity(new.unlocked);
  new.is_complete    := (total > 0 and new.unlocked_count = total);
  new.dead_god       := (dg is not null and dg < length(new.unlocked) and get_bit(new.unlocked, dg) = 1);
  if not new.dead_god then new.dead_god_at := null; end if;
  return new;
end;
$$;

drop trigger if exists players_derive_trg on players;
create trigger players_derive_trg
  before insert or update of unlocked on players
  for each row execute function players_derive();

-- Recalcula todos los scores. Se corre despues de refrescar los % globales,
-- porque el peso de cada logro cambia cuando cambia su rareza.
-- El where no es decorativo: Supabase tiene pg_safeupdate activado y rechaza
-- cualquier UPDATE sin clausula WHERE.
create or replace function rescore_all() returns void
language sql as $$
  update players set unlocked = unlocked where steamid64 is not null;
$$;

-- ---------------------------------------------------------------------------
-- Vista publica del ranking
-- ---------------------------------------------------------------------------
create or replace view leaderboard
with (security_invoker = on) as
select
  rank() over (order by p.unlocked_count desc, p.rarity_score desc) as rank,
  p.steamid64,
  p.custom_url,
  p.display_name,
  p.avatar,
  p.unlocked_count,
  p.rarity_score,
  p.is_complete,
  p.dead_god,
  p.dead_god_at,
  p.first_unlock_at,
  p.last_unlock_at,
  p.last_sync,
  (select count(*) from achievements) as total_achievements
from players p
where not p.private
order by p.unlocked_count desc, p.rarity_score desc, p.last_unlock_at asc nulls last;

-- ---------------------------------------------------------------------------
-- Rate limit por IP (sin login: la IP hasheada es todo lo que tenemos)
-- ---------------------------------------------------------------------------
create table if not exists submissions (
  id         bigserial primary key,
  ip_hash    text not null,
  input      text not null,
  ok         boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists submissions_ip_idx on submissions (ip_hash, created_at desc);

create or replace function submissions_today(p_ip text) returns int
language sql stable as $$
  select count(*)::int from submissions
  where ip_hash = p_ip and created_at > now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- RLS: lectura publica, escritura solo con service_role (edge functions)
-- ---------------------------------------------------------------------------
alter table players       enable row level security;
alter table achievements  enable row level security;
alter table submissions   enable row level security;

drop policy if exists players_read on players;
create policy players_read on players for select to anon, authenticated using (true);

drop policy if exists achievements_read on achievements;
create policy achievements_read on achievements for select to anon, authenticated using (true);

-- submissions no tiene policy de lectura a proposito: nadie ve las IPs.

grant select on players, achievements to anon, authenticated;
grant select on leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers para los jobs
-- ---------------------------------------------------------------------------

-- Aplica los % globales de una sola pasada. Como weight es una columna generada,
-- se recalcula sola; despues hay que correr rescore_all() para los jugadores.
create or replace function apply_global_pcts(p jsonb) returns int
language plpgsql as $$
declare n int;
begin
  update achievements a
     set global_pct = (v->>'pct')::numeric,
         updated_at = now()
    from jsonb_array_elements(p) v
   where a.apiname = v->>'apiname';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A quien le toca refrescar: el top se actualiza a diario, el resto una vez por
-- semana, y los que estan al 100% no se tocan nunca mas.
create or replace function players_to_sync(p_limit int default 20)
returns setof text language sql stable as $$
  with ranked as (
    select steamid64, last_sync,
           row_number() over (order by unlocked_count desc, rarity_score desc) as rn
    from players
    where not is_complete and not private
  )
  select steamid64 from ranked
  where last_sync < now() - (case when rn <= 50 then interval '1 day' else interval '7 days' end)
  order by rn
  limit p_limit;
$$;

-- Numeros para el header del sitio
create or replace view site_stats
with (security_invoker = on) as
select
  (select count(*) from players where not private)              as jugadores,
  (select count(*) from players where dead_god)                 as dead_gods,
  (select count(*) from players where is_complete)              as completos,
  (select count(*) from achievements)                           as total_achievements,
  (select max(last_sync) from players)                          as ultima_sync;

grant select on site_stats to anon, authenticated;

-- ---------------------------------------------------------------------------
-- PostgREST expone toda funcion del schema public como endpoint RPC. Estas no
-- son para el navegador: rescore_all() reescribe la tabla entera y apply_global_pcts()
-- pisa los porcentajes. Solo las corren las edge functions con service_role.
-- ---------------------------------------------------------------------------
revoke execute on function
  apply_global_pcts(jsonb), rescore_all(), players_to_sync(int),
  submissions_today(text), compute_rarity(bit varying), compute_count(bit varying)
from public, anon, authenticated;

grant execute on function
  apply_global_pcts(jsonb), rescore_all(), players_to_sync(int),
  submissions_today(text), compute_rarity(bit varying), compute_count(bit varying)
to service_role;
