import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const sidebar = document.getElementById("sidebar");
const hamburger = document.getElementById("hamburger");
const closeBtn = document.getElementById("closeBtn");
const topBar = document.querySelector('.top-bar');
let overlay = document.getElementById('overlay');
if (!overlay) {
  overlay = document.createElement('div');
  overlay.id = 'overlay';
  document.body.appendChild(overlay);
}
const profileCard = document.querySelector(".profile-card");
const profileNameEl = profileCard?.querySelector(".profile-name");
const logout = document.querySelector(".logout");
const logo = document.querySelector(".logo");
const welcomeHeader = document.querySelector(".main-content header h1");

const auth = getAuth();
const db = getFirestore();

let unsubscribeUserListener = null;


function updateSidebarDisplay() {
  if (window.innerWidth > 1024) {
    sidebar.classList.remove("active");
    if (hamburger) hamburger.style.display = "none";
    if (closeBtn) closeBtn.style.display = "none";
    if (topBar) topBar.style.display = "none"; 
    overlay.classList.remove('active');
  } else {
    if (hamburger) hamburger.style.display = "block";
    if (closeBtn) closeBtn.style.display = "none";
    if (topBar) topBar.style.display = "flex"; 
  }
}

function openSidebar() {
  sidebar.classList.add('active');
  if (hamburger) hamburger.style.display = 'none';
  if (closeBtn) {
    closeBtn.style.display = 'block';
  }
  overlay.classList.add('active');
  if (topBar) topBar.style.display = 'none'; 
}

function closeSidebar() {
  sidebar.classList.remove('active');
  if (hamburger) hamburger.style.display = 'block';
  if (closeBtn) {
    closeBtn.style.display = 'none';
  }
  overlay.classList.remove('active');
  if (window.innerWidth <= 1024 && topBar) topBar.style.display = 'flex'; 
}

updateSidebarDisplay();
window.addEventListener("resize", updateSidebarDisplay);

hamburger?.addEventListener("click", openSidebar);
closeBtn?.addEventListener("click", closeSidebar);
overlay.addEventListener('click', closeSidebar);

const navLinks = sidebar.querySelectorAll("nav ul li");
if (navLinks.length >= 6) {
  navLinks[0].addEventListener(
    "click",
    () => { window.location.href = "adminpanel.html"; closeSidebar(); }
  );
  navLinks[1].addEventListener(
    "click",
    () => { window.location.href = "menumanagement.html"; closeSidebar(); }
  );
  navLinks[2].addEventListener(
    "click",
    () => { window.location.href = "orders.html"; closeSidebar(); }
  );
  navLinks[3].addEventListener(
    "click",
    () => { window.location.href = "incomingorder.html"; closeSidebar(); }
  );
  navLinks[4].addEventListener(
    "click",
    () => { window.location.href = "admin-feedback.html"; closeSidebar(); }
  );
  navLinks[5].addEventListener(
    "click",
    () => { window.location.href = "inventory.html"; closeSidebar(); }
  );
  if (navLinks[6])
    navLinks[6].addEventListener(
      "click",
      () => { window.location.href = "employeeManagement.html"; closeSidebar(); }
    );
  if (navLinks[7])
    navLinks[7].addEventListener(
      "click",
      () => { window.location.href = "sales.html"; closeSidebar(); }
    );
}

const currentPage = window.location.pathname.split("/").pop();
navLinks.forEach((link) => {
  link.classList.remove("active");
  const text = link.textContent.trim().toLowerCase();
  if (
    (currentPage === "adminpanel.html" && text === "home") ||
    (currentPage === "menumanagement.html" && text === "menu management") ||
    (currentPage === "orders.html" && text === "orders") ||
    (currentPage === "incomingorder.html" && text === "incoming orders") ||
    (currentPage === "admin-feedback.html" && text === "feedback") ||
    (currentPage === "inventory.html" && text === "inventory") ||
    (currentPage === "employeeManagement.html" &&
      text === "employee management") ||
    (currentPage === "sales.html" && text === "sales")
  ) {
    link.classList.add("active");
  }
});

profileCard?.addEventListener("click", () => {
  window.location.href = "Admin-EditProfile.html";
});

logo?.addEventListener("click", () => {
  window.location.href = "adminpanel.html";
});

logout?.addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    if (unsubscribeUserListener) {
      unsubscribeUserListener();
      unsubscribeUserListener = null;
    }
    await signOut(auth);
    localStorage.removeItem("currentAdminName");
    console.log("User signed out successfully. Redirecting to login page.");
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error signing out:", error);
  }
});


/**
 * @param {object} user 
 */
function setupRealTimeNameUpdate(user) {
    if (unsubscribeUserListener) {
        unsubscribeUserListener();
    }

    const userRef = doc(db, "users", user.uid);

    unsubscribeUserListener = onSnapshot(userRef, (docSnapshot) => {
        let fullName = "Admin";
        
        if (docSnapshot.exists()) {
            const data = docSnapshot.data();
            fullName = data.fullname || "Admin";
            localStorage.setItem("currentAdminName", fullName); 
        } else {
            const storedName = localStorage.getItem("currentAdminName");
            if (storedName) fullName = storedName;
        }

        if (profileNameEl) profileNameEl.textContent = fullName;
        if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${fullName}`;

    }, (error) => {
        console.error("Error setting up real-time name listener:", error);
        const storedName = localStorage.getItem("currentAdminName");
        if (storedName) {
            if (profileNameEl) profileNameEl.textContent = storedName;
            if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${storedName}`;
        }
    });
}


onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (unsubscribeUserListener) {
      unsubscribeUserListener();
      unsubscribeUserListener = null;
    }
    if (currentPage !== "login.html") {
      console.log("No authenticated user found. Redirecting to login.");
      window.location.href = "login.html";
    }
    return;
  }
  setupRealTimeNameUpdate(user);
});
