# PG Finder — Karvenagar

A small PG (paying guest accommodation) discovery website for students in Karvenagar, Pune. Visitors can compare published properties, view rent and facilities, check bed availability, and contact the listing. Property owners can submit a listing for an administrator to review before it becomes public.

**Live website:** https://pg-finder-lovat.vercel.app/  
**Source repository:** https://github.com/Tejas-4t/PG-FINDER

## How the project works

The frontend is plain HTML, CSS and JavaScript. There is no Node build step, React app, custom server or package installation required to serve it.

- **GitHub** stores the source and change history.
- **Vercel** hosts the static website and automatically deploys changes from the main branch.
- **Supabase** provides PostgreSQL, the browser data API, admin authentication and the existing photo-storage bucket.
- The browser uses the Supabase publishable key. Database permissions and Row Level Security (RLS), rather than hidden frontend controls, determine what each visitor can do.

The site does not depend on any developer's computer remaining online. Deleting a local working copy does not delete the GitHub repository, Vercel deployment or Supabase data.

## Repository file guide

| File | Purpose | When to change it |
| --- | --- | --- |
| [index.html](index.html) | Main page structure: navigation, hero, listing grid, information sections, footer, stylesheet and script loading. | Change page text, section layout or navigation links. |
| [pg.css](pg.css) | Original visual design: colours, typography, cards, hero, responsive layout and fallback property images. | Change the site's general appearance. |
| [pg.js](pg.js) | Creates the Supabase client; fetches published PGs; builds cards and property details; displays photos; applies quick filters and updates listing/bed counts. | Change the public listing experience or public query. |
| [moderation.css](moderation.css) | Styles for the listing request dialog, admin sign-in and review queue, status messages, form fields and photo gallery. | Change the submission/admin interface. Loaded after pg.css so its dialog rules take precedence. |
| [moderation.js](moderation.js) | Builds the request form and admin dialogs; validates submissions; inserts pending requests; signs admins in; checks membership; loads and reviews requests. | Change submission fields, admin controls or review messages. |
| [supabase-config.js](supabase-config.js) | Browser configuration containing the Supabase project URL and public publishable key. | Connect a different Supabase project or rotate its publishable key. Never put a secret/service-role key here. |
| [supabase-js-2.117.2.js](supabase-js-2.117.2.js) | Vendored browser Supabase client library. Application code uses its createClient API. | Upgrade deliberately and test auth, queries and storage afterward. Keep the filename in index.html in sync. |
| [listing-approval.sql](listing-approval.sql) | Database migration for admin membership, private listing requests, photo URLs, RLS policies, restricted writes and atomic approval/publication. | Reference the deployed database design. Make later schema changes through new migrations. |
| [README.md](README.md) | This project overview, operating guide, setup instructions and limitations. | Update whenever behavior, setup or files change. |

The original files (1).zip has been removed because its five source files are now maintained directly in the repository. Vercel does not need the archive. Its original contents remain recoverable through Git history.

### Script loading order

index.html loads supabase-js-2.117.2.js, then supabase-config.js, then pg.js, then moderation.js. Keep this order: moderation.js uses the database client, escaping helpers, labels and listing refresh function defined in pg.js. These are classic browser scripts, not independent ES modules.

## Visitor and owner workflow

1. Browse the home page and use the rent, room-sharing, food or Wi-Fi quick filters.
2. Open **View Details** for address, availability, facilities, photos and the listing contact number.
3. Choose **List My PG** in the top navigation or owner section, or **Request to List** in the footer.
4. Enter contact and property details, rent, room type, bed counts, facilities, description and photo links.
5. Confirm permission to publish the property address, public contact number and photos, then choose **Send for Approval**.
6. The request is stored as pending. It is not a public PG listing until an admin approves it.

Requester name and email stay in the private review queue. The listing phone number, address, description and approved photos are public property information.

### Photo links

The form accepts 1–8 public HTTPS photo links, one per line. Direct links to image files work best. A private cloud-drive sharing page or a page containing a photo may not render as an image. Keep the linked images available and use photos you have permission to publish.

