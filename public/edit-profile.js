// ==========================
// Imports
// ==========================
import { auth, db } from './firebase-config.js';
import { 
  doc, getDoc, updateDoc, collection, query, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { 
  updatePassword, 
  EmailAuthProvider, 
  reauthenticateWithCredential, 
  reload, 
  verifyBeforeUpdateEmail,
  RecaptchaVerifier,
  signInWithPhoneNumber        
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================
// Sidebar Active Link
// ==========================
const sidebarLinks = document.querySelectorAll('.login-link, .profile-card, .logout');
sidebarLinks.forEach(link => link.classList.remove('active'));
document.querySelector('.profile-card').classList.add('active');

// ==========================
// Tabs Functionality
// ==========================
const tabs = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    tabContents.forEach(tc => tc.style.display = "none");
    document.getElementById(tab.dataset.tab).style.display = "block";
  });
});

// ==========================
// Input Elements
// ==========================
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const emailInput = document.getElementById("email");
const currentEmailInput = document.getElementById("currentEmailInput");
const newEmailInput = document.getElementById("newEmail");
const currentPasswordInput = document.getElementById("currentPassword");

const barangayInput = document.getElementById("barangay");
const houseNumberInput = document.getElementById("houseNumber");
const regionInput = document.getElementById("region");
const provinceInput = document.getElementById("province");
const cityInput = document.getElementById("city");

const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const currentPasswordForChange = document.getElementById("currentPasswordForChange");

const phoneInput = document.getElementById("phone");
const currentPhoneInput = document.getElementById("currentPhoneInput");
const newPhoneInput = document.getElementById("newPhone");
const currentPhonePasswordInput = document.getElementById("currentPhonePassword");

const emailEditFields = document.querySelector(".email-edit-fields");
const phoneEditFields = document.querySelector(".phone-edit-fields");

// ==========================
// OTP Popup Elements
// ==========================
const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
const otpError = document.getElementById("otpError"); 
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");

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
  });
}

// ==========================
// Mask Functions
// ==========================
function maskEmail(email) {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (user.length <= 3) return user + "*****@" + domain;
  return user.substring(0, 3) + "*".repeat(Math.max(user.length - 3, 3)) + "@" + domain;
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone || "";
  return phone.slice(0, 3) + "*".repeat(phone.length - 6) + phone.slice(-3);
}

// ==========================
// Phone Input Helper
// ==========================
function formatPhone(input) {
  let value = input.value.trim();
  let digits = value.replace(/[^0-9]/g, "");
  if (value.startsWith("09")) digits = digits.slice(1);
  if (digits.length >= 10 && !value.startsWith('+')) {
    input.value = "09" + digits.slice(-10);
  } else {
    input.value = value;
  }
}
[newPhoneInput].forEach(input => input.addEventListener("input", () => formatPhone(input)));

// ==========================
// Load User Data 
// ==========================
async function loadUserData() {
  const user = auth.currentUser;
  if (!user) return;

  const docRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    const data = docSnap.data();
    firstNameInput.value = data.firstName || "";
    lastNameInput.value = data.lastName || "";
    emailInput.value = maskEmail(data.email || "");
    phoneInput.value = maskPhone(data.phoneNumber || "");

    currentEmailInput.value = data.email || "";
    currentPhoneInput.value = data.phoneNumber || "";

    barangayInput.value = data.barangay || "";
    houseNumberInput.value = data.houseNumber || "";
    regionInput.value = data.region || "South Luzon";
    provinceInput.value = data.province || "Cavite";
    cityInput.value = data.city || "Bacoor";
  }
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    // No logged-in user -> redirect to login page
    window.location.href = "login.html"; // adjust path if needed
    return;
  }

  // User is logged in, load their data
  await loadUserData();
});


