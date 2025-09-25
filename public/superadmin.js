import { db } from './firebase-config.js';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* Message Popup */
const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const popupOkBtn = document.getElementById("popupOkBtn");

function showMessage(msg) {
  messageText.textContent = msg;
  messagePopup.style.display = "flex";
}

popupOkBtn.addEventListener("click", () => {
  messagePopup.style.display = "none";
  window.location.href = "login.html"; // redirect to update account page
});

/* Password Validation - Minimum 8 characters */
function validatePassword(pass) {
  return pass.length >= 8;
}

/* Registration */
const registerForm = document.getElementById("registerForm");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const passwordError = document.getElementById("passwordError");

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  password.classList.remove("input-error");
  confirmPassword.classList.remove("input-error");
  passwordError.style.display = "none";

  const username = document.getElementById("username").value.trim();
  const pass = password.value;
  const confirmPass = confirmPassword.value;

  // Password minimum length validation
  if (!validatePassword(pass)) {
    password.classList.add("input-error");
    passwordError.innerText = "Password must be at least 8 characters long.";
    passwordError.style.display = "block";
    return;
  }

  // Check password match
  if (pass !== confirmPass) {
    password.classList.add("input-error");
    confirmPassword.classList.add("input-error");
    passwordError.innerText = "Passwords do not match.";
    passwordError.style.display = "block";
    return;
  }

  try {
    // Save admin credentials in Firestore directly
    await setDoc(doc(db, "admins", username), {
      username,
      password: pass,  // store hashed in production
      firstTime: true
    });

    showMessage("Admin account created successfully!");
    registerForm.reset();

  } catch (error) {
    showMessage("Error: " + error.message);
  }
});