The request form currently uses photo links, not file uploads. Existing pg_photos records can still reference images in the Supabase pg-photos bucket. New approved requests store their links in pgs.photo_urls.

## Administrator workflow

1. Open **Admin Login** in the website footer.
2. Sign in with an existing **application user** in this project's Supabase Authentication and that user's password.
3. The account must also have a row in pg_admins. A Supabase dashboard login or an owner profile alone does not grant website admin access.
4. Review **Pending** requests, open their photo links, and check the submitted details.
5. Add optional private review notes, then choose **Approve & Publish** or **Reject**.
6. Use the status selector to view approved or rejected requests. Use **Refresh** for new arrivals and **Sign Out** when finished.

Approval publishes the property in the same database transaction as the review. The homepage includes it on its next data load; the approving admin's page refreshes the listing grid immediately. Other visitors already viewing the page should reload to see new data. Approval does not automatically give a property the Verified badge.

Decisions are final in the current UI: there is no edit, reopen, unpublish or delete control. A trusted database maintainer must handle corrections. Review notes and requester emails are not copied into public PG records.

### Managing admin access

A project maintainer manages membership in the Supabase dashboard. Never expose an admin-grant endpoint or allow clients to edit pg_admins.

- Create or identify the intended account in Authentication > Users.
- Ensure the account has a matching public.profiles row: approved listings use the reviewing admin's UUID as pgs.owner_id, which references profiles.id.
- Add that exact user UUID to public.pg_admins using a trusted database session.
- To revoke access, remove that membership through a trusted database session. Do not disable RLS to make the admin panel work.
- Keep passwords out of this repository. Password setup/recovery is handled through Supabase Authentication; this website has no password-reset screen.

## Database structure and security

| Object | Role |
| --- | --- |
| auth.users | Supabase-managed application identities and credentials. |
| public.profiles | Existing profile records linked to auth.users. Includes the legacy student/owner role. |
| public.pgs | Public property data, publication/verification flags, beds, facilities and photo URLs. The homepage explicitly queries is_published = true. |
| public.pg_photos | Existing related photos using Supabase Storage paths and sort order. |
| public.pg_listing_requests | Private submitted details, pending/approved/rejected status, review notes, reviewer/time and published property ID. |
| public.pg_admins | Admin allowlist keyed by application user UUID. Users can only read their own membership; they cannot grant themselves access. |
| private.valid_pg_photo_urls | Database validation helper for submitted HTTPS photo-link arrays. |
| private.review_pg_listing | Guarded trigger function that checks admin membership and publishes approved requests atomically. |
| pg-photos bucket | Existing public storage for legacy property photo records. |

Visitors have insert access only to submission fields. They cannot set approval fields or read requests. Signed-in non-admins cannot see or review the queue. Admins can read requests and update status/review notes. A guarded trigger records the reviewer and creates the public PG on approval. Legacy direct client writes to pgs and pg_photos are revoked so an owner cannot bypass review. Repeated reviews cannot publish duplicate properties.

The publishable key is expected to be visible in a static website. It is not an administrator credential. Security depends on database grants and RLS. Do not replace it with a secret or service-role key.

## Run the frontend locally

1. Clone or download this repository.
2. Check supabase-config.js points to the intended project. The committed configuration connects to the live project: local form submissions would also affect that project's data.
3. Serve the repository root over HTTP. For example, with Python 3 installed:

~~~sh
python3 -m http.server 8000 --bind 127.0.0.1
~~~

4. Open http://127.0.0.1:8000 in a browser. Do not rely on opening index.html as a file URL.

There is no npm install or build command. Node.js is optional for JavaScript syntax checks:

~~~sh
node --check pg.js
node --check moderation.js
~~~

## Supabase setup and migration notes

The current live project already has the base tables, authentication setup, storage bucket and listing-approval migration applied.