// ==========================
// Generic Edit/Save/Cancel
// ==========================
function setupEditSaveCancel(editBtnId, saveBtnId, cancelBtnId, inputs, formId, onSave, onEditExtra = null) {
  const editBtn = document.getElementById(editBtnId);
  const saveBtn = document.getElementById(saveBtnId);
  const cancelBtn = document.getElementById(cancelBtnId);
  const form = document.getElementById(formId);
  let originalValues = {};

  editBtn.addEventListener("click", () => {
    inputs.forEach(i => originalValues[i.id] = i.value);
    inputs.forEach(i => i.disabled = false);
    editBtn.style.display = "none";
    saveBtn.style.display = "inline-block";
    cancelBtn.style.display = "inline-block";
    if (onEditExtra) onEditExtra();
  });

  cancelBtn.addEventListener("click", () => {
    inputs.forEach(i => i.value = originalValues[i.id]);
    inputs.forEach(i => i.disabled = true);
    editBtn.style.display = "inline-block";
    saveBtn.style.display = "none";
    cancelBtn.style.display = "none";
    if (onEditExtra) {
      if (onEditExtra === emailEditFields) emailEditFields.style.display = "none";
      if (onEditExtra === phoneEditFields) phoneEditFields.style.display = "none";
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await onSave();
      await loadUserData();
      inputs.forEach(i => i.disabled = true);
      editBtn.style.display = "inline-block";
      saveBtn.style.display = "none";
      cancelBtn.style.display = "none";
    } catch (err) {
      if (!err.message.includes("Failed to send OTP")) {
        alert("Error: " + err.message);
      }
    }
  });
}

// ==========================
// Re-login Popup
// ==========================
function showReLoginPopup(message) {
  if (otpPopup) otpPopup.style.display = "none";

  const popup = document.createElement("div");
  popup.style.position = "fixed";
  popup.style.top = "0";
  popup.style.left = "0";
  popup.style.width = "100%";
  popup.style.height = "100%";
  popup.style.backgroundColor = "rgba(0,0,0,0.6)";
  popup.style.display = "flex";
  popup.style.alignItems = "center";
  popup.style.justifyContent = "center";
  popup.style.zIndex = "10001";

  const box = document.createElement("div");
  box.style.background = "#fff8f0";
  box.style.padding = "30px 25px";
  box.style.borderRadius = "15px";
  box.style.textAlign = "center";
  box.style.maxWidth = "400px";
  box.style.width = "90%";
  box.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
  box.style.position = "relative";

  const msg = document.createElement("p");
  msg.textContent = message;
  msg.style.color = "#552915";
  msg.style.fontSize = "1.1em";
  msg.style.marginBottom = "20px";
  box.appendChild(msg);

  const okBtn = document.createElement("button");
  okBtn.textContent = "OK";
  okBtn.style.background = "#552915";
  okBtn.style.color = "#fff";
  okBtn.style.border = "none";
  okBtn.style.padding = "10px 25px";
  okBtn.style.borderRadius = "10px";
  okBtn.style.fontWeight = "bold";
  okBtn.style.cursor = "pointer";
  okBtn.onmouseover = () => okBtn.style.background = "#6f4e37";
  okBtn.onmouseout = () => okBtn.style.background = "#552915";
  box.appendChild(okBtn);

  popup.appendChild(box);
  document.body.appendChild(popup);

  okBtn.addEventListener("click", () => {
    auth.signOut().then(() => {
      window.location.href = "login.html";
    });
  });
}

// ==========================
// Tabs: Info, Address, Email, Password, Phone
// ==========================

