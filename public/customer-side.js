import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const sidebar = document.getElementById('sidebar');
const hamburger = document.getElementById('hamburger');
const closeBtn = document.getElementById('closeBtn');
const loginLink = document.querySelector('.login-link');
const profileCard = document.querySelector('.profile-card');
const profileEdit = profileCard?.querySelector('.edit-text');
const profileNameEl = profileCard?.querySelector('.profile-name');
const logout = document.querySelector('.logout');
const logo = document.querySelector('.logo');
const welcomeHeader = document.querySelector('.main-content header h1');

const db = getFirestore();
const auth = getAuth();

if (closeBtn) closeBtn.style.display = 'none';

// Hamburger toggle
hamburger.addEventListener('click', () => {
  sidebar.classList.add('active');
  hamburger.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'block';
});

closeBtn?.addEventListener('click', () => {
  sidebar.classList.remove('active');
  hamburger.style.display = 'block';
  closeBtn.style.display = 'none';
});

// Reset sidebar on resize
window.addEventListener('resize', () => {
  if (window.innerWidth > 1024) {
    sidebar.classList.remove('active');
    hamburger.style.display = 'none';
    closeBtn.style.display = 'none';
  } else {
    hamburger.style.display = 'block';
    closeBtn.style.display = 'none';
  }
});

// Navigation links
const navLinks = sidebar.querySelectorAll('nav ul li');
const linkMap = {
  "menu-link": "index.html",
  "cart-link": "cart.html",
  "order-status-link": "customer-status.html", // added this
  "favorites-link": "favorites.html",
  "history-link": "history.html"
};

navLinks.forEach(link => {
  link.addEventListener('click', () => {
    const target = linkMap[link.classList[0]];
    if (target) window.location.href = target;
  });
});

// Login button click
loginLink?.addEventListener('click', () => {
  window.location.href = "login.html";
});

// Profile edit click (entire card clickable)
profileCard?.addEventListener('click', () => {
  window.location.href = "edit-profile.html";
});

// Logout
logout?.addEventListener('click', async (e) => {
  e.stopPropagation();
  try {
    await signOut(auth);
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

  // Menu is always visible
  navLinks[0].style.display = "flex"; // Menu

  // Other nav links based on login
  navLinks[1].style.display = isLoggedIn ? "flex" : "none"; // Cart
  navLinks[2].style.display = isLoggedIn ? "flex" : "none"; // Favorites
  navLinks[3].style.display = isLoggedIn ? "flex" : "none"; // History

  // Profile, logout, login
  profileCard.style.display = isLoggedIn ? "flex" : "none";
  logout.style.display = isLoggedIn ? "flex" : "none";
  loginLink.style.display = isLoggedIn ? "none" : "flex";

  if (isLoggedIn && user.uid) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const data = userDoc.exists() ? userDoc.data() : {};
      const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Customer";
      profileNameEl.textContent = fullName;
      welcomeHeader.textContent = `Welcome, ${fullName}`;
    } catch {
      profileNameEl.textContent = "Customer";
      welcomeHeader.textContent = "Welcome, Customer";
    }
  } else {
    profileNameEl.textContent = "Customer";
    welcomeHeader.textContent = "Welcome, Customer";
  }
});
