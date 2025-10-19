// ==========================
// Imports
// ==========================
import { auth, db } from './firebase-config.js';
import {
    doc,
    getDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    deleteDoc,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    reload,
    verifyBeforeUpdateEmail,
    RecaptchaVerifier,
    signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================
// Sidebar Active Link
// ==========================
const sidebarLinks = document.querySelectorAll('.login-link, .profile-card, .logout');
sidebarLinks.forEach(link => link.classList.remove('active'));
document.querySelector('.profile-card').classList.add('active');

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
// Information Fields
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");

// Email Fields
const emailInput = document.getElementById("email"); // Display only
const currentEmailInput = document.getElementById("currentEmailInput");
const newEmailInput = document.getElementById("newEmail");
const currentPasswordInput = document.getElementById("currentPassword"); // Used for reauth

// Password Fields
const passwordInput = document.getElementById("password"); // New password
const confirmPasswordInput = document.getElementById("confirmPassword");
const currentPasswordForChange = document.getElementById("currentPasswordForChange"); // Current password for reauth

// Phone Fields
const phoneInput = document.getElementById("phone"); // Display only
const currentPhoneInput = document.getElementById("currentPhoneInput"); // <<< CONFIRM CURRENT PHONE INPUT
const newPhoneInput = document.getElementById("newPhone");
const currentPhonePasswordInput = document.getElementById("currentPhonePassword"); // Used for reauth

// Address Fields
const barangayInput = document.getElementById("barangay");
const houseNumberInput = document.getElementById("houseNumber");
const regionInput = document.getElementById("region");
const provinceInput = document.getElementById("province");
const cityInput = document.getElementById("city");
const editingAddressIdInput = document.getElementById("editingAddressId"); // Hidden input for address editing

// Container in Address tab where we'll show saved addresses
let addressSavedListEl = document.getElementById("address-saved-list");
if (!addressSavedListEl) {
    const addressTab = document.getElementById("addressTab");
    if (addressTab) {
        addressSavedListEl = document.createElement("div");
        addressSavedListEl.id = "address-saved-list";
        addressSavedListEl.style.marginTop = "18px";
        addressTab.insertBefore(addressSavedListEl, addressTab.firstChild);
    }
}

// Address Edit Container (The form container)
const addressEditContainer = document.getElementById("addressEditContainer");

// Edit/Field Containers
const emailEditFields = document.getElementById("emailEditFields");
const phoneEditFields = document.getElementById("phoneEditFields");
const passwordEditFields = document.getElementById("passwordEditFields");

// Global variable to store address form values when 'Edit' is clicked
let currentAddressOriginalValues = {};

// ==========================
// OTP Popup Elements
// ==========================
const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
const otpError = document.getElementById("otpError");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
const recaptchaContainer = document.getElementById('recaptcha-container');

// Recaptcha
let recaptchaVerifierInitialized = false;

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
        // Reset phone number fields on OTP cancel
        if (newPhoneInput) newPhoneInput.value = "";
        if (currentPhonePasswordInput) currentPhonePasswordInput.value = "";
    });
}

// ==========================
// Mask Functions
// ==========================
function maskEmail(email) {
    if (!email) return "";
    const [user, domain] = email.split("@");
    if (user.length <= 3) return user + "*****@" + domain;
    return user.substring(0, 3) + "*".repeat(Math.max(user.length - 3, 3)) + "@" + domain;
}

function maskPhone(phone) {
    if (!phone || phone.length < 6) return phone || "";
    return phone.slice(0, 3) + "*".repeat(phone.length - 6) + phone.slice(-3);
}

// ==========================
// Phone Input Helper
// ==========================
function formatPhone(input) {
    let value = input.value.trim();
    let digits = value.replace(/[^0-9]/g, "");
    if (value.startsWith("09")) digits = digits.slice(1);
    if (digits.length >= 10 && !value.startsWith('+')) {
        input.value = "09" + digits.slice(-10);
    } else {
        input.value = value;
    }
}

if (newPhoneInput) {
    newPhoneInput.addEventListener("input", () => formatPhone(newPhoneInput));
}

