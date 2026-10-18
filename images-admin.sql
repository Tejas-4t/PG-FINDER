-- Apply once, after listing-approval.sql. No records are deleted.
begin;
alter table public.pg_listing_requests add column photo_paths text[] not null default '{}';
alter table public.pgs add column photo_paths text[] not null default '{}', add column deleted_at timestamptz;
alter table public.pg_listing_requests drop constraint pg_listing_requests_photo_urls_check;
create or replace function private.valid_pg_photo_urls(urls text[]) returns boolean
language sql immutable set search_path='' as $$
select urls is not null and cardinality(urls) between 0 and 3 and not exists(select 1 from unnest(urls) u where u is null or length(u)>2048 or u !~ '^https://[^[:space:]]+$' or u ~ '^https://[^/]*@');
$$;
create function private.valid_pg_photo_paths(paths text[]) returns boolean
language sql immutable set search_path='' as $$
select paths is not null and cardinality(paths)<=3 and not exists(select 1 from unnest(paths) p where p is null or p !~ '^[0-9a-f-]{36}/[1-3]\.webp$') and cardinality(paths)=(select count(distinct p) from unnest(paths) p);
$$;
revoke all on function private.valid_pg_photo_paths(text[]) from public;
grant execute on function private.valid_pg_photo_paths(text[]) to anon,authenticated;
alter table public.pg_listing_requests add constraint request_photos_v2 check(private.valid_pg_photo_urls(photo_urls) and private.valid_pg_photo_paths(photo_paths) and cardinality(photo_urls)+cardinality(photo_paths) between 1 and 3 and photo_paths <@ array[id::text||'/1.webp',id::text||'/2.webp',id::text||'/3.webp']) not valid;
alter table public.pg_listing_requests validate constraint request_photos_v2;
grant insert(photo_paths) on public.pg_listing_requests to anon,authenticated;
create function private.pg_is_admin() returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.pg_admins where user_id=auth.uid());
$$;
revoke all on function private.pg_is_admin() from public;
grant execute on function private.pg_is_admin() to anon,authenticated;
create policy "Admins read all PGs" on public.pgs for select to authenticated using(private.pg_is_admin());
-- Restrictive policy also covers any pre-existing owner/public SELECT policy.
create policy "Deleted PGs are admin only" on public.pgs as restrictive for select to anon,authenticated using(deleted_at is null or private.pg_is_admin());
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pg-listing-images','pg-listing-images',false,5242880,array['image/webp']);
create function private.pg_image_upload_allowed(path text) returns boolean
language sql stable security definer set search_path='' as $$
select path ~ '^[0-9a-f-]{36}/[1-3]\.webp$' and (private.pg_is_admin() or exists(
select 1 from public.pg_listing_requests r where path=any(r.photo_paths) and r.status='pending' and r.created_at>now()-interval '24 hours'));
$$;
create function private.pg_image_read_allowed(path text) returns boolean
language sql stable security definer set search_path='' as $$
select private.pg_is_admin() or exists(select 1 from public.pgs p where p.is_published and p.deleted_at is null and path=any(p.photo_paths));
$$;
revoke all on function private.pg_image_upload_allowed(text),private.pg_image_read_allowed(text) from public;
grant execute on function private.pg_image_upload_allowed(text),private.pg_image_read_allowed(text) to anon,authenticated;
create policy "Upload reserved PG image slots" on storage.objects for insert to anon,authenticated with check(bucket_id='pg-listing-images' and private.pg_image_upload_allowed(name));
create policy "Read approved PG images or admin previews" on storage.objects for select to anon,authenticated using(bucket_id='pg-listing-images' and private.pg_image_read_allowed(name));
-- No UPDATE or DELETE policy: public uploads cannot overwrite approved images.
create function private.pg_images_exist(paths text[]) returns boolean language sql stable security definer set search_path='' as $$
select not exists(select 1 from unnest(paths) p where not exists(select 1 from storage.objects o where o.bucket_id='pg-listing-images' and o.name=p));
$$;
revoke all on function private.pg_images_exist(text[]) from public,anon,authenticated;
create or replace function private.review_pg_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not private.pg_is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if new.status=old.status then return old; end if;
 if old.status<>'pending' or new.status not in('approved','rejected') then raise exception 'This request has already been reviewed'; end if;
 new.reviewed_by:=auth.uid(); new.reviewed_at:=now();
 if new.status='approved' then
  if not private.pg_images_exist(new.photo_paths) then raise exception 'Photo upload is incomplete. Do not approve yet.'; end if;
  insert into public.pgs(owner_id,name,description,address,area,city,contact_phone,monthly_rent,sharing_type,total_beds,available_beds,facilities,photo_urls,photo_paths,is_published,is_verified)
  values(auth.uid(),new.name,new.description,new.address,new.area,new.city,new.contact_phone,new.monthly_rent,new.sharing_type,new.total_beds,new.available_beds,new.facilities,new.photo_urls,new.photo_paths,true,false) returning id into new.published_pg_id;
 end if;
 return new;
