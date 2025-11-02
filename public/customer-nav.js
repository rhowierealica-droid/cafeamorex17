const hamburger = document.getElementById('hamburger');
const sidebar = document.getElementById('sidebar');

hamburger.addEventListener('click', () => {
  sidebar.classList.toggle('active');
});

const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');

document.querySelectorAll('.add-cart-btn').forEach(button => {
  button.addEventListener('click', () => {
    loginPopup.style.display = 'flex';
  });
});

// close
loginPopup.addEventListener('click', (e) => {
  if (e.target === loginPopup) {
    loginPopup.style.display = 'none';
  }
});


loginRedirect.addEventListener('click', () => {
  window.location.href = 'login.html';
});
