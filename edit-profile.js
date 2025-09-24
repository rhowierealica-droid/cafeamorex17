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
  applyActionCode, 
  verifyBeforeUpdateEmail, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

const emailEditFields = document.querySelector(".email-edit-fields");

// ==========================
// Mask Email Function
// ==========================
function maskEmail(email) {
  if (!email) return "";
  const [user, domain] = email.split("@");
  if (user.length <= 3) return user + "*****@" + domain;
  return user.substring(0, 3) + "*".repeat(Math.max(user.length - 3, 3)) + "@" + domain;
}

// ==========================
// Load User Data
// ==========================
auth.onAuthStateChanged(async (user) => {
  if (!user) {
    alert("No account detected. Please log in.");
    window.location.href = "login.html";
    return;
  }

  const docRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    const data = docSnap.data();
    firstNameInput.value = data.firstName || "";
    lastNameInput.value = data.lastName || "";
    emailInput.value = maskEmail(data.email || "");
    currentEmailInput.value = data.email || "";
    barangayInput.value = data.barangay || "";
    houseNumberInput.value = data.houseNumber || "";
    regionInput.value = data.region || "South Luzon";
    provinceInput.value = data.province || "Cavite";
    cityInput.value = data.city || "Bacoor";
  }
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
    if (onEditExtra) emailEditFields.style.display = "none";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await onSave();
    } catch (err) {
      alert("Error: " + err.message);
    }
  });
}

// ==========================
// Information Tab
// ==========================
setupEditSaveCancel(
  "editInfoBtn",
  "saveInfoBtn",
  "cancelInfoBtn",
  [firstNameInput, lastNameInput],
  "infoForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected. Please log in.");
    await updateDoc(doc(db, "users", user.uid), {
      firstName: firstNameInput.value,
      lastName: lastNameInput.value
    });
    alert("Information updated successfully!");
  }
);

// ==========================
// Address Tab
// ==========================
setupEditSaveCancel(
  "editAddressBtn",
  "saveAddressBtn",
  "cancelAddressBtn",
  [barangayInput, houseNumberInput],
  "addressForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected. Please log in.");
    await updateDoc(doc(db, "users", user.uid), {
      barangay: barangayInput.value,
      houseNumber: houseNumberInput.value
    });
    alert("Address updated successfully!");
  }
);

// ==========================
// Email Tab
// ==========================
setupEditSaveCancel(
  "editEmailBtn",
  "saveEmailBtn",
  "cancelEmailBtn",
  [currentEmailInput, newEmailInput, currentPasswordInput],
  "emailForm",
  async () => {
    let user = auth.currentUser;
    if (!user) throw new Error("No account detected. Please log in.");
    if (!currentEmailInput.value || !newEmailInput.value || !currentPasswordInput.value)
      throw new Error("All fields are required");
if (currentEmailInput.value !== user.email) {
  throw new Error("The entered current email does not match your account email.");
}

    await reload(user);
    user = auth.currentUser;

    const credential = EmailAuthProvider.credential(user.email, currentPasswordInput.value);
    await reauthenticateWithCredential(user, credential);

    // Check for duplicate email
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("email", "==", newEmailInput.value));
    const querySnapshot = await getDocs(q);
    if (!querySnapshot.empty) throw new Error("Email already in use");

    // Set pendingEmail in Firestore
    await updateDoc(doc(db, "users", user.uid), { pendingEmail: newEmailInput.value });

    // Send verification email
    await verifyBeforeUpdateEmail(user, newEmailInput.value);

    alert("Verification email sent! Please check your inbox and click the link to confirm.");
  },
  () => {
    emailEditFields.style.display = "block";
    currentEmailInput.value = ""; // leave empty
    newEmailInput.value = "";
    currentPasswordInput.value = "";
}

);

// ==========================
// Password Tab
// ==========================
// ==========================
// Password Tab
// ==========================
setupEditSaveCancel(
  "editPasswordBtn",
  "savePasswordBtn",
  "cancelPasswordBtn",
  [passwordInput, confirmPasswordInput],
  "passwordForm",
  async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected. Please log in.");
    if (passwordInput.value !== confirmPasswordInput.value)
      throw new Error("Passwords do not match");
    await updatePassword(user, passwordInput.value);
    passwordInput.value = "";
    confirmPasswordInput.value = "";
    alert("Password updated successfully!");
  }
);


// ==========================
// Handle Email Verification Link
// ==========================
async function handleEmailVerificationLink() {
  const oobCode = new URLSearchParams(window.location.search).get("oobCode");
  if (!oobCode) return;

  try {
    await applyActionCode(auth, oobCode);
    await reload(auth.currentUser);

    const user = auth.currentUser;
    if (!user) throw new Error("No account detected. Please log in.");

    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists() && docSnap.data().pendingEmail) {
      const newEmail = docSnap.data().pendingEmail;

      // Update Firestore with new verified email
      await updateDoc(docRef, { email: newEmail, pendingEmail: "" });

      alert("Email verified successfully! Please login with your new email.");

      // Force logout to refresh session
      await signOut(auth);
      window.location.href = "login.html";
    }

    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);

  } catch (err) {
    console.error(err);
    alert("Failed to verify email: " + err.message);
  }
}

window.addEventListener("load", handleEmailVerificationLink);
