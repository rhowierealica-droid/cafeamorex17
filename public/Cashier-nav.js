document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    const hamburgerBtn = document.getElementById("hamburger");
    const closeBtn = document.getElementById("closeBtn");
    
    const profileCard = document.querySelector(".profile-card") || document.getElementById("profileCard"); 
    const profileName = document.querySelector(".profile-card .profile-name") || document.getElementById("profileName");
    const logoutBtn = document.querySelector(".logout"); 
    const navItems = sidebar ? sidebar.querySelectorAll("nav ul li") : [];

    const storedName = sessionStorage.getItem("cashierName"); 
    const storedRole = sessionStorage.getItem("cashierRole");
    
    const navPaths = [
        "employee-order.html", // Orders
        "employee-incomingorder.html", // Incoming Orders
        "employee-feedback.html" // Feedback
    ];

    if (profileName) {
        profileName.textContent = storedName || storedRole || "Cashier User"; 
    }
    if (profileCard) {
        profileCard.style.cursor = "pointer"; 
        profileCard.addEventListener("click", () => {
            window.location.href = "Cashier-EditProfile.html"; 
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

    if (logoutBtn) {
        logoutBtn.style.cursor = "pointer";
        logoutBtn.addEventListener("click", () => {
            
            setTimeout(() => {
                sessionStorage.clear(); 
                
                localStorage.removeItem('cashierName'); 
                localStorage.removeItem('cashierRole'); 

                window.location.href = "login.html";
            }, 50);
        });
    }
});