import { db, auth } from './firebase-config.js';
import { 
    collection, query, where, getDocs,
    doc, updateDoc, deleteField 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
    signInWithEmailAndPassword, 
    sendPasswordResetEmail, 
    RecaptchaVerifier, 
    signInWithPhoneNumber,
    sendEmailVerification 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const okMessage = document.getElementById("okMessage"); 
const resendVerificationBtn = document.getElementById("resendVerificationBtn");

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

window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });

const loginForm = document.getElementById("loginForm");
const DEFAULT_PASSWORD = "CafeAmoreX17"; 

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("loginEmail").value.trim();
        const pass = document.getElementById("loginPassword").value;

        try {
            const usersRef = collection(db, "users");
            let userDocId = null; 
            let qEmail = query(usersRef, where("email", "==", emailInput));
            let querySnapshot = await getDocs(qEmail);
            
            if (querySnapshot.empty) {
                qEmail = query(usersRef, where("pendingEmail", "==", emailInput));
                querySnapshot = await getDocs(qEmail);
            }

            if (querySnapshot.empty) return showMessage("Account does not exist.");

            const userDoc = querySnapshot.docs[0];
            userDocId = userDoc.id; 
            currentUserData = userDoc.data();
            currentRole = currentUserData.role;

            currentRole = currentRole.charAt(0).toUpperCase() + currentRole.slice(1).toLowerCase();

            const isSecureRole = (currentRole === "Super admin" || currentRole === "Admin" || currentRole === "Customer");
            const isInsecureRole = (currentRole !== "Super admin" && currentRole !== "Admin" && currentRole !== "Customer");

            // Employee Enable/Disable
            if (isInsecureRole) {
                const isActive = currentUserData.isActive !== false; 
                if (!isActive) {
                    return showMessage("Your account is disabled. Please contact the admin.");
                }

                const storedPassword = currentUserData.password;
                if (pass !== storedPassword) return showMessage("Wrong password.");
                if (pass === DEFAULT_PASSWORD) {
                    return window.location.href = "updatepass.html?uid=" + userDoc.id;
                }

                if (currentUserData.verified === false) {
                    return showMessage("Your account is not verified yet. Please contact admin.");
                }

                const fullName = `${currentUserData.firstName} ${currentUserData.lastName}`;
                localStorage.setItem('employeeName', fullName);
                localStorage.setItem('employeeRole', currentRole);
                localStorage.setItem('employeeEmail', currentUserData.email);

                switch (currentRole) {
                    case "Cashier":
                        sessionStorage.setItem("cashierName", fullName);
                        sessionStorage.setItem("cashierRole", currentRole);
                        sessionStorage.setItem("cashierEmail", emailInput);
                        return window.location.href = "employee-order.html";
                    case "Driver":
                        sessionStorage.setItem("driverName", fullName);
                        sessionStorage.setItem("driverRole", currentRole);
                        sessionStorage.setItem("driverEmail", emailInput);
                        sessionStorage.setItem("driverPassword", pass);
                        return window.location.href = "driver.html";
                    default:
                        showMessage("Employee role not recognized!");
                        return;
                }
            } 

            if (currentRole === "Admin" && emailInput.endsWith("@cafeamore.com")) {
                return window.location.href = "adminverification.html";
            }

            if (isSecureRole) {
                const userCredential = await signInWithEmailAndPassword(auth, emailInput, pass);
                const user = userCredential.user;
                
                emailCredential.email = emailInput;
                emailCredential.password = pass;
                await user.reload(); 

                const isPendingEmailLogin = currentUserData.pendingEmail && currentUserData.pendingEmail === emailInput;
                if (isPendingEmailLogin) {
                    if (user.email === emailInput) { 
                        await updateDoc(doc(db, "users", userDocId), {
                            email: emailInput,
                            pendingEmail: deleteField() 
                        });
                    } else {
                        showMessage(`Email update process incomplete. Please contact support.`);
                        return;
                    }
                }

                if (!user.emailVerified) {
                    let verificationMessage = `Your email is not verified yet. Please check your inbox: ${emailInput}`;
                    if (currentUserData.pendingEmail === emailInput) {
                        verificationMessage = `Email change pending. Please verify your new email (${emailInput}).`;
                    }
                    showMessage(verificationMessage);
                    if (resendVerificationBtn) {
                        resendVerificationBtn.style.display = 'block';
                        resendVerificationBtn.onclick = async () => {
                            try {
                                if (user) {
                                    await sendEmailVerification(user);
                                    showMessage(`Verification email sent to ${emailInput}.`);
                                    resendVerificationBtn.style.display = 'none';
                                }
                            } catch {
                                showMessage("Failed to resend verification email.");
                            }
                        };
                    }
                    return;
                }

                const phoneNumber = currentUserData.phoneNumber;
                if (!phoneNumber) return showMessage("Phone number not found. Please contact admin.");

                const maskedNumber = phoneNumber.replace(/(\+\d{2,3})\d{4,6}(\d{2,3})$/, '$1*******$2');
                otpPhoneDisplay.textContent = maskedNumber; 

                const appVerifier = window.recaptchaVerifier;
                confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);

                otpPopup.style.display = "flex";
                otpCode.focus(); 
                otpError.style.display = "none";
            }
        } catch (error) {
            console.error("Login error:", error);
            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                showMessage("Wrong password.");
            } else if (error.code === 'auth/user-not-found') {
                showMessage("Account not found or email pending verification.");
            } else {
                showMessage("Error logging in. Please try again.");
            }
        }
    });
}

// OTP verification
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
            await signInWithEmailAndPassword(auth, emailCredential.email, emailCredential.password);

            if (currentRole === "Customer") {
                window.location.href = "menu.html";
            } else if (currentRole === "Admin") {
                window.location.href = "adminpanel.html";
            } else if (currentRole === "Super admin") {
                window.location.href = "superadmin.html";
            } else {
                showMessage("Role not recognized!");
            }
        } catch (error) {
            console.error("OTP verification error:", error);
            let errorMessage = "Incorrect OTP. Please try again.";
            if (error.code === 'auth/code-expired') {
                errorMessage = "Verification code expired. Please log in again.";
            } else if (error.code === 'auth/invalid-verification-code') {
                errorMessage = "Incorrect OTP. Please ensure the code is correct.";
            }
            otpError.textContent = errorMessage;
            otpError.style.display = "block";
        }
    });
}

if (closeOtpBtn) closeOtpBtn.addEventListener("click", () => otpPopup.style.display = "none");

// Forgot password
const forgotLink = document.getElementById("forgotPassword");
const forgotPopup = document.getElementById("forgotPopup");
const closeForgotBtn = document.getElementById("closeForgot");
const sendResetBtn = document.getElementById("sendReset");

if (forgotLink) forgotLink.addEventListener("click", (e) => {
    e.preventDefault();
    forgotPopup.style.display = "flex";
});

if (closeForgotBtn) closeForgotBtn.addEventListener("click", () => {
    forgotPopup.style.display = "none";
});

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

            if (role === "Customer" || role === "Admin" || role === "Super admin") {
                await sendPasswordResetEmail(auth, resetEmail);
                showMessage(`Password reset email sent to ${resetEmail}.`);
                forgotPopup.style.display = "none";
            } else {
                showMessage("Only Customers, Admins, and Super Admins can reset their password.");
            }
        } catch (error) {
            console.error("Forgot password error:", error);
            showMessage("Error: " + error.message);
        }
    });
}
