// employee-nav.js

document.addEventListener('DOMContentLoaded', () => {
    // 1. Get elements
    const profileNameElement = document.querySelector('.profile-name');
    const hamburgerButton = document.getElementById('hamburger');
    const sidebar = document.getElementById('sidebar');

    // 2. Fetch data from localStorage
    const employeeName = localStorage.getItem('employeeName') || 'Guest';
    const employeeRole = localStorage.getItem('employeeRole') || 'User';

    // 3. Update the profile name display
    if (profileNameElement) {
        // Display the user's name
        profileNameElement.textContent = employeeName;
        
        // Optionally update the 'Edit Profile' text to show the role
        const editTextElement = document.querySelector('.edit-text');
        if (editTextElement) {
             editTextElement.textContent = employeeRole;
        }
    }
    
    // 4. Hamburger menu toggle logic
    if (hamburgerButton && sidebar) {
        hamburgerButton.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // 5. Logout logic
    const logoutBtn = document.querySelector('.logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            // Clear all employee data from localStorage
            localStorage.removeItem('employeeName');
            localStorage.removeItem('employeeRole');
            
            // Redirect to login page
            window.location.href = "login.html"; 
        });
    }
});
