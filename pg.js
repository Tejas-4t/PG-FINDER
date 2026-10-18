// ==========================================
// PG FINDER - JAVASCRIPT
// Frontend-only prototype
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
    "is_verified, rating, created_at, " +
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
    return pg.pg_photos.slice().sort(function(a, b) {
        return a.sort_order - b.sort_order;
    });
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

        const url = photoUrl(photos[0].storage_path).replace(/"/g, "%22");

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
// 2. CREATE OWNER LOGIN POPUP
// ------------------------------------------

const loginModal = document.createElement("div");

loginModal.className = "custom-modal";

loginModal.innerHTML = `
    <div class="modal-box">

        <button class="close-modal">&times;</button>

        <h2>Owner Login</h2>
        <p>Login to manage your PG listings.</p>

        <form id="loginForm">

            <label>Email / Username</label>
            <input type="text" id="loginUsername"
                   placeholder="Enter username or email" required>

            <label>Password</label>
            <input type="password" id="loginPassword"
                   placeholder="Enter password" required>

            <button type="submit" class="modal-main-btn">
                Login
            </button>

        </form>

        <p class="modal-bottom">
            New owner?
            <button type="button" id="signupLink">
                Create an account
            </button>
        </p>

    </div>
`;

document.body.appendChild(loginModal);


// ------------------------------------------
// 3. OWNER SIGNUP POPUP
// ------------------------------------------

const signupModal = document.createElement("div");

signupModal.className = "custom-modal";

signupModal.innerHTML = `
    <div class="modal-box">

        <button class="close-modal">&times;</button>

        <h2>Create Owner Account</h2>
        <p>Create an account to list your PG.</p>

        <form id="signupForm">

            <label>Owner Name</label>
            <input type="text"
                   id="ownerName"
                   placeholder="Enter your name"
                   required>

            <label>Email</label>
            <input type="email"
                   id="ownerEmail"
                   placeholder="Enter email"
                   required>

            <label>Mobile Number</label>
            <input type="tel"
                   id="ownerMobile"
                   placeholder="Enter mobile number"
                   required>

            <label>Password</label>
            <input type="password"
                   id="ownerPassword"
                   placeholder="Create password"
                   required>

            <label>Confirm Password</label>
            <input type="password"
                   id="confirmPassword"
                   placeholder="Confirm password"
                   required>

            <button type="submit" class="modal-main-btn">
                Create Account
            </button>

        </form>

    </div>
`;

document.body.appendChild(signupModal);


// ------------------------------------------
// 4. OWNER DASHBOARD
// ------------------------------------------

const dashboardModal = document.createElement("div");

dashboardModal.className = "custom-modal";

dashboardModal.innerHTML = `
    <div class="modal-box dashboard-box">

        <button class="close-modal">&times;</button>

        <h2>Owner Dashboard</h2>

        <p id="welcomeOwner">
            Welcome, Owner!
        </p>

        <div class="dashboard-buttons">

            <button id="listPGButton" class="dashboard-btn">
                + List Your PG
            </button>

            <button id="myListingsButton" class="dashboard-btn">
                My PG Listings
            </button>

            <button id="logoutButton" class="dashboard-btn logout-btn">
                Logout
            </button>

        </div>

    </div>
`;

document.body.appendChild(dashboardModal);


// ------------------------------------------
// 5. LIST YOUR PG FORM
// ------------------------------------------

const listPGModal = document.createElement("div");

listPGModal.className = "custom-modal";

listPGModal.innerHTML = `
    <div class="modal-box large-modal">

        <button class="close-modal">&times;</button>

        <h2>List Your PG</h2>
        <p>Enter your PG details below.</p>

        <form id="pgForm">

            <h3>Basic Information</h3>

            <label>PG Name</label>
            <input type="text"
                   id="newPGName"
                   placeholder="Example: Sunrise Premium PG"
                   required>

            <label>Location</label>
            <input type="text"
                   id="newPGLocation"
                   value="Karvenagar, Pune"
                   required>

            <label>Contact Number</label>
            <input type="tel"
                   id="newPGContact"
                   placeholder="Enter contact number"
                   required>


            <h3>Pricing</h3>

            <label>Monthly Rent</label>
            <input type="number"
                   id="newPGRent"
                   placeholder="Example: 7000"
                   required>

            <label>Available Beds</label>
            <input type="number"
                   id="newPGBeds"
                   placeholder="Example: 2"
                   required>


            <h3>Room Type</h3>

            <select id="newPGRoom" required>

                <option value="">
                    Select room type
                </option>

                <option value="Single Sharing">
                    Single Sharing
                </option>

                <option value="Double Sharing">
                    Double Sharing
                </option>

                <option value="Triple Sharing">
                    Triple Sharing
                </option>

            </select>


            <h3>Facilities</h3>

            <div class="facility-options">

                <label>
                    <input type="checkbox" value="Wi-Fi">
                    Wi-Fi
                </label>

                <label>
                    <input type="checkbox" value="Food">
                    Food
                </label>

                <label>
                    <input type="checkbox" value="Laundry">
                    Laundry
                </label>

                <label>
                    <input type="checkbox" value="Parking">
                    Parking
                </label>

                <label>
                    <input type="checkbox" value="AC">
                    AC
                </label>

                <label>
                    <input type="checkbox" value="CCTV">
                    CCTV
                </label>

            </div>


            <h3>Description</h3>

            <textarea id="newPGDescription"
                      rows="4"
                      placeholder="Describe your PG..."></textarea>


            <h3>PG Photos</h3>

            <input type="file"
                   id="newPGPhotos"
                   accept="image/*"
                   multiple>


            <button type="submit" class="modal-main-btn">
                Submit PG
            </button>

        </form>

    </div>
`;

document.body.appendChild(listPGModal);


// ------------------------------------------
// 6. ADD BASIC MODAL CSS USING JAVASCRIPT
// ------------------------------------------

const modalStyle = document.createElement("style");

modalStyle.innerHTML = `

.custom-modal {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    z-index: 9999;
    align-items: center;
    justify-content: center;
    padding: 20px;
}

.custom-modal.show {
    display: flex;
}

.modal-box {
    background: white;
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    overflow-y: auto;
    border-radius: 18px;
    padding: 30px;
    position: relative;
}

.large-modal {
    max-width: 650px;
}

.modal-box h2 {
    margin-bottom: 8px;
}

.modal-box h3 {
    margin-top: 22px;
    margin-bottom: 10px;
}

.modal-box p {
    margin-bottom: 20px;
}

.close-modal {
    position: absolute;
    right: 18px;
    top: 12px;
    border: none;
    background: none;
    font-size: 30px;
    cursor: pointer;
}

.modal-box label {
    display: block;
    margin-top: 12px;
    margin-bottom: 5px;
    font-weight: 600;
}

.modal-box input,
.modal-box select,
.modal-box textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 15px;
    box-sizing: border-box;
}

.modal-main-btn {
    width: 100%;
    margin-top: 20px;
    padding: 13px;
    border: none;
    border-radius: 8px;
    background: #111;
    color: white;
    font-size: 16px;
    cursor: pointer;
}

.modal-main-btn:hover {
    opacity: 0.85;
}

.modal-bottom {
    text-align: center;
    margin-top: 18px;
}

.modal-bottom button {
    border: none;
    background: none;
    cursor: pointer;
    font-weight: bold;
}

.dashboard-buttons {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.dashboard-btn {
    padding: 14px;
    border: 1px solid #ddd;
    background: white;
    border-radius: 10px;
    cursor: pointer;
    font-size: 16px;
}

.dashboard-btn:hover {
    background: #f5f5f5;
}

.logout-btn {
    color: #c0392b;
}

.facility-options {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

.facility-options label {
    margin: 0;
    font-weight: normal;
}

.facility-options input {
    width: auto;
    margin-right: 5px;
}

`;

document.head.appendChild(modalStyle);


// ------------------------------------------
// 7. HELPER FUNCTIONS
// ------------------------------------------

function openModal(modal) {
    modal.classList.add("show");
}

function closeModal(modal) {
    modal.classList.remove("show");
}


// ------------------------------------------
// 8. OWNER LOGIN BUTTON
// ------------------------------------------

const ownerLoginButton = document.querySelector(".owner-btn");

if (ownerLoginButton) {

    ownerLoginButton.addEventListener("click", function(event) {

        event.preventDefault();

        openModal(loginModal);

    });

}


// ------------------------------------------
// 9. CLOSE BUTTONS
// ------------------------------------------

document.querySelectorAll(".close-modal").forEach(function(button) {

    button.addEventListener("click", function() {

        button.closest(".custom-modal").classList.remove("show");

    });

});


// ------------------------------------------
// 10. SIGNUP LINK
// ------------------------------------------

document.getElementById("signupLink").addEventListener("click", function() {

    closeModal(loginModal);

    openModal(signupModal);

});


// ------------------------------------------
// 11. SIGNUP
// ------------------------------------------

document.getElementById("signupForm").addEventListener("submit", function(event) {

    event.preventDefault();

    const ownerName = document.getElementById("ownerName").value;

    const successMessage = document.createElement("div");

successMessage.textContent = "Account created successfully!";

successMessage.style.position = "fixed";
successMessage.style.top = "30px";
successMessage.style.right = "30px";
successMessage.style.background = "#174f43";
successMessage.style.color = "white";
successMessage.style.padding = "15px 25px";
successMessage.style.borderRadius = "10px";
successMessage.style.zIndex = "10000";
successMessage.style.fontWeight = "600";
successMessage.style.boxShadow = "0 5px 20px rgba(0,0,0,0.2)";

document.body.appendChild(successMessage);

setTimeout(function () {
    successMessage.remove();
}, 3000);

    closeModal(signupModal);

    document.getElementById("welcomeOwner").textContent =
        "Welcome, " + ownerName + "!";

    openModal(dashboardModal);

});


// ------------------------------------------
// 12. LOGIN
// ------------------------------------------

document.getElementById("loginForm").addEventListener("submit", function(event) {

    event.preventDefault();

    const username =
        document.getElementById("loginUsername").value;

    const password =
        document.getElementById("loginPassword").value;

    if (username === "owner" && password === "1234") {

        const loginMessage = document.createElement("div");

        loginMessage.textContent = "Logged in successfully!";

        loginMessage.style.position = "fixed";
        loginMessage.style.top = "30px";
        loginMessage.style.right = "30px";
        loginMessage.style.background = "#174f43";
        loginMessage.style.color = "white";
        loginMessage.style.padding = "15px 25px";
        loginMessage.style.borderRadius = "10px";
        loginMessage.style.zIndex = "10000";
        loginMessage.style.fontWeight = "600";
        loginMessage.style.boxShadow = "0 5px 20px rgba(0,0,0,0.2)";

        document.body.appendChild(loginMessage);

        setTimeout(function () {
            loginMessage.remove();
        }, 3000);

        closeModal(loginModal);

        document.getElementById("welcomeOwner").textContent =
            "Welcome, " + username + "!";

        openModal(dashboardModal);

    } else {

        const errorMessage = document.createElement("div");

        errorMessage.textContent = "Invalid username or password!";

        errorMessage.style.position = "fixed";
        errorMessage.style.top = "30px";
        errorMessage.style.right = "30px";
        errorMessage.style.background = "#b23b3b";
        errorMessage.style.color = "white";
        errorMessage.style.padding = "15px 25px";
        errorMessage.style.borderRadius = "10px";
        errorMessage.style.zIndex = "10000";
        errorMessage.style.fontWeight = "600";
        errorMessage.style.boxShadow = "0 5px 20px rgba(0,0,0,0.2)";

        document.body.appendChild(errorMessage);

        setTimeout(function () {
            errorMessage.remove();
        }, 3000);

    }

});


// ------------------------------------------
// 13. LIST YOUR PG BUTTON
// ------------------------------------------

document.getElementById("listPGButton").addEventListener("click", function() {

    closeModal(dashboardModal);

    openModal(listPGModal);

});


// ------------------------------------------
// 14. SUBMIT PG
// ------------------------------------------

document.getElementById("pgForm").addEventListener("submit", function(event) {

    event.preventDefault();

    const name =
        document.getElementById("newPGName").value;

    const location =
        document.getElementById("newPGLocation").value;

    const contact =
        document.getElementById("newPGContact").value;

    const rent =
        document.getElementById("newPGRent").value;

    const beds =
        document.getElementById("newPGBeds").value;

    const room =
        document.getElementById("newPGRoom").value;

    const description =
        document.getElementById("newPGDescription").value;


    // Get selected facilities

    const selectedFacilities = [];

    document.querySelectorAll(
        ".facility-options input:checked"
    ).forEach(function(item) {

        selectedFacilities.push(item.value);

    });


    // Create new PG card

    const pgGrid = document.querySelector(".pg-grid");

    const gridMessage = pgGrid.querySelector(".grid-message");

    if (gridMessage) gridMessage.remove();

    const newCard = document.createElement("article");

    newCard.className = "pg-card";

    newCard.innerHTML = `

        <div class="image-area image-one">

            <span class="verified">
                ✓ Verified
            </span>

            <button class="heart">
                ♡
            </button>

        </div>

        <div class="card-content">

            <div class="card-top">

                <div>

                    <h3>${name}</h3>

                    <p class="location">
                        ${location}
                    </p>

                </div>

                <div class="rating">
                    ★ New
                </div>

            </div>

            <div class="price">
                ₹${rent}
                <span>/month</span>
            </div>

            <div class="room-type">
                ${room}
            </div>

            <div class="facilities">

                ${selectedFacilities.map(function(facility) {
                    return `<span>${facility}</span>`;
                }).join("")}

            </div>

            <div class="card-footer">

                <span>
                    ${beds} beds available
                </span>

                <button class="new-view-details">
                    View Details
                </button>

            </div>

        </div>
    `;


    pgGrid.appendChild(newCard);


    // Add favourite functionality

    const newHeart = newCard.querySelector(".heart");

    newHeart.addEventListener("click", function() {

        if (newHeart.textContent === "♡") {

            newHeart.textContent = "♥";

        } else {

            newHeart.textContent = "♡";

        }

    });


    // Add view details functionality

    const newDetailsButton =
        newCard.querySelector(".new-view-details");

    newDetailsButton.addEventListener("click", function() {

        alert(
            "PG Name: " + name +
            "\nLocation: " + location +
            "\nRent: ₹" + rent +
            "/month" +
            "\nRoom: " + room +
            "\nBeds Available: " + beds +
            "\nFacilities: " +
            selectedFacilities.join(", ") +
            "\nContact: " + contact +
            "\n\nDescription:\n" +
            description
        );

    });


    alert("Your PG has been added successfully!");

    closeModal(listPGModal);

    document.getElementById("pgForm").reset();

});


// ------------------------------------------
// 15. MY PG LISTINGS
// ------------------------------------------

document.getElementById("myListingsButton").addEventListener("click", function() {

    alert(
        "My PG Listings\n\n" +
        "Your submitted PG listings will appear here.\n\n" +
        "Currently using frontend sample data."
    );

});


// ------------------------------------------
// 16. LOGOUT
// ------------------------------------------

document.getElementById("logoutButton").addEventListener("click", function() {

    closeModal(dashboardModal);

    alert("You have been logged out.");

});


// ------------------------------------------
// 17-18. FAVOURITE + VIEW DETAILS BUTTONS
// ------------------------------------------
// These are now attached to each card when it is built
// (see buildCard() in section 1), because the cards come
// from the database instead of the HTML file.


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
// List Your PG button
const listYourPGButton = document.querySelector(".owner-section button");

if (listYourPGButton) {
    listYourPGButton.addEventListener("click", function () {
        openModal(loginModal);
    });
}


// ------------------------------------------
// 21. LOAD PGs FROM SUPABASE
// ------------------------------------------

loadPGs();
