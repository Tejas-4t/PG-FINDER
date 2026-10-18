// ==========================================
// PG FINDER - JAVASCRIPT
// Public listings, backed by Supabase
// ==========================================

// ------------------------------------------
// 1. GET ELEMENTS + SUPABASE CONNECTION
// ------------------------------------------

const searchButton = document.querySelector(".search-btn");
const quickButtons = document.querySelectorAll(".quick-filters button");
const gridEl = document.getElementById("pgGrid");

// --- Connect to Supabase (settings live in supabase-config.js) ---
// Note: the library itself creates a global called "supabase",
// so we name our connection "db".

let db = null;

(function connectToSupabase() {

    const cfg = window.PG_SUPABASE;

    if (!window.supabase || !cfg || !cfg.url || !cfg.publishableKey) {
        console.error("[PG Finder] Supabase is not configured. " +
                      "Check supabase-config.js and the script tags in index.html.");
        return;
    }

    // Safety net: refuse to run if a SECRET key was pasted by mistake.
    let isSecret = /^sb_secret_/.test(cfg.publishableKey);

    try {
        const parts = cfg.publishableKey.split(".");
        if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (payload.role === "service_role") isSecret = true;
        }
    } catch (e) { /* not a JWT - that's fine */ }

    if (isSecret) {
        console.error("[PG Finder] A SECRET / service_role key was found in " +
                      "supabase-config.js. Remove it immediately and rotate it in " +
                      "Supabase (Settings > API Keys). Only the publishable key may be used here.");
        return;
    }

    db = window.supabase.createClient(cfg.url, cfg.publishableKey);

})();


// --- PG data: what we read, and how to display it ---

// Columns that exist in the "pgs" table (see supabase/01_schema.sql),
// plus the related photos from "pg_photos".
const PG_COLUMNS =
    "id, name, description, address, area, city, contact_phone, " +
    "monthly_rent, sharing_type, facilities, total_beds, available_beds, " +
    "is_verified, rating, created_at, photo_urls, " +
    "pg_photos ( storage_path, sort_order )";

const SHARING_LABELS = {
    single: "Single Sharing",
    double: "Double Sharing",
    triple: "Triple Sharing"
};

const FACILITY_LABELS = {
    wifi: "📶 Wi-Fi",
    food: "🍱 Food",
    laundry: "🧺 Laundry",
    parking: "🅿️ Parking",
    ac: "❄️ AC",
    cctv: "📹 CCTV"
};

// Your existing photos are used until a PG has uploaded photos
const FALLBACK_IMAGE_CLASSES = ["image-one", "image-two", "image-three"];

// Quick filter buttons (data-filter="..." in index.html)
const FILTERS = {
    "rent-5k-8k": function(pg) { return pg.monthly_rent >= 5000 && pg.monthly_rent <= 8000; },
    "single":     function(pg) { return pg.sharing_type === "single"; },
    "food":       function(pg) { return pg.facilities.includes("food"); },
    "wifi":       function(pg) { return pg.facilities.includes("wifi"); }
};

let allPGs = [];
let activeFilter = null;
let pgsLoaded = false;


// Makes text safe to put inside HTML (stops script injection)
function esc(value) {

    return String(value === null || value === undefined ? "" : value)
        .replace(/[&<>"']/g, function(c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;",
                     '"': "&quot;", "'": "&#39;" }[c];
        });

}

function formatRent(amount) {
    return "₹" + Number(amount).toLocaleString("en-IN");
}

function sortedPhotos(pg) {
    return (pg.photo_urls || []).filter(safePhotoUrl).map(function(url, index) { return { external_url: url, sort_order: index }; }).concat(pg.pg_photos.slice().sort(function(a, b) {
        return a.sort_order - b.sort_order;
    }));
}

function safePhotoUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch (_) { return false; }
}

function photoUrl(path) {
    return db.storage.from("pg-photos").getPublicUrl(path).data.publicUrl;
}


// --- Details popup (replaces the old alert box) ---

const detailsModal = document.createElement("div");

detailsModal.className = "custom-modal";

detailsModal.innerHTML = `
    <div class="modal-box">
        <button class="close-modal" aria-label="Close">&times;</button>
        <div id="pgDetailsBody"></div>
    </div>
`;

document.body.appendChild(detailsModal);
detailsModal.querySelector(".close-modal").addEventListener("click", function() { detailsModal.classList.remove("show"); });

detailsModal.addEventListener("click", function(event) {
    if (event.target === detailsModal) detailsModal.classList.remove("show");
});

document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") detailsModal.classList.remove("show");
});

