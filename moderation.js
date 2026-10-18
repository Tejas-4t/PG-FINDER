// Listing requests are insert-only for visitors. Supabase enforces admin approval.
(function () {
    'use strict';
    function makeDialog(id, title, contents, className) {
        const modal = document.createElement('div');
        modal.id = id; modal.className = 'custom-modal';
        modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', id + '-title');
        modal.innerHTML = '<div class="modal-box ' + className + '"><button type="button" class="close-modal" aria-label="Close">&times;</button><h2 id="' + id + '-title">' + title + '</h2>' + contents + '</div>';
        document.body.appendChild(modal);
        modal.querySelector('.close-modal').addEventListener('click', () => close(modal));
        modal.addEventListener('click', event => { if (event.target === modal) close(modal); });
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') close(modal);
            if (event.key !== 'Tab') return;
            const fields = [...modal.querySelectorAll('button,a,input,select,textarea')].filter(el => !el.disabled && el.offsetParent !== null && el.tabIndex >= 0);
            if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
            else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
        });
        return modal;
    }
    function open(modal) {
        modal.previousFocus = document.activeElement;
        modal.classList.add('show'); document.body.style.overflow = 'hidden';
        modal.querySelector('input,button').focus();
    }
    function close(modal) {
        modal.classList.remove('show'); document.body.style.overflow = document.querySelector('.custom-modal.show') ? 'hidden' : '';
        if (modal.previousFocus && modal.previousFocus.isConnected) modal.previousFocus.focus();
    }
    function message(el, text, isError = false) { el.textContent = text; el.classList.toggle('error', isError); }
    function input(id, label, type, attributes = '') {
        return '<div><label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" type="' + type + '" ' + attributes + ' required></div>';
    }
    function makeRoomFields(container, prefix, initial = []) {
        container.innerHTML = '<fieldset class="room-options"><legend>Sharing options</legend><p class="field-help">Select every room type you offer. Enter total and available beds separately for each selected type.</p>' + Object.entries(SHARING_LABELS).map(([type,label]) =>
            '<div class="room-option"><label><input type="checkbox" name="' + prefix + '-type" value="' + type + '">' + label + '</label><div class="form-grid room-counts" hidden>' +
            input(prefix+'-'+type+'-total',label+' — total beds','number','min="1" max="10000" step="1"') +
            input(prefix+'-'+type+'-available',label+' — available beds','number','min="0" max="10000" step="1"') + '</div></div>'
        ).join('') + '</fieldset>';
        function sync() {
            container.querySelectorAll('.room-option').forEach(row => {
                const selected=row.querySelector('[type=checkbox]').checked;
                row.querySelector('.room-counts').hidden=!selected;
                row.querySelectorAll('[type=number]').forEach(field => {field.disabled=!selected;field.required=selected;});
            });
        }
        container.querySelectorAll('[type=checkbox]').forEach(box => {
            const room=initial.find(room=>room.type===box.value);box.checked=!!room;
            if(room) {document.getElementById(prefix+'-'+box.value+'-total').value=room.total_beds;document.getElementById(prefix+'-'+box.value+'-available').value=room.available_beds;}
            box.addEventListener('change',sync);
        });
        sync();return {sync};
    }
    function readRoomFields(container,prefix) {
        const rooms=[...container.querySelectorAll('[type=checkbox]:checked')].map(box => ({type:box.value,total_beds:Number(document.getElementById(prefix+'-'+box.value+'-total').value),available_beds:Number(document.getElementById(prefix+'-'+box.value+'-available').value)}));
        if(!rooms.length)throw new Error('Select at least one sharing option.');
        for(const room of rooms) {
            if(!Number.isInteger(room.total_beds)||room.total_beds<1||room.total_beds>10000||!Number.isInteger(room.available_beds)||room.available_beds<0||room.available_beds>room.total_beds)throw new Error(SHARING_LABELS[room.type]+': available beds must be between zero and total beds.');
        }
        if(rooms.reduce((sum,room)=>sum+room.total_beds,0)>10000)throw new Error('Total beds across all sharing types cannot exceed 10,000.');
        return {room_options:rooms,sharing_type:rooms[0].type,total_beds:rooms.reduce((sum,room)=>sum+room.total_beds,0),available_beds:rooms.reduce((sum,room)=>sum+room.available_beds,0)};
    }
    const listingModal = makeDialog('listingRequest', 'List My PG', `
        <p>Send your property details for review. Your listing will appear only after an admin approves it.</p>
        <form id="listingRequestForm">
          <fieldset><legend>Your contact details</legend><div class="form-grid">
            ${input('requesterName', 'Your name', 'text', 'minlength="2" maxlength="100" autocomplete="name"')}
            ${input('requesterEmail', 'Your email (private)', 'email', 'maxlength="254" autocomplete="email"')}
          </div><p class="field-help">Your name and email are shared only with the review team.</p></fieldset>
          <fieldset><legend>Property details</legend><div class="form-grid">
            ${input('requestPGName', 'PG name', 'text', 'minlength="2" maxlength="100"')}
            ${input('requestPhone', 'Listing contact number (public)', 'tel', 'pattern="[+]?[0-9 ]{10,15}" maxlength="16" autocomplete="tel"')}
            <div class="wide"><label for="requestAddress">Full address</label><textarea id="requestAddress" name="requestAddress" rows="2" minlength="5" maxlength="500" required></textarea></div>
            ${input('requestArea', 'Area', 'text', 'value="Karvenagar" minlength="2" maxlength="100"')}
            ${input('requestCity', 'City', 'text', 'value="Pune" minlength="2" maxlength="100"')}
            ${input('requestRent', 'Monthly rent (₹)', 'number', 'min="1" max="1000000" step="1"')}
            <div class="wide" id="requestRooms"></div>
          </div></fieldset>
          <fieldset><legend>Facilities</legend><div class="facility-options">${Object.entries(FACILITY_LABELS).map(([value, label]) => '<label><input type="checkbox" name="facility" value="' + value + '">' + label + '</label>').join('')}</div></fieldset>
          <label for="requestDescription">Description</label><textarea id="requestDescription" name="requestDescription" maxlength="2000" rows="3" placeholder="Food, house rules, nearby landmarks and what makes your PG special"></textarea>
          <label for="requestFiles">Upload photos</label><input id="requestFiles" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp" multiple><div id="requestPreview" class="upload-preview"></div><label for="requestPhotos">Or add photo links</label><textarea id="requestPhotos" name="requestPhotos" rows="3" maxlength="10240" placeholder="https://example.com/room.jpg"></textarea>
          <p class="field-help">Add 1–5 images in total using uploads, HTTPS links, or both. Maximum 5 MB per uploaded image. JPEG, PNG, WebP, GIF, AVIF and BMP are supported. Uploads are resized and saved as WebP; animated images become still photos. Only share images you have permission to publish.</p>
          <div class="spam-trap" aria-hidden="true"><label for="requestWebsite">Leave blank</label><input id="requestWebsite" name="requestWebsite" tabindex="-1" autocomplete="off"></div>
          <label><input type="checkbox" id="requestConsent" required> I confirm these details are accurate and may be published, including the address, listing contact number and photos, after approval.</label>
          <div class="form-status" id="requestStatus" role="status" aria-live="polite"></div>
          <button class="modal-main-btn" type="submit">Send for Approval</button>
        </form>`, 'listing-dialog');
    const requestRooms=document.getElementById('requestRooms');
    const requestRoomControls=makeRoomFields(requestRooms,'request-room');
    const requestForm = document.getElementById('listingRequestForm');
    const requestStatus = document.getElementById('requestStatus');
    let requestId = crypto.randomUUID(), requestDraft = null;
    const requestFiles = document.getElementById('requestFiles');
    let previewUrls = [];
    requestFiles.addEventListener('change', () => {
        previewUrls.forEach(URL.revokeObjectURL); previewUrls = [];
        const preview = document.getElementById('requestPreview'); preview.replaceChildren();
        try {
            const links = document.getElementById('requestPhotos').value.split(/\r?\n/).filter(s=>s.trim());
            validateImageFiles([...requestFiles.files], links.length);
            [...requestFiles.files].forEach(file=>{const img=document.createElement('img');img.src=URL.createObjectURL(file);previewUrls.push(img.src);img.alt=file.name;preview.appendChild(img);});
            message(requestStatus, '');
        } catch(error) { message(requestStatus, error.message, true); requestFiles.value=''; }
    });
    document.querySelectorAll('[data-open-listing]').forEach(button => button.addEventListener('click', () => open(listingModal)));
    requestForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = requestForm.querySelector('[type=submit]');
        if (button.disabled) return;
        const f = new FormData(requestForm);
        const files = [...requestFiles.files];
        const photos = [...new Set(String(f.get('requestPhotos')).split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
        if (!requestDraft) {
            try {
                validateImageFiles(files, photos.length);
                if (photos.length + files.length < 1 || photos.some(url=>!safePhotoUrl(url)||url.length>2048)) throw new Error('Add 1–5 images using uploads or valid HTTPS image links.');
            } catch(error) { message(requestStatus,error.message,true);return; }
        }
        let roomDetails;
        try { roomDetails=requestDraft?.payload || readRoomFields(requestRooms,'request-room'); }
        catch(error) {message(requestStatus,error.message,true);return;}
        if (f.get('requestWebsite')) { message(requestStatus, 'Unable to submit this request.', true); return; }
        if (!db) { message(requestStatus, 'The connection is unavailable. Please try again later.', true); return; }
        button.disabled = true; button.textContent = 'Sending…'; message(requestStatus, '');
        const payload = {
            id: requestId, requester_name: String(f.get('requesterName')).trim(), requester_email: String(f.get('requesterEmail')).trim(),
            name: String(f.get('requestPGName')).trim(), address: String(f.get('requestAddress')).trim(), area: String(f.get('requestArea')).trim(), city: String(f.get('requestCity')).trim(),
            contact_phone: String(f.get('requestPhone')).trim(), monthly_rent: Number(f.get('requestRent')), ...roomDetails, facilities: f.getAll('facility'),
            description: String(f.get('requestDescription')).trim(), photo_urls: photos
        };
        try {
            if (!requestDraft) {
                message(requestStatus, 'Preparing photos…');
                const blobs = await prepareImages(files);
                payload.photo_paths = blobs.map((_,i)=>requestId+'/'+(i+1)+'.webp');
                requestDraft = {payload, blobs, completed:new Set()};
                requestForm.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);
            }
            message(requestStatus, 'Sending details and uploading photos…');
            const {error} = await db.from('pg_listing_requests').insert(requestDraft.payload).abortSignal(AbortSignal.timeout(20000));
            if (error && error.code !== '23505') throw error;
            await uploadPGImages(requestDraft.payload.photo_paths, requestDraft.blobs, requestDraft.completed);
            message(requestStatus, 'Request received with all photos. Your PG is awaiting admin approval. Reference: ' + requestId.slice(0, 8));
            requestForm.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=false);
            requestForm.reset(); requestRoomControls.sync(); requestId = crypto.randomUUID(); requestDraft=null;
            previewUrls.forEach(URL.revokeObjectURL); previewUrls=[];document.getElementById('requestPreview').replaceChildren();
        } catch (error) {
            console.error('[PG Finder] Submission failed', error);
            message(requestStatus, requestDraft ? 'Could not finish submitting. Your details and photos are kept in this tab. Check your connection and press Retry Upload; do not close this tab.' : error.message || 'Could not prepare these photos. Please choose another image.', true);
        } finally { button.disabled = false; button.textContent = requestDraft ? 'Retry Upload' : 'Send for Approval'; }
    });

    const adminModal = makeDialog('adminPanel', 'Admin Login', `
        <div id="adminSignIn"><p>Sign in with your approved admin account to review listing requests.</p>
          <form id="adminLoginForm">
            <label for="adminEmail">Admin email</label><input id="adminEmail" type="email" autocomplete="username" required>
            <label for="adminPassword">Password</label><input id="adminPassword" type="password" autocomplete="current-password" required>
            <button class="modal-main-btn" type="submit">Sign In</button>
          </form>
        </div>
        <div class="form-status" id="adminStatus" role="status" aria-live="polite"></div>
        <section id="adminQueue" hidden>
          <div class="admin-mode"><button type="button" id="showRequests">Listing Requests</button><button type="button" id="showListings">Manage Listings</button></div><div class="admin-toolbar"><label for="requestFilter" id="filterLabel">Requests</label><select id="requestFilter"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><button id="refreshRequests" type="button">Refresh</button><button id="adminSignOut" type="button">Sign Out</button></div>
          <div id="reviewRequests" aria-live="polite"></div>
        </section>`, 'admin-dialog');
    const adminStatus = document.getElementById('adminStatus');
    const queue = document.getElementById('adminQueue');
    const signIn = document.getElementById('adminSignIn');
    const reviewList = document.getElementById('reviewRequests');
    let adminUserId = null, refreshVersion = 0, adminMode = 'requests';
    function resetAdmin() {
        adminUserId = null; if (editor) { editor.remove(); editor=null; } refreshVersion++; queue.hidden = true; signIn.hidden = false; reviewList.replaceChildren();
        document.getElementById('adminPassword').value = '';
        document.getElementById('adminPanel-title').textContent = 'Admin Login';
    }
    async function checkAdmin() {
        if (!db) throw new Error('Connection unavailable.');
        const {data: {user}, error} = await db.auth.getUser();
        if (error || !user) { resetAdmin(); return false; }
        const result = await db.from('pg_admins').select('user_id').eq('user_id', user.id).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) { resetAdmin(); message(adminStatus, 'This account does not have admin access.', true); return false; }
        adminUserId = user.id; queue.hidden = false; signIn.hidden = true;
        document.getElementById('adminPanel-title').textContent = 'Admin Panel';
        document.getElementById('adminPassword').value = '';
        return true;
    }
    document.getElementById('adminLoginButton').addEventListener('click', async () => {
        open(adminModal); message(adminStatus, '');
        try { if (await checkAdmin()) await loadRequests(); }
        catch (error) { message(adminStatus, 'Could not check admin access. Please try again.', true); }
    });
    document.getElementById('adminLoginForm').addEventListener('submit', async event => {
        event.preventDefault(); const button = event.target.querySelector('button');
        button.disabled = true; message(adminStatus, 'Signing in…');
        try {
            if (!db) throw new Error('Connection unavailable');
            const {error} = await db.auth.signInWithPassword({email: document.getElementById('adminEmail').value.trim(), password: document.getElementById('adminPassword').value});
            if (error) throw error;
            if (await checkAdmin()) { message(adminStatus, ''); await loadRequests(); }
            else await db.auth.signOut();
        } catch (error) { message(adminStatus, 'Sign-in failed. Check your email and password and try again.', true); }
        finally { button.disabled = false; document.getElementById('adminPassword').value = ''; }
    });
    document.getElementById('adminSignOut').addEventListener('click', async () => {
        const {error} = await db.auth.signOut();
        if (error) { message(adminStatus, 'Could not sign out. Please retry.', true); return; }
        resetAdmin(); message(adminStatus, 'Signed out.');
    });
    if (db) db.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') resetAdmin(); });
    document.getElementById('refreshRequests').addEventListener('click', loadRequests);
    document.getElementById('requestFilter').addEventListener('change', loadRequests);

    async function loadRequests() {
        if (!adminUserId) return;
        if (adminMode === 'listings') return loadManagedListings();
        const version = ++refreshVersion;
        reviewList.textContent = 'Loading requests…';
        try {
            const {data, error} = await db.from('pg_listing_requests').select('*').eq('status', document.getElementById('requestFilter').value).order('created_at', {ascending: false}).limit(100).abortSignal(AbortSignal.timeout(20000));
            if (error) throw error;
            if (version !== refreshVersion || !adminUserId) return;
            reviewList.replaceChildren();
            if (!data.length) { reviewList.innerHTML = '<p class="admin-empty">No requests in this category.</p>'; return; }
            await resolvePGImages(data);
            if (version !== refreshVersion || !adminUserId) return;
            data.forEach(renderRequest);
            if (data.length === 100) { const note = document.createElement('p'); note.textContent = 'Showing the latest 100 requests. Review these and refresh to see older pending requests.'; reviewList.appendChild(note); }
        } catch (error) { if (version === refreshVersion) reviewList.textContent = 'Could not load requests. Use Refresh to try again.'; }
    }
    function renderRequest(request) {
        const card = document.createElement('article'); card.className = 'request-card';
        const fields = [['Requested by', request.requester_name], ['Private email', request.requester_email], ['Public phone', request.contact_phone], ['Address', [request.address,request.area,request.city].join(', ')], ['Rent', formatRent(request.monthly_rent) + ' / month'], ['Room', sharingSummary(request)], ['Beds by sharing', roomOptions(request).map(room=>SHARING_LABELS[room.type]+': '+room.available_beds+' available / '+room.total_beds+' total').join(' · ')], ['Submitted', new Date(request.created_at).toLocaleString()]];
        card.innerHTML = `<span class="status-badge">${esc(request.status)}</span><h3>${esc(request.name)}</h3><dl class="request-meta">${fields.map(([label,value]) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join('')}</dl><p>${request.facilities.map(value => esc(FACILITY_LABELS[value] || value)).join(' · ')}</p><p>${esc(request.description)}</p><div class="photo-links"></div>`;
        card.querySelector('.photo-links').appendChild(createPhotoCarousel(sortedPhotos(request), request.name));
        const missingPhotos = (request.uploaded_photos || []).some(photo=>photo.unavailable);
        if (missingPhotos) { const warning=document.createElement('p'); warning.textContent='Photo upload incomplete or preview unavailable. Refresh before approving.'; warning.className='form-status error';card.appendChild(warning); }
        if (request.status === 'pending') {
            const noteLabel = document.createElement('label'); noteLabel.textContent = 'Review notes (optional)';
            const notes = document.createElement('textarea'); notes.id = 'notes-' + request.id; notes.maxLength = 1000; notes.rows = 2; noteLabel.htmlFor = notes.id;
            const actions = document.createElement('div'); actions.className = 'review-actions';
            const status = document.createElement('div'); status.className = 'form-status'; status.setAttribute('role','status');
            ['approved','rejected'].forEach(decision => {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = decision === 'approved' ? 'Approve & Publish' : 'Reject'; button.className = decision === 'rejected' ? 'reject' : '';
                if (decision === 'approved' && missingPhotos) button.disabled=true;
                button.addEventListener('click', async () => {
                    actions.querySelectorAll('button').forEach(b => b.disabled = true); message(status, 'Saving…');
                    try {
                        const {data,error} = await db.from('pg_listing_requests').update({status: decision,review_notes: notes.value.trim()}).eq('id',request.id).eq('status','pending').select('id,status,published_pg_id').maybeSingle();
                        if (error) throw error;
                        if (!data) { message(adminStatus, 'This request was already reviewed, or your access changed.'); await loadRequests(); return; }
                        message(adminStatus, decision === 'approved' ? 'Approved and published: ' + request.name : 'Rejected: ' + request.name);
                        await loadRequests(); if (decision === 'approved') await loadPGs();
                    } catch (error) { message(status, 'Could not save the review. Refresh to check its status before retrying.', true); actions.querySelectorAll('button').forEach(b => b.disabled = false); }
                });
                actions.appendChild(button);
            });
            card.append(noteLabel, notes, actions, status);
        } else {
            const reviewed = document.createElement('p'); reviewed.textContent = 'Reviewed ' + new Date(request.reviewed_at).toLocaleString() + (request.review_notes ? ' · ' + request.review_notes : ''); card.appendChild(reviewed);
        }
        reviewList.appendChild(card);
    }
    function setAdminMode(mode) {
        adminMode=mode;
        const filter=document.getElementById('requestFilter');
        filter.innerHTML=mode==='requests' ? '<option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option>' : '<option value="active">Active listings</option><option value="trash">Trash</option>';
        document.getElementById('filterLabel').textContent=mode==='requests'?'Requests':'Listings';
        loadRequests();
    }
    document.getElementById('showRequests').addEventListener('click',()=>setAdminMode('requests'));
    document.getElementById('showListings').addEventListener('click',()=>setAdminMode('listings'));
    async function loadManagedListings() {
        const version=++refreshVersion; reviewList.textContent='Loading listings…';
        try {
            const trash=document.getElementById('requestFilter').value==='trash';
            let query=db.from('pgs').select(PG_COLUMNS+',is_published,deleted_at').order('created_at',{ascending:false}).limit(100);
            query=trash?query.not('deleted_at','is',null):query.is('deleted_at',null);
            const {data,error}=await query.abortSignal(AbortSignal.timeout(20000));if(error)throw error;
            await resolvePGImages(data);
            if(version!==refreshVersion || !adminUserId)return;
            reviewList.replaceChildren();
            if(!data.length)reviewList.textContent=trash?'Trash is empty.':'No listings.';
            data.forEach(pg=>{
                const card=document.createElement('article');card.className='request-card';
                card.innerHTML='<span class="status-badge">'+(trash?'Trash':pg.is_published?'Published':'Unpublished')+'</span><h3>'+esc(pg.name)+'</h3><p>'+formatRent(pg.monthly_rent)+' / month · '+esc(pg.area)+'</p><div class="manage-actions"></div>';
                card.prepend(createPhotoCarousel(sortedPhotos(pg),pg.name));
                const actions=card.querySelector('.manage-actions');
                function action(label,handler){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',handler);actions.appendChild(button);return button;}
                if(!trash) {
                    action('View',()=>{close(adminModal);showDetails(pg);});
                    action('Edit',()=>editPG(pg));
                }
                action(trash?'Restore':'Delete',async()=>{
                    if(!confirm(trash?'Restore '+pg.name+' as unpublished? You can publish it from Edit.':'Move '+pg.name+' to Trash? It will disappear from the website and can be restored by an admin.'))return;
                    actions.querySelectorAll('button').forEach(b=>b.disabled=true);
                    try {const {error}=await db.rpc('admin_trash_pg',{pg_id:pg.id,expected_updated_at:pg.updated_at,restore:trash});if(error)throw error;message(adminStatus,trash?'Restored as unpublished. Use Edit to publish.':'Listing moved to Trash.');await loadRequests();await loadPGs();}
                    catch(error){message(adminStatus,error.message || 'Could not update listing. Refresh and retry.',true);actions.querySelectorAll('button').forEach(b=>b.disabled=false);}
                }).className='danger-button';
                reviewList.appendChild(card);
            });
            if(data.length===100){const note=document.createElement('p');note.textContent='Showing the latest 100 listings in this view.';reviewList.appendChild(note);}
        } catch(error){if(version===refreshVersion)reviewList.textContent='Could not load listings. Refresh to retry.';}
    }
    let editor=null;
    function editPG(pg) {
        if(editor)editor.remove();
        const fields=[['name','PG name','text','minlength="2" maxlength="100"'],['contact_phone','Public contact number','tel','pattern="[+]?[0-9 ]{10,15}"'],['address','Full address','text','minlength="5" maxlength="500"'],['area','Area','text','minlength="2" maxlength="100"'],['city','City','text','minlength="2" maxlength="100"'],['monthly_rent','Monthly rent (₹)','number','min="1" max="1000000"']];
        editor=makeDialog('editPG','Edit Listing','<form id="editPGForm"><div class="form-grid">'+fields.map(([key,label,type,attrs])=>input('edit-'+key,label,type,attrs)).join('')+'</div><div id="edit-rooms"></div><fieldset><legend>Facilities</legend><div class="facility-options">'+Object.entries(FACILITY_LABELS).map(([value,label])=>'<label><input type="checkbox" name="editFacility" value="'+value+'">'+label+'</label>').join('')+'</div></fieldset><label for="edit-description">Description</label><textarea id="edit-description" maxlength="2000" rows="3"></textarea><label><input type="checkbox" id="edit-published"> Published on homepage</label><h3>Photos</h3><div id="edit-retained"></div><label for="edit-files">Add photos (maximum 5 total, 5 MB each)</label><input id="edit-files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/bmp"><label for="edit-links">Add HTTPS image links, one per line</label><textarea id="edit-links" maxlength="10240"></textarea><p class="field-help">Remove an existing photo to replace it. Uploaded photos are compressed to WebP.</p><div id="edit-status" class="form-status" role="status"></div><button type="submit" class="modal-main-btn">Save Changes</button></form>','edit-dialog');
        editor.classList.add('edit-layer');
        fields.forEach(([key])=>document.getElementById('edit-'+key).value=pg[key]);
        const editRooms=document.getElementById('edit-rooms');
        makeRoomFields(editRooms,'edit-room',roomOptions(pg));
        document.getElementById('edit-description').value=pg.description||'';
        document.getElementById('edit-published').checked=pg.is_published;
        editor.querySelectorAll('[name=editFacility]').forEach(el=>el.checked=pg.facilities.includes(el.value));
        const retained=[...(pg.photo_urls||[]).map(url=>({url})),...(pg.photo_paths||[]).map(path=>({path,url:(pg.uploaded_photos||[]).find(p=>p.storage_path===path)?.external_url}))];
        function drawRetained(){const list=document.getElementById('edit-retained');list.replaceChildren();retained.forEach((photo,index)=>{const row=document.createElement('div');row.className='retained-photo';const img=document.createElement('img');if(photo.url)img.src=photo.url;img.alt='Existing image '+(index+1);img.referrerPolicy='no-referrer';const button=document.createElement('button');button.type='button';button.textContent='Remove image '+(index+1);button.addEventListener('click',()=>{retained.splice(index,1);drawRetained();});row.append(img,button);list.appendChild(row);});}
        drawRetained();open(editor);
        const form=document.getElementById('editPGForm'),status=document.getElementById('edit-status');
        document.getElementById('edit-files').addEventListener('change',()=>{try{validateImageFiles([...document.getElementById('edit-files').files],retained.length);message(status,'');}catch(error){message(status,error.message,true);document.getElementById('edit-files').value='';}});
        form.addEventListener('submit',async event=>{
            event.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;
            button.disabled=true;
            try{
                const details={};fields.forEach(([key,,type])=>{const value=document.getElementById('edit-'+key).value.trim();details[key]=type==='number'?Number(value):value;});
                Object.assign(details,readRoomFields(editRooms,'edit-room'));
                details.description=document.getElementById('edit-description').value.trim();details.is_published=document.getElementById('edit-published').checked;details.facilities=[...editor.querySelectorAll('[name=editFacility]:checked')].map(el=>el.value);
                const links=[...new Set(document.getElementById('edit-links').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
                if(links.some(url=>!safePhotoUrl(url)||url.length>2048))throw new Error('Use valid HTTPS image links.');
                const files=[...document.getElementById('edit-files').files];validateImageFiles(files,retained.length+links.length);
                if(retained.length+links.length+files.length<1)throw new Error('Keep at least one image.');
                message(status,'Preparing and uploading photos…');
                const blobs=await prepareImages(files),folder=crypto.randomUUID(),paths=blobs.map((_,i)=>folder+'/'+(i+1)+'.webp');
                await uploadPGImages(paths,blobs);
                details.photo_urls=retained.filter(photo=>!photo.path).map(photo=>photo.url).concat(links);details.photo_paths=retained.filter(photo=>photo.path).map(photo=>photo.path).concat(paths);
                const {error}=await db.rpc('admin_save_pg',{pg_id:pg.id,expected_updated_at:pg.updated_at,details});if(error)throw error;
                close(editor);message(adminStatus,'Listing updated: '+pg.name);await loadRequests();await loadPGs();
            }catch(error){message(status,error.message || 'Could not save changes. Refresh before retrying.',true);}
            finally{button.disabled=false;}
        });
    }
})();
