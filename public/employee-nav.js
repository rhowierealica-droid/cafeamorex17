// ==========================
// Sidebar Elements
// ==========================
const sidebar = document.getElementById('sidebar');
const hamburger = document.getElementById('hamburger');
const closeBtn = document.getElementById('closeBtn');

// Hide close button initially
if (closeBtn) closeBtn.style.display = 'none';

// ==========================
// Hamburger Toggle
// ==========================
hamburger.addEventListener('click', () => {
  sidebar.classList.add('active');
  hamburger.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'block';
});

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    sidebar.classList.remove('active');
    hamburger.style.display = 'block';
    closeBtn.style.display = 'none';
  });
}

// ==========================
// Reset Sidebar on Resize
// ==========================
window.addEventListener('resize', () => {
  if (window.innerWidth > 1024) {
    sidebar.classList.remove('active');
    hamburger.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none';
  } else {
    hamburger.style.display = 'block';
    if (closeBtn) closeBtn.style.display = 'none';
  }
});

// ==========================
// Navigation Links
// ==========================
const navLinks = sidebar.querySelectorAll('nav ul li');

// Assign click handlers
if (navLinks.length >= 2) {
  navLinks[0].addEventListener('click', () => window.location.href = "employee-order.html"); // Orders
  navLinks[1].addEventListener('click', () => window.location.href = "employee-incomingorder.html"); // Incoming Orders
  navLinks[2].addEventListener('click', () => window.location.href = "employee-feedback.html"); // Feedback
}
// ==========================
// Profile Edit
// ==========================
const profileEdit = document.querySelector('.profile-card .edit-text');
if (profileEdit) {
  profileEdit.addEventListener('click', () => {
    window.location.href = "editprofile.html";
  });
}

// ==========================
// Logout
// ==========================
const logout = document.querySelector('.logout');
if (logout) {
  logout.addEventListener('click', () => {
    window.location.href = "login.html";
  });
}

// ==========================
// Logo Click → Home
// ==========================
const logo = document.querySelector('.logo');
if (logo) {
  logo.addEventListener('click', () => {
    window.location.href = "adminpanel.html";
  });
}

// ==========================
// Highlight Current Page
// ==========================
const currentPage = window.location.pathname.split("/").pop();

navLinks.forEach(link => {
  link.classList.remove('active'); // Reset all

  const text = link.textContent.trim().toLowerCase();
  if (
    (currentPage === "adminpanel.html" && text === "home") ||
    (currentPage === "menumanagement.html" && text === "menu management") ||
    (currentPage === "orders.html" && text === "orders") ||
    (currentPage === "incomingorder.html" && text === "incoming orders") ||
    (currentPage === "inventory.html" && text === "inventory") ||
    (currentPage === "sales.html" && text === "sales")
  ) {
    link.classList.add('active');
  }
});
