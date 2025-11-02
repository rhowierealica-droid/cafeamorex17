
document.addEventListener('DOMContentLoaded', () => {
    const profileNameElement = document.querySelector('.profile-name');
    const hamburgerButton = document.getElementById('hamburger');
    const sidebar = document.getElementById('sidebar');

    const employeeName = localStorage.getItem('employeeName') || 'Guest';
    const employeeRole = localStorage.getItem('employeeRole') || 'User';

    // profile name display
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

    const logoutBtn = document.querySelector('.logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('employeeName');
            localStorage.removeItem('employeeRole');
                        window.location.href = "login.html"; 
        });
    }
});
