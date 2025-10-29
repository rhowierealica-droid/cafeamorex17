import {
    getAuth,
    onAuthStateChanged,
    signOut,
    updateEmail,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider,
    RecaptchaVerifier, 
    signInWithPhoneNumber 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./firebase-config.js";

const sidebar = document.getElementById("sidebar");
const hamburger = document.getElementById("hamburger");
const closeBtn = document.getElementById("closeBtn");
const logoutBtn = document.querySelector(".logout");
const profileCard = document.querySelector(".profile-card");

const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const phoneInput = document.getElementById("phone"); 

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

const emailEditFields = document.getElementById("emailEditFields");
const passwordEditFields = document.getElementById("passwordEditFields");
const phoneEditFields = document.getElementById("phoneEditFields");

const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
const otpError = document.getElementById("otpError");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
const recaptchaContainer = document.getElementById('recaptcha-container');

let recaptchaVerifierInitialized = false;

const auth = getAuth();
const firestore = getFirestore();

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
        document.getElementById("newPhone").value = "";
        document.getElementById("currentPhoneInput").value = "";
        document.getElementById("currentPhonePassword").value = "";
    });
}

hamburger?.addEventListener("click", () => {
    sidebar.classList.add("active");
    closeBtn.style.opacity = 1;
});

closeBtn?.addEventListener("click", () => {
    sidebar.classList.remove("active");
    closeBtn.style.opacity = 0;
});


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

/**
 */
function maskPhone(phone) {
    const cleanPhone = phone.replace(/[^\d+]/g, ''); 

    if (cleanPhone.length < 10) return phone;

    let startIndex = cleanPhone.startsWith('+') ? 4 : 3;
    const suffixLength = 3;

    if (cleanPhone.length <= startIndex + suffixLength) return phone;

    const prefix = cleanPhone.slice(0, startIndex);
    const suffix = cleanPhone.slice(-suffixLength);
    const maskedLength = cleanPhone.length - startIndex - suffixLength;

    return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}

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

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const userRef = doc(firestore, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            await setDoc(userRef, {
                fullname: user.displayName || "Admin User",
                email: user.email,
                phoneNumber: "", 
                role: "Admin"
            });
            return;
        }

        const data = userSnap.data();
        const fullName = data.fullname || "Admin User";
        const [firstName, ...lastParts] = fullName.split(" ");
        const lastName = lastParts.join(" ");
        
        const rawPhone = data.phoneNumber || ""; 

        firstNameInput.value = firstName || "";
        lastNameInput.value = lastName || "";
        emailInput.value = maskEmail(data.email || user.email || "");
        

        phoneInput.value = maskPhone(rawPhone);
        profileCard.style.display = "flex";
        logoutBtn.style.display = "flex";
    } else {
        window.location.href = "login.html";
    }
});

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

editEmailBtn?.addEventListener("click", () => {
    emailEditFields.style.display = "block";
    editEmailBtn.style.display = "none";
    saveEmailBtn.style.display = "inline-block";
    cancelEmailBtn.style.display = "inline-block";
});

cancelEmailBtn?.addEventListener("click", () => {
    document.getElementById("newEmail").value = "";
    document.getElementById("currentEmailInput").value = "";
    document.getElementById("currentPassword").value = "";
    emailEditFields.style.display = "none";
    editEmailBtn.style.display = "inline-block";
    saveEmailBtn.style.display = "none";
    cancelEmailBtn.style.display = "none";
});

editPasswordBtn?.addEventListener("click", () => {
    passwordEditFields.style.display = "block";
    editPasswordBtn.style.display = "none";
    savePasswordBtn.style.display = "inline-block";
    cancelPasswordBtn.style.display = "inline-block";
});

cancelPasswordBtn?.addEventListener("click", () => {
    passwordInput.value = "";
    document.getElementById("confirmPassword").value = "";
    document.getElementById("currentPasswordForChange").value = "";
    passwordEditFields.style.display = "none";
    editPasswordBtn.style.display = "inline-block";
    savePasswordBtn.style.display = "none";
    cancelPasswordBtn.style.display = "none";
});

