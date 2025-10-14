// ==========================
// AccessAdmin.js
// Restrict access to Admins only
// ==========================
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not logged in
    window.location.href = "login.html";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists() || userSnap.data().role !== "Admin") {
      alert("Access denied. Admins only.");
      window.location.href = "login.html";
      return;
    }

    // ✅ If admin, access granted
    console.log("Access granted: Admin verified.");

  } catch (error) {
    console.error("Error verifying admin:", error);
    alert("Access denied. Admins only.");
    window.location.href = "login.html";
  }
});
