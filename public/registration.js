import { auth, db } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    RecaptchaVerifier,
    signInWithPhoneNumber,
    sendEmailVerification,
    onAuthStateChanged,
    reload
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const messagePopup = document.getElementById("messagePopup");
const messageText = document.getElementById("messageText");
const popupOkBtn = document.getElementById("popupOkBtn");
const countdownDisplay = document.getElementById("countdownDisplay"); 
const registerButton = document.getElementById("registerButton");

let shouldRedirect = false;
let timerInterval = null; 
let verificationCheckInterval = null; 

function showMessage(msg, redirect = false) {
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

    // Hide countdown and show the OK button 
    if (countdownDisplay) {
        countdownDisplay.style.display = "none";
    }
    if (popupOkBtn) {
        popupOkBtn.style.display = "block";
    }
    
    shouldRedirect = redirect;
    messagePopup.style.display = "flex";
}

// Starts the 3-minute countdown timer and starts the background verification check.
 
function startCountdownTimer(durationInSeconds) {
    let timer = durationInSeconds;
    let minutes, seconds;
    const user = auth.currentUser;

    // Hide the OK button while the user is actively verifying
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
        countdownDisplay.textContent = `Time left to verify: ${minutes}:${seconds}`;
        countdownDisplay.style.display = "block";
    }

    clearInterval(timerInterval); 

    timerInterval = setInterval(async () => {
        minutes = parseInt(timer / 60, 10);
        seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        if (countdownDisplay) {
            countdownDisplay.textContent = `Time left to verify: ${minutes}:${seconds}`;
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
                if(popupOkBtn) popupOkBtn.style.display = 'block';
            }
        }
    }, 1000);
}

// Continuously checks the current user's email verification status.
 
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
                
                // Successful Verification
                if (registerButton) {
                    registerButton.disabled = false;
                    registerButton.style.opacity = 1;
                    registerButton.textContent = "REGISTER";
                }

                // Change the popup message
                if (messagePopup.style.display === "flex") {
                    messageText.textContent = "Registration successful! Please login";
                    if(countdownDisplay) countdownDisplay.style.display = 'none';
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
    termsBody.scrollTop = 0;
    termsPopup.style.display = "flex";
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
    return email.toLowerCase().endsWith('@gmail.com');
}


const deliveryFees = {
    "Alima": 5, "Aniban I": 10, "Aniban II": 15, "Aniban III": 20,
    "Aniban IV": 25, "Aniban V": 30, "Banalo": 35, "Bayanan": 40, "Campo Santo": 45,
    "Daang Bukid": 50, "Digman": 55, "Dulong Bayan": 60, "Habay I": 65, "Habay II": 70,
    "Ligas I": 75, "Ligas II": 80, "Ligas III": 85, "Mabolo I": 90, "Mabolo II": 95,
    "Mabolo III": 100, "Maliksi I": 105, "Maliksi II": 110, "Maliksi III": 115,
    "Mambog I": 120, "Mambog II": 125, "Mambog III": 130, "Mambog IV": 135,
    "Mambog V": 140, "Molino I": 145, "Molino II": 150, "Molino III": 155,
    "Molino IV": 160, "Molino V": 165, "Molino VI": 170, "Molino VII": 175,
    "Niog I": 180, "Niog II": 185, "Niog III": 190, "P.F. Espiritu I (Panapaan)": 195,
    "P.F. Espiritu II": 200, "P.F. Espiritu III": 205, "P.F. Espiritu IV": 210,
    "P.F. Espiritu V": 215, "P.F. Espiritu VI": 220, "P.F. Espiritu VII": 225,
    "P.F. Espiritu VIII": 230, "Queens Row Central": 235, "Queens Row East": 240,
    "Queens Row West": 245, "Real I": 250, "Real II": 255, "Salinas I": 260,
    "Salinas II": 265, "Salinas III": 270, "Salinas IV": 275, "San Nicolas I": 280,
    "San Nicolas II": 285, "San Nicolas III": 290, "Sineguelasan": 295,
    "Tabing Dagat (Poblacion)": 300, "Talaba I": 305, "Talaba II": 310,
    "Talaba III": 315, "Talaba IV": 320, "Talaba V": 325, "Talaba VI": 330,
    "Talaba VII": 335, "Zapote I": 340, "Zapote II": 345, "Zapote III": 350,
    "Zapote IV": 355, "Zapote V": 360
};
function getDeliveryFee(barangay) {
    return deliveryFees[barangay] || 0;
}


// OTP 

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
const password = document.getElementById("password");
const confirmPassword = document.getElementById("confirmPassword");
const passwordError = document.getElementById("passwordError");

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
            showMessage("Registration is only allowed for @gmail.com accounts.");
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
            
            // The duration for the countdown 180 seconds
            const countdownDuration = 180;

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

            showMessage("Registration successful! Please check your email now to verify your account.", true); 
            
            // Start the 3-minute 
            startCountdownTimer(countdownDuration);
            
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
