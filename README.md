# PG Finder — Karvenagar

PG Finder helps students compare paying guest accommodation in Karvenagar, Pune. Owners submit property details and photos for review. Approved listings appear on the home page. Administrators can review requests, view and edit listings, publish or unpublish them, and move listings to recoverable Trash.

- Website: https://pg-finder-lovat.vercel.app/
- Repository: https://github.com/Tejas-4t/PG-FINDER
- Stack: plain HTML, CSS and JavaScript; Supabase database, authentication and image storage; Vercel static hosting.

No Node build, package installation or custom application server is required. GitHub stores source/history, Vercel deploys `main`, and Supabase stores data independently. The site does not depend on a developer's computer staying online. The original ZIP is unnecessary and was removed; its contents remain in Git history.

## File guide

| File | What it does | When to edit |
| --- | --- | --- |
| `index.html` | Navigation, hero, public listing grid, information sections, footer and script loading. | Page text, layout, menu and footer links. |
| `pg.css` | Original site design, typography, cards, responsive layouts and modal base styles. | Overall appearance. |
| `pg.js` | Creates the Supabase browser client, fetches published/non-deleted properties, renders cards/details, applies quick filters and updates statistics. | Public browsing and listing queries. |
| `photos.js` | Validates uploads, resizes/converts them to WebP, uploads immutable image slots, resolves private-storage signed URLs, and creates accessible carousels. | Image limits, formats, compression, navigation and storage behavior. |
| `moderation.css` | Request/admin forms, messages, review cards, carousel controls, image previews and editor styles. | Submission/admin UI and photo layout. |
| `moderation.js` | Request submission with retry state, admin sign-in and membership check, approval/rejection, listing management, editing, Trash and restore. | Owner and admin workflows. |
| `supabase-config.js` | Supabase project URL and public publishable key. | Connect a different project or rotate the public key. Never add a secret/service-role key. |
| `supabase-js-2.117.2.js` | Vendored browser Supabase SDK. | Deliberate SDK upgrades followed by auth, query and storage testing. |
| `listing-approval.sql` | Original one-time incremental migration: admin membership, private requests, approval trigger, grants and policies. | Historical migration reference; do not rerun on the live database. |
| `images-admin.sql` | Second one-time migration: private upload bucket, three-photo validation, upload/read policies, approval upload checks, admin edit/Trash RPCs and deleted-listing protection. | Historical migration reference; use a new migration for later changes. |
| `sharing-options.sql` | Third migration: multiple sharing types with bed counts per type, derived legacy totals, and a five-image limit. | Apply after images-admin.sql; do not rerun. |
| `verification.sql` | Transactional role and workflow tests for uploads, privacy, approval and admin management. Historical three-image-release checks; not run for the sharing/five-image update. All fixture rows roll back. | Review and adapt for a development database. Requires a real admin UUID/profile, currently configured for this project. |
| `README.md` | Architecture, file guide, operating instructions, setup, security and limits. | Keep aligned with behavior and migrations. |

Script order is the SDK, configuration, `photos.js`, `pg.js`, then `moderation.js`. These are classic scripts with shared helpers, not independent modules.

## Submitting a PG

1. Choose **List My PG** in the navigation/owner section, or **Request to List** in the footer.
2. Enter your name and email (private to admins), property name/address, public phone number, rent, all offered sharing types, total/available beds for each type, facilities and description.
3. Supply **one to five images total**, using uploads, HTTPS links, or a mixture.
4. Confirm you have permission to publish the property information and photos, then select **Send for Approval**.
5. A successful submission displays a reference and waits for admin approval. It is not public yet.

If a network failure interrupts a submission, keep the tab open and use **Retry Upload**. The original details and prepared photos are locked in memory so retrying cannot accidentally change the request or duplicate its listing. Closing/reloading the tab loses this retry state. Upload reservations expire after 24 hours; incomplete requests cannot be approved.

### Sharing options

Select any combination of Single, Double and Triple Sharing. Every selected type has its own total beds and available beds; availability cannot exceed that type’s total. The listing’s overall bed counts are calculated automatically. Cards, details, admin reviews and the admin editor show the breakdown. The Single Sharing filter includes properties offering single rooms alongside other types. Existing records retain their original type and counts until edited. Monthly rent remains a single listing-level amount.

### Image rules

