-- ============================================================
-- LOCUM CHECK-IN — SCHEMA
-- ============================================================

-- Workers (locums)
create table if not exists workers (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid references auth.users(id) on delete cascade not null unique,
  name            text not null,
  email           text not null,
  phone           text,
  created_at      timestamptz not null default now()
);

alter table workers enable row level security;
create policy "workers read own"   on workers for select to authenticated using (auth.uid() = auth_user_id);
create policy "workers insert own" on workers for insert to authenticated with check (auth.uid() = auth_user_id);
create policy "workers update own" on workers for update to authenticated using (auth.uid() = auth_user_id);
-- agency can read all workers
create policy "all read workers"   on workers for select to authenticated using (true);

-- Sites (hospitals, care homes, GP practices)
create table if not exists sites (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  type                text not null check (type in ('hospital', 'care_home', 'gp_practice')),
  address             text,
  lat                 double precision not null,
  lon                 double precision not null,
  -- stored as array of polygons: [ [[lat,lon],...], [[lat,lon],...] ]
  -- supports multi-polygon sites (e.g. UHCW has two building footprints)
  polygons            jsonb,
  geofence_radius_m   integer not null default 300,
  use_polygon         boolean not null default false,
  nhs_ods_code        text,
  osm_way_id          bigint,
  created_at          timestamptz not null default now()
);

alter table sites enable row level security;
create policy "all read sites" on sites for select to authenticated using (true);

-- Shifts (scheduled assignments)
create table if not exists shifts (
  id              uuid primary key default gen_random_uuid(),
  worker_id       uuid references workers(id) on delete cascade not null,
  site_id         uuid references sites(id) on delete cascade not null,
  ward            text,
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz not null,
  status          text not null default 'upcoming'
                    check (status in ('upcoming', 'active', 'complete', 'no_show')),
  created_at      timestamptz not null default now()
);

alter table shifts enable row level security;
create policy "workers read own shifts" on shifts for select to authenticated using (
  worker_id = (select id from workers where auth_user_id = auth.uid())
);
create policy "all read shifts" on shifts for select to authenticated using (true);
create policy "all insert shifts" on shifts for insert to authenticated with check (true);
create policy "all update shifts" on shifts for update to authenticated using (true);

-- Check-ins (one row per shift worked; holds both clock-in and clock-out)
create table if not exists check_ins (
  id                      uuid primary key default gen_random_uuid(),
  shift_id                uuid references shifts(id) on delete cascade not null,
  worker_id               uuid references workers(id) on delete cascade not null,
  site_id                 uuid references sites(id) on delete cascade not null,
  clocked_in_at           timestamptz,
  clocked_out_at          timestamptz,
  clock_in_lat            double precision,
  clock_in_lon            double precision,
  clock_in_distance_m     double precision,
  clock_in_geofence_passed boolean,
  clock_out_lat           double precision,
  clock_out_lon           double precision,
  clock_out_distance_m    double precision,
  duration_minutes        integer,
  created_at              timestamptz not null default now()
);

alter table check_ins enable row level security;
create policy "workers read own check_ins" on check_ins for select to authenticated using (
  worker_id = (select id from workers where auth_user_id = auth.uid())
);
create policy "workers insert own check_ins" on check_ins for insert to authenticated with check (
  worker_id = (select id from workers where auth_user_id = auth.uid())
);
create policy "workers update own check_ins" on check_ins for update to authenticated using (
  worker_id = (select id from workers where auth_user_id = auth.uid())
);
create policy "all read check_ins" on check_ins for select to authenticated using (true);
