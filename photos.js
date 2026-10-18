// Shared upload validation and accessible photo carousel. No service-role credentials.
const PG_IMAGE_BUCKET = 'pg-listing-images';
const PG_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
function validateImageFiles(files, existingCount = 0) {
    if (files.length + existingCount > 3) throw new Error('A PG can have a maximum of 3 images. Remove an image before adding another.');
    for (const file of files) {
        if (file.size > PG_MAX_IMAGE_BYTES) throw new Error(file.name + ' exceeds 5 MB. Choose a smaller image.');
        if (!file.size) throw new Error(file.name + ' is empty. Choose another image.');
        if (!/^image\/(jpeg|png|webp|gif|avif|bmp|x-ms-bmp)$/i.test(file.type)) throw new Error(file.name + ': choose a JPEG, PNG, WebP, GIF, AVIF or BMP image.');
    }
}
async function prepareImages(files) {
    validateImageFiles(files);
    const images = [];
    for (const file of files) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
            if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000) throw new Error('dimensions');
            const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));
            if (!blob || blob.type !== 'image/webp' || blob.size > PG_MAX_IMAGE_BYTES) throw new Error('conversion');
            images.push(blob);
        } catch (_) { throw new Error(file.name + ' could not be read. Export it as JPEG or PNG and try again (maximum 80 megapixels).'); }
        finally { if (bitmap) bitmap.close(); }
    }
    return images;
}
async function uploadPGImages(paths, blobs, completed = new Set()) {
    for (let i = 0; i < paths.length; i++) {
        if (completed.has(paths[i])) continue;
        const {error} = await db.storage.from(PG_IMAGE_BUCKET).upload(paths[i], blobs[i], {contentType:'image/webp', upsert:false, cacheControl:'3600'});
        // Only this request knows its random paths. An existing immutable slot means
        // an earlier upload succeeded even if its response was lost.
        if (error && String(error.statusCode) !== '409' && !/already exists|duplicate/i.test(error.message)) throw error;
        completed.add(paths[i]);
    }
}
async function resolvePGImages(records) {
    const paths = [...new Set(records.flatMap(pg => pg.photo_paths || []))];
    let byPath = new Map();
    if (paths.length) {
        const {data, error} = await db.storage.from(PG_IMAGE_BUCKET).createSignedUrls(paths, 3600);
        if (!error) byPath = new Map((data || []).filter(item => item.signedUrl).map(item => [item.path, item.signedUrl]));
    }
    records.forEach(pg => { pg.uploaded_photos = (pg.photo_paths || []).map(path => ({storage_path:path, external_url:byPath.get(path) || '', unavailable:!byPath.has(path)})); });
    return records;
}
function createPhotoCarousel(photos, name, compact = false) {
    const gallery = document.createElement('div'); gallery.className = 'pg-carousel' + (compact ? ' compact' : '');
    gallery.setAttribute('role','region'); gallery.setAttribute('aria-label',name + ' photos'); gallery.tabIndex=0;
    if (!photos.length) { gallery.textContent='No photos available'; return gallery; }
    const img=document.createElement('img'); img.loading='lazy'; img.referrerPolicy='no-referrer';
    const failure=document.createElement('span'); failure.className='photo-failure'; failure.hidden=true;
    const counter=document.createElement('span'); counter.className='photo-counter'; counter.setAttribute('aria-live','polite');
    let position=0;
    function draw() {
        const photo=photos[position]; failure.hidden=true; img.hidden=false;
        img.alt=name+' — image '+(position+1)+' of '+photos.length;
        counter.textContent=(position+1)+' / '+photos.length;
        if (photo.unavailable) { img.removeAttribute('src'); img.hidden=true; failure.hidden=false; failure.textContent='Photo unavailable. Refresh to retry.'; }
        else img.src=photo.external_url || photoUrl(photo.storage_path);
    }
    img.addEventListener('error',()=>{img.hidden=true;failure.hidden=false;failure.textContent='Photo unavailable. Refresh to retry.';});
    gallery.append(img,failure,counter);
    function move(delta){position=(position+delta+photos.length)%photos.length;draw();}
    if (photos.length>1) {
        [-1,1].forEach(delta=>{const button=document.createElement('button'); button.type='button';button.className='photo-arrow '+(delta<0?'prev':'next');button.textContent=delta<0?'‹':'›';button.setAttribute('aria-label',(delta<0?'Previous':'Next')+' photo of '+name);button.addEventListener('click',event=>{event.stopPropagation();move(delta);});gallery.appendChild(button);});
        gallery.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();move(event.key==='ArrowLeft'?-1:1);}});
        let touchX=null;
        gallery.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;},{passive:true});
        gallery.addEventListener('touchend',e=>{if(touchX!==null && Math.abs(e.changedTouches[0].clientX-touchX)>40)move(e.changedTouches[0].clientX<touchX?1:-1);touchX=null;},{passive:true});
    }
    draw();return gallery;
}
