import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    sendEmailVerification,
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const popupOkBtn = document.getElementById("popupOkBtn");
const countdownDisplay = document.getElementById("countdownDisplay"); 
const registerButton = document.getElementById("registerButton");

const resendEmailBtn = document.getElementById("resendEmailBtn");
const resendTimerDisplay = document.getElementById("resendTimerDisplay");

let shouldRedirect = false;
let timerInterval = null; 
let verificationCheckInterval = null; 

// 3 Mins
const MAIN_VERIFICATION_DURATION = 180; 
// 30 Sec
const RESEND_COOLDOWN_DURATION = 30; 

const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const passwordError = document.getElementById("passwordError");

const togglePasswordIcons = document.querySelectorAll('.toggle-password');

togglePasswordIcons.forEach(icon => {
    icon.addEventListener('click', () => {
        const targetId = icon.getAttribute('data-target');
        const passwordInput = document.getElementById(targetId);

        if (passwordInput) {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        }
    });
});


//  start the 30-second cooldown on the Resend button
function startResendCooldown() {
    let countdown = RESEND_COOLDOWN_DURATION;
    
    resendEmailBtn.disabled = true;
    resendEmailBtn.textContent = `Resend Email (${countdown}s)`;
    resendEmailBtn.style.opacity = 0.5;
    resendEmailBtn.style.cursor = 'not-allowed';
    resendTimerDisplay.textContent = `Wait ${countdown} seconds before trying again.`;

    const resendInterval = setInterval(() => {
        countdown--;
        resendEmailBtn.textContent = `Resend Email (${countdown}s)`;
        resendTimerDisplay.textContent = `Wait ${countdown} seconds before trying again.`;

        if (countdown <= 0) {
            clearInterval(resendInterval);
            resendEmailBtn.disabled = false;
            resendEmailBtn.textContent = 'Resend Email';
            resendEmailBtn.style.opacity = 1;
            resendEmailBtn.style.cursor = 'pointer';
            resendTimerDisplay.textContent = 'Ready to resend.';
        }
    }, 1000);
}

if (resendEmailBtn) {
    resendEmailBtn.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (!user) {
            messageText.textContent = "Error: No active user session. Please try logging in again.";
            resendEmailBtn.style.display = "none";
            popupOkBtn.style.display = "block";
            return;
        }

        try {
            // fresh token and state before resending
            await user.reload(); 
            
            if (user.emailVerified) {
                messageText.textContent = "Your email is already verified! You can now log in.";
                startResendCooldown(); // Still start cooldown 
                return;
            }
            
            await sendEmailVerification(user);
            messageText.textContent = "Verification email successfully resent! Please check your inbox (and spam folder).";
            startResendCooldown();
        } catch (error) {
            let errorMessage = "Failed to resend verification email. Please try again later.";
            if (error.code === 'auth/too-many-requests') {
                 errorMessage = "Too many resend attempts. Please wait a minute before trying again.";
            } else if (error.code === 'auth/missing-continue-uri') {
                 errorMessage = "Configuration error. Please contact support.";
            }
            messageText.textContent = errorMessage;
            console.error("Resend Email Error:", error);
        }
    });
}


function showMessage(msg, type = 'info') {
    // Clear any existing timer or verification check
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (verificationCheckInterval) {
        clearInterval(verificationCheckInterval);
        verificationCheckInterval = null;
    }
    
    messageText.textContent = msg;

    if (countdownDisplay) countdownDisplay.style.display = "none";
    if (popupOkBtn) popupOkBtn.style.display = "block";
    if (resendEmailBtn) resendEmailBtn.style.display = "none";
    if (resendTimerDisplay) resendTimerDisplay.style.display = "none";

    if (type === 'verification-pending') {
        resendEmailBtn.style.display = "block";
        resendTimerDisplay.style.display = "block";
        startResendCooldown(); // Start cooldown immediately after first send
        startCountdownTimer(MAIN_VERIFICATION_DURATION);
    } else if (type === 'success-redirect') {
        shouldRedirect = true;
    } else {
        shouldRedirect = false;
    }
    
    messagePopup.style.display = "flex";
}

