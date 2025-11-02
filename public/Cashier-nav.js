document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const hamburgerBtn = document.getElementById("hamburger");
    const closeBtn = document.getElementById("closeBtn");
    
    const profileCard = document.getElementById("profileCard"); 
    const profileName = document.getElementById("profileName"); 

    const navItems = sidebar.querySelectorAll("nav ul li");

    const navPaths = [
        "employee-order.html", // Orders
        "employee-incomingorder.html", // Incoming Orders
        "employee-feedback.html" // Feedback
    ];

    if (profileName) {
        profileName.textContent = "Cashier"; 
    }

    if (profileCard) {
        profileCard.style.cursor = "pointer"; 
        profileCard.addEventListener("click", () => {
            window.location.href = "Employee-EditProfile.html"; 
        });
    }

    navItems.forEach((item, index) => {
        const path = navPaths[index];

        if (path) {
            item.style.cursor = "pointer"; 
            item.addEventListener("click", () => {
                window.location.href = path;
            });
        }
    });

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener("click", () => {
            if (sidebar) {
                sidebar.classList.add("open");
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            if (sidebar) {
                sidebar.classList.remove("open");
            }
        });
    }
});