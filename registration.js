import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  sendEmailVerification,
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
   Terms Popup with Scroll Requirement
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
  if (!termsCheckbox.checked) {
    e.preventDefault();
    openTermsPopup();
  }
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
const deliveryFees = {
  "Alima": 5, "Aniban I": 10, "Aniban II": 15, "Aniban III": 20,
  "Aniban IV": 25, "Aniban V": 30, "Banalo": 35, "Bayanan": 40,
  "Campo Santo": 45, "Daang Bukid": 50, "Digman": 55, "Dulong Bayan": 60,
  "Habay I": 65, "Habay II": 70, "Ligas I": 75, "Ligas II": 80,
  "Ligas III": 85, "Mabolo I": 90, "Mabolo II": 95, "Mabolo III": 100,
  "Maliksi I": 105, "Maliksi II": 110, "Maliksi III": 115, "Mambog I": 120,
  "Mambog II": 125, "Mambog III": 130, "Mambog IV": 135, "Mambog V": 140,
  "Molino I": 145, "Molino II": 150, "Molino III": 155, "Molino IV": 160,
  "Molino V": 165, "Molino VI": 170, "Molino VII": 175, "Niog I": 180,
  "Niog II": 185, "Niog III": 190, "P.F. Espiritu I (Panapaan)": 195,
  "P.F. Espiritu II": 200, "P.F. Espiritu III": 205, "P.F. Espiritu IV": 210,
  "P.F. Espiritu V": 215, "P.F. Espiritu VI": 220, "P.F. Espiritu VII": 225,
  "P.F. Espiritu VIII": 230, "Queens Row Central": 235, "Queens Row East": 240,
  "Queens Row West": 245, "Real I": 250, "Real II": 255, "Salinas I": 260,
  "Salinas II": 265, "Salinas III": 270, "Salinas IV": 275, "San Nicolas I": 280,
  "San Nicolas II": 285, "San Nicolas III": 290, "Sineguelasan": 295,
  "Tabing Dagat (Poblacion)": 300, "Talaba I": 305, "Talaba II": 310,
  "Talaba III": 315, "Talaba IV": 320, "Talaba V": 325, "Talaba VI": 330,
  "Talaba VII": 335, "Zapote I": 340, "Zapote II": 345, "Zapote III": 350,
  "Zapote IV": 355, "Zapote V": 360
};

function getDeliveryFee(barangay) {
  return deliveryFees[barangay] || 0;
}

/* ===============================
   Phone Authentication Setup
=============================== */
const phoneInput = document.getElementById("phoneNumber");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
let confirmationResult;

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
    } catch (error) {
      showMessage("Error sending OTP: " + error.message);
    }
  });
}

if (verifyOtpBtn) {
  verifyOtpBtn.addEventListener("click", async () => {
    try {
      const result = await confirmationResult.confirm(otpCode.value.trim());
      otpPopup.style.display = "none";
      showMessage("Phone number verified: " + result.user.phoneNumber);
    } catch (error) {
      showMessage("Invalid OTP: " + error.message);
    }
  });
}

if (closeOtpBtn) {
  closeOtpBtn.addEventListener("click", () => {
    otpPopup.style.display = "none";
  });
}

/* ===============================
   Registration with Email + Phone
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

    if (!confirmationResult) {
      showMessage("Please verify your phone number before registering.");
      return;
    }

    try {
      const userCred = await createUserWithEmailAndPassword(auth, email, pass);
      await sendEmailVerification(userCred.user);

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

      showMessage(`Registration successful! Delivery fee for ${barangay} is ₱${deliveryFee}. Please verify your email.`, true);
      registerForm.reset();
      termsCheckbox.checked = false;

    } catch (error) {
      showMessage("Error: " + error.message);
    }
  });
}