// Information Tab
setupEditSaveCancel(
  "editInfoBtn",
  "saveInfoBtn",
  "cancelInfoBtn",
  [firstNameInput, lastNameInput],
  "infoForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");
    const fullName = `${firstNameInput.value} ${lastNameInput.value}`.trim();
    await updateDoc(doc(db, "users", user.uid), {
      firstName: firstNameInput.value,
      lastName: lastNameInput.value
    });
    localStorage.setItem("currentUserName", fullName);
    const profileNameEl = document.querySelector('.profile-name');
    const welcomeHeader = document.querySelector('.main-content header h1');
    if (profileNameEl) profileNameEl.textContent = fullName;
    if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${fullName}`;
    alert("Information updated successfully!");
  }
);

// Address Tab
setupEditSaveCancel(
  "editAddressBtn",
  "saveAddressBtn",
  "cancelAddressBtn",
  [barangayInput, houseNumberInput],
  "addressForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");
    await updateDoc(doc(db, "users", user.uid), {
      barangay: barangayInput.value,
      houseNumber: houseNumberInput.value
    });
    alert("Address updated successfully!");
  }
);

// Email Tab
setupEditSaveCancel(
  "editEmailBtn",
  "saveEmailBtn",
  "cancelEmailBtn",
  [currentEmailInput, newEmailInput, currentPasswordInput],
  "emailForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");
    if (!currentEmailInput.value || !newEmailInput.value || !currentPasswordInput.value)
      throw new Error("All fields are required");
    if (currentEmailInput.value !== user.email)
      throw new Error("Current email does not match account email.");

    await reload(user);
    const credential = EmailAuthProvider.credential(user.email, currentPasswordInput.value);
    await reauthenticateWithCredential(user, credential);

    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", newEmailInput.value));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) throw new Error("Email already in use");

    await updateDoc(doc(db, "users", user.uid), { pendingEmail: newEmailInput.value });
    await verifyBeforeUpdateEmail(user, newEmailInput.value);

    showReLoginPopup("Email updated successfully! Please login again.");
  },
  () => {
    phoneEditFields.style.display = "none";
    emailEditFields.style.display = "block";
    currentEmailInput.value = "";
    newEmailInput.value = "";
    currentPasswordInput.value = "";
  }
);

// Password Tab
setupEditSaveCancel(
  "editPasswordBtn",
  "savePasswordBtn",
  "cancelPasswordBtn",
  [currentPasswordForChange, passwordInput, confirmPasswordInput],
  "passwordForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");
    if (!currentPasswordForChange.value || !passwordInput.value || !confirmPasswordInput.value)
      throw new Error("All fields are required");
    if (passwordInput.value !== confirmPasswordInput.value)
      throw new Error("Passwords do not match");

    const credential = EmailAuthProvider.credential(user.email, currentPasswordForChange.value);
    await reauthenticateWithCredential(user, credential);
    await updatePassword(user, passwordInput.value);

    showReLoginPopup("Password updated successfully! Please login again.");
  },
  () => {
    currentPasswordForChange.value = "";
    passwordInput.value = "";
    confirmPasswordInput.value = "";
  }
);

// Phone Tab
setupEditSaveCancel(
  "editPhoneBtn",
  "savePhoneBtn",
  "cancelPhoneBtn",
  [currentPhoneInput, newPhoneInput, currentPhonePasswordInput],
  "phoneForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");
    if (!currentPhoneInput.value || !newPhoneInput.value || !currentPhonePasswordInput.value)
      throw new Error("All fields are required");

    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) throw new Error("User data not found.");
    const data = docSnap.data();

    if (currentPhoneInput.value !== data.phoneNumber)
      throw new Error("Current phone does not match saved number.");

    const credential = EmailAuthProvider.credential(user.email, currentPhonePasswordInput.value);
    await reauthenticateWithCredential(user, credential);

    let newPhoneNumber = newPhoneInput.value.trim();
    if (newPhoneNumber.startsWith("09")) newPhoneNumber = "+63" + newPhoneNumber.slice(1);
    else if (!newPhoneNumber.startsWith("+63")) newPhoneNumber = "+63" + newPhoneNumber.replace(/[^0-9]/g, "").slice(-10);

    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });

    try {
      const confirmationResult = await signInWithPhoneNumber(auth, newPhoneNumber, window.recaptchaVerifier);
      otpPopup.style.display = "flex";
      clearOtpError();

      verifyOtpBtn.onclick = async () => {
        const otp = otpCode.value.trim();
        if (!otp) return showOtpError("Please enter the OTP.");
        try {
          await confirmationResult.confirm(otp);
          await updateDoc(docRef, { phoneNumber: newPhoneNumber });
          showReLoginPopup("Phone number updated successfully! Please login again.");
        } catch {
          showOtpError("Wrong OTP. Please try again.");
        }
      };
    } catch (err) {
      console.error("OTP send error:", err);
      throw new Error("Failed to send OTP. Check phone number format.");
    }
  },
  () => {
    phoneEditFields.style.display = "block";
    currentPhoneInput.value = "";
    newPhoneInput.value = "";
    currentPhonePasswordInput.value = "";
  }
);