**listing-approval.sql is an incremental, one-time migration, not a complete empty-database installer.** It expects the existing pgs, pg_photos and profiles schema and Supabase auth roles. It adds pgs.photo_urls and creates new objects without IF NOT EXISTS guards for those objects. Do not run it again on the current database.

For a separate development instance, first obtain the base schema, policies, profile creation behavior and storage setup from the project maintainer or a database backup. Recreate those dependencies, then apply listing-approval.sql once in the Supabase SQL Editor. Update supabase-config.js with the new project's URL and publishable key and provision an authorized admin user/profile/membership. The original base-schema migration is not included in this repository; old comments mentioning 01_schema.sql do not mean that file is present.

Source control does not back up live listings, users, requests or storage objects. Keep database/storage backups separately. Future database changes should be recorded as new reviewed SQL migrations; a Vercel deployment does not execute SQL files automatically.

## Vercel deployment

The current Vercel project is pg-finder in the Tejas workspace and is connected to Tejas-4t/PG-FINDER, production branch main.

For the existing deployment, commit frontend changes to main and check that the Vercel deployment reports Ready. Open the production URL to verify the changed behavior. The project serves files from the repository root as a static site; no framework build is required.

For a new deployment, import the repository into Vercel, use its static/Other setup with the repository root as the site source, and leave build/install commands unset unless the project is later changed to use a build tool. Browser Supabase configuration currently comes from supabase-config.js, not from Vercel environment variables.

A frontend rollback in Vercel does not undo Supabase migrations or data changes. Keep the deployed frontend compatible with the database schema.

## Verification and troubleshooting

Checks performed for the approval release:

- Both application JavaScript files passed Node syntax checks.
- The browser loaded the three existing published properties and the new request/admin dialogs.
- Form validation rejected availability greater than total beds and non-HTTPS photo links.
- Database role tests verified visitor insertion, private request protection, blocked non-admin review and blocked self-admin grants.
- Transactional tests verified admin approval publishes with photo URLs, rejection remains private, and repeat approval cannot create another property. Test records were rolled back.
- Vercel reported the workflow release Ready and the public URL displayed the new navigation and footer.

A real admin password sign-in and review through the browser still need to be exercised by the account holder; database-role tests do not establish that the account holder's password is known or usable.

| Symptom | Check |
| --- | --- |
| Listings fail to load | Check browser console, project availability, Supabase URL/key, pgs columns, pg_photos relationship and SELECT policies. |
| Request cannot be submitted | Check required fields, positive rent, available beds <= total beds, valid phone and 1–8 HTTPS photo links. Then inspect database errors/grants/RLS. |
| Sign-in fails | Use the project's application user and its password, not dashboard login credentials. Check the user in Supabase Authentication. |
| Signed in but no admin access | Check pg_admins contains exactly that auth user's UUID. |
| Approval fails | Confirm the admin has a profiles row, the trigger/migration exists, and the property satisfies the pgs constraints. Refresh the queue before retrying. |
| Photo does not display | Open the link directly: it must be public, remain accessible and ideally serve an image rather than HTML. |
| Deployment does not show edits | Check the Vercel source commit and Ready status, then reload the production page. |

## Current scope and limits

- Public browsing and pending listing submission require no owner account.
- Photos are external links; upload management is not implemented.
- Pending/approved/rejected admin views show at most the latest 100 requests in that category; process pending items and refresh to reveal older ones.
- The homepage loads at most 60 published PGs. Pagination and realtime updates are not implemented.
- The hero's Location, Budget and Room Type summaries are not editable search fields. Quick-filter buttons provide the implemented filtering.
- Hearts toggle visually during the current page session; saved accounts/favourites and a comparison workflow are not implemented.
- There are no approval emails, submission-status lookup, owner dashboard, payments or booking workflow.
- The form has a honeypot and validation, but no server-side rate limiter or CAPTCHA. Consider abuse controls before promoting the submission form widely.
- The repo does not currently include a complete automated test suite or a full database bootstrap/backup.

When extending this project, keep private request data separate from public property data and test permissions as visitor, non-admin and admin. Update this README and preserve migrations alongside application changes.
