-- Apply once after images-admin.sql. Keeps legacy room totals and existing data.
begin;
alter table public.pgs add column room_options jsonb;
alter table public.pg_listing_requests add column room_options jsonb;
create function private.valid_pg_rooms(rooms jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare room jsonb; seen text[] := '{}'; total integer := 0; t integer; a integer;
begin
 if rooms is null or jsonb_typeof(rooms)<>'array' then return false; end if;
 if jsonb_array_length(rooms) not between 1 and 3 then return false; end if;
 for room in select value from jsonb_array_elements(rooms) loop
  if jsonb_typeof(room)<>'object' then return false;end if;
  if not (room ?& array['type','total_beds','available_beds']) or (room - array['type','total_beds','available_beds'])<>'{}'::jsonb then return false;end if;
  if jsonb_typeof(room->'type')<>'string' or room->>'type' not in ('single','double','triple') or room->>'type'=any(seen) then return false;end if;
  if jsonb_typeof(room->'total_beds')<>'number' or jsonb_typeof(room->'available_beds')<>'number' or room->>'total_beds' !~ '^[0-9]{1,5}$' or room->>'available_beds' !~ '^[0-9]{1,5}$' then return false;end if;
  t:=(room->>'total_beds')::int; a:=(room->>'available_beds')::int;
  if t not between 1 and 10000 or a not between 0 and t then return false;end if;
  total:=total+t; seen:=array_append(seen,room->>'type');
 end loop;
 return total<=10000;
end; $$;
revoke all on function private.valid_pg_rooms(jsonb) from public;
grant execute on function private.valid_pg_rooms(jsonb) to anon,authenticated;
create function private.normalize_pg_rooms() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.room_options is null then
  new.room_options:=jsonb_build_array(jsonb_build_object('type',new.sharing_type,'total_beds',new.total_beds,'available_beds',new.available_beds));
 end if;
 if not private.valid_pg_rooms(new.room_options) then raise exception 'Select valid sharing types with total and available beds for each.' using errcode='23514';end if;
 new.sharing_type:=new.room_options->0->>'type';
 select sum((value->>'total_beds')::int),sum((value->>'available_beds')::int) into new.total_beds,new.available_beds from jsonb_array_elements(new.room_options);
 return new;
end; $$;
revoke all on function private.normalize_pg_rooms() from public,anon,authenticated;
-- Null on historical rows intentionally falls back to the legacy single type.
-- First edit/review normalizes it without rewriting private request history.
alter table public.pgs add constraint pgs_room_options_valid check(room_options is null or private.valid_pg_rooms(room_options));
alter table public.pg_listing_requests add constraint requests_room_options_valid check(room_options is null or private.valid_pg_rooms(room_options));
create trigger a_normalize_pg_rooms before insert or update on public.pgs for each row execute function private.normalize_pg_rooms();
create trigger a_normalize_pg_rooms before insert or update on public.pg_listing_requests for each row execute function private.normalize_pg_rooms();
grant insert(room_options) on public.pg_listing_requests to anon,authenticated;

create or replace function private.valid_pg_photo_urls(urls text[]) returns boolean
language sql immutable set search_path='' as $$
select urls is not null and cardinality(urls) between 0 and 5 and not exists(select 1 from unnest(urls) u where u is null or length(u)>2048 or u !~ '^https://[^[:space:]]+$' or u ~ '^https://[^/]*@');
$$;
create or replace function private.valid_pg_photo_paths(paths text[]) returns boolean
language sql immutable set search_path='' as $$
select paths is not null and cardinality(paths)<=5 and not exists(select 1 from unnest(paths) p where p is null or p !~ '^[0-9a-f-]{36}/[1-5]\.webp$') and cardinality(paths)=(select count(distinct p) from unnest(paths) p);
$$;
alter table public.pg_listing_requests drop constraint request_photos_v2;
alter table public.pg_listing_requests add constraint request_photos_v3 check(private.valid_pg_photo_urls(photo_urls) and private.valid_pg_photo_paths(photo_paths) and cardinality(photo_urls)+cardinality(photo_paths) between 1 and 5 and photo_paths <@ array[id::text||'/1.webp',id::text||'/2.webp',id::text||'/3.webp',id::text||'/4.webp',id::text||'/5.webp']);
create or replace function private.pg_image_upload_allowed(path text) returns boolean
language sql stable security definer set search_path='' as $$
select path ~ '^[0-9a-f-]{36}/[1-5]\.webp$' and (private.pg_is_admin() or exists(select 1 from public.pg_listing_requests r where path=any(r.photo_paths) and r.status='pending' and r.created_at>now()-interval '24 hours'));
$$;
create or replace function private.review_pg_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not private.pg_is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if new.status=old.status then return old; end if;
 if old.status<>'pending' or new.status not in('approved','rejected') then raise exception 'This request has already been reviewed'; end if;
 new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
 if new.status='approved' then
  if not private.pg_images_exist(new.photo_paths) then raise exception 'Photo upload is incomplete. Do not approve yet.'; end if;
  insert into public.pgs(owner_id,name,description,address,area,city,contact_phone,monthly_rent,sharing_type,room_options,total_beds,available_beds,facilities,photo_urls,photo_paths,is_published,is_verified)
  values(auth.uid(),new.name,new.description,new.address,new.area,new.city,new.contact_phone,new.monthly_rent,new.sharing_type,new.room_options,new.total_beds,new.available_beds,new.facilities,new.photo_urls,new.photo_paths,true,false) returning id into new.published_pg_id;
 end if;
 return new;
end; $$;
create or replace function public.admin_save_pg(pg_id uuid, expected_updated_at timestamptz, details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare urls text[]; paths text[]; facility_list text[]; p public.pgs; rooms jsonb;
begin
 if not private.pg_is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into p from public.pgs where id=pg_id for update;
 if not found or p.updated_at is distinct from expected_updated_at then raise exception 'Listing changed. Refresh and reopen it.'; end if;
 if p.deleted_at is not null then raise exception 'Restore this listing before editing.'; end if;
 rooms:=coalesce(details->'room_options',p.room_options,jsonb_build_array(jsonb_build_object('type',details->>'sharing_type','total_beds',(details->>'total_beds')::int,'available_beds',(details->>'available_beds')::int)));
 if not private.valid_pg_rooms(rooms) then raise exception 'Check total and available beds for every selected sharing type.';end if;
 urls:=array(select jsonb_array_elements_text(details->'photo_urls')); paths:=array(select jsonb_array_elements_text(details->'photo_paths'));
 facility_list:=array(select jsonb_array_elements_text(details->'facilities'));
 if not private.valid_pg_photo_urls(urls) or not private.valid_pg_photo_paths(paths) or cardinality(urls)+cardinality(paths) not between 1 and 5 or not private.pg_images_exist(paths) then raise exception 'Use 1–5 valid, fully uploaded images.'; end if;
 if length(btrim(details->>'name')) not between 2 and 100 or length(btrim(details->>'address')) not between 5 and 500 or length(btrim(details->>'area')) not between 2 and 100 or length(btrim(details->>'city')) not between 2 and 100 or (details->>'total_beds')::int not between 1 and 10000 or (details->>'monthly_rent')::numeric>1000000 or length(details->>'description')>2000 then raise exception 'Check property details and limits.'; end if;
 update public.pgs set name=btrim(details->>'name'),description=details->>'description',address=btrim(details->>'address'),area=btrim(details->>'area'),city=btrim(details->>'city'),contact_phone=btrim(details->>'contact_phone'),monthly_rent=(details->>'monthly_rent')::numeric,room_options=rooms,sharing_type=rooms->0->>'type',total_beds=(details->>'total_beds')::int,available_beds=(details->>'available_beds')::int,facilities=facility_list,photo_urls=urls,photo_paths=paths,is_published=(details->>'is_published')::boolean where id=pg_id;
end; $$;
commit;