// ==========================
// Load User Data
// ==========================
async function loadUserData() {
    const user = auth.currentUser;
    if (!user) return;

    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        firstNameInput.value = data.firstName || "";
        lastNameInput.value = data.lastName || "";

        // Display masked info
        emailInput.value = maskEmail(user.email || data.email || "");
        phoneInput.value = maskPhone(data.phoneNumber || "");

        // if (currentEmailInput) currentEmailInput.value = user.email || data.email || ""; // <<< REMOVED
        // if (currentPhoneInput) currentPhoneInput.value = maskPhone(data.phoneNumber || ""); // <<< REMOVED: DON'T PRE-FILL CURRENT PHONE

        // Address form fields
        barangayInput.value = data.barangay || "";
        houseNumberInput.value = data.houseNumber || "";
        regionInput.value = data.region || "South Luzon";
        provinceInput.value = data.province || "Cavite";
        cityInput.value = data.city || "Bacoor";

        // Initial state: All address fields are DISABLED (read-only)
        barangayInput.disabled = true; 
        houseNumberInput.disabled = true; 
        regionInput.disabled = true;
        provinceInput.disabled = true;
        cityInput.disabled = true;
    }

    await loadAddressesIntoAddressTab();
}

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    await loadUserData();
});

// ==========================
// Generic Edit/Save/Cancel
// ==========================
function setupEditSaveCancel(editBtnId, saveBtnId, cancelBtnId, inputs, formId, onSave, onEditExtra = null, onCancelExtra = null) {
    const editBtn = document.getElementById(editBtnId);
    const saveBtn = document.getElementById(saveBtnId);
    const cancelBtn = document.getElementById(cancelBtnId);
    const form = document.getElementById(formId);

    if (!editBtn || !saveBtn || !cancelBtn || !form) return;

    let originalValues = {};

    editBtn.addEventListener("click", () => {
        // Store original values and enable fields for editing
        if (formId !== "addressForm") {
            inputs.forEach(i => originalValues[i.id] = i.value);
            inputs.forEach(i => i.disabled = false);
        } else {
            // Address Form (Default Address Edit)
            // 1. Set ID to default and store original values for *all* fields (for reset)
            editingAddressIdInput.value = 'default';
            const addressInputs = [houseNumberInput, barangayInput, regionInput, provinceInput, cityInput];
            addressInputs.forEach(i => originalValues[i.id] = i.value);
            
            // 2. ENABLE only editable fields (houseNumber and barangay)
            houseNumberInput.disabled = false;
            barangayInput.disabled = false;
            houseNumberInput.removeAttribute('disabled');
            barangayInput.removeAttribute('disabled');
            // The rest are deliberately disabled (fixed location)
            regionInput.disabled = true;
            provinceInput.disabled = true;
            cityInput.disabled = true;

            // Ensure address form container is visible in its default location
            if (addressEditContainer) addressEditContainer.style.display = 'block';
        }

        editBtn.style.display = "none";
        saveBtn.style.display = "inline-block";
        cancelBtn.style.display = "inline-block";
        if (onEditExtra) onEditExtra();

        // Ensure address edit container is hidden if it was open for a saved address
        if (formId === "addressForm" && addressEditContainer) {
            // When clicking Edit Default, the container should be in the main tab and visible
            if (editingAddressIdInput.value === 'default') {
                if (addressEditContainer.parentNode !== document.getElementById("addressTab")) {
                    document.getElementById("addressTab").appendChild(addressEditContainer);
                }
                addressEditContainer.style.display = 'block';
            }
            document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
        }
    });

    cancelBtn.addEventListener("click", () => {
        // Reset form fields to original values
        if (formId !== "addressForm") {
            // Standard forms (Name, Email, Password, Phone)
            inputs.forEach(i => i.value = originalValues[i.id]);
            inputs.forEach(i => i.disabled = true);
            
            // Special case for email/phone: reset current inputs to display only
            if (formId === "emailForm") {
                 emailInput.value = maskEmail(auth.currentUser.email);
                 if (currentEmailInput) currentEmailInput.value = ""; // Clear current email input
            }
            if (formId === "phoneForm") {
                 loadUserData(); // Reload to get masked number
                 if (currentPhoneInput) currentPhoneInput.value = ""; // Clear current phone input
            }

        } else {
            // Address Form (Used for Default and Saved Addresses)
            // Determine the source of original values
            const sourceValues = editingAddressIdInput.value === 'default' ? originalValues : currentAddressOriginalValues;

            const addressInputs = [houseNumberInput, barangayInput, regionInput, provinceInput, cityInput];

            // 1. Reset fields to original values
            addressInputs.forEach(i => {
                // Use the stored original value for reset
                if (sourceValues[i.id] !== undefined) {
                    i.value = sourceValues[i.id];
                }
                i.disabled = true; // Always disable on cancel
            });
            editingAddressIdInput.value = ''; // Clear address ID

            // 2. Ensure non-editable fields remain disabled (redundant but safe)
            regionInput.disabled = true;
            provinceInput.disabled = true;
            cityInput.disabled = true;

            // 3. Move the address form container back to the main tab and hide it
            if (addressEditContainer) {
                document.getElementById("addressTab").appendChild(addressEditContainer);
                addressEditContainer.style.display = 'none';
                document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
            }
        }

        // Reset button visibility for the form associated with these buttons
        editBtn.style.display = "inline-block";
        saveBtn.style.display = "none";
        cancelBtn.style.display = "none";

        if (onCancelExtra) onCancelExtra();
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await onSave();
            
            // Re-load data after successful save
            await loadUserData();

            // Reset field states after successful save
            if (formId !== "addressForm") {
                inputs.forEach(i => i.disabled = true);
                
                // Clear the current email/phone inputs after successful save
                if (formId === "emailForm" && currentEmailInput) {
                    currentEmailInput.value = "";
                }
                if (formId === "phoneForm" && currentPhoneInput) {
                    currentPhoneInput.value = "";
                }

            } else {
                // Address: Disable all fields and hide inline container if it was active
                barangayInput.disabled = true;
                houseNumberInput.disabled = true;
                regionInput.disabled = true;
                provinceInput.disabled = true;
                cityInput.disabled = true;

                if (addressEditContainer) {
                    // Move the container back to the main tab and hide it
                    document.getElementById("addressTab").appendChild(addressEditContainer);
                    addressEditContainer.style.display = 'none';
                    document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
                }
            }

            // Reset button visibility
            editBtn.style.display = "inline-block";
            saveBtn.style.display = "none";
            cancelBtn.style.display = "none";
            if (onCancelExtra) onCancelExtra();

        } catch (err) {
            if (!err.message.includes("Failed to send OTP")) {
                alert("Error: " + err.message);
            }
        }
    });
}

