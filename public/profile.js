// profile.js
import { auth, db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* Mask email (same logic as edit page) */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return "";
  const [userPart = "", domain = ""] = email.split("@");
  if (userPart.length <= 3) return userPart + "*****@" + domain;
  return userPart.substring(0, 3) + "*".repeat(Math.max(userPart.length - 3, 3)) + "@" + domain;
}

/* Load and display user info */
async function loadProfile(user) {
  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      console.warn("No profile data found.");
      return;
    }

    const data = snap.data();
    document.getElementById("firstName").textContent = data.firstName || "";
    document.getElementById("lastName").textContent = data.lastName || "";
    document.getElementById("email").textContent = maskEmail(data.email || user.email);
    document.getElementById("region").textContent = data.region || "";
    document.getElementById("province").textContent = data.province || "";
    document.getElementById("city").textContent = data.city || "";
    document.getElementById("barangay").textContent = data.barangay || "";
    document.getElementById("houseNumber").textContent = data.houseNumber || "";
  } catch (err) {
    console.error("Failed to load profile:", err);
  }
}

/* Auth */
onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Redirect if not logged in
    window.location.href = "login.html";
    return;
  }
  loadProfile(user);

  // Edit button -> go to edit-profile page
  document.getElementById("editBtn").addEventListener("click", () => {
    window.location.href = "edit-profile.html";
  });
});
