document.addEventListener('DOMContentLoaded', () => {
    // ==========================
    // 1. Login Popup for "Order Now" buttons
    // ==========================
    const loginPopup = document.getElementById('loginPopup');
    const loginRedirect = document.getElementById('loginRedirect');

    // Attach event listener to all "Order Now/Try Our..." buttons
    document.querySelectorAll('.add-cart-btn').forEach(button => {
        button.addEventListener('click', () => {
            if (loginPopup) {
                // Display the popup
                loginPopup.style.display = 'flex';
            }
        });
    });

    // Close popup when clicking outside content
    if (loginPopup) {
        loginPopup.addEventListener('click', (e) => {
            if (e.target === loginPopup) {
                loginPopup.style.display = 'none';
            }
        });
    }
    
    // Redirect button inside popup
    if (loginRedirect) {
        loginRedirect.addEventListener('click', () => {
            window.location.href = 'login.html'; 
        });
    }

    // ==========================
    // 2. Smooth scrolling for internal links
    // ==========================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();

            const targetId = this.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                const nav = document.querySelector('.customer-nav');
                const navHeight = nav ? nav.offsetHeight : 0;
                const offset = targetElement.offsetTop - navHeight;

                window.scrollTo({
                    top: offset,
                    behavior: 'smooth'
                });
            }
        });
    });
});
