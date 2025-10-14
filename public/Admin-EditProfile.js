// ==========================
// Imports
// ==========================
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  updateEmail,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./firebase-config.js";

// ==========================
// DOM Elements
// ==========================
const sidebar = document.getElementById("sidebar");
const hamburger = document.getElementById("hamburger");
const closeBtn = document.getElementById("closeBtn");
const logoutBtn = document.querySelector(".logout");
const profileCard = document.querySelector(".profile-card");

// Inputs
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const phoneInput = document.getElementById("phone");

// Buttons
const saveNameBtn = document.getElementById("saveNameBtn");
const saveEmailBtn = document.getElementById("saveEmailBtn");
const savePasswordBtn = document.getElementById("savePasswordBtn");
const savePhoneBtn = document.getElementById("savePhoneBtn");

const editNameBtn = document.getElementById("editNameBtn");
const cancelNameBtn = document.getElementById("cancelNameBtn");

const editEmailBtn = document.getElementById("editEmailBtn");
const cancelEmailBtn = document.getElementById("cancelEmailBtn");

const editPasswordBtn = document.getElementById("editPasswordBtn");
const cancelPasswordBtn = document.getElementById("cancelPasswordBtn");

const editPhoneBtn = document.getElementById("editPhoneBtn");
const cancelPhoneBtn = document.getElementById("cancelPhoneBtn");

// Fields containers
const emailEditFields = document.getElementById("emailEditFields");
const passwordEditFields = document.getElementById("passwordEditFields");
const phoneEditFields = document.getElementById("phoneEditFields");

// ==========================
// Firebase Setup
// ==========================
const auth = getAuth();
const firestore = getFirestore();

// ==========================
// Sidebar Toggle
// ==========================
hamburger?.addEventListener("click", () => {
  sidebar.classList.add("active");
  closeBtn.style.opacity = 1;
});

closeBtn?.addEventListener("click", () => {
  sidebar.classList.remove("active");
  closeBtn.style.opacity = 0;
});

// ==========================
// Mask Email
// ==========================
function maskEmail(email) {
  if (!email || !email.includes("@")) return email;
  const [userPart, domainPart] = email.split("@");

  if (userPart.length <= 3) {
    return userPart + "@" + domainPart;
  }

  const visiblePart = userPart.slice(0, 3);
  const maskedPart = "*".repeat(userPart.length - 3);
  return `${visiblePart}${maskedPart}@${domainPart}`;
}

// ==========================
// Load Admin Profile Info
// ==========================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const userRef = doc(firestore, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        fullname: user.displayName || "Admin User",
        email: user.email,
        phone: "",
        role: "Admin"
      });
      alert("Admin profile initialized. Please reload the page.");
      return;
    }

    const data = userSnap.data();
    const fullName = data.fullname || "Admin User";
    const [firstName, ...lastParts] = fullName.split(" ");
    const lastName = lastParts.join(" ");

    firstNameInput.value = firstName || "";
    lastNameInput.value = lastName || "";
    emailInput.value = maskEmail(data.email || user.email || "");
    phoneInput.value = data.phone || "";

    profileCard.style.display = "flex";
    logoutBtn.style.display = "flex";
  } else {
    window.location.href = "adminlogin.html";
  }
});

// ==========================
// Edit/Cancel Toggles
// ==========================

// --- Name ---
editNameBtn?.addEventListener("click", () => {
  firstNameInput.disabled = false;
  lastNameInput.disabled = false;

  editNameBtn.style.display = "none";
  saveNameBtn.style.display = "inline-block";
  cancelNameBtn.style.display = "inline-block";
});

cancelNameBtn?.addEventListener("click", () => {
  firstNameInput.disabled = true;
  lastNameInput.disabled = true;

  editNameBtn.style.display = "inline-block";
  saveNameBtn.style.display = "none";
  cancelNameBtn.style.display = "none";
});

// --- Email ---
editEmailBtn?.addEventListener("click", () => {
  emailEditFields.style.display = "block";
  editEmailBtn.style.display = "none";
  saveEmailBtn.style.display = "inline-block";
  cancelEmailBtn.style.display = "inline-block";
});