// ==========================
// Re-login Popup
// ==========================
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

// ===================================
// Information Tab Logic
// ===================================

// --- Section 1: Name ---
setupEditSaveCancel(
    "editNameBtn",
    "saveNameBtn",
    "cancelNameBtn",
    [firstNameInput, lastNameInput],
    "nameForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");
        const fullName = `${firstNameInput.value} ${lastNameInput.value}`.trim();
        await updateDoc(doc(db, "users", user.uid), {
            firstName: firstNameInput.value,
            lastName: lastNameInput.value
        });
        localStorage.setItem("currentUserName", fullName);
        const profileNameEl = document.querySelector('.profile-name');
        const welcomeHeader = document.querySelector('.main-content header h1');
        if (profileNameEl) profileNameEl.textContent = fullName;
        if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${fullName}`;
        alert("Name updated successfully!");
    }
);

// --- Section 2: Email ---
setupEditSaveCancel(
    "editEmailBtn",
    "saveEmailBtn",
    "cancelEmailBtn",
    [emailInput, newEmailInput, currentPasswordInput], 
    "emailForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");
        
        // Use the user-entered values
        const confirmEmail = currentEmailInput.value.trim(); 
        const newEmail = newEmailInput.value.trim();
        const currentPassword = currentPasswordInput.value;

        if (!confirmEmail || !newEmail || !currentPassword)
            throw new Error("All fields are required");
        
        // New validation: User input must match Firebase email
        if (confirmEmail !== user.email) 
            throw new Error("The entered current email does not match your account email.");

        await reload(user);
        
        // Use user-entered 'confirmEmail' and 'currentPassword' to reauthenticate
        const credential = EmailAuthProvider.credential(confirmEmail, currentPassword);
        await reauthenticateWithCredential(user, credential);

        const usersRef = collection(db, "users");
        const q = query(usersRef, where("email", "==", newEmail));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) throw new Error("Email already in use");

        await updateDoc(doc(db, "users", user.uid), { pendingEmail: newEmail });
        await verifyBeforeUpdateEmail(user, newEmail);

        showReLoginPopup("Email change verification sent! Please check your new email's inbox. You will be logged out now.");
    },
    () => {
        if (emailEditFields) emailEditFields.style.display = "block";
        if (emailInput) emailInput.disabled = true;
        if (currentEmailInput) currentEmailInput.disabled = false; // Ensure current email input is enabled for entry
    },
    () => {
        if (emailEditFields) emailEditFields.style.display = "none";
        if (emailInput) emailInput.disabled = true;
        if (currentEmailInput) currentEmailInput.value = ""; // Clear on cancel
        if (newEmailInput) newEmailInput.value = "";
        if (currentPasswordInput) currentPasswordInput.value = "";
    }
);

// --- Section 3: Password ---
setupEditSaveCancel(
    "editPasswordBtn",
    "savePasswordBtn",
    "cancelPasswordBtn",
    [passwordInput, confirmPasswordInput, currentPasswordForChange],
    "passwordForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");
        if (!currentPasswordForChange.value || !passwordInput.value || !confirmPasswordInput.value)
            throw new Error("All fields are required");
        if (passwordInput.value !== confirmPasswordInput.value)
            throw new Error("New passwords do not match");

        const credential = EmailAuthProvider.credential(user.email, currentPasswordForChange.value);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, passwordInput.value);

        showReLoginPopup("Password updated successfully! Please login again.");
    },
    () => {
        if (passwordEditFields) passwordEditFields.style.display = "block";
    },
    () => {
        if (passwordEditFields) passwordEditFields.style.display = "none";
        if (currentPasswordForChange) currentPasswordForChange.value = "";
        if (passwordInput) passwordInput.value = "";
        if (confirmPasswordInput) confirmPasswordInput.value = "";
    }
);

// --- Section 4: Phone ---
setupEditSaveCancel(
    "editPhoneBtn",
    "savePhoneBtn",
    "cancelPhoneBtn",
    [phoneInput, newPhoneInput, currentPhonePasswordInput], // <<< currentPhoneInput REMOVED from generic handler
    "phoneForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");
        
        const confirmPhoneMasked = currentPhoneInput.value.trim();
        const newPhone = newPhoneInput.value.trim();
        const currentPassword = currentPhonePasswordInput.value;

        if (!confirmPhoneMasked || !newPhone || !currentPassword)
            throw new Error("All fields are required");

        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("User data not found.");
        const data = docSnap.data();
        
        // Validation: User input (which should be the masked number) must match the saved masked number
        if (confirmPhoneMasked !== maskPhone(data.phoneNumber))
             throw new Error("The entered current phone number does not match your masked account number. Please enter the number as it appears masked above.");
        
        // Re-authenticate using email/password
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        let newPhoneNumber = newPhone;
        // Format to E.164 (e.g., +639XXXXXXXXX) for Firebase
        if (newPhoneNumber.startsWith("09")) newPhoneNumber = "+63" + newPhoneNumber.slice(1);
        else if (!newPhoneNumber.startsWith("+63")) newPhoneNumber = "+63" + newPhoneNumber.replace(/[^0-9]/g, "").slice(-10);

        if (!recaptchaVerifierInitialized) {
            // Check if the reCAPTCHA container is available
            if (!recaptchaContainer) throw new Error("reCAPTCHA container not found.");
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
            recaptchaVerifierInitialized = true;
        }

        try {
            const confirmationResult = await signInWithPhoneNumber(auth, newPhoneNumber, window.recaptchaVerifier);
            otpPopup.style.display = "flex";
            clearOtpError();
            
            // Wait for OTP verification
            return new Promise((resolve, reject) => {
                const handleVerify = async () => {
                    verifyOtpBtn.removeEventListener('click', handleVerify); // Prevent multiple handlers

                    const otp = otpCode.value.trim();
                    if (!otp) {
                        verifyOtpBtn.addEventListener('click', handleVerify); // Re-attach on error
                        return showOtpError("Please enter the OTP.");
                    }
                    try {
                        await confirmationResult.confirm(otp);
                        await updateDoc(docRef, { phoneNumber: newPhoneNumber });
                        otpPopup.style.display = "none";
                        showReLoginPopup("Phone number updated successfully! Please login again.");
                        resolve(); // Resolve the main promise on success
                    } catch (e) {
                        console.error("OTP confirmation error:", e);
                        showOtpError("Wrong OTP. Please try again.");
                        verifyOtpBtn.addEventListener('click', handleVerify); // Re-attach on error
                    }
                };

                verifyOtpBtn.addEventListener('click', handleVerify);
            });
        } catch (err) {
            console.error("OTP send error:", err);
            // Handle reCAPTCHA not solved error more gracefully if needed
            throw new Error("Failed to send OTP. Check phone number format or reCAPTCHA setup.");
        }
    },
    () => {
        if (phoneEditFields) phoneEditFields.style.display = "block";
        if (phoneInput) phoneInput.disabled = true;
        if (currentPhoneInput) currentPhoneInput.disabled = false; // Ensure current phone input is enabled for entry
    },
    () => {
        if (phoneEditFields) phoneEditFields.style.display = "none";
        if (phoneInput) phoneInput.disabled = true;
        if (currentPhoneInput) currentPhoneInput.value = ""; // Clear on cancel
        if (newPhoneInput) newPhoneInput.value = "";
        if (currentPhonePasswordInput) currentPhonePasswordInput.value = "";
    }
);

// ===================================
// Address Tab Logic
// ===================================

/**
 * Formats address data into a readable string.
 */
function formatAddress(data = {}) {
    return [data.houseNumber, data.barangay, data.city, data.province, data.region].filter(Boolean).join(", ");
}

/**
 * Populates the address form with specific data and stores original values for cancel.
 * Also explicitly enables HouseNumber and Barangay inputs.
 */
function populateAddressForm(data, addressId) {
    if (editingAddressIdInput) editingAddressIdInput.value = addressId;

    // Set form values
    houseNumberInput.value = data.houseNumber || "";
    barangayInput.value = data.barangay || "";
    cityInput.value = data.city || "";
    provinceInput.value = data.province || "";
    regionInput.value = data.region || "";

    // Store original values (including fixed fields) for cancel functionality
    currentAddressOriginalValues = {
        houseNumber: houseNumberInput.value,
        barangay: barangayInput.value,
        city: cityInput.value,
        province: provinceInput.value,
        region: regionInput.value,
        editingAddressId: editingAddressIdInput.value
    };

    // CRITICAL FIX: Ensure editable fields are enabled and remove disabled attribute
    houseNumberInput.disabled = false;
    barangayInput.disabled = false;
    
    // Use removeAttribute as a backup to counter aggressive browser disabling
    houseNumberInput.removeAttribute('disabled');
    barangayInput.removeAttribute('disabled');


    // Disable fixed fields
    regionInput.disabled = true;
    provinceInput.disabled = true;
    cityInput.disabled = true;

    // Show save/cancel buttons for the inline form
    document.getElementById("editAddressBtn").style.display = "none";
    document.getElementById("saveAddressBtn").style.display = "inline-block";
    document.getElementById("cancelAddressBtn").style.display = "inline-block";
}

/**
 * Handles the click event for editing a saved address, moving the form inline.
 */
function handleAddressEditClick(data, addressId, cardElement) {
    // 1. Reset all card states and hide any open inline edit containers
    document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
    
    // Ensure the container is moved to the main tab and hidden if it was NOT this card
    if (addressEditContainer && addressEditContainer.parentNode !== document.getElementById("addressTab")) {
        document.getElementById("addressTab").appendChild(addressEditContainer); 
        addressEditContainer.style.display = "none";
    }

    // 2. Hide the main edit button
    document.getElementById("editAddressBtn").style.display = "none";

    // 3. Move the address form (addressEditContainer) into the clicked card
    if (addressEditContainer) {
        cardElement.appendChild(addressEditContainer);
        addressEditContainer.style.display = "block";
    }

    // 4. Set the card as active and populate the form (which enables the inputs)
    cardElement.classList.add('active-edit');
    populateAddressForm(data, addressId);

    // 5. CRITICAL FIX: Manually ensure buttons are visible since we bypassed the default handler
    // The populateAddressForm already does this, but we make sure here again.
    document.getElementById("saveAddressBtn").style.display = "inline-block";
    document.getElementById("cancelAddressBtn").style.display = "inline-block";
}

/**
 * Promotes a saved address to the default address and demotes the old default.
 */
async function promoteAddressToDefault(savedAddressId, savedAddressData, defaultAddressData) {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");

    const userDocRef = doc(db, "users", user.uid);
    const savedAddressDocRef = doc(db, "users", user.uid, "addresses", savedAddressId);

    // 1. Prepare the old default address data to become a saved address
    const newSavedAddressData = {
        houseNumber: defaultAddressData.houseNumber || "",
        barangay: defaultAddressData.barangay || "",
        city: defaultAddressData.city || "",
        province: defaultAddressData.province || "",
        region: defaultAddressData.region || "",
    };

    // 2. Update the saved address document with the old default data
    await setDoc(savedAddressDocRef, newSavedAddressData);

    // 3. Update the main user document (default address) with the promoted address data
    await updateDoc(userDocRef, {
        houseNumber: savedAddressData.houseNumber,
        barangay: savedAddressData.barangay,
        city: savedAddressData.city,
        province: savedAddressData.province,
        region: savedAddressData.region,
    });

    alert("Default Address updated successfully! The old default is now a saved address.");
    await loadUserData(); // Reload all data to refresh the display
}

/**
 * Renders the default and saved addresses into the address tab.
 */
async function loadAddressesIntoAddressTab() {
    try {
        const user = auth.currentUser;
        if (!user) return;

        // Ensure addressSavedListEl exists
        if (!addressSavedListEl) {
            const addressTab = document.getElementById("addressTab");
            if (!addressTab) return;
            addressSavedListEl = document.createElement("div");
            addressSavedListEl.id = "address-saved-list";
            addressSavedListEl.style.marginTop = "18px";
            addressTab.insertBefore(addressSavedListEl, addressTab.firstChild);
        }

        addressSavedListEl.innerHTML = "";

        const userDocRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userDocRef);
        let index = 1;
        let defaultAddressData = {}; // Store default address data for promotion logic

        if (userSnap.exists()) {
            const userData = userSnap.data();
            defaultAddressData = {
                houseNumber: userData.houseNumber,
                barangay: userData.barangay,
                city: userData.city,
                province: userData.province,
                region: userData.region
            };

            const defaultAddressStr = formatAddress(defaultAddressData);

            if (defaultAddressStr) {
                const card = document.createElement("div");
                card.className = "address-card default-address-card";
                card.setAttribute('data-address-id', 'default');
                // The main edit/save/cancel buttons below the default address are used for editing
                card.innerHTML = `
                    <div style="flex:1;">
                        <strong>Default Address</strong><br>
                        <span class="addr-text">${defaultAddressStr}</span>
                    </div>
                `;
                addressSavedListEl.appendChild(card);
            }
        }

        const addrColRef = collection(db, "users", user.uid, "addresses");
        const snapshot = await getDocs(addrColRef);

        if (!snapshot.empty) {
            snapshot.forEach(docSnap => {
                const id = docSnap.id;
                const data = docSnap.data();
                const full = formatAddress(data);
                index++;

                const card = document.createElement("div");
                card.className = "address-card saved-address-item";
                card.setAttribute('data-address-id', id);

                card.innerHTML = `
                    <div class="address-card-header">
                        <div class="address-title">
                            Address ${index}
                        </div>
                        <div class="address-card-actions">
                            <button type="button" class="set-default-btn edit-btn-small" data-id="${id}" style="background:#007bff; border:1px solid #007bff; color:white;">
                                <i class="fas fa-star"></i> Set as Default
                            </button>
                            <button type="button" class="edit-address-btn edit-btn-small" data-id="${id}">
                                <i class="fas fa-edit"></i> Edit
                            </button>
                            <button type="button" class="delete-address-btn delete-btn-small" data-id="${id}" title="Delete Address">
                                <i class="fas fa-trash-alt"></i> Delete
                            </button>
                        </div>
                    </div>
                    <div class="address-details addr-text">${full}</div>
                `;

                addressSavedListEl.appendChild(card);

                // EVENT LISTENERS
                card.querySelector(".set-default-btn").addEventListener("click", () => {
                    promoteAddressToDefault(id, data, defaultAddressData);
                });

                card.querySelector(".edit-address-btn").addEventListener("click", () => {
                    handleAddressEditClick(data, id, card);
                });

                card.querySelector(".delete-address-btn").addEventListener("click", async () => {
                    const confirmed = confirm("Delete this saved address? This cannot be undone.");
                    if (!confirmed) return;
                    try {
                        await deleteDoc(doc(db, "users", auth.currentUser.uid, "addresses", id));
                        await loadAddressesIntoAddressTab();
                        if (addressEditContainer) {
                            addressEditContainer.style.display = 'none';
                            document.getElementById("addressTab").appendChild(addressEditContainer);
                        }
                    } catch (err) {
                        console.error("Failed to delete address:", err);
                        alert("Failed to delete address. Try again.");
                    }
                });
            });
        } else {
            if (addressSavedListEl.children.length === 0) {
                const hint = document.createElement("div");
                hint.style.padding = "10px";
                hint.style.color = "#666";
                hint.textContent = "No additional saved addresses.";
                addressSavedListEl.appendChild(hint);
            }
        }

        // Final check to ensure the address edit container is at the bottom and hidden initially/after load
        if (addressEditContainer && addressEditContainer.parentNode !== document.getElementById("addressTab")) {
            document.getElementById("addressTab").appendChild(addressEditContainer);
        }
        // Check if the main 'Edit Address' button is visible. If not, the form is in 'edit' state for default address, so keep it visible.
        const editAddressBtn = document.getElementById("editAddressBtn");
        if (editAddressBtn && editAddressBtn.style.display !== "none") {
            if (addressEditContainer) addressEditContainer.style.display = 'none';
        }

        document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));

    } catch (err) {
        console.error("Error loading addresses into tab:", err);
        if (addressSavedListEl) addressSavedListEl.innerHTML = "<p>Failed to load saved addresses.</p>";
    }
}

// --- Address Save/Cancel Setup ---
setupEditSaveCancel(
    "editAddressBtn",
    "saveAddressBtn",
    "cancelAddressBtn",
    [barangayInput, houseNumberInput, regionInput, provinceInput, cityInput, editingAddressIdInput],
    "addressForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");

        const addressData = {
            barangay: barangayInput.value,
            houseNumber: houseNumberInput.value,
            // These fields are non-editable but must be included in the update for saved addresses
            region: regionInput.value,
            province: provinceInput.value,
            city: cityInput.value,
        };

        const addressId = editingAddressIdInput.value;

        if (addressId === 'default') {
            // Only update the editable fields (barangay, houseNumber) for the default address
            await updateDoc(doc(db, "users", user.uid), {
                barangay: addressData.barangay,
                houseNumber: addressData.houseNumber,
            });
            alert("Default Address updated successfully! (Barangay/House Number changed)");
        } else {
            // Update a saved address document (updates all fields)
            await updateDoc(doc(db, "users", user.uid, "addresses", addressId), addressData);
            alert("Saved Address updated successfully! (Barangay/House Number changed)");
        }

        await loadAddressesIntoAddressTab();
    },
    () => {
        // onEditExtra for default address edit
        editingAddressIdInput.value = 'default';
    },
    () => {
        // onCancelExtra for default address edit / saved address edit
        editingAddressIdInput.value = '';
    }
);

// --- Inline Address Edit Close Button Handler (For saved addresses) ---
if (addressEditContainer) {
    const closeAddressEditBtn = document.getElementById("closeAddressEditBtn");
    if (closeAddressEditBtn) {
        // This close button acts identically to the main 'Cancel' button when editing a saved address
        closeAddressEditBtn.addEventListener("click", () => {
            document.getElementById("cancelAddressBtn").click();
        });
    }
}
