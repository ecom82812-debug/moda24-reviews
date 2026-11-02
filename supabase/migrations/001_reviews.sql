-- moda24.online — база відгуків (Supabase).
-- Схема як на madona.com.ua; відмінності для Moda24:
--   • відгук можна схвалити лише тоді, коли в нього є хоча б одне фото;
--   • відвідувачі НЕ пишуть у базу і сховище напряму — лише через функцію reviews-api (ключ на сервері);
--   • публічно видно тільки схвалені відгуки.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- нові таблиці в public одразу з увімкненим RLS
create or replace function public.rls_auto_enable()
returns event_trigger language plpgsql security definer set search_path to 'pg_catalog' as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') and object_type in ('table','partitioned table')
  loop
    if cmd.schema_name = 'public' then
      execute format('alter table if exists %s enable row level security', cmd.object_identity);
    end if;
  end loop;
end $$;
drop event trigger if exists rls_auto_enable;
create event trigger rls_auto_enable on ddl_command_end execute function public.rls_auto_enable();

-- ── таблиці ────────────────────────────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,                       -- адреса сторінки товару (…/tproduct/<uid>-…)
  product_uid text generated always as (substring(product_id from 'tproduct[-/](\d{6,})')) stored,
  product_name text,
  product_url text,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text not null,
  size_fit text check (size_fit in ('small','true','large')),
  verified boolean default false,
  approved boolean default false,
  reply_text text,
  reply_date timestamptz,
  ip_hash text,
  created_at timestamptz default now()
);

create table public.review_photos (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  url text not null,
  thumb_url text,
  orig_url text,
  created_at timestamptz default now()
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

create table public.api_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits int not null default 0
);

create table public.snapshot_dirty (
  uid text primary key,
  at timestamptz not null default now()
);

alter table public.reviews enable row level security;
alter table public.review_photos enable row level security;
alter table public.admin_users enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.snapshot_dirty enable row level security;

create index idx_reviews_product on public.reviews (product_id, approved, created_at desc);
create index idx_reviews_approved_date on public.reviews (approved, created_at desc);
create index idx_reviews_uid_pub on public.reviews (product_uid, created_at desc) where approved;
create index idx_reviews_pub_created on public.reviews (created_at desc) where approved;
create index idx_photos_review on public.review_photos (review_id);

-- ── функції ────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.admin_users where user_id = (select auth.uid()));
$$;

create or replace function public.api_hit(p_key text, p_limit int, p_window_seconds int) returns boolean
language plpgsql set search_path to '' as $$
declare v_hits int;
begin
  insert into public.api_rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end $$;

create or replace function public.api_catalog_ratings() returns table(uid text, avg numeric, cnt bigint)
language sql stable set search_path to '' as $$
  select product_uid, round(avg(rating)::numeric, 2), count(*)
  from public.reviews where approved and product_uid is not null group by product_uid;
$$;

create or replace function public.api_stats(p_uid text default null) returns json
language sql stable set search_path to '' as $$
  select json_build_object(
    'avg', coalesce(round(avg(rating)::numeric, 1), 0),
    'count', count(*),
    'dist', json_build_array(
      count(*) filter (where rating = 5), count(*) filter (where rating = 4), count(*) filter (where rating = 3),
      count(*) filter (where rating = 2), count(*) filter (where rating = 1)),
    'fit', json_build_object(
      'small', count(*) filter (where size_fit = 'small'),
      'true',  count(*) filter (where size_fit = 'true'),
      'large', count(*) filter (where size_fit = 'large')))
  from public.reviews where approved and (p_uid is null or product_uid = p_uid);
$$;

-- Moda24: відгук без фото схвалити не можна
create or replace function public.reviews_require_photo() returns trigger
language plpgsql set search_path to '' as $$
begin
  if new.approved and not coalesce(old.approved, false)
     and not exists (select 1 from public.review_photos p where p.review_id = new.id) then
    raise exception 'Відгук без фото не можна опублікувати' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger reviews_require_photo before insert or update of approved on public.reviews
  for each row execute function public.reviews_require_photo();