function showDetails(pg) {

    const phone = pg.contact_phone.replace(/[^0-9+]/g, "");

    const beds = pg.available_beds > 0
        ? pg.available_beds + " of " + pg.total_beds + " beds available"
        : "Currently full";

    document.getElementById("pgDetailsBody").innerHTML = `
        <h2>${esc(pg.name)}</h2>
        <p>📍 ${esc(pg.address)}${pg.address.includes(pg.area) ? "" : ", " + esc(pg.area)}, ${esc(pg.city)}</p>

        <div class="pg-detail-meta">
            <div><small>Rent</small><strong>${formatRent(pg.monthly_rent)} / month</strong></div>
            <div><small>Room</small><strong>${esc(SHARING_LABELS[pg.sharing_type] || pg.sharing_type)}</strong></div>
            <div><small>Availability</small><strong>${esc(beds)}</strong></div>
            <div><small>Status</small><strong>${pg.is_verified ? "✓ Verified" : "Not yet verified"}</strong></div>
        </div>

        <div class="pg-detail-chips">
            ${pg.facilities.map(function(f) {
                return "<span>" + esc(FACILITY_LABELS[f] || f) + "</span>";
            }).join("")}
        </div>

        ${pg.description ? "<p>" + esc(pg.description) + "</p>" : ""}

        <a class="pg-detail-call" href="tel:${esc(phone)}">
            📞 Call: ${esc(pg.contact_phone)}
        </a>
    `;

    const gallery = document.createElement("div");
    gallery.className = "photo-gallery";
    sortedPhotos(pg).forEach(function(photo) {
        const img = document.createElement("img");
        img.src = photo.external_url || photoUrl(photo.storage_path);
        img.alt = pg.name + " photo"; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
        gallery.appendChild(img);
    });
    document.getElementById("pgDetailsBody").appendChild(gallery);
    detailsModal.classList.add("show");

}


// --- Build one PG card (same markup/classes as your original cards) ---