cancelEmailBtn?.addEventListener("click", () => {
  emailEditFields.style.display = "none";
  editEmailBtn.style.display = "inline-block";
  saveEmailBtn.style.display = "none";
  cancelEmailBtn.style.display = "none";
});

// --- Password ---
editPasswordBtn?.addEventListener("click", () => {
  passwordEditFields.style.display = "block";
  editPasswordBtn.style.display = "none";
  savePasswordBtn.style.display = "inline-block";
  cancelPasswordBtn.style.display = "inline-block";
});

cancelPasswordBtn?.addEventListener("click", () => {
  passwordEditFields.style.display = "none";
  editPasswordBtn.style.display = "inline-block";
  savePasswordBtn.style.display = "none";
  cancelPasswordBtn.style.display = "none";
  passwordInput.value = "";
});

// --- Phone ---
editPhoneBtn?.addEventListener("click", () => {
  phoneEditFields.style.display = "block";
  editPhoneBtn.style.display = "none";
  savePhoneBtn.style.display = "inline-block";
  cancelPhoneBtn.style.display = "inline-block";
});

cancelPhoneBtn?.addEventListener("click", () => {
  phoneEditFields.style.display = "none";
  editPhoneBtn.style.display = "inline-block";
  savePhoneBtn.style.display = "none";
  cancelPhoneBtn.style.display = "none";
});

// ==========================
// Save Functions
// ==========================
saveNameBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newFirstName = firstNameInput.value.trim();
  const newLastName = lastNameInput.value.trim();
  const newFullName = `${newFirstName} ${newLastName}`.trim();

  if (newFullName === "") return alert("Please enter a valid name.");

  const userRef = doc(firestore, "users", user.uid);
  await updateDoc(userRef, { fullname: newFullName });

  alert("Name updated successfully!");
  firstNameInput.disabled = true;
  lastNameInput.disabled = true;
  editNameBtn.style.display = "inline-block";
  saveNameBtn.style.display = "none";
  cancelNameBtn.style.display = "none";
});

saveEmailBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newEmail = document.getElementById("newEmail").value.trim();
  if (!newEmail) return alert("Please enter a valid email.");

  try {
    await updateEmail(user, newEmail);
    const userRef = doc(firestore, "users", user.uid);
    await updateDoc(userRef, { email: newEmail });

    alert("Email updated successfully!");
    emailInput.value = maskEmail(newEmail);
    emailEditFields.style.display = "none";
    editEmailBtn.style.display = "inline-block";
    saveEmailBtn.style.display = "none";
    cancelEmailBtn.style.display = "none";
  } catch (error) {
    console.error("Error updating email:", error);
    alert("Failed to update email. Please reauthenticate.");
  }
});

savePasswordBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newPassword = passwordInput.value.trim();
  if (newPassword.length < 6)
    return alert("Password must be at least 6 characters.");

  try {
    await updatePassword(user, newPassword);
    alert("Password updated successfully!");
    passwordInput.value = "";
    passwordEditFields.style.display = "none";
    editPasswordBtn.style.display = "inline-block";
    savePasswordBtn.style.display = "none";
    cancelPasswordBtn.style.display = "none";
  } catch (error) {
    console.error("Error updating password:", error);
    alert("Failed to update password. Please reauthenticate.");
  }
});

savePhoneBtn?.addEventListener("click", async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  if (!user) return;

  const newPhone = document.getElementById("newPhone").value.trim();
  if (newPhone === "") return alert("Please enter a valid phone number.");

  const userRef = doc(firestore, "users", user.uid);
  await updateDoc(userRef, { phone: newPhone });

  alert("Phone number updated successfully!");
  phoneInput.value = newPhone;
  phoneEditFields.style.display = "none";
  editPhoneBtn.style.display = "inline-block";
  savePhoneBtn.style.display = "none";
  cancelPhoneBtn.style.display = "none";
});

// ==========================
// Logout
// ==========================
logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "login.html";
});
