import {
    getFirestore,
    doc,
    updateDoc,
    query,
    collection,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
    getAuth, 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { db } from "./firebase-config.js"; 

const sidebar = document.getElementById("sidebar");
const hamburger = document.getElementById("hamburger");
const closeBtn = document.getElementById("closeBtn");
const logoutBtn = document.querySelector(".logout");
const profileCard = document.querySelector(".profile-card");

const editPasswordBtn = document.getElementById("editPasswordBtn");
const savePasswordBtn = document.getElementById("savePasswordBtn");
const cancelPasswordBtn = document.getElementById("cancelPasswordBtn");
const passwordEditFields = document.getElementById("passwordEditFields");
const currentPasswordForChangeInput = document.getElementById("currentPasswordForChange");
const newPasswordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const passwordForm = document.getElementById("passwordForm");

const otpPopup = document.getElementById("otpPopup");
const otpError = document.getElementById("otpError");
const closeOtpBtn = document.getElementById("closeOtpBtn");
const recaptchaContainer = document.getElementById('recaptcha-container');

const auth = getAuth();
const firestore = getFirestore();

let currentCashierUID = null;
let currentCashierEmail = null;
let currentCashierStoredPassword = null;

function showOtpError(message) {
    if (otpError) {
        otpError.textContent = message;
        otpError.style.display = "block";
    }
}

function clearOtpError() {
    if (otpError) {
        otpError.textContent = "";
        otpError.style.display = "none";
    }
}

if (closeOtpBtn) {
    closeOtpBtn.addEventListener('click', () => {
        otpPopup.style.display = 'none';
        cancelPasswordBtn?.click(); 
    });
}

hamburger?.addEventListener("click", () => {
    sidebar.classList.add("active");
    closeBtn.style.opacity = 1;
});

closeBtn?.addEventListener("click", () => {
    sidebar.classList.remove("active");
    closeBtn.style.opacity = 0;
});

/**
 * @param {string} email - 
 */
async function loadCashierProfile(email) {
    if (!email) {        
        sessionStorage.clear();
        window.location.href = "login.html"; 
        return;
    }

    try {
        const usersRef = collection(firestore, "users");
        const q = query(usersRef, where("email", "==", email), where("role", "==", "Cashier"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("Access Denied. You do not have Cashier privileges.");
            sessionStorage.clear();
            window.location.href = "login.html";
            return;
        }

        const docSnap = snapshot.docs[0];
        const data = docSnap.data();

        if (data.isActive === false) {
            alert("Your account has been disabled by the admin.");
            sessionStorage.clear();
            window.location.href = "login.html";
            return;
        }

        currentCashierUID = docSnap.id;
        currentCashierEmail = data.email;
        currentCashierStoredPassword = data.password; 
        
        const fullName = data.firstName && data.lastName
            ? `${data.firstName} ${data.lastName}`
            : data.fullname || "Cashier User";

        const [firstName, ...lastParts] = fullName.split(" ");
        const lastName = lastParts.join(" ");

        const profileNameEl = document.querySelector(".profile-card .profile-name");
        if (profileNameEl) profileNameEl.textContent = `${firstName} ${lastName}`;

        profileCard.style.display = "flex";
        logoutBtn.style.display = "flex";

    } catch (error) {
        console.error("Error loading cashier profile:", error);
        alert("Failed to load profile data.");
        sessionStorage.clear();
        window.location.href = "login.html";
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const storedEmail = sessionStorage.getItem("cashierEmail");
    loadCashierProfile(storedEmail);
});


editPasswordBtn?.addEventListener("click", () => {
    passwordEditFields.style.display = "flex";
    editPasswordBtn.style.display = "none";
    savePasswordBtn.style.display = "inline-block";
    cancelPasswordBtn.style.display = "inline-block";
});

cancelPasswordBtn?.addEventListener("click", () => {
    currentPasswordForChangeInput.value = "";
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";

    passwordEditFields.style.display = "none";
    editPasswordBtn.style.display = "inline-block";
    savePasswordBtn.style.display = "none";
    cancelPasswordBtn.style.display = "none";
});

passwordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    if (!currentCashierUID || !currentCashierEmail) return alert("Session Error. Please refresh.");

    const currentPassword = currentPasswordForChangeInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        return alert("Please fill in all password fields.");
    }

    if (newPassword !== confirmPassword) {
        return alert("New password and confirmation password do not match.");
    }
        if (currentPassword !== currentCashierStoredPassword) {
        return alert("The current password you entered is incorrect.");
    }

    if (newPassword.length < 6) { 
        return alert("New password must be at least 6 characters long.");
    }
 
    try {
        const userDocRef = doc(db, "users", currentCashierUID);
        
        await updateDoc(userDocRef, { password: newPassword });

        currentCashierStoredPassword = newPassword; 

        alert("Password updated successfully!");
        
        cancelPasswordBtn?.click();

    } catch (error) {
        console.error("Error updating password in Firestore:", error);
        alert("Failed to update password. Please try again.");
    }
});


logoutBtn?.addEventListener("click", () => {
    const confirmLogout = confirm("Are you sure you want to log out?");
    if (!confirmLogout) return;

    sessionStorage.clear();
    window.location.href = "login.html";
});