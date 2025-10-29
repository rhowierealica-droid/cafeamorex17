document.addEventListener('DOMContentLoaded', () => {
    const loginPopup = document.getElementById('loginPopup');
    const loginRedirect = document.getElementById('loginRedirect');

    document.querySelectorAll('.add-cart-btn').forEach(button => {
        button.addEventListener('click', () => {
            if (loginPopup) {
                loginPopup.style.display = 'flex';
            }
        });
    });

    if (loginPopup) {
        loginPopup.addEventListener('click', (e) => {
            if (e.target === loginPopup) {
                loginPopup.style.display = 'none';
            }
        });
    }
    
    if (loginRedirect) {
        loginRedirect.addEventListener('click', () => {
            window.location.href = 'login.html'; 
        });
    }

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
