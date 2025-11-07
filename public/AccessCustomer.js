import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return; 
    }

    try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.data();

        if (!userDoc.exists() || userData.role !== "Customer") {
            console.error("Access denied. User role:", userData ? userData.role : "Document Missing");
            
            
            window.location.href = "login.html";
            return; 
        }

        console.log("Customer Access Granted for UID:", user.uid);
        
    } catch (error) {
        console.error("Error checking user role:", error);
        alert("An error occurred during authentication verification. Redirecting to login.");
        window.location.href = "login.html";
        return;
    }
});