- Maximum **5 images per listing**, including existing images and new image links/uploads.
- Maximum **5 MiB (5 × 1024 × 1024 bytes)** per uploaded source file; the UI labels this 5 MB. The storage bucket also caps each stored object at 5 MiB.
- JPEG, PNG, WebP, GIF, AVIF and BMP are accepted when the browser can decode them. Unsupported, empty, corrupt or excessively large-dimension images get an error. HEIC/SVG are not accepted; export to JPEG or PNG.
- Uploads are resized to a maximum 1600-pixel longest edge and converted to WebP at 80% quality. Animated images become a still frame. Canvas conversion avoids preserving original camera metadata.
- Local previews appear before submission. Both listing cards and detail views have left/right controls and a photo counter when multiple photos exist. Focused galleries also support keyboard left/right arrows and mobile swipes.
- External links must be HTTPS direct-image URLs. A sharing page may not display as an image. External images remain on their provider, so this app cannot enforce a byte-size limit on them or ensure continued availability. The 5 MB limit applies to uploaded files.
- A single-image listing has no unnecessary navigation arrows. Missing/expired images show a retry message.

## Admin operation

Use **Admin Login** in the footer. Sign in using an application user from this Supabase project's Authentication service. Dashboard credentials are separate. The authenticated user must also have a row in `public.pg_admins`; an owner profile alone does not grant admin access.

**Listing Requests** shows Pending, Approved and Rejected requests, including private requester contact details and photo previews. Review the property, then **Approve & Publish** or **Reject**, optionally adding private notes. Approval inserts the public property atomically in the database and refreshes the homepage. Missing uploaded objects block approval. Approval does not automatically grant a Verified badge. Request review decisions are final; later changes to an approved property happen in Manage Listings.

**Manage Listings** shows published and unpublished properties. You can:

- **View** the public-style detail page.
- **Edit** property details, rent, sharing, beds, facilities, description, publication state and photos. Remove an existing photo to replace it; the combined limit remains five.
- **Delete** after an on-screen confirmation. This moves the listing to **Trash**, marks it unpublished and removes it from the public site.
- **Restore** from Trash. Restored listings are intentionally unpublished; use Edit and enable Published to put one back on the homepage.

Deletion is recoverable, not a permanent database/storage purge. Uploaded files are retained for recovery. An editor checks `updated_at` to prevent silently overwriting another admin's newer changes. On a conflict, refresh and reopen the listing.

The three original example PGs were unpublished. They remain available to admins as unpublished records; the public site no longer uses them as placeholders.

## Security and data flow

The browser's publishable key is public by design. Authorization is enforced by database grants, RLS and guarded functions. Never expose a secret/service-role key or add browser code that grants admin membership.

| Object | Purpose/access |
| --- | --- |
| `auth.users` / `public.profiles` | Application identity and existing profile records. Approved listings reference the reviewing admin's profile. |
| `public.pg_admins` | Admin allowlist. Authenticated users can read only their own membership, not grant access. |
| `public.pg_listing_requests` | Private requester details, property submission, photo URLs/paths, review decision and publication reference. Visitors can insert only submission columns; only admins read/review. |
| `public.pgs` | Public property data, `room_options` (type/total/available array), `photo_urls`, `photo_paths`, publication flag and `deleted_at`. Public queries exclude unpublished/deleted rows. Admins can read all. |
| `public.pg_photos` / `pg-photos` | Legacy related storage photos and the existing public bucket. New uploads use the separate private bucket. |
| `pg-listing-images` | Private bucket, WebP only, maximum stored object size 5 MiB. |
| `private.pg_image_upload_allowed` | Allows a visitor to INSERT only the exact one-to-five paths reserved by a pending request less than 24 hours old. Random request UUIDs serve as unguessable upload capabilities. Admins may insert images for edits. |
| `private.pg_image_read_allowed` | Allows admins to preview pending images; public reads only when a published, non-deleted PG references the path. |
| `private.review_pg_listing` | Checks admin membership and complete uploaded objects, then publishes an approved request atomically. |
| `public.admin_save_pg` | Admin-only RPC with explicit editable fields, concurrency check and photo validation. Cannot change owner/admin membership or verification. |
| `public.admin_trash_pg` | Admin-only recoverable deletion/restore RPC with concurrency check. |

