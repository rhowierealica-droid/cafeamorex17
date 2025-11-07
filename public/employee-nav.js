document.addEventListener('DOMContentLoaded', () => {
    const profileNameElement = document.querySelector('.profile-name');
    const hamburgerButton = document.getElementById('hamburger');
    const sidebar = document.getElementById('sidebar');
    const profileCard = document.getElementById('profileCard');

    const employeeName = localStorage.getItem('employeeName') || 'Guest';
    const employeeRole = localStorage.getItem('employeeRole') || 'User';

    if (profileNameElement) {
        profileNameElement.textContent = employeeName;

        const editTextElement = document.querySelector('.edit-text');
        if (editTextElement) {
            editTextElement.textContent = employeeRole;
        }
    }

    if (hamburgerButton && sidebar) {
        hamburgerButton.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    if (profileCard) {
        profileCard.style.cursor = 'pointer'; 
        profileCard.addEventListener('click', () => {
            window.location.href = "Employee-EditProfile.html"; 
        });
    }

    const deliveriesLink = document.getElementById('deliveriesLink');
    if (deliveriesLink) {
        deliveriesLink.style.cursor = 'pointer'; 
        deliveriesLink.addEventListener('click', () => {
            window.location.href = "driver.html"; 
        });
    }

    const logoutBtn = document.querySelector('.logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('employeeName');
            localStorage.removeItem('employeeRole');
    
            setTimeout(() => {
                window.location.href = "login.html";
            }, 10); 
        });
    }
});
