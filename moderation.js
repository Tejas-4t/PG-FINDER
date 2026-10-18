// Listing requests are insert-only for visitors. Supabase enforces admin approval.
(function () {
    'use strict';
    let previousFocus = null;
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
        previousFocus = document.activeElement;
        modal.classList.add('show'); document.body.style.overflow = 'hidden';
        modal.querySelector('input,button').focus();
    }
    function close(modal) {
        modal.classList.remove('show'); document.body.style.overflow = '';
        if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function message(el, text, isError = false) { el.textContent = text; el.classList.toggle('error', isError); }
    function input(id, label, type, attributes = '') {
        return '<div><label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" type="' + type + '" ' + attributes + ' required></div>';
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
            <div><label for="requestSharing">Room type</label><select id="requestSharing" name="requestSharing" required><option value="">Select sharing</option><option value="single">Single Sharing</option><option value="double">Double Sharing</option><option value="triple">Triple Sharing</option></select></div>
            ${input('requestTotalBeds', 'Total beds', 'number', 'min="1" max="10000" step="1"')}
            ${input('requestAvailableBeds', 'Available beds', 'number', 'min="0" max="10000" step="1"')}
          </div></fieldset>
          <fieldset><legend>Facilities</legend><div class="facility-options">${Object.entries(FACILITY_LABELS).map(([value, label]) => '<label><input type="checkbox" name="facility" value="' + value + '">' + label + '</label>').join('')}</div></fieldset>
          <label for="requestDescription">Description</label><textarea id="requestDescription" name="requestDescription" maxlength="2000" rows="3" placeholder="Food, house rules, nearby landmarks and what makes your PG special"></textarea>
          <label for="requestPhotos">Photo links</label><textarea id="requestPhotos" name="requestPhotos" rows="3" maxlength="16384" required placeholder="https://example.com/room.jpg"></textarea>
          <p class="field-help">Add 1–8 public HTTPS photo links, one per line. Direct image links work best. Make sure you have permission to share them.</p>
          <div class="spam-trap" aria-hidden="true"><label for="requestWebsite">Leave blank</label><input id="requestWebsite" name="requestWebsite" tabindex="-1" autocomplete="off"></div>
          <label><input type="checkbox" id="requestConsent" required> I confirm these details are accurate and may be published, including the address, listing contact number and photos, after approval.</label>
          <div class="form-status" id="requestStatus" role="status" aria-live="polite"></div>
          <button class="modal-main-btn" type="submit">Send for Approval</button>
        </form>`, 'listing-dialog');
    const requestForm = document.getElementById('listingRequestForm');
    const requestStatus = document.getElementById('requestStatus');
    let requestId = crypto.randomUUID();
    document.querySelectorAll('[data-open-listing]').forEach(button => button.addEventListener('click', () => open(listingModal)));
    requestForm.addEventListener('submit', async event => {
        event.preventDefault();
        const button = requestForm.querySelector('[type=submit]');
        if (button.disabled) return;
        const f = new FormData(requestForm);
        const photos = [...new Set(String(f.get('requestPhotos')).split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
        if (photos.length < 1 || photos.length > 8 || photos.some(url => !safePhotoUrl(url) || url.length > 2048)) {
            message(requestStatus, 'Add 1–8 valid public HTTPS photo links, one per line.', true); return;
        }
        if (Number(f.get('requestAvailableBeds')) > Number(f.get('requestTotalBeds'))) {
            message(requestStatus, 'Available beds cannot exceed total beds.', true); return;
        }
        if (f.get('requestWebsite')) { message(requestStatus, 'Unable to submit this request.', true); return; }
        if (!db) { message(requestStatus, 'The connection is unavailable. Please try again later.', true); return; }
        button.disabled = true; button.textContent = 'Sending…'; message(requestStatus, '');
        const payload = {
            id: requestId, requester_name: String(f.get('requesterName')).trim(), requester_email: String(f.get('requesterEmail')).trim(),
            name: String(f.get('requestPGName')).trim(), address: String(f.get('requestAddress')).trim(), area: String(f.get('requestArea')).trim(), city: String(f.get('requestCity')).trim(),
            contact_phone: String(f.get('requestPhone')).trim(), monthly_rent: Number(f.get('requestRent')), sharing_type: f.get('requestSharing'),
            total_beds: Number(f.get('requestTotalBeds')), available_beds: Number(f.get('requestAvailableBeds')), facilities: f.getAll('facility'),
            description: String(f.get('requestDescription')).trim(), photo_urls: photos
        };
        try {
            const {error} = await db.from('pg_listing_requests').insert(payload).abortSignal(AbortSignal.timeout(20000));
            if (error && error.code !== '23505') throw error;
            message(requestStatus, 'Request received. Your PG is awaiting admin approval and is not public yet. Reference: ' + requestId.slice(0, 8));
            requestForm.reset(); requestId = crypto.randomUUID();
        } catch (error) {
            console.error('[PG Finder] Submission failed', error);
            message(requestStatus, 'We could not confirm your request. Please check the details and connection, then retry. Your form has been kept.', true);
        } finally { button.disabled = false; button.textContent = 'Send for Approval'; }
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
          <div class="admin-toolbar"><label for="requestFilter">Requests</label><select id="requestFilter"><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><button id="refreshRequests" type="button">Refresh</button><button id="adminSignOut" type="button">Sign Out</button></div>
          <div id="reviewRequests" aria-live="polite"></div>
        </section>`, 'admin-dialog');
    const adminStatus = document.getElementById('adminStatus');
    const queue = document.getElementById('adminQueue');
    const signIn = document.getElementById('adminSignIn');
    const reviewList = document.getElementById('reviewRequests');
    let adminUserId = null, refreshVersion = 0;
    function resetAdmin() {
        adminUserId = null; refreshVersion++; queue.hidden = true; signIn.hidden = false; reviewList.replaceChildren();
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
        document.getElementById('adminPanel-title').textContent = 'Listing Approvals';
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
        const version = ++refreshVersion;
        reviewList.textContent = 'Loading requests…';
        try {
            const {data, error} = await db.from('pg_listing_requests').select('*').eq('status', document.getElementById('requestFilter').value).order('created_at', {ascending: false}).limit(100).abortSignal(AbortSignal.timeout(20000));
            if (error) throw error;
            if (version !== refreshVersion || !adminUserId) return;
            reviewList.replaceChildren();
            if (!data.length) { reviewList.innerHTML = '<p class="admin-empty">No requests in this category.</p>'; return; }
            data.forEach(renderRequest);
            if (data.length === 100) { const note = document.createElement('p'); note.textContent = 'Showing the latest 100 requests. Review these and refresh to see older pending requests.'; reviewList.appendChild(note); }
        } catch (error) { if (version === refreshVersion) reviewList.textContent = 'Could not load requests. Use Refresh to try again.'; }
    }
    function renderRequest(request) {
        const card = document.createElement('article'); card.className = 'request-card';
        const fields = [['Requested by', request.requester_name], ['Private email', request.requester_email], ['Public phone', request.contact_phone], ['Address', [request.address,request.area,request.city].join(', ')], ['Rent', formatRent(request.monthly_rent) + ' / month'], ['Room', SHARING_LABELS[request.sharing_type]], ['Beds', request.available_beds + ' available / ' + request.total_beds + ' total'], ['Submitted', new Date(request.created_at).toLocaleString()]];
        card.innerHTML = `<span class="status-badge">${esc(request.status)}</span><h3>${esc(request.name)}</h3><dl class="request-meta">${fields.map(([label,value]) => '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>').join('')}</dl><p>${request.facilities.map(value => esc(FACILITY_LABELS[value] || value)).join(' · ')}</p><p>${esc(request.description)}</p><div class="photo-links"></div>`;
        (request.photo_urls || []).filter(safePhotoUrl).forEach((url, index) => {
            const link = document.createElement('a'); link.href = url; link.textContent = 'View photo ' + (index + 1); link.target = '_blank'; link.rel = 'noopener noreferrer';
            card.querySelector('.photo-links').appendChild(link);
        });
        if (request.status === 'pending') {
            const noteLabel = document.createElement('label'); noteLabel.textContent = 'Review notes (optional)';
            const notes = document.createElement('textarea'); notes.id = 'notes-' + request.id; notes.maxLength = 1000; notes.rows = 2; noteLabel.htmlFor = notes.id;
            const actions = document.createElement('div'); actions.className = 'review-actions';
            const status = document.createElement('div'); status.className = 'form-status'; status.setAttribute('role','status');
            ['approved','rejected'].forEach(decision => {
                const button = document.createElement('button'); button.type = 'button'; button.textContent = decision === 'approved' ? 'Approve & Publish' : 'Reject'; button.className = decision === 'rejected' ? 'reject' : '';
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
})();
