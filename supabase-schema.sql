-- ============================================================================
-- SOS Felnijavítás — Supabase séma (1. lépés: fogadó oldal + ajánlatkérés)
-- ----------------------------------------------------------------------------
-- A meglévő foglaló-projektbe (kmndjlwcjrnfnxeukzaq) fut, ÜTKÖZÉSMENTESEN:
-- minden objektum neve sos_felni_ / sos-felni- előtagot visel, a foglaló
-- meglévő tábláihoz, függvényeihez és szabályaihoz NEM nyúl.
-- Többször is lefuttatható (idempotens).
--
-- Lefuttatás: Supabase Dashboard -> SQL Editor -> New query -> beillesztés -> Run.
-- ============================================================================

-- 1) Lead-tábla ---------------------------------------------------------------
create table if not exists public.sos_felni_leads (
  id                    uuid primary key default gen_random_uuid(),
  share_token           uuid not null unique default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  allapot               text not null default 'uj'
                        check (allapot in ('uj','kapcsolatfelvetel','ajanlat_kuldve','elfogadva','folyamatban','kesz','elutasitva')),
  forras                text not null default 'foto' check (forras in ('foto','kalkulator')),
  nev                   text,
  telefon               text,
  email                 text,
  felni_meret           text,
  darabszam             integer check (darabszam is null or (darabszam between 1 and 20)),
  munka_tipus           text,
  gumiszereles          boolean not null default false,
  szelep_tipus          text,
  becsult_osszeg_szoveg text,
  vegleges_ar           integer,
  fotok                 text[] not null default '{}',
  staff_megjegyzes      text
);

create index if not exists sos_felni_leads_created_idx on public.sos_felni_leads (created_at desc);
create index if not exists sos_felni_leads_allapot_idx on public.sos_felni_leads (allapot);

create or replace function public.sos_felni_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists sos_felni_leads_touch on public.sos_felni_leads;
create trigger sos_felni_leads_touch before update on public.sos_felni_leads
  for each row execute function public.sos_felni_touch_updated_at();

-- 2) Jogosultságok (RLS) --------------------------------------------------------
alter table public.sos_felni_leads enable row level security;

-- Névtelen látogató csak BESZÚRHAT, olvasni/módosítani nem tud. A beszúráskor
-- a státusz mindig 'uj', a pultos mezők üresek.
drop policy if exists sos_felni_leads_anon_insert on public.sos_felni_leads;
create policy sos_felni_leads_anon_insert on public.sos_felni_leads
  for insert to anon
  with check (
    allapot = 'uj'
    and vegleges_ar is null
    and staff_megjegyzes is null
    and nev is not null and length(nev) between 1 and 120
    and telefon is not null and length(telefon) between 6 and 40
  );

-- Bejelentkezett pultos teljes hozzáférést kap.
-- FIGYELEM: a "authenticated" szerep MINDEN bejelentkezett felhasználót jelent
-- ebben a projektben. Ha a foglaló-projektben a pultoson kívül más felhasználó
-- (pl. partneri belépés) is létezik, szűkítsd ezt a feltételt.
drop policy if exists sos_felni_leads_staff_all on public.sos_felni_leads;
create policy sos_felni_leads_staff_all on public.sos_felni_leads
  for all to authenticated using (true) with check (true);

grant insert on public.sos_felni_leads to anon;
grant select, insert, update on public.sos_felni_leads to authenticated;

-- 3) Ügyfél saját nézete: csak a saját tokenjével, csak a nem belső mezők -----
create or replace function public.get_sos_felni_lead_by_token(p_token uuid)
returns table (
  id uuid, created_at timestamptz, allapot text, forras text, nev text,
  felni_meret text, darabszam integer, munka_tipus text, gumiszereles boolean,
  szelep_tipus text, becsult_osszeg_szoveg text, vegleges_ar integer
)
language sql security definer set search_path = public as $$
  select l.id, l.created_at, l.allapot, l.forras, l.nev, l.felni_meret,
         l.darabszam, l.munka_tipus, l.gumiszereles, l.szelep_tipus,
         l.becsult_osszeg_szoveg, l.vegleges_ar
  from public.sos_felni_leads l
  where l.share_token = p_token
  limit 1;
$$;
revoke all on function public.get_sos_felni_lead_by_token(uuid) from public;
grant execute on function public.get_sos_felni_lead_by_token(uuid) to anon, authenticated;

-- 4) Fotók tárolása (privát bucket) -----------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sos-felni-fotok', 'sos-felni-fotok', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

drop policy if exists sos_felni_fotok_anon_upload on storage.objects;
create policy sos_felni_fotok_anon_upload on storage.objects
  for insert to anon
  with check (bucket_id = 'sos-felni-fotok');

drop policy if exists sos_felni_fotok_staff_read on storage.objects;
create policy sos_felni_fotok_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'sos-felni-fotok');

-- 5) Ellenőrzés ---------------------------------------------------------------------
select
  (select count(*) from information_schema.tables where table_schema='public' and table_name='sos_felni_leads') as tabla,
  (select count(*) from pg_policies where tablename='sos_felni_leads') as szabalyok,
  (select count(*) from storage.buckets where id='sos-felni-fotok') as bucket;
-- Elvárt: tabla = 1, szabalyok = 2, bucket = 1
