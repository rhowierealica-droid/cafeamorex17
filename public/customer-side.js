import { 
  getAuth, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ===============================
   DOM ELEMENTS
=============================== */
const sidebar = document.getElementById('sidebar');
const hamburger = document.getElementById('hamburger');
const closeBtn = document.getElementById('closeBtn');
const topBar = document.querySelector('.top-bar');
const loginLink = document.querySelector('.login-link');
const profileCard = document.querySelector('.profile-card');
const profileNameEl = profileCard?.querySelector('.profile-name');
const logout = document.querySelector('.logout');
const logo = document.querySelector('.logo');
const welcomeHeader = document.querySelector('.main-content header h1');

/* ===============================
   CREATE OVERLAY
=============================== */
let overlay = document.getElementById('overlay');
if (!overlay) {
  overlay = document.createElement('div');
  overlay.id = 'overlay';
  document.body.appendChild(overlay);
}

/* ===============================
   FIREBASE INIT
=============================== */
const db = getFirestore();
const auth = getAuth();

/* ===============================
   INITIAL STATE
=============================== */
if (closeBtn) closeBtn.style.display = 'none';

/* ===============================
   RESPONSIVE ELEMENTS HANDLER
=============================== */
function updateResponsiveElements() {
  if (window.innerWidth > 1024) {
    sidebar.classList.remove('active');
    if (hamburger) hamburger.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    if (topBar) topBar.style.display = 'none';
    overlay.classList.remove('active');
  } else {
    if (hamburger) hamburger.style.display = 'block';
    if (closeBtn) closeBtn.style.display = 'none';
    if (topBar) topBar.style.display = 'flex';
  }
}

// Initial call + listener
updateResponsiveElements();
window.addEventListener('resize', updateResponsiveElements);

/* ===============================
   SIDEBAR TOGGLE FUNCTIONS
=============================== */
function openSidebar() {
  sidebar.classList.add('active');
  if (hamburger) hamburger.style.display = 'none';
  if (closeBtn) {
    closeBtn.style.display = 'block';
    closeBtn.style.opacity = '1';
  }
  overlay.classList.add('active');
  if (topBar) topBar.style.display = 'none';
}

function closeSidebar() {
  sidebar.classList.remove('active');
  if (hamburger) hamburger.style.display = 'block';
  if (closeBtn) {
    closeBtn.style.display = 'none';
    closeBtn.style.opacity = '0';
  }
  overlay.classList.remove('active');
  if (topBar) topBar.style.display = 'flex';
}

/* ===============================
   EVENT LISTENERS
=============================== */
hamburger?.addEventListener('click', openSidebar);
closeBtn?.addEventListener('click', closeSidebar);
overlay.addEventListener('click', closeSidebar);

/* ===============================
   NAVIGATION LINKS
=============================== */
const navLinks = sidebar?.querySelectorAll('nav ul li') || [];
const linkMap = {
  "menu-link": "menu.html",
  "cart-link": "cart.html",
  "order-status-link": "customer-status.html",
  "favorites-link": "favorites.html",
  "history-link": "history.html"
};

navLinks.forEach(link => {
  link.addEventListener('click', () => {
    const target = linkMap[link.classList[0]];
    if (target) window.location.href = target;
    closeSidebar();
  });
});

/* ===============================
   LOGIN / PROFILE / LOGOUT
=============================== */
loginLink?.addEventListener('click', () => {
  window.location.href = "login.html";
});

profileCard?.addEventListener('click', () => {
  window.location.href = "edit-profile.html";
});

logout?.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    await signOut(auth);
    localStorage.removeItem("currentUserName");
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
});

logo?.addEventListener('click', () => {
  window.location.href = "menu.html";
});

/* ===============================
   AUTH STATE OBSERVER
=============================== */
onAuthStateChanged(auth, async (user) => {
  const isLoggedIn = !!user;

  // Ensure navLinks exist before modifying
  if (navLinks.length > 0) {
    // Menu (always visible)
    if (navLinks[0]) navLinks[0].style.display = "flex";

    // Show/Hide other links based on login
    if (navLinks[1]) navLinks[1].style.display = isLoggedIn ? "flex" : "display"; // Cart
    if (navLinks[2]) navLinks[2].style.display = isLoggedIn ? "flex" : "none"; // Order Status
    if (navLinks[3]) navLinks[3].style.display = isLoggedIn ? "flex" : "none"; // Favorites
    // if (navLinks[4]) navLinks[4].style.display = isLoggedIn ? "flex" : "none"; // History
  }

  // Profile & login visibility
  if (profileCard) profileCard.style.display = isLoggedIn ? "flex" : "none";
  if (logout) logout.style.display = isLoggedIn ? "flex" : "none";
  if (loginLink) loginLink.style.display = isLoggedIn ? "none" : "flex";

  // Default name
  let fullName = "Customer";

  // Get stored name or fetch from Firestore
  const storedName = localStorage.getItem("currentUserName");
  if (storedName) {
    fullName = storedName;
  } else if (isLoggedIn && user.uid) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Customer";
      }
    } catch (err) {
      console.error("Error fetching user data:", err);
    }
  }

  // Update UI
  if (profileNameEl) profileNameEl.textContent = fullName;
  if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${fullName}`;
});