Public uploads have no UPDATE/DELETE rights in the new bucket and cannot overwrite approved photos. Visitors cannot list/read pending requests or pending images. Requester names, email addresses and review notes never enter public property rows. The new private bucket does not inherit the old bucket's public visibility.

The browser obtains signed image URLs valid for one hour. Unpublishing/deleting stops new public URLs; a URL issued earlier can work until it expires. Previously downloaded images and external links cannot be revoked by the app. Reload the page if an old image URL expires.

## Storage and free-tier operation

Compression reduces storage and bandwidth use; five photos and the 5 MB source limit do not guarantee unlimited free usage. Keep the project on its current plan and monitor **Supabase Usage** for storage, bandwidth and database limits. Actual capacity depends on compressed file sizes, visitor traffic and current plan allowances.

Rejected/incomplete request photos, replaced photos and Trash images are retained. A trusted maintainer should periodically inspect unused objects before deleting them through the Storage dashboard. Do not delete an object referenced by an active property or a recoverable record you intend to keep. Storage cleanup is not automatic. Public submissions have validation and a honeypot, but no CAPTCHA/server rate limiter; add abuse controls before promoting the form widely.

## Local development

Download or clone the repo, then serve its root over HTTP:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/. There is no build/install command. Do not rely on `file://` URLs. **The committed configuration points to the live database**, so local form submissions affect live data. Use a separate development Supabase project for general development.

Optional syntax checks:

```sh
node --check photos.js
node --check pg.js
node --check moderation.js
```

## Database setup and changes

The migrations are incremental and one-time. They require the original `pgs`, `pg_photos`, `profiles`, authentication and storage setup; this repo does not contain a complete empty-database bootstrap. For a new instance, obtain the base schema/policies/profile creation behavior from the project maintainer or backup, apply `listing-approval.sql`, then `images-admin.sql`, then `sharing-options.sql`, configure the public URL/key and provision an authorized admin.

For admin provisioning, identify the intended Authentication user, ensure a matching `profiles` record, then add their UUID to `pg_admins` in a trusted database session. Never disable RLS to work around access failures. Password setup/recovery is handled separately through Supabase Authentication; this site has no password-reset UI.

Future changes should use new reviewed migration files. Vercel does not execute SQL files. Source control is not a backup of listings, requests, accounts or uploaded objects. Preserve database/storage backups separately. Review SQL tests before running; `verification.sql` uses a project-specific admin identity and rollback-only fixtures, not production content.

## Deployment and troubleshooting

The existing Vercel project `pg-finder` in Tejas's workspace tracks `Tejas-4t/PG-FINDER`, branch `main`. Commit frontend changes and verify the deployment is **Ready**, then reload the public URL. It is a static/Other project serving the repo root without build/install commands. Public Supabase configuration comes from `supabase-config.js`, not Vercel environment variables. A frontend rollback does not undo database changes.

| Problem | Check |
| --- | --- |
| Listings fail to load | Supabase availability, public URL/key, columns/relationships and RLS. Do not rerun historical migrations blindly. |
| Upload validation fails | At most five total images, each upload at most 5 MB, accepted format, valid image contents. |
| Submission stalls/fails | Keep the tab open and Retry Upload. Check connection, bucket availability/quota and storage policies. Incomplete uploads cannot be approved. |
| Photo is unavailable | For external links, use a direct public image URL. For uploads, refresh signed URLs and inspect bucket permissions/object existence. |
| Admin sign-in fails | Use the application user's email/password, not the Supabase dashboard login. |
| Signed in without access | Check the exact auth UUID in `pg_admins`. |
| Approval fails | Check admin profile, request status, image completion and property constraints. |
| Edit conflicts | Refresh and reopen the listing; someone changed it after it was loaded. |
| Deleted listing missing | Check Manage Listings → Trash. Restore then explicitly republish from Edit. |
| Deployment shows old UI | Verify Vercel's source commit and Ready status, then reload. |

## Scope and limits

The homepage loads up to 60 published properties; admin category views show up to 100 records. Pagination/realtime updates are not implemented. The hero location/budget/sharing summaries are informational; quick-filter buttons provide filtering. Hearts are temporary visual toggles. There are no booking/payment workflows, owner dashboard, notification emails, favourites accounts, comparison workflow or submission-status lookup.

When extending this project, keep private submission data separate from public property data, test visitor/non-admin/admin permissions, and update this file with migrations and behavior changes.
