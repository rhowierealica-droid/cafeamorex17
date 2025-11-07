document.addEventListener("DOMContentLoaded", function() {
    const userRole = sessionStorage.getItem("cashierRole");
    const userName = sessionStorage.getItem("cashierName");

    if (!userName || !userRole || userRole !== "Cashier") {
        
      
        sessionStorage.clear();
        console.warn("Unauthorized access: Redirecting to login.");
        window.location.href = "login.html"; 
        
        return; 
    }

    const profileNameElement = document.querySelector(".profile-name");
    if (profileNameElement) {
        profileNameElement.textContent = userName;
    }
});