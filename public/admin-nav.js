import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const sidebar = document.getElementById("sidebar");
const hamburger = document.getElementById("hamburger");
const closeBtn = document.getElementById("closeBtn");
const profileCard = document.querySelector(".profile-card");
const profileNameEl = profileCard?.querySelector(".profile-name");
const logout = document.querySelector(".logout");
const logo = document.querySelector(".logo");
const welcomeHeader = document.querySelector(".main-content header h1");

const auth = getAuth();
const db = getFirestore();

function updateSidebarDisplay() {
  if (window.innerWidth > 1024) {
    sidebar.classList.remove("active");
    if (hamburger) hamburger.style.display = "none";
    if (closeBtn) closeBtn.style.display = "none";
  } else {
    if (hamburger) hamburger.style.display = "block";
    if (closeBtn) closeBtn.style.display = "none";
  }
}
updateSidebarDisplay();
window.addEventListener("resize", updateSidebarDisplay);

hamburger?.addEventListener("click", () => {
  sidebar.classList.add("active");
  hamburger.style.display = "none";
  if (closeBtn) closeBtn.style.display = "block";
});

closeBtn?.addEventListener("click", () => {
  sidebar.classList.remove("active");
  hamburger.style.display = "block";
  closeBtn.style.display = "none";
});


const navLinks = sidebar.querySelectorAll("nav ul li");
if (navLinks.length >= 6) {
  navLinks[0].addEventListener(
    "click",
    () => (window.location.href = "adminpanel.html")
  );
  navLinks[1].addEventListener(
    "click",
    () => (window.location.href = "menumanagement.html")
  );
  navLinks[2].addEventListener(
    "click",
    () => (window.location.href = "orders.html")
  );
  navLinks[3].addEventListener(
    "click",
    () => (window.location.href = "incomingorder.html")
  );
  navLinks[4].addEventListener(
    "click",
    () => (window.location.href = "admin-feedback.html")
  );
  navLinks[5].addEventListener(
    "click",
    () => (window.location.href = "inventory.html")
  ); 
  if (navLinks[6])
    navLinks[6].addEventListener(
      "click",
      () => (window.location.href = "employeeManagement.html")
    );
  if (navLinks[7])
    navLinks[7].addEventListener(
      "click",
      () => (window.location.href = "sales.html")
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
    await signOut(auth); 
    localStorage.removeItem("currentAdminName"); 
    console.log("User signed out successfully. Redirecting to login page.");
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error signing out:", error); 
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    
    if (currentPage !== "login.html") {
      console.log("No authenticated user found. Redirecting to login.");
      window.location.href = "login.html";
    }
    return; 
  } 
  let fullName = "Admin";
  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      fullName = data.fullname || "Admin";
      localStorage.setItem("currentAdminName", fullName);
    } else {
      
      const storedName = localStorage.getItem("currentAdminName");
      if (storedName) fullName = storedName;
    }
  } catch (err) {
    console.error("Error fetching admin data:", err);
    const storedName = localStorage.getItem("currentAdminName");
    if (storedName) fullName = storedName;
  }

  if (profileNameEl) profileNameEl.textContent = fullName;
  if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${fullName}`;
});
