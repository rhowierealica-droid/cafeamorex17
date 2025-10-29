import { auth } from './firebase-config.js';
import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// 30 mins
const IDLE_TIMEOUT = 30 * 60 * 1000;

let idleTimer;

const LOGOUT_CHANNEL = new BroadcastChannel('cafeamore-logout-channel');


function startTimer() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(logoutUser, IDLE_TIMEOUT);
}


function resetIdleTimer() {
    startTimer();
    LOGOUT_CHANNEL.postMessage('activity');
}


async function logoutUser() {
    clearTimeout(idleTimer);
    
    LOGOUT_CHANNEL.postMessage('logout-complete');
    
    try {
        await signOut(auth); 
        console.log("User signed out due to inactivity.");
        window.location.href = "login.html";
    } catch (error) {
        console.error("Logout error:", error);
        window.location.href = "login.html"; 
    }
}

LOGOUT_CHANNEL.onmessage = (event) => {
    if (event.data === 'activity') {
        startTimer();
    } else if (event.data === 'logout-complete') {
        clearTimeout(idleTimer);
        if (!window.location.pathname.includes('login.html')) {
            window.location.href = "login.html";
        }
    }
};

startTimer();

document.addEventListener("mousemove", resetIdleTimer);
document.addEventListener("keypress", resetIdleTimer);
document.addEventListener("click", resetIdleTimer);
document.addEventListener("scroll", resetIdleTimer);