// Starts the 3-minute countdown timer and starts the background verification check.
function startCountdownTimer(durationInSeconds) {
    let timer = durationInSeconds;
    let minutes, seconds;
    
    if (popupOkBtn) popupOkBtn.style.display = 'none';

    // Disable the register button when the timer starts
    if (registerButton) {
        registerButton.disabled = true;
        registerButton.style.opacity = 0.5;
        registerButton.textContent = "Verifying...";
    }
        
    startVerificationCheck();

    // Display countdown time
    if (countdownDisplay) {
        minutes = parseInt(timer / 60, 10);
        seconds = parseInt(timer % 60, 10);
        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;
        countdownDisplay.textContent = `Time left for automatic verification check: ${minutes}:${seconds}`;
        countdownDisplay.style.display = "block";
    }

    clearInterval(timerInterval); 

    timerInterval = setInterval(async () => {
        minutes = parseInt(timer / 60, 10);
        seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        if (countdownDisplay) {
            countdownDisplay.textContent = `Time left for automatic verification check: ${minutes}:${seconds}`;
        }
        
        if (--timer < 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            clearInterval(verificationCheckInterval); 
            
            if (registerButton) {
                registerButton.disabled = false;
                registerButton.style.opacity = 1;
                registerButton.textContent = "REGISTER";
            }

            if (messagePopup.style.display === "flex") {
                messageText.textContent = "Email verification timed out. Your unverified account may be deleted. Please try to register again.";
                if(countdownDisplay) countdownDisplay.style.display = "none";
                if(resendEmailBtn) resendEmailBtn.style.display = "none"; // Hide resend button on timeout
                if(resendTimerDisplay) resendTimerDisplay.style.display = "none";
                if(popupOkBtn) popupOkBtn.style.display = 'block';
            }
        }
    }, 1000);
}

// Continuously checks the current user's email verification status
function startVerificationCheck() {
    if (verificationCheckInterval) {
        clearInterval(verificationCheckInterval);
    }

    verificationCheckInterval = setInterval(async () => {
        const user = auth.currentUser;
        if (user) {
            
            await user.reload(); 
            
            if (user.emailVerified) {
                clearInterval(verificationCheckInterval); // Stop checking
                clearInterval(timerInterval); // Stop the countdown
                
                if (registerButton) {
                    registerButton.disabled = false;
                    registerButton.style.opacity = 1;
                    registerButton.textContent = "REGISTER";
                }

                if (messagePopup.style.display === "flex") {
                    messageText.textContent = "Email verification successful! You can now login.";
                    if(countdownDisplay) countdownDisplay.style.display = 'none';
                    if(resendEmailBtn) resendEmailBtn.style.display = 'none';
                    if(resendTimerDisplay) resendTimerDisplay.style.display = 'none';
                    if(popupOkBtn) popupOkBtn.style.display = 'block';

                    popupOkBtn.onclick = () => {
                        messagePopup.style.display = "none";
                        window.location.href = 'login.html';
                    };
                }
            }
        } else {
            clearInterval(verificationCheckInterval);
        }
    }, 3000); 
}

popupOkBtn.addEventListener("click", () => {
    messagePopup.style.display = "none";
    
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (verificationCheckInterval) {
        clearInterval(verificationCheckInterval);
        verificationCheckInterval = null;
    }
    
    // Reset register button 
    if (registerButton) {
        registerButton.disabled = false;
        registerButton.style.opacity = 1;
        registerButton.textContent = "REGISTER";
    }

    if (shouldRedirect) window.location.href = "login.html";
    
    popupOkBtn.onclick = () => {
        messagePopup.style.display = "none";
    };
});

// Terms and Condition

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
    termsPopup.style.display = "flex";
    
    setTimeout(() => {
        termsBody.scrollTop = 0; 
    }, 10);
}

termsCheckbox.addEventListener("change", (e) => {
    if (termsCheckbox.checked && !isOpeningPopup) {
        e.preventDefault();
        termsCheckbox.checked = false;
        openTermsPopup();
    }
});

