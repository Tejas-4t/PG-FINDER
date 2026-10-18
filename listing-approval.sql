begin;
create schema if not exists private;

create table public.pg_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.pg_admins enable row level security;
revoke all on public.pg_admins from public, anon, authenticated;
grant select on public.pg_admins to authenticated;
create policy "Admins can see their own membership" on public.pg_admins
  for select to authenticated using (user_id = (select auth.uid()));

create function private.valid_pg_photo_urls(urls text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(urls) between 1 and 8 and not exists (
    select 1 from unnest(urls) u where u is null or length(u) > 2048
      or u !~ '^https://[^[:space:]]+$'
  );
$$;
revoke all on function private.valid_pg_photo_urls(text[]) from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.valid_pg_photo_urls(text[]) to anon, authenticated;

alter table public.pgs add column photo_urls text[] not null default '{}';
create table public.pg_listing_requests (
  id uuid primary key,
  requester_name text not null check (char_length(btrim(requester_name)) between 2 and 100),
  requester_email text not null check (char_length(requester_email) <= 254 and requester_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  address text not null check (char_length(btrim(address)) between 5 and 500),
  area text not null default 'Karvenagar' check (char_length(btrim(area)) between 2 and 100),
  city text not null default 'Pune' check (char_length(btrim(city)) between 2 and 100),
  contact_phone text not null check (contact_phone ~ '^\+?[0-9 ]{10,15}$'),
  monthly_rent numeric not null check (monthly_rent > 0 and monthly_rent <= 1000000),
  sharing_type text not null check (sharing_type in ('single','double','triple')),
  total_beds integer not null check (total_beds between 1 and 10000),
  available_beds integer not null check (available_beds between 0 and total_beds),
  facilities text[] not null default '{}' check (facilities <@ array['wifi','food','laundry','parking','ac','cctv']::text[] and cardinality(facilities) <= 6),
  description text not null default '' check (char_length(description) <= 2000),
  photo_urls text[] not null check (private.valid_pg_photo_urls(photo_urls)),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_notes text not null default '' check (char_length(review_notes) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  published_pg_id uuid unique references public.pgs(id)
);
create index pg_listing_requests_status_created_idx on public.pg_listing_requests(status, created_at desc);
alter table public.pg_listing_requests enable row level security;
revoke all on public.pg_listing_requests from public, anon, authenticated;
grant insert (id,requester_name,requester_email,name,address,area,city,contact_phone,monthly_rent,sharing_type,total_beds,available_beds,facilities,description,photo_urls) on public.pg_listing_requests to anon, authenticated;
grant select on public.pg_listing_requests to authenticated;
grant update (status,review_notes) on public.pg_listing_requests to authenticated;
create policy "Visitors submit pending requests" on public.pg_listing_requests for insert to anon, authenticated
  with check (status='pending' and reviewed_at is null and reviewed_by is null and published_pg_id is null and review_notes='');
create policy "Admins read requests" on public.pg_listing_requests for select to authenticated
  using (exists (select 1 from public.pg_admins where user_id=(select auth.uid())));
create policy "Admins review requests" on public.pg_listing_requests for update to authenticated
  using (exists (select 1 from public.pg_admins where user_id=(select auth.uid())))
  with check (exists (select 1 from public.pg_admins where user_id=(select auth.uid())));

-- All publication goes through the guarded trigger, including for legacy owner accounts.
revoke insert, update, delete, truncate, references, trigger on public.pgs, public.pg_photos from anon, authenticated;

create function private.review_pg_listing() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.pg_admins where user_id=auth.uid()) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if new.status = old.status then return old; end if;
  if old.status <> 'pending' or new.status not in ('approved','rejected') then
    raise exception 'This request has already been reviewed';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  if new.status='approved' then
    insert into public.pgs(owner_id,name,description,address,area,city,contact_phone,monthly_rent,sharing_type,total_beds,available_beds,facilities,photo_urls,is_published,is_verified)
    values(auth.uid(),new.name,new.description,new.address,new.area,new.city,new.contact_phone,new.monthly_rent,new.sharing_type,new.total_beds,new.available_beds,new.facilities,new.photo_urls,true,false)
    returning id into new.published_pg_id;
  end if;
  return new;
end;
$$;
revoke all on function private.review_pg_listing() from public, anon, authenticated;
create trigger review_pg_listing before update on public.pg_listing_requests for each row execute function private.review_pg_listing();
commit;