end; $$;
create function public.admin_save_pg(pg_id uuid, expected_updated_at timestamptz, details jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare urls text[]; paths text[]; facility_list text[]; p public.pgs;
begin
 if not private.pg_is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into p from public.pgs where id=pg_id for update;
 if not found or p.updated_at is distinct from expected_updated_at then raise exception 'Listing changed. Refresh and reopen it.'; end if;
 if p.deleted_at is not null then raise exception 'Restore this listing before editing.'; end if;
 urls:=array(select jsonb_array_elements_text(details->'photo_urls')); paths:=array(select jsonb_array_elements_text(details->'photo_paths'));
 facility_list:=array(select jsonb_array_elements_text(details->'facilities'));
 if not private.valid_pg_photo_urls(urls) or not private.valid_pg_photo_paths(paths) or cardinality(urls)+cardinality(paths) not between 1 and 3 or not private.pg_images_exist(paths) then raise exception 'Use 1–3 valid, fully uploaded images.'; end if;
 if length(btrim(details->>'name')) not between 2 and 100 or length(btrim(details->>'address')) not between 5 and 500 or length(btrim(details->>'area')) not between 2 and 100 or length(btrim(details->>'city')) not between 2 and 100 or (details->>'total_beds')::int not between 1 and 10000 or (details->>'monthly_rent')::numeric>1000000 or length(details->>'description')>2000 then raise exception 'Check property details and limits.'; end if;
 update public.pgs set name=btrim(details->>'name'),description=details->>'description',address=btrim(details->>'address'),area=btrim(details->>'area'),city=btrim(details->>'city'),contact_phone=btrim(details->>'contact_phone'),monthly_rent=(details->>'monthly_rent')::numeric,sharing_type=details->>'sharing_type',total_beds=(details->>'total_beds')::int,available_beds=(details->>'available_beds')::int,facilities=facility_list,photo_urls=urls,photo_paths=paths,is_published=(details->>'is_published')::boolean where id=pg_id;
end; $$;
create function public.admin_trash_pg(pg_id uuid, expected_updated_at timestamptz, restore boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare p public.pgs;
begin
 if not private.pg_is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 select * into p from public.pgs where id=pg_id for update;
 if not found or p.updated_at is distinct from expected_updated_at then raise exception 'Listing changed. Refresh and retry.'; end if;
 -- Restore as unpublished; admin deliberately republishes from Edit.
 update public.pgs set deleted_at=case when restore then null else now() end,is_published=false where id=pg_id;
end; $$;
revoke all on function public.admin_save_pg(uuid,timestamptz,jsonb),public.admin_trash_pg(uuid,timestamptz,boolean) from public,anon;
grant execute on function public.admin_save_pg(uuid,timestamptz,jsonb),public.admin_trash_pg(uuid,timestamptz,boolean) to authenticated;
commit;