termsLabel.addEventListener("click", (e) => {
    e.preventDefault();
    openTermsPopup();
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


function validatePassword(pass) {
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return regex.test(pass);
}

function validateEmailDomain(email) {
    const allowedDomains = [
        '@live.com', 
        '@gmail.com', 
        '@outlook.com', 
        '@yahoo.com', 
        '@hotmail.com'
    ];
    
    const lowerCaseEmail = email.toLowerCase();
    return allowedDomains.some(domain => lowerCaseEmail.endsWith(domain));
}


const deliveryFees = {
    "Aniban I": 57, "Aniban 557": 15, "Aniban III": 56,
    "Aniban 54": 25, "Aniban V": 55,
    "Ligas I": 50, "Ligas II": 57, "Ligas III": 58, "San Nicolas I": 61,
    "San Nicolas II": 64, "San Nicolas III": 104, "Zapote I": 62,
};
function getDeliveryFee(barangay) {
    return deliveryFees[barangay] || 0;
}



const phoneInput = document.getElementById("phoneNumber");
const sendOtpBtn = document.getElementById("sendOtpBtn");
const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
let otpErrorMsg = document.getElementById("otpErrorMsg");

if (!otpErrorMsg) {
    otpErrorMsg = document.createElement("div");
    otpErrorMsg.id = "otpErrorMsg";
    otpErrorMsg.style.color = "red";
    otpErrorMsg.style.marginTop = "5px";
    otpPopup.querySelector(".message-content").appendChild(otpErrorMsg);
}
otpErrorMsg.style.display = "none";

const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
let confirmationResult;
let isPhoneVerified = false;

function showOtpError(message) {
    otpErrorMsg.textContent = message;
    otpErrorMsg.style.display = "block";
}
function clearOtpError() {
    otpErrorMsg.style.display = "none";
}

if (sendOtpBtn) {
    let recaptchaContainer = document.getElementById("recaptcha-container");
    if (!recaptchaContainer) {
        recaptchaContainer = document.createElement("div");
        recaptchaContainer.id = "recaptcha-container";
        document.body.appendChild(recaptchaContainer); 
    }
    // Set up reCAPTCHA verifier 
    window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", { size: "invisible" });
    
    sendOtpBtn.addEventListener("click", async () => {
        const phoneNumber = phoneInput.value.trim();
        if (!phoneNumber.startsWith("+63")) {
            showMessage("Phone number must start with +63 (PH format).");
            return;
        }
        try {
            await window.recaptchaVerifier.verify(); 
            confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
            otpPopup.style.display = "flex";
            clearOtpError();
        } catch (error) {
            showMessage("Failed to send OTP. Please try again.");
            console.error(error);
        }
    });
}

if (verifyOtpBtn) {
    verifyOtpBtn.addEventListener("click", async () => {
        clearOtpError();
        if (!otpCode.value.trim()) {
            showOtpError("Please enter the OTP.");
            return;
        }
        try {
            const result = await confirmationResult.confirm(otpCode.value.trim());
            otpPopup.style.display = "none";
            isPhoneVerified = true;
            showMessage("Phone number verified: " + result.user.phoneNumber);
        } catch (error) {
            isPhoneVerified = false;
            showOtpError("Wrong OTP. Please try again.");
        }
    });
}

if (closeOtpBtn) {
    closeOtpBtn.addEventListener("click", () => {
        otpPopup.style.display = "none";
        clearOtpError();
    });
}


const registerForm = document.getElementById("registerForm");

if (registerForm) {
    const registerButton = document.getElementById("registerButton"); 
    
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        password.classList.remove("input-error");
        confirmPassword.classList.remove("input-error");
        passwordError.style.display = "none";

        const email = document.getElementById("email").value.trim();
        const pass = password.value;
        const confirmPass = confirmPassword.value;
                                    
        if (!termsCheckbox.checked) {
            showMessage("You must agree to the Terms and Conditions before registering.");
            return;
        }

        if (!isPhoneVerified) {
            showMessage("Please verify your phone number before registering.");
            return;
        }
        
        if (!validateEmailDomain(email)) {
            showMessage("Registration is only allowed for email accounts (@live.com, @gmail.com, @outlook.com, @yahoo.com, @hotmail.com).");
            return;
        }

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
        
        
        const firstName = document.getElementById("firstName").value.trim();
        const lastName = document.getElementById("lastName").value.trim();
        const phoneNumber = phoneInput.value.trim();
        const barangay = document.getElementById("barangay").value;
        const houseNumber = document.getElementById("houseNumber").value.trim();

        try {
            if (registerButton) {
                registerButton.disabled = true;
                registerButton.style.opacity = 0.5;
                registerButton.textContent = "Processing...";
            }
            
            const userCred = await createUserWithEmailAndPassword(auth, email, pass);
            const user = userCred.user;
            
            await sendEmailVerification(user);

            const deliveryFee = getDeliveryFee(barangay);

            await setDoc(doc(db, "users", user.uid), {
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

            showMessage("Please check your email now to verify your account.", 'verification-pending'); 
                        
            registerForm.reset();
            termsCheckbox.checked = false;
            isPhoneVerified = false;
            
        } catch (error) {
            let errorMessage = "Something went wrong. Please try again.";
            if (error.code === "auth/email-already-in-use") errorMessage = "The email is already in use. Please use a different email.";
            else if (error.code === "auth/invalid-email") errorMessage = "The email address is not valid.";
            else if (error.code === "auth/weak-password") errorMessage = "Password is too weak. Please choose a stronger password.";
            
            showMessage(errorMessage);
            
            if (registerButton) {
                registerButton.disabled = false;
                registerButton.style.opacity = 1;
                registerButton.textContent = "REGISTER";
            }
        }
    });
}