function buildCard(pg, index) {

    const photos = sortedPhotos(pg);

    const card = document.createElement("div");

    card.className = "pg-card";
    card.dataset.id = pg.id;

    const fallbackClass = photos.length
        ? ""
        : " " + FALLBACK_IMAGE_CLASSES[index % FALLBACK_IMAGE_CLASSES.length];

    const bedsText = pg.available_beds > 0
        ? "● " + pg.available_beds + (pg.available_beds === 1 ? " bed" : " beds") + " available"
        : "● Currently full";

    card.innerHTML = `

        <div class="image-area${fallbackClass}">

            ${pg.is_verified ? '<span class="verified">✓ Verified</span>' : ""}

            <button class="heart" aria-label="Save this PG">♡</button>

            ${photos.length ? `
                <div class="image-bottom">
                    <span>📷 ${photos.length} ${photos.length === 1 ? "Photo" : "Photos"}</span>
                </div>` : ""}

        </div>

        <div class="card-content">

            <div class="card-top">

                <div>
                    <h3>${esc(pg.name)}</h3>
                    <p class="location">📍 ${esc(pg.area)}, ${esc(pg.city)}</p>
                </div>

                <div class="rating">
                    ★ ${pg.rating === null ? "New" : Number(pg.rating).toFixed(1)}
                </div>

            </div>

            <div class="price">
                ${formatRent(pg.monthly_rent)}
                <span>/ month</span>
            </div>

            <div class="room-type">
                🛏️ ${esc(SHARING_LABELS[pg.sharing_type] || pg.sharing_type)}
            </div>

            <div class="facilities">
                ${pg.facilities.map(function(f) {
                    return "<span>" + esc(FACILITY_LABELS[f] || f) + "</span>";
                }).join("")}
            </div>

            <div class="card-footer">

                <span class="available${pg.available_beds > 0 ? "" : " full"}">
                    ${bedsText}
                </span>

                <button type="button" class="view-details">
                    View Details
                </button>

            </div>

        </div>
    `;

    // Cover photo from Supabase Storage (if the PG has photos)
    if (photos.length) {

        const url = (photos[0].external_url || photoUrl(photos[0].storage_path)).replace(/"/g, "%22");

        card.querySelector(".image-area").style.backgroundImage =
            'linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.5)), url("' + url + '")';

    }

    // Heart (not saved yet - saved favourites come in a later stage)
    const heart = card.querySelector(".heart");

    heart.addEventListener("click", function() {
        heart.textContent = heart.textContent.trim() === "♡" ? "♥" : "♡";
    });

    card.querySelector(".view-details").addEventListener("click", function() {
        showDetails(pg);
    });

    return card;

}


// --- Grid states: loading / error / empty / results ---

function showMessage(html, isError) {

    gridEl.innerHTML = "";

    const box = document.createElement("div");

    box.className = "grid-message" + (isError ? " error" : "");
    box.innerHTML = html;

    gridEl.appendChild(box);

    return box;

}

function showLoading() {

    gridEl.innerHTML = "";

    for (let i = 0; i < 3; i++) {

        const sk = document.createElement("div");

        sk.className = "pg-card skeleton";
        sk.setAttribute("aria-hidden", "true");

        gridEl.appendChild(sk);

    }

    gridEl.setAttribute("aria-busy", "true");

}

function friendlyError(err) {

    const code = (err && err.code) || "";
    const msg = ((err && err.message) || "").toLowerCase();

    if (!db) {
        return "The website isn't connected to Supabase yet. " +
               "Please check <b>supabase-config.js</b>.";
    }

    if (msg.includes("failed to fetch") || msg.includes("networkerror") ||
        msg.includes("timeout") || msg.includes("abort") || msg.includes("load failed")) {
        return "Couldn't reach the server. Please check your internet connection and try again.";
    }

    if (code === "42501" || msg.includes("permission denied")) {
        return "The database refused access to the PG list. " +
               "(Owner: re-run <b>01_schema.sql</b> in Supabase to restore permissions.)";
    }

    if (code === "PGRST205" || code === "42P01" || msg.includes("could not find the table")) {
        return "The <b>pgs</b> table wasn't found. " +
               "(Owner: run <b>01_schema.sql</b> in the Supabase SQL Editor.)";
    }

    if (code === "PGRST200" || msg.includes("relationship")) {
        return "The PG photos link wasn't found. " +
               "(Owner: check that the <b>pg_photos</b> table exists.)";
    }

    if (msg.includes("invalid api key") || msg.includes("apikey") || code === "PGRST301") {
        return "Supabase rejected the key. (Owner: check <b>supabase-config.js</b>.)";
    }

    return "Something went wrong while loading PGs. Please try again.";

}

function updateStats() {

    const listings = document.getElementById("statListings");
    const beds = document.getElementById("statBeds");

    if (listings) listings.textContent = allPGs.length;

    if (beds) {
        beds.textContent = allPGs.reduce(function(sum, pg) {
            return sum + pg.available_beds;
        }, 0);
    }

}

function renderPGs() {

    if (!pgsLoaded) return;

    gridEl.removeAttribute("aria-busy");

    const list = activeFilter ? allPGs.filter(FILTERS[activeFilter]) : allPGs;

    if (allPGs.length === 0) {

        showMessage("No PGs have been listed in Karvenagar yet.<br>Check back soon!");

        return;

    }

    if (list.length === 0) {

        const box = showMessage("No PGs match this filter right now.<br>");

        const clear = document.createElement("button");

        clear.type = "button";
        clear.textContent = "Show all PGs";

        clear.addEventListener("click", function() {
            activeFilter = null;
            quickButtons.forEach(function(b) { b.classList.remove("active"); });
            renderPGs();
        });

        box.appendChild(clear);

        return;

    }

    gridEl.innerHTML = "";

    list.forEach(function(pg, index) {
        gridEl.appendChild(buildCard(pg, index));
    });

}

// --- The actual database request ---

async function loadPGs() {

    pgsLoaded = false;

    showLoading();

    if (!db) {
        showMessage(friendlyError(null), true);
        return;
    }

    try {

        // Only published PGs on the public page. Row Level Security in the
        // database ALSO enforces this - this is just for clarity.
        let query = db
            .from("pgs")
            .select(PG_COLUMNS)
            .eq("is_published", true)
            .order("created_at", { ascending: false })
            .order("name", { ascending: true })
            .limit(60);

        if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
            query = query.abortSignal(AbortSignal.timeout(15000));
        }

        const { data, error } = await query;

        if (error) throw error;

        allPGs = (data || []).map(function(pg) {
            return Object.assign({}, pg, {
                facilities: pg.facilities || [],
                pg_photos: pg.pg_photos || [],
                rating: pg.rating === null || pg.rating === undefined ? null : Number(pg.rating)
            });
        });

        pgsLoaded = true;

        console.log("[PG Finder] Loaded " + allPGs.length + " PG(s) from Supabase.");

        updateStats();
        renderPGs();

    } catch (err) {

        console.error("[PG Finder] Could not load PGs from Supabase:", err);

        const box = showMessage(friendlyError(err), true);

        gridEl.removeAttribute("aria-busy");

        const retry = document.createElement("button");

        retry.type = "button";
        retry.textContent = "Try again";
        retry.addEventListener("click", loadPGs);

        box.appendChild(retry);

    }

}


// ------------------------------------------
// 19. QUICK FILTER BUTTONS
// ------------------------------------------
// Click a filter to apply it, click again to remove it.

quickButtons.forEach(function(button) {

    button.addEventListener("click", function() {

        const key = button.dataset.filter;

        activeFilter = (activeFilter === key) ? null : key;

        quickButtons.forEach(function(b) {
            b.classList.toggle("active", b.dataset.filter === activeFilter);
        });

        renderPGs();

        const section = document.querySelector(".pg-section");

        if (section) section.scrollIntoView({ behavior: "smooth" });

    });

});


// ------------------------------------------
// 20. SEARCH BUTTON
// ------------------------------------------

if (searchButton) {

    searchButton.addEventListener("click", function() {

        const popularPGSection = document.querySelector(".pg-section");

        if (popularPGSection) {
            popularPGSection.scrollIntoView({
                behavior: "smooth"
            });
        }

    });

}
// ------------------------------------------
// 21. LOAD PGs FROM SUPABASE
// ------------------------------------------

loadPGs();
