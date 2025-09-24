import { db } from './firebase-config.js';
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("updatePassForm");
const messageDiv = document.getElementById("message");
const DEFAULT_PASSWORD = "CafeAmoreX17";

// Show messages
function showMessage(msg, color = "red") {
    messageDiv.textContent = msg;
    messageDiv.style.color = color;
}

// Get user UID from URL query parameter
const params = new URLSearchParams(window.location.search);
const uid = params.get("uid");
if (!uid) {
    window.location.href = "login.html"; // Redirect if no UID
}

// Handle form submission
form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const newPass = document.getElementById("newPassword").value.trim();
    const confirmPass = document.getElementById("confirmPassword").value.trim();

    if (newPass !== confirmPass) {
        return showMessage("Passwords do not match!");
    }

    if (newPass === DEFAULT_PASSWORD) {
        return showMessage("New password cannot be the default password!");
    }

    try {
        const userDocRef = doc(db, "users", uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) return showMessage("User does not exist.");

        // Update Firestore password
        await updateDoc(userDocRef, { password: newPass });

        // Get user role for redirection
        const role = userDoc.data().role;

        showMessage("Password updated successfully!", "green");

        // Redirect based on role after 1.5 seconds
        setTimeout(() => {
            switch(role) {
                case "Cashier":
                    window.location.href = "orders.html";
                    break;
                case "Bartender":
                    window.location.href = "incomingorders.html";
                    break;
                case "Driver":
                    window.location.href = "driver.html";
                    break;
                case "Admin":
                    window.location.href = "adminpanel.html";
                    break;
                default:
                    window.location.href = "index.html"; // fallback
            }
        }, 1500);

    } catch (error) {
        console.error(error);
        showMessage("Error updating password: " + error.message);
    }
});
