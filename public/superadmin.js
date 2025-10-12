import { db, auth } from './firebase-config.js'; // <-- ADDED auth import
import { collection, doc, setDoc, getDocs, updateDoc, deleteDoc, query, where, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"; // <-- ADDED Auth imports

// ==========================
// DOM Elements
// ==========================
const adminForm = document.getElementById('adminForm');
const adminTableBody = document.querySelector('#adminTable tbody');
const messageDiv = document.getElementById('message');
const logoutBtn = document.getElementById('logoutBtn'); // Assuming you have a logout button
const FIXED_PASSWORD = "CafeAmoreX17";

// ====================================================================
// ✅ SUPER ADMIN ACCESS CONTROL
// ====================================================================
// All administrative logic (functions and initial calls) will be wrapped
// in a function called 'initAdminPanel' and only run after this check passes.

onAuthStateChanged(auth, async (user) => {
    // 1. 🛑 Authentication Check: Not logged in
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    try {
        // 2. Firestore Role Check
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        const userRole = (docSnap.exists() ? docSnap.data().role : '').toLowerCase();

        // 3. 🛑 Role Denied: Not "super admin"
        if (userRole !== "super admin") {
            alert("Access denied. Only Super Admin can access this page.");
            // Use window.location.replace to prevent back button history issues
            window.location.replace("login.html"); 
            return;
        }

        // 4. ✅ Access Granted: Initialize the page functions
        initAdminPanel();

    } catch (e) {
        console.error("Access check error:", e);
        // Safety redirect on any database/connection error
        alert("An error occurred during verification. Please log in again.");
        window.location.replace("login.html");
    }
});


// ==========================
// Initialization Function (Wrapped Content)
// ==========================
function initAdminPanel() {
    // Start by loading the existing admins
    loadAdmins(); 

    // Add logout functionality
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                window.location.href = "login.html";
            } catch (err) {
                console.error("Error logging out:", err);
                alert("Failed to log out. Please try again.");
            }
        });
    }

    // ==========================
    // Create Admin
    // ==========================
    if (adminForm) {
        adminForm.addEventListener('submit', async e => {
            e.preventDefault();
            const firstName = document.getElementById('firstName').value.trim();
            const lastName = document.getElementById('lastName').value.trim();
            if (!firstName || !lastName) return;

            let email = generateEmail(firstName, lastName);
            while (await isEmailTaken(email)) email = generateEmail(firstName, lastName);

            try {
                // Using Firestore to create user with FIXED_PASSWORD
                const newDocRef = doc(collection(db, "users"));
                await setDoc(newDocRef, {
                    firstName, lastName, email,
                    password: FIXED_PASSWORD, // Storing password directly in Firestore
                    role: "admin",
                    verified: true // Setting verification state
                });
                messageDiv.textContent = `Admin Created! Email: ${email} | Password: ${FIXED_PASSWORD}`;
                adminForm.reset();
                loadAdmins();
            } catch (err) {
                console.error(err);
                messageDiv.textContent = `Error: ${err.message}`;
            }
        });
    }
}


// ==========================
// Load Admins
// ==========================
async function loadAdmins() {
    adminTableBody.innerHTML = "";
    const snapshot = await getDocs(collection(db, "users"));
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        // Only show users with the role "admin" (lowercase check for safety)
        if ((data.role || '').toLowerCase() !== "admin") return; 

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${data.firstName}</td>
            <td>${data.lastName}</td>
            <td>${data.email}</td>
            <td>${data.password || 'N/A'}</td> <td>
                <button class="reset" data-id="${docSnap.id}">Reset</button>
                <button class="delete" data-id="${docSnap.id}">Delete</button>
            </td>
        `;
        adminTableBody.appendChild(tr);
    });

    document.querySelectorAll(".reset").forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to reset the password for this admin?")) return;
            const uid = btn.getAttribute("data-id");
            try {
                await updateDoc(doc(db, "users", uid), { password: FIXED_PASSWORD });
                messageDiv.textContent = `Password reset successfully! New password: ${FIXED_PASSWORD}`;
                loadAdmins();
            } catch (err) {
                messageDiv.textContent = `Error resetting password: ${err.message}`;
            }
        });
    });

    document.querySelectorAll(".delete").forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm("WARNING: Are you sure you want to PERMANENTLY delete this admin account?")) return;
            const uid = btn.getAttribute("data-id");
            try {
                await deleteDoc(doc(db, "users", uid));
                messageDiv.textContent = `Admin account deleted successfully.`;
                loadAdmins();
            } catch (err) {
                messageDiv.textContent = `Error deleting admin: ${err.message}`;
            }
        });
    });
}


// ==========================
// Helper Functions (Kept outside initAdminPanel for potential global use)
// ==========================
function sanitizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generateEmail(firstName, lastName) {
    const f = sanitizeName(firstName), l = sanitizeName(lastName);
    return `${f}.${l}${Math.floor(100 + Math.random() * 900)}@cafeamore.com`;
}

async function isEmailTaken(email) {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", email));
    const snapshot = await getDocs(q);
    return !snapshot.empty;
}
