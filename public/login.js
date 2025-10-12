import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
    signInWithEmailAndPassword, 
    sendPasswordResetEmail, 
    RecaptchaVerifier, 
    signInWithPhoneNumber,
    // ADDED: Import the email verification function
    sendEmailVerification 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ===============================
    DOM Elements & Message Popup Helper
=============================== */
const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const okMessage = document.getElementById("okMessage"); 
const resendVerificationBtn = document.getElementById("resendVerificationBtn");

/**
 * Shows a message popup. Hides the resend button by default.
 * @param {string} msg The message content.
 */
function showMessage(msg) {
    if (messageText) {
        messageText.textContent = msg;
        messagePopup.style.display = "flex";
        okMessage.focus(); 
        
        if (resendVerificationBtn) {
            resendVerificationBtn.style.display = "none";
            resendVerificationBtn.onclick = null; 
        }
    }
}

okMessage.addEventListener("click", () => {
    messagePopup.style.display = "none";
});

/* ===============================
    OTP Modal Elements
=============================== */
const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
const otpPhoneDisplay = document.getElementById("maskedPhone");
const otpError = document.getElementById("otpError");

let confirmationResult;
let currentUserData = null;
let currentRole = null;
let emailCredential = { email: '', password: '' }; 

/* ===============================
    Recaptcha Setup
=============================== */
window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });

/* ===============================
    Login Form (Email + Password)
=============================== */
const loginForm = document.getElementById("loginForm");
const DEFAULT_PASSWORD = "CafeAmoreX17"; 

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("loginEmail").value.trim();
        const pass = document.getElementById("loginPassword").value;

        try {
            // 1. Check Firestore for user account existence/role
            const usersRef = collection(db, "users");
            const qEmail = query(usersRef, where("email", "==", emailInput));
            const querySnapshot = await getDocs(qEmail);

            if (querySnapshot.empty) return showMessage("Account does not exist.");

            const userDoc = querySnapshot.docs[0];
            currentUserData = userDoc.data();
            currentRole = currentUserData.role;

            // Normalize role
            currentRole = currentRole.charAt(0).toUpperCase() + currentRole.slice(1).toLowerCase();

            // ============================
            // Identify Secure vs. Insecure Login Flow
            // ============================
            // SECURE AUTH FLOW (Super Admin, Admin, Customer)
            const isSecureRole = (currentRole === "Super admin" || currentRole === "Admin" || currentRole === "Customer");
            
            // INSECURE DB FLOW (Cashier, Bartender, Driver)
            const isInsecureRole = (currentRole !== "Super admin" && currentRole !== "Admin" && currentRole !== "Customer");


            // ============================
            // 2. Insecure Employee Flow (DB Password Check)
            // ============================
            if (isInsecureRole) {
                const storedPassword = currentUserData.password;
                
                // ⚠️ CRITICAL VULNERABILITY: Comparing plaintext password
                if (pass !== storedPassword) return showMessage("Wrong password.");

                // Enforce password change if using default password
                if (pass === DEFAULT_PASSWORD) {
                    return window.location.href = "updatepass.html?uid=" + userDoc.id;
                }

                // Redirect based on role
                switch (currentRole) {
                    case "Cashier":
                        return window.location.href = "employee-incomingorder.html";
                    case "Bartender":
                        return window.location.href = "incomingorders.html";
                    case "Driver":
                        return window.location.href = "driver.html";
                    default:
                        showMessage("Employee role not recognized!");
                        return;
                }
            } 

            // ============================
            // 3. Admin (@cafeamore.com) bypass (This remains outside of the Auth flow)
            // ============================
            if (currentRole === "Admin" && emailInput.endsWith("@cafeamore.com")) {
                 return window.location.href = "adminverification.html";
            }
            
            // ============================
            // 4. Secure Auth Flow (Super Admin, Admin, Customer)
            // ============================
            if (isSecureRole) {
                // Sign in with Firebase Authentication
                const userCredential = await signInWithEmailAndPassword(auth, emailInput, pass);
                const user = userCredential.user;
                emailCredential.email = emailInput;
                emailCredential.password = pass;

                await user.reload(); // Get latest verification status

                if (!user.emailVerified) {
                    showMessage(`Your email is not verified yet. Please check your inbox: ${emailInput}`);
                    
                    if (resendVerificationBtn) {
                        resendVerificationBtn.style.display = 'block'; 
                        
                        resendVerificationBtn.onclick = async () => {
                            try {
                                if (user) {
                                    await sendEmailVerification(user);
                                    showMessage(`Verification email successfully resent to ${emailInput}. Please check your spam folder.`);
                                    resendVerificationBtn.style.display = 'none';
                                }
                            } catch (resendError) {
                                console.error("Resend email error:", resendError);
                                showMessage("Failed to resend verification email. Please try again later.");
                            }
                        };
                    }
                    return; // Stop the login process until verified
                }

                // Email is verified, proceed to OTP
                const phoneNumber = currentUserData.phoneNumber;
                if (!phoneNumber) return showMessage("Phone number not found. Please contact admin.");
                otpPhoneDisplay.textContent = phoneNumber.replace(/(\d{4})$/, "****");

                const appVerifier = window.recaptchaVerifier;
                confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);

                otpPopup.style.display = "flex";
                otpCode.focus(); 
                otpError.style.display = "none";
            }
        } catch (error) {
            console.error("Login error:", error);
            if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
                showMessage("Wrong password.");
            } else {
                showMessage("Error logging in. Please try again.");
            }
        }
    });
}

