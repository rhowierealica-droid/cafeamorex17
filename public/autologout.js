import { auth } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Set the maximum idle time in milliseconds (e.g., 1 minute)
const IDLE_TIMEOUT = 30 * 60 * 1000;

let idleTimer; // Variable to store the timeout ID

// Function to reset the idle timer
function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(logoutUser, IDLE_TIMEOUT);
}

// Function to perform the logout action
async function logoutUser() {
  try {
    await signOut(auth); // ✅ Firebase logout
    window.location.href = "login.html"; // Redirect to login page
  } catch (error) {
    console.error("Logout error:", error);
    window.location.href = "login.html"; // Still redirect even if error
  }
}

// Add event listeners to detect user activity
document.addEventListener("mousemove", resetIdleTimer);
document.addEventListener("keypress", resetIdleTimer);
document.addEventListener("click", resetIdleTimer);
document.addEventListener("scroll", resetIdleTimer); // Optional

// Initialize the timer when the page loads
resetIdleTimer();