editPhoneBtn?.addEventListener("click", () => {
    phoneEditFields.style.display = "block";
    editPhoneBtn.style.display = "none";
    savePhoneBtn.style.display = "inline-block";
    cancelPhoneBtn.style.display = "inline-block";
});

cancelPhoneBtn?.addEventListener("click", () => {
    document.getElementById("newPhone").value = "";
    document.getElementById("currentPhoneInput").value = "";
    document.getElementById("currentPhonePassword").value = "";
    phoneEditFields.style.display = "none";
    editPhoneBtn.style.display = "inline-block";
    savePhoneBtn.style.display = "none";
    cancelPhoneBtn.style.display = "none";
});

saveNameBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const newFirstName = firstNameInput.value.trim();
    const newLastName = lastNameInput.value.trim();
    const newFullName = `${newFirstName} ${newLastName}`.trim();

    if (newFullName === "") return alert("Please enter a valid name.");

    try {
        const userRef = doc(firestore, "users", user.uid);
        await updateDoc(userRef, { fullname: newFullName });

        alert("Name updated successfully!");
        firstNameInput.disabled = true;
        lastNameInput.disabled = true;
        editNameBtn.style.display = "inline-block";
        saveNameBtn.style.display = "none";
        cancelNameBtn.style.display = "none";
    } catch (error) {
        console.error("Error updating name:", error);
        alert("Failed to update name. Please try again.");
    }
});

saveEmailBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const newEmail = document.getElementById("newEmail").value.trim();
    const currentPassword = document.getElementById("currentPassword").value;
    const currentEmailInput = document.getElementById("currentEmailInput").value.trim();

    if (!newEmail) return alert("Please enter a valid new email.");
    if (!currentPassword) return alert("Please enter your current password to confirm.");
    if (currentEmailInput !== user.email) return alert("The current email confirmation must match your logged-in email.");

    const credential = EmailAuthProvider.credential(user.email, currentPassword);

    try {
        await reauthenticateWithCredential(user, credential);

        await updateEmail(user, newEmail);

        const userRef = doc(firestore, "users", user.uid);
        await updateDoc(userRef, { email: newEmail });

        alert("Email updated successfully! You may need to verify your new email.");

        emailInput.value = maskEmail(newEmail);
        document.getElementById("newEmail").value = "";
        document.getElementById("currentEmailInput").value = "";
        document.getElementById("currentPassword").value = "";
        emailEditFields.style.display = "none";
        editEmailBtn.style.display = "inline-block";
        saveEmailBtn.style.display = "none";
        cancelEmailBtn.style.display = "none";

    } catch (error) {
        console.error("Error updating email:", error);
        if (error.code === 'auth/wrong-password') {
            alert("Failed to update email. Wrong current password.");
        } else if (error.code === 'auth/email-already-in-use') {
            alert("Failed to update email. The new email is already in use.");
        } else if (error.code === 'auth/requires-recent-login') {
            alert("Failed to update email. Please sign out and sign back in, then try again immediately.");
        } else {
            alert(`Failed to update email: ${error.message}`);
        }
    }
});

savePasswordBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const newPassword = passwordInput.value.trim();
    const confirmPassword = document.getElementById("confirmPassword").value.trim();
    const currentPasswordForChange = document.getElementById("currentPasswordForChange").value;

    if (newPassword.length < 6)
        return alert("New password must be at least 6 characters.");
    
    if (newPassword !== confirmPassword) 
        return alert("New Password and Confirm Password do not match.");

    if (!currentPasswordForChange) 
        return alert("Please enter your current password to confirm.");
    
    const credential = EmailAuthProvider.credential(user.email, currentPasswordForChange);

    try {
        await reauthenticateWithCredential(user, credential);

        await updatePassword(user, newPassword);
        
        alert("Password updated successfully! Please re-login with your new password on your next session.");

        passwordInput.value = "";
        document.getElementById("confirmPassword").value = "";
        document.getElementById("currentPasswordForChange").value = "";
        passwordEditFields.style.display = "none";
        editPasswordBtn.style.display = "inline-block";
        savePasswordBtn.style.display = "none";
        cancelPasswordBtn.style.display = "none";

    } catch (error) {
        console.error("Error updating password:", error);
        if (error.code === 'auth/wrong-password') {
            alert("Failed to update password. Wrong current password.");
        } else if (error.code === 'auth/requires-recent-login') {
            alert("Failed to update password. Please sign out and sign back in, then try again immediately.");
        } else {
            alert(`Failed to update password: ${error.message}`);
        }
    }
});

savePhoneBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return;

    const newPhone = document.getElementById("newPhone").value.trim();
    const currentPhoneInput = document.getElementById("currentPhoneInput").value.trim();
    const currentPhonePassword = document.getElementById("currentPhonePassword").value;

    if (newPhone === "") return alert("Please enter a valid new phone number.");
    if (!currentPhonePassword) return alert("Please enter your current password to confirm.");
    
    const phoneRegex = /^\+63\s?9\d{9}$/; 

    if (!phoneRegex.test(newPhone)) {
        return alert("Invalid phone format. Please use the format +63 9xxxxxxxxx or +639xxxxxxxxx. (Must be 10 digits after +63).");
    }
    
    const userRef = doc(firestore, "users", user.uid);
    const userSnap = await getDoc(userRef);
    
    const currentDbPhone = userSnap.data()?.phoneNumber || ""; 

    const cleanCurrentInput = currentPhoneInput.replace(/[\s-]/g, '');
    const cleanCurrentDbPhone = currentDbPhone.replace(/[\s-]/g, '');

    if (cleanCurrentInput !== cleanCurrentDbPhone) {
        return alert("The Current Phone number does not match your current number.");
    }
    
    const credential = EmailAuthProvider.credential(user.email, currentPhonePassword);

    try {
        await reauthenticateWithCredential(user, credential);
        
        if (!recaptchaVerifierInitialized) {
            if (!recaptchaContainer) throw new Error("reCAPTCHA container not found. Add a div with id='recaptcha-container'.");
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
            recaptchaVerifierInitialized = true;
        }

        const confirmationResult = await signInWithPhoneNumber(auth, newPhone, window.recaptchaVerifier);
        
        otpPopup.style.display = "flex";
        clearOtpError();

        return new Promise((resolve, reject) => {
            const handleVerify = async () => {
                verifyOtpBtn.removeEventListener('click', handleVerify);

                const otp = otpCode.value.trim();
                if (!otp) {
                    verifyOtpBtn.addEventListener('click', handleVerify);
                    return showOtpError("Please enter the OTP.");
                }
                
                try {
                    await confirmationResult.confirm(otp);
                    
                    await updateDoc(userRef, { phoneNumber: newPhone });
                    
                    otpPopup.style.display = "none";
                    showReLoginPopup("Phone number updated successfully! Please login again.");
                    
                    phoneInput.value = maskPhone(newPhone);
                    document.getElementById("newPhone").value = "";
                    document.getElementById("currentPhoneInput").value = "";
                    document.getElementById("currentPhonePassword").value = "";
                    phoneEditFields.style.display = "none";
                    editPhoneBtn.style.display = "inline-block";
                    savePhoneBtn.style.display = "none";
                    cancelPhoneBtn.style.display = "none";

                    resolve();

                } catch (e) {
                    console.error("OTP confirmation error:", e);
                    showOtpError("Wrong OTP. Please try again.");
                    verifyOtpBtn.addEventListener('click', handleVerify); 
                }
            };

            verifyOtpBtn.addEventListener('click', handleVerify);
        });
        
    } catch (error) {
        console.error("Error updating phone number:", error);
        if (error.code === 'auth/wrong-password') {
            alert("Failed to update phone number. Wrong current password.");
        } else if (error.code === 'auth/requires-recent-login') {
            alert("Failed to update phone number. Please sign out and sign back in, then try again immediately.");
        } else if (error.code === 'auth/web-storage-unsupported') {
            alert("Failed to send OTP. Your browser does not support the necessary storage.");
        } else {
            alert(`Failed to update phone number: ${error.message}`);
        }
    }
});

logoutBtn?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html"; 
});