/* ===============================
    Verify OTP
=============================== */
if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener("click", async () => {
        const code = otpCode.value.trim();
        otpError.style.display = "none";

        if (!code) {
            otpError.textContent = "Please enter the OTP.";
            otpError.style.display = "block";
            return;
        }

        if (!confirmationResult) {
            otpError.textContent = "Verification session expired. Please log in again.";
            otpError.style.display = "block";
            return;
        }

        try {
            await confirmationResult.confirm(code);
            otpPopup.style.display = "none";

            // Re-sign in with email and password to update the auth state after OTP
            await signInWithEmailAndPassword(auth, emailCredential.email, emailCredential.password);

            // Redirect based on the role stored earlier
            if (currentRole === "Customer") {
                window.location.href = "index.html";
            } else if (currentRole === "Admin") {
                window.location.href = "adminpanel.html";
            } else if (currentRole === "Super admin") {
                window.location.href = "superadmin.html";
            }
            else {
                showMessage("Role not recognized!");
            }
        } catch (error) {
            console.error("OTP verification error:", error);
            let errorMessage = "Incorrect OTP. Please try again.";
            if (error.code === 'auth/code-expired') {
                errorMessage = "The verification code has expired. Please log in again to send a new one.";
            } else if (error.code === 'auth/invalid-verification-code') {
                errorMessage = "Incorrect OTP. Please ensure the code is typed exactly as received.";
            }
            otpError.textContent = errorMessage;
            otpError.style.display = "block";
        }
    });
}

/* ===============================
    Close OTP Popup
=============================== */
if (closeOtpBtn) {
    closeOtpBtn.addEventListener("click", () => {
        otpPopup.style.display = "none";
    });
}

/* ===============================
    Forgot Password
=============================== */
const forgotLink = document.getElementById("forgotPassword");
const forgotPopup = document.getElementById("forgotPopup");
const closeForgotBtn = document.getElementById("closeForgot");
const sendResetBtn = document.getElementById("sendReset");

if (forgotLink) {
    forgotLink.addEventListener("click", (e) => {
        e.preventDefault();
        forgotPopup.style.display = "flex";
    });
}

if (closeForgotBtn) {
    closeForgotBtn.addEventListener("click", () => {
        forgotPopup.style.display = "none";
    });
}

if (sendResetBtn) {
    sendResetBtn.addEventListener("click", async () => {
        const resetEmail = document.getElementById("resetEmail").value.trim();
        if (!resetEmail) return showMessage("Please enter your email.");

        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("email", "==", resetEmail));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) return showMessage("This account does not exist.");

            const userDoc = querySnapshot.docs[0];
            const role = userDoc.data().role;

            // Only customers and admins use Firebase Auth and can receive reset emails
            if (role === "Customer" || role === "Admin" || role === "Super admin") {
                await sendPasswordResetEmail(auth, resetEmail);
                showMessage(`Password reset email sent to ${resetEmail}. Please check your inbox.`);
                forgotPopup.style.display = "none";
            } else {
                showMessage("Only Customers, Admins, and Super Admins can reset their password. Employees must contact the admin.");
            }
        } catch (error) {
            console.error("Forgot password error:", error);
            showMessage("Error: " + error.message);
        }
    });
}
