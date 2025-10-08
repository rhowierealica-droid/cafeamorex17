import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// Create overlay element
let overlay = document.getElementById('overlay');
if (!overlay) {
  overlay = document.createElement('div');
  overlay.id = 'overlay';
  document.body.appendChild(overlay);
}

const db = getFirestore();
const auth = getAuth();

// Initial state
if (closeBtn) closeBtn.style.display = 'none';

// Function to update responsive elements
function updateResponsiveElements() {
  if (window.innerWidth > 1024) {
    sidebar.classList.remove('active');
    hamburger.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
    if (topBar) topBar.style.display = 'none';
    overlay.classList.remove('active');
  } else {
    hamburger.style.display = 'block';
    if (closeBtn) closeBtn.style.display = 'none';
    if (topBar) topBar.style.display = 'flex';
  }
}

// Initial call
updateResponsiveElements();

// Update on resize
window.addEventListener('resize', updateResponsiveElements);

// Function to open sidebar
function openSidebar() {
  sidebar.classList.add('active');
  hamburger.style.display = 'none';
  if (closeBtn) {
    closeBtn.style.display = 'block';
    closeBtn.style.opacity = '1';  // Ensure visible
  }
  overlay.classList.add('active');
  if (topBar) topBar.style.display = 'none'; // hide top bar when sidebar is open
}

// Function to close sidebar
function closeSidebar() {
  sidebar.classList.remove('active');
  hamburger.style.display = 'block';
  if (closeBtn) {
    closeBtn.style.display = 'none';
    closeBtn.style.opacity = '0';
  }
  overlay.classList.remove('active');
  if (topBar) topBar.style.display = 'flex'; // show top bar when sidebar is closed
}

// Hamburger toggle
hamburger.addEventListener('click', openSidebar);

// Close button toggle
closeBtn?.addEventListener('click', closeSidebar);

// Overlay click to close sidebar
overlay.addEventListener('click', closeSidebar);

// Navigation links
const navLinks = sidebar.querySelectorAll('nav ul li');
const linkMap = {
  "menu-link": "index.html",
  "cart-link": "cart.html",
  "order-status-link": "customer-status.html",
  "favorites-link": "favorites.html",
  // "history-link": "history.html"  
};

navLinks.forEach(link => {
  link.addEventListener('click', () => {
    const target = linkMap[link.classList[0]];
    if (target) window.location.href = target;
    closeSidebar(); // close sidebar after navigation
  });
});

// Login button click
loginLink?.addEventListener('click', () => {
  window.location.href = "login.html";
});

// Profile card click
profileCard?.addEventListener('click', () => {
  window.location.href = "edit-profile.html";
});

// Logout
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

// Logo click
logo?.addEventListener('click', () => {
  window.location.href = "customer-menu.html";
});

// Auth state observer
onAuthStateChanged(auth, async (user) => {
  const isLoggedIn = !!user;

  // Menu always visible
  navLinks[0].style.display = "flex";

  // Other nav links based on login
  navLinks[1].style.display = isLoggedIn ? "flex" : "none"; // Cart
  navLinks[2].style.display = isLoggedIn ? "flex" : "none"; // Order Status
  navLinks[3].style.display = isLoggedIn ? "flex" : "none"; // Favorites
  // navLinks[4].style.display = isLoggedIn ? "flex" : "none"; // History

  // Profile, logout, login
  profileCard.style.display = isLoggedIn ? "flex" : "none";
  logout.style.display = isLoggedIn ? "flex" : "none";
  loginLink.style.display = isLoggedIn ? "none" : "flex";

  let fullName = "Customer";

  // Try reading name from localStorage first
  const storedName = localStorage.getItem("currentUserName");
  if (storedName) fullName = storedName;
  else if (isLoggedIn && user.uid) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const data = userDoc.exists() ? userDoc.data() : {};
      fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Customer";
    } catch (err) {
      console.error("Error fetching user data:", err);
    }
  }

  profileNameEl.textContent = fullName;
  welcomeHeader.textContent = `Welcome, ${fullName}`;
});
