import { db, auth } from './firebase-config.js';
import { 
  collection, query, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  RecaptchaVerifier, 
  signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ===============================
   Message Popup Helper
=============================== */
const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const okMessage = document.getElementById("okMessage"); 

function showMessage(msg) {
  if (messageText) {
    messageText.textContent = msg;
    messagePopup.style.display = "flex";
    okMessage.focus(); 
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
const otpError = document.getElementById("otpError"); // Inline OTP error

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
      const usersRef = collection(db, "users");
      const qEmail = query(usersRef, where("email", "==", emailInput));
      const querySnapshot = await getDocs(qEmail);

      if (querySnapshot.empty) return showMessage("Account does not exist.");

      const userDoc = querySnapshot.docs[0];
      currentUserData = userDoc.data();
      currentRole = currentUserData.role;

      // ============================
      // Employees: Firestore password (No MFA)
      // ============================
      if (currentRole !== "Customer" && currentRole !== "Admin") {
        const storedPassword = currentUserData.password;
        if (pass !== storedPassword) return showMessage("Wrong password.");

        if (pass === DEFAULT_PASSWORD) {
          return window.location.href = "updatepass.html?uid=" + userDoc.id;
        }

        switch (currentRole) {
          case "Cashier":
            window.location.href = "orders.html";
            break;
          case "Bartender":
            window.location.href = "incomingorders.html";
            break;
          case "Driver":
            window.location.href = "driver.html";
            break;
          default:
            showMessage("Role not recognized!");
        }
      } 
      // ============================
      // Customers/Admins: Email+Password, then OTP (MFA)
      // ============================
      else {
        // STEP 1: Primary Sign-in with Email and Password
        const userCredential = await signInWithEmailAndPassword(auth, emailInput, pass);
        emailCredential.email = emailInput;
        emailCredential.password = pass;

        await userCredential.user.reload();

        if (!userCredential.user.emailVerified) {
          return showMessage(`Your email is not verified yet. Please check your inbox: ${emailInput}`);
        }

        // STEP 2: Send OTP
        const phoneNumber = currentUserData.phoneNumber;
        if (!phoneNumber) return showMessage("Phone number not found. Please contact admin.");
        otpPhoneDisplay.textContent = phoneNumber.replace(/(\d{4})$/, "****");

        confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);

        otpPopup.style.display = "flex";
        otpCode.focus(); 
        otpError.style.display = "none"; // Reset any previous error
      }
    } catch (error) {
      console.error("Login error:", error);
      // Always show "Wrong password" for credential errors
      if (error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
        showMessage("Wrong password.");
      } else {
        showMessage("Error logging in. Please try again.");
      }
    }
  });
}

/* ===============================
   Verify OTP (Inline Error)
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

      // Re-authenticate with Email/Password
      await signInWithEmailAndPassword(auth, emailCredential.email, emailCredential.password);

      if (currentRole === "Customer") window.location.href = "index.html";
      else if (currentRole === "Admin") window.location.href = "adminpanel.html";
      else showMessage("Role not recognized!");
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
   Forgot Password (Customer + Admin)
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

      if (role === "Customer" || role === "Admin") {
        await sendPasswordResetEmail(auth, resetEmail);
        showMessage(`Password reset email sent to ${resetEmail}. Please check your inbox.`);
        forgotPopup.style.display = "none";
      } else {
        showMessage("Only Customers and Admins can reset their password. Employees must contact the admin.");
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      showMessage("Error: " + error.message);
    }
  });
}
