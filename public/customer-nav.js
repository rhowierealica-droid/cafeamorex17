// ===== Hamburger Toggle =====
const hamburger = document.getElementById('hamburger');
const sidebar = document.getElementById('sidebar');

hamburger.addEventListener('click', () => {
  sidebar.classList.toggle('active');
});

// ===== Login Popup =====
const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');

// Example: show popup if user tries to add to cart without logging in
document.querySelectorAll('.add-cart-btn').forEach(button => {
  button.addEventListener('click', () => {
    // Show popup
    loginPopup.style.display = 'flex';
  });
});

// Close popup when clicking outside content
loginPopup.addEventListener('click', (e) => {
  if (e.target === loginPopup) {
    loginPopup.style.display = 'none';
  }
});

// Redirect button inside popup
loginRedirect.addEventListener('click', () => {
  window.location.href = 'login.html'; // change to your login page
});
