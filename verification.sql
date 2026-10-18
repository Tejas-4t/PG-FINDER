-- Disposable transaction: every fixture is rolled back.
begin;
set local role anon;
insert into public.pg_listing_requests(id,requester_name,requester_email,name,address,area,city,contact_phone,monthly_rent,sharing_type,total_beds,available_beds,facilities,description,photo_urls,photo_paths)
values('df396822-5b25-4410-a591-60e57773a978','Test Owner','test@example.com','Image verification fixture','Test property address','Karvenagar','Pune','0000000000',5000,'single',2,1,'{}','Test only','{}',array['df396822-5b25-4410-a591-60e57773a978/1.webp','df396822-5b25-4410-a591-60e57773a978/2.webp','df396822-5b25-4410-a591-60e57773a978/3.webp']);
do $$ begin
 if not private.pg_image_upload_allowed('df396822-5b25-4410-a591-60e57773a978/1.webp') then raise exception 'Reserved upload denied'; end if;
 if private.pg_image_upload_allowed('df396822-5b25-4410-a591-60e57773a978/6.webp') or private.pg_image_upload_allowed('df396822-5b25-4410-a591-60e57773a977/1.webp') then raise exception 'Unreserved slot allowed'; end if;
 if private.pg_image_read_allowed('df396822-5b25-4410-a591-60e57773a978/1.webp') then raise exception 'Pending image leaked'; end if;
 begin perform 1 from public.pg_listing_requests; raise exception 'Anonymous request read allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_trash_pg('df396822-5b25-4410-a591-60e57773a978',now(),false); raise exception 'Anonymous admin RPC allowed'; exception when insufficient_privilege then null; end;
 begin insert into storage.objects(bucket_id,name) values('pg-listing-images','df396822-5b25-4410-a591-60e57773a978/6.webp'); raise exception 'Sixth image allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
do $$ begin
 if exists(select 1 from public.pg_listing_requests where id='df396822-5b25-4410-a591-60e57773a978') then raise exception 'Nonadmin private read allowed';end if;
 begin perform public.admin_trash_pg('df396822-5b25-4410-a591-60e57773a978',now(),false); raise exception 'Nonadmin admin RPC allowed'; exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','7b06efbf-eb96-4473-a9b1-b8ead0c73d2d',true);
do $$ begin
 begin update public.pg_listing_requests set status='approved' where id='df396822-5b25-4410-a591-60e57773a978'; raise exception 'Incomplete upload approved'; exception when raise_exception then if sqlerrm <> 'Photo upload is incomplete. Do not approve yet.' then raise;end if;end;
end $$;
-- Metadata fixtures exist only within this rollback transaction; no real files are created.
reset role;
insert into storage.objects(bucket_id,name) select 'pg-listing-images','df396822-5b25-4410-a591-60e57773a978/'||n||'.webp' from generate_series(1,3) n;
set local role authenticated;
update public.pg_listing_requests set status='approved' where id='df396822-5b25-4410-a591-60e57773a978';
do $$ declare p public.pgs; begin
 select * into p from public.pgs where id=(select published_pg_id from public.pg_listing_requests where id='df396822-5b25-4410-a591-60e57773a978');
 if not p.is_published or cardinality(p.photo_paths)<>3 then raise exception 'Approval failed';end if;
 perform public.admin_save_pg(p.id,p.updated_at,to_jsonb(p)||jsonb_build_object('name','Edited verification fixture'));
 select * into p from public.pgs where id=p.id;
 if p.name<>'Edited verification fixture' then raise exception 'Edit failed';end if;
 perform public.admin_trash_pg(p.id,p.updated_at,false);
 select * into p from public.pgs where id=p.id;
 if p.deleted_at is null or p.is_published then raise exception 'Trash failed';end if;
 perform public.admin_trash_pg(p.id,p.updated_at,true);
 select * into p from public.pgs where id=p.id;
 if p.deleted_at is not null or p.is_published then raise exception 'Restore must be unpublished';end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 if exists(select 1 from public.pgs where name='Edited verification fixture') then raise exception 'Unpublished record visible';end if;
 if private.pg_image_read_allowed('df396822-5b25-4410-a591-60e57773a978/1.webp') then raise exception 'Unpublished photo readable';end if;
end $$;
reset role;
select 'PASS: reserved slots, maximum five, private requests/photos, nonadmin denial, incomplete approval protection, approve, edit, trash, restore' as verification;
rollback;
