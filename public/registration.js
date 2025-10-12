import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword,
  RecaptchaVerifier,
  signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ===============================
   Message Popup Helper
=============================== */
const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const popupOkBtn = document.getElementById("popupOkBtn");
let shouldRedirect = false;

function showMessage(msg, redirect = false) {
  messageText.textContent = msg;
  shouldRedirect = redirect;
  messagePopup.style.display = "flex";
}

popupOkBtn.addEventListener("click", () => {
  messagePopup.style.display = "none";
  if (shouldRedirect) window.location.href = "login.html";
});

/* ===============================
   Terms Popup
=============================== */
const termsPopup = document.getElementById("termsPopup");
const termsCheckbox = document.getElementById("terms");
const termsLabel = document.getElementById("termsLabel");
const termsOkBtn = document.getElementById("termsOkBtn");
const termsCancelBtn = document.getElementById("termsCancelBtn");
const termsBody = document.querySelector(".terms-body");
let isOpeningPopup = false;

termsOkBtn.disabled = true;
termsOkBtn.style.opacity = 0.5;

termsBody.addEventListener("scroll", () => {
  if (termsBody.scrollTop + termsBody.clientHeight >= termsBody.scrollHeight - 5) {
    termsOkBtn.disabled = false;
    termsOkBtn.style.opacity = 1;
  }
});

function openTermsPopup() {
  termsOkBtn.disabled = true;
  termsOkBtn.style.opacity = 0.5;
  termsBody.scrollTop = 0;
  termsPopup.style.display = "flex";
}

termsCheckbox.addEventListener("change", (e) => {
  if (termsCheckbox.checked && !isOpeningPopup) {
    e.preventDefault();
    termsCheckbox.checked = false;
    openTermsPopup();
  }
});

termsLabel.addEventListener("click", (e) => {
  e.preventDefault();
  openTermsPopup();
});

termsOkBtn.addEventListener("click", () => {
  isOpeningPopup = true;
  termsCheckbox.checked = true;
  isOpeningPopup = false;
  termsPopup.style.display = "none";
});

termsCancelBtn.addEventListener("click", () => {
  termsPopup.style.display = "none";
  termsCheckbox.checked = false;
});

/* ===============================
   Password Validation
=============================== */
function validatePassword(pass) {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return regex.test(pass);
}

/* ===============================
   Delivery Fee Mapping
=============================== */
const deliveryFees = { /* same as your previous mapping */ };
function getDeliveryFee(barangay) {
  return deliveryFees[barangay] || 0;
}

/* ===============================
   Phone Authentication
=============================== */
const phoneInput = document.getElementById("phoneNumber");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
let otpErrorMsg = document.getElementById("otpErrorMsg");

if (!otpErrorMsg) {
  otpErrorMsg = document.createElement("div");
  otpErrorMsg.id = "otpErrorMsg";
  otpErrorMsg.style.color = "red";
  otpErrorMsg.style.marginTop = "5px";
  otpPopup.querySelector(".message-content").appendChild(otpErrorMsg);
}
otpErrorMsg.style.display = "none";

const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
let confirmationResult;
let isPhoneVerified = false;

function showOtpError(message) {
  otpErrorMsg.textContent = message;
  otpErrorMsg.style.display = "block";
}
function clearOtpError() {
  otpErrorMsg.style.display = "none";
}

if (sendOtpBtn) {
  window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
  sendOtpBtn.addEventListener("click", async () => {
    const phoneNumber = phoneInput.value.trim();
    if (!phoneNumber.startsWith("+63")) {
      showMessage("Phone number must start with +63 (PH format).");
      return;
    }
    try {
      confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
      otpPopup.style.display = "flex";
      clearOtpError();
    } catch (error) {
      showMessage("Failed to send OTP. Please try again.");
      console.error(error);
    }
  });
}

if (verifyOtpBtn) {
  verifyOtpBtn.addEventListener("click", async () => {
    clearOtpError();
    if (!otpCode.value.trim()) {
      showOtpError("Please enter the OTP.");
      return;
    }
    try {
      const result = await confirmationResult.confirm(otpCode.value.trim());
      otpPopup.style.display = "none";
      isPhoneVerified = true;
      showMessage("Phone number verified: " + result.user.phoneNumber);
    } catch (error) {
      isPhoneVerified = false;
      showOtpError("Wrong OTP. Please try again.");
    }
  });
}

if (closeOtpBtn) {
  closeOtpBtn.addEventListener("click", () => {
    otpPopup.style.display = "none";
    clearOtpError();
  });
}

/* ===============================
   Registration
=============================== */
const registerForm = document.getElementById("registerForm");
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const passwordError = document.getElementById("passwordError");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    password.classList.remove("input-error");
    confirmPassword.classList.remove("input-error");
    passwordError.style.display = "none";

    if (!termsCheckbox.checked) {
      showMessage("You must agree to the Terms and Conditions before registering.");
      return;
    }

    if (!isPhoneVerified) {
      showMessage("Please verify your phone number before registering.");
      return;
    }

    const firstName = document.getElementById("firstName").value.trim();
    const lastName = document.getElementById("lastName").value.trim();
    const email = document.getElementById("email").value.trim();
    const phoneNumber = phoneInput.value.trim();
    const pass = password.value;
    const confirmPass = confirmPassword.value;
    const barangay = document.getElementById("barangay").value;
    const houseNumber = document.getElementById("houseNumber").value.trim();

    if (!validatePassword(pass)) {
      password.classList.add("input-error");
      passwordError.innerText = "Password must be at least 8 characters, include uppercase, lowercase, number, and special character.";
      passwordError.style.display = "block";
      return;
    }

    if (pass !== confirmPass) {
      password.classList.add("input-error");
      confirmPassword.classList.add("input-error");
      passwordError.innerText = "Passwords do not match.";
      passwordError.style.display = "block";
      return;
    }

    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, pass);

      // ✅ Fixed local endpoint for SendGrid
      try {
        await fetch('http://localhost:3000/.netlify/functions/sendVerificationEmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userCred.user.email, uid: userCred.user.uid })
        });
      } catch (err) {
        console.error("SendGrid verification failed:", err);
      }

      const deliveryFee = getDeliveryFee(barangay);

      await setDoc(doc(db, "users", userCred.user.uid), {
        firstName,
        lastName,
        email,
        phoneNumber,
        barangay,
        houseNumber,
        region: "South Luzon",
        province: "Cavite",
        city: "Bacoor",
        role: "Customer",
        deliveryFee
      });

      showMessage(`Registration successful! Please verify your email.`, true);
      registerForm.reset();
      termsCheckbox.checked = false;
      isPhoneVerified = false;

    } catch (error) {
      let errorMessage = "Something went wrong. Please try again.";
      if (error.code === "auth/email-already-in-use") errorMessage = "The email is already in use. Please use a different email.";
      else if (error.code === "auth/invalid-email") errorMessage = "The email address is not valid.";
      else if (error.code === "auth/weak-password") errorMessage = "Password is too weak. Please choose a stronger password.";
      showMessage(errorMessage);
    }
  });
}
