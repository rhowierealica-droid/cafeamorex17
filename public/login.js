import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  fetchSignInMethodsForEmail 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ===============================
   Message Popup Helper
   =============================== */
const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const closeMessage = document.getElementById("closeMessage");

function showMessage(msg) {
  messageText.textContent = msg;
  messagePopup.style.display = "flex";
}

closeMessage.addEventListener("click", () => {
  messagePopup.style.display = "none";
});

/* ===============================
   Login with Role Redirection
   =============================== */
const loginForm = document.getElementById("loginForm");
const DEFAULT_PASSWORD = "CafeAmoreX17";

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPassword").value;

  try {
    const usersRef = collection(db, "users");

    // Query Firestore for email or pendingEmail
    const qEmail = query(usersRef, where("email", "==", emailInput));
    const qPending = query(usersRef, where("pendingEmail", "==", emailInput));

    let querySnapshot = await getDocs(qEmail);
    let usingPending = false;

    if (querySnapshot.empty) {
      querySnapshot = await getDocs(qPending);
      if (!querySnapshot.empty) usingPending = true;
    }

    if (querySnapshot.empty) return showMessage("Account does not exist.");

    const userDoc = querySnapshot.docs[0];
    const data = userDoc.data();
    const role = data.role;
    const storedPassword = data.password;

    // ============================
    // Handle pending email login
    // ============================
    if (usingPending) {
      const pendingEmail = data.pendingEmail.trim();

      try {
        // Try logging in with pending email
        const pendingCredential = await signInWithEmailAndPassword(auth, pendingEmail, pass);

        // Reload user to get latest verification state
        await pendingCredential.user.reload();

        if (!pendingCredential.user.emailVerified) {
          return showMessage(
            `Account is not verified yet. Please check your email: ${pendingEmail}`
          );
        }

        // ✅ Verified → sync Firestore
        await updateDoc(doc(db, "users", userDoc.id), {
          email: pendingEmail,
          pendingEmail: ""
        });

        showMessage("Email verified successfully. Logging in...");
        window.location.href = role === "Customer" ? "index.html" : "adminpanel.html";
        return;
      } catch (err) {
        console.error("Pending email login error:", err);
        return showMessage("Wrong password for this email.");
      }
    }

    // ============================
    // Normal Customer/Admin login
    // ============================
    if (role === "Customer" || role === "Admin") {
      try {
        const userCredential = await signInWithEmailAndPassword(auth, data.email.trim(), pass);

        await userCredential.user.reload();

        // Sync Firestore if still has pendingEmail
        if (data.pendingEmail && userCredential.user.emailVerified) {
          await updateDoc(doc(db, "users", userDoc.id), {
            email: userCredential.user.email,
            pendingEmail: ""
          });
        }

        window.location.href = role === "Customer" ? "index.html" : "adminpanel.html";
      } catch (err) {
        console.error("Normal login error:", err);
        return showMessage("Account does not exist or wrong password.");
      }
    }

    // ============================
    // Employee login via Firestore
    // ============================
    else {
      if (pass !== storedPassword) return showMessage("Wrong password.");

      if (pass === DEFAULT_PASSWORD) {
        return window.location.href = "updatepass.html?uid=" + userDoc.id;
      }

      switch (role) {
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
  } catch (error) {
    console.error("Login flow error:", error);
    showMessage("Error logging in: " + error.message);
  }
});

/* ===============================
   Forgot Password (Customer Only)
   =============================== */
const forgotLink = document.getElementById("forgotPassword");
const forgotPopup = document.getElementById("forgotPopup");
const closeForgotBtn = document.getElementById("closeForgot");
const sendResetBtn = document.getElementById("sendReset");

forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  forgotPopup.style.display = "flex";
});

closeForgotBtn.addEventListener("click", () => {
  forgotPopup.style.display = "none";
});

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

    if (role !== "Customer") {
      return showMessage("Only customers can reset their password here. Employees must contact the admin.");
    }

    await sendPasswordResetEmail(auth, resetEmail);
    showMessage(`Password reset email sent to ${resetEmail}. Please check your inbox.`);
    forgotPopup.style.display = "none";
  } catch (error) {
    console.error("Forgot password error:", error);
    showMessage("Error: " + error.message);
  }
});