-- ── «знімок»: готові JSON-файли для сайту ─────────────────
create or replace function public.snapshot_mark_many(p_uids text[]) returns void
language sql security definer set search_path to '' as $$
  insert into public.snapshot_dirty(uid) select unnest(p_uids) on conflict (uid) do update set at = now();
$$;

create or replace function public.snapshot_claim() returns text[]
language sql security definer set search_path to '' as $$
  with d as (delete from public.snapshot_dirty where true returning uid) select coalesce(array_agg(uid), '{}') from d;
$$;

create or replace function public.snapshot_trg_reviews() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if tg_op in ('INSERT','UPDATE') and new.approved and new.product_uid is not null then
    insert into public.snapshot_dirty(uid) values (new.product_uid) on conflict (uid) do update set at = now();
  end if;
  if tg_op in ('UPDATE','DELETE') and old.approved and old.product_uid is not null then
    insert into public.snapshot_dirty(uid) values (old.product_uid) on conflict (uid) do update set at = now();
  end if;
  return null;
end $$;

create or replace function public.snapshot_trg_photos() returns trigger
language plpgsql security definer set search_path to '' as $$
declare v_uid text;
begin
  select r.product_uid into v_uid from public.reviews r where r.id = coalesce(new.review_id, old.review_id) and r.approved;
  if v_uid is not null then
    insert into public.snapshot_dirty(uid) values (v_uid) on conflict (uid) do update set at = now();
  end if;
  return null;
end $$;

create trigger snapshot_reviews after insert or update or delete on public.reviews
  for each row execute function public.snapshot_trg_reviews();
create trigger snapshot_photos after insert or update or delete on public.review_photos
  for each row execute function public.snapshot_trg_photos();

create or replace function public.snapshot_check_key(p_key text) returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce(length(p_key) > 20 and p_key = (select decrypted_secret from vault.decrypted_secrets where name = 'snap_key'), false);
$$;

create or replace function public.snapshot_kick(p_force boolean default false, p_full boolean default false) returns void
language plpgsql security definer set search_path to '' as $$
declare v_key text;
begin
  if not p_force and not exists (select 1 from public.snapshot_dirty) then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'snap_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://lvyssuomgbccjmksetof.supabase.co/functions/v1/reviews-snapshot',
    headers := jsonb_build_object('Content-Type','application/json','x-snap-key', v_key),
    body := jsonb_build_object('full', p_full),
    timeout_milliseconds := 60000);
end $$;

-- службові функції — не для відвідувачів
revoke execute on function public.snapshot_mark_many(text[]), public.snapshot_claim(), public.snapshot_kick(boolean, boolean),
  public.snapshot_check_key(text), public.api_hit(text, int, int) from public, anon, authenticated;

-- ── доступ (RLS) ───────────────────────────────────────────
create policy admin_self_read on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

create policy public_select_reviews on public.reviews for select to anon, authenticated using (approved);
create policy admin_all_reviews on public.reviews for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy public_select_photos on public.review_photos for select to anon, authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.approved));
create policy admin_all_photos on public.review_photos for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── сховище ────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('review-photos', 'review-photos', true, 8388608, array['image/webp','image/jpeg','image/png']),
  ('review-cache',  'review-cache',  true, 5242880, array['application/json'])
on conflict (id) do nothing;

create policy admin_storage_all on storage.objects for all to authenticated
  using (bucket_id = 'review-photos' and (select public.is_admin()))
  with check (bucket_id = 'review-photos' and (select public.is_admin()));

-- ── розклад ────────────────────────────────────────────────
select cron.schedule('reviews-snapshot-changes',    '* * * * *',  $$select public.snapshot_kick(false, false)$$);
select cron.schedule('reviews-snapshot-hourly',     '17 * * * *', $$select public.snapshot_kick(true, false)$$);
select cron.schedule('reviews-snapshot-daily-full', '40 1 * * *', $$select public.snapshot_kick(true, true)$$);
select cron.schedule('cleanup-net-responses', '5 3 * * *', $$delete from net._http_response where created < now() - interval '2 days'$$);
select cron.schedule('cleanup-cron-history',  '7 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
select cron.schedule('cleanup-rate-limits',   '9 3 * * *', $$delete from public.api_rate_limits where window_start < now() - interval '2 days'$$);
