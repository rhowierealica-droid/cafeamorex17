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
    deleteDoc
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
const currentPhoneInput = document.getElementById("currentPhoneInput");
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

// Address Edit Container
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

        if (currentEmailInput) currentEmailInput.value = user.email || data.email || "";
        if (currentPhoneInput) currentPhoneInput.value = data.phoneNumber || "";

        // Address form fields
        barangayInput.value = data.barangay || "";
        houseNumberInput.value = data.houseNumber || "";
        regionInput.value = data.region || "South Luzon"; 
        provinceInput.value = data.province || "Cavite";
        cityInput.value = data.city || "Bacoor";

        // Initial state: Default address fields are DISABLED (read-only)
        barangayInput.disabled = true; // FIX: Start disabled
        houseNumberInput.disabled = true; // FIX: Start disabled
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
            const addressInputs = [barangayInput, houseNumberInput];
            addressInputs.forEach(i => originalValues[i.id] = i.value);
            addressInputs.forEach(i => i.disabled = false);
        }

        editBtn.style.display = "none";
        saveBtn.style.display = "inline-block";
        cancelBtn.style.display = "inline-block";
        if (onEditExtra) onEditExtra();

        // Ensure address edit container is hidden if it was open for a saved address
        if (formId === "addressForm" && addressEditContainer) {
            addressEditContainer.style.display = 'none';
            document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
        }
    });

    cancelBtn.addEventListener("click", () => {
        if (formId !== "addressForm") {
            // Standard forms (Name, Email, Password, Phone)
            inputs.forEach(i => i.value = originalValues[i.id]);
            inputs.forEach(i => i.disabled = true);
        } else {
            // Address Form (Used for Default and Saved Addresses)
            
            // Check if we are canceling the main address form's edit (the default address)
            if (editBtn.style.display === "none") {
                 // If the main edit button is hidden, it means the main form is in edit mode
                const addressInputs = [barangayInput, houseNumberInput];
                addressInputs.forEach(i => {
                    if (originalValues[i.id] !== undefined) {
                        i.value = originalValues[i.id];
                    }
                    i.disabled = true; // FIX: Disable fields when canceling default address edit
                });
            } else {
                // This branch handles cancelling an IN-CARD saved address edit
                const addressInputs = [barangayInput, houseNumberInput, regionInput, provinceInput, cityInput];
                addressInputs.forEach(i => {
                    if (currentAddressOriginalValues[i.id] !== undefined) {
                        i.value = currentAddressOriginalValues[i.id];
                    }
                    i.disabled = true; // Disable fields when cancelling saved address edit
                });
            }
            // These are always disabled
            regionInput.disabled = true;
            provinceInput.disabled = true;
            cityInput.disabled = true;

            // Reset buttons if canceling the default address edit
            if (editBtn.style.display === "none") {
                editBtn.style.display = "inline-block";
                saveBtn.style.display = "none";
                cancelBtn.style.display = "none";
            }
        }
        
        // Reset button visibility if this is not the address form (standard behavior)
        if (formId !== "addressForm" || (formId === "addressForm" && editBtn.style.display === "none")) {
            editBtn.style.display = "inline-block";
            saveBtn.style.display = "none";
            cancelBtn.style.display = "none";
        }


        if (onCancelExtra) onCancelExtra();

        // Handle address edit container reset for saved addresses
        if (formId === "addressForm" && addressEditContainer && addressSavedListEl) {
            document.getElementById("addressTab").appendChild(addressEditContainer);
            addressEditContainer.style.display = 'none';
            document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
        }
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await onSave();
            await loadUserData();

            if (formId !== "addressForm") {
                inputs.forEach(i => i.disabled = true);
            } else {
                // Disable address fields after save
                barangayInput.disabled = true;
                houseNumberInput.disabled = true;
            }
            
            editBtn.style.display = "inline-block";
            saveBtn.style.display = "none";
            cancelBtn.style.display = "none";
            if (onCancelExtra) onCancelExtra();

            // Handle address edit container reset for saved addresses
            if (formId === "addressForm" && addressEditContainer && addressSavedListEl) {
                document.getElementById("addressTab").appendChild(addressEditContainer);
                addressEditContainer.style.display = 'none';
                document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
            }
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
// Information Tab Logic (No Change)
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
    [emailInput, currentEmailInput, newEmailInput, currentPasswordInput],
    "emailForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");
        if (!currentEmailInput.value || !newEmailInput.value || !currentPasswordInput.value)
            throw new Error("All fields are required");
        if (currentEmailInput.value !== user.email)
            throw new Error("Current email does not match account email.");

        await reload(user);
        const credential = EmailAuthProvider.credential(user.email, currentPasswordInput.value);
        await reauthenticateWithCredential(user, credential);

        const usersRef = collection(db, "users");
        const q = query(usersRef, where("email", "==", newEmailInput.value));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) throw new Error("Email already in use");

        await updateDoc(doc(db, "users", user.uid), { pendingEmail: newEmailInput.value });
        await verifyBeforeUpdateEmail(user, newEmailInput.value);

        showReLoginPopup("Email updated successfully! Please login again to confirm new email.");
    },
    () => {
        if (emailEditFields) emailEditFields.style.display = "block";
        if (emailInput) emailInput.disabled = true;
        if (currentEmailInput) currentEmailInput.value = auth.currentUser.email;
    },
    () => {
        if (emailEditFields) emailEditFields.style.display = "none";
        if (emailInput) emailInput.disabled = true;
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
            throw new Error("Passwords do not match");

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
    [phoneInput, currentPhoneInput, newPhoneInput, currentPhonePasswordInput],
    "phoneForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");
        if (!currentPhoneInput.value || !newPhoneInput.value || !currentPhonePasswordInput.value)
            throw new Error("All fields are required");

        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("User data not found.");
        const data = docSnap.data();

        if (currentPhoneInput.value !== data.phoneNumber)
            throw new Error("Current phone does not match saved number.");

        const credential = EmailAuthProvider.credential(user.email, currentPhonePasswordInput.value);
        await reauthenticateWithCredential(user, credential);

        let newPhoneNumber = newPhoneInput.value.trim();
        if (newPhoneNumber.startsWith("09")) newPhoneNumber = "+63" + newPhoneNumber.slice(1);
        else if (!newPhoneNumber.startsWith("+63")) newPhoneNumber = "+63" + newPhoneNumber.replace(/[^0-9]/g, "").slice(-10);

        if (!recaptchaVerifierInitialized) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
            recaptchaVerifierInitialized = true;
        }

        try {
            const confirmationResult = await signInWithPhoneNumber(auth, newPhoneNumber, window.recaptchaVerifier);
            otpPopup.style.display = "flex";
            clearOtpError();

            verifyOtpBtn.onclick = async () => {
                const otp = otpCode.value.trim();
                if (!otp) return showOtpError("Please enter the OTP.");
                try {
                    await confirmationResult.confirm(otp);
                    await updateDoc(docRef, { phoneNumber: newPhoneNumber });
                    showReLoginPopup("Phone number updated successfully! Please login again.");
                } catch {
                    showOtpError("Wrong OTP. Please try again.");
                }
            };
        } catch (err) {
            console.error("OTP send error:", err);
            throw new Error("Failed to send OTP. Check phone number format.");
        }
    },
    () => {
        if (phoneEditFields) phoneEditFields.style.display = "block";
        if (phoneInput) phoneInput.disabled = true;
        if (currentPhoneInput) currentPhoneInput.value = currentPhoneInput.value;
    },
    () => {
        if (phoneEditFields) phoneEditFields.style.display = "none";
        if (phoneInput) phoneInput.disabled = true;
        if (newPhoneInput) newPhoneInput.value = "";
        if (currentPhonePasswordInput) currentPhonePasswordInput.value = "";
    }
);

// ===================================
// Address Tab Logic (UPDATED FOR INLINE POPUP) 🚀
// ===================================
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
            region: regionInput.value,
            province: provinceInput.value,
            city: cityInput.value,
        };

        const addressId = editingAddressIdInput.value;

        if (addressId === 'default') {
            await updateDoc(doc(db, "users", user.uid), addressData);
            alert("Default Address updated successfully! (Barangay/House Number changed)");
            // Ensure address form fields are disabled after save
            barangayInput.disabled = true;
            houseNumberInput.disabled = true;
        } else {
            await updateDoc(doc(db, "users", user.uid, "addresses", addressId), addressData);
            alert("Saved Address updated successfully! (Barangay/House Number changed)");
            // These fields are managed by the in-card edit/cancel/save, no need to manually disable here
            // as loadAddressesIntoAddressTab will be called.
        }

        await loadAddressesIntoAddressTab();
    },
    () => {
        // onEditExtra for default address edit
        editingAddressIdInput.value = 'default';
        const addressInputs = [houseNumberInput, barangayInput];
        addressInputs.forEach(i => currentAddressOriginalValues[i.id] = i.value);
    },
    () => {
        // onCancelExtra for default address edit (handled by setupEditSaveCancel cancel logic)
        editingAddressIdInput.value = '';
    }
);

// ==========================
// Additional Address Tab Helpers (UPDATED) 🚀
// ==========================
function formatAddress(data = {}) {
    return [data.houseNumber, data.barangay, data.city, data.province, data.region].filter(Boolean).join(", ");
}

function populateAddressForm(data, addressId) {
    if (editingAddressIdInput) editingAddressIdInput.value = addressId;

    houseNumberInput.value = data.houseNumber || "";
    barangayInput.value = data.barangay || "";
    cityInput.value = data.city || "";
    provinceInput.value = data.province || "";
    regionInput.value = data.region || "";

    // Store original values for cancel functionality
    currentAddressOriginalValues = {
        houseNumber: houseNumberInput.value,
        barangay: barangayInput.value,
        city: cityInput.value,
        province: provinceInput.value,
        region: regionInput.value,
        editingAddressId: editingAddressIdInput.value
    };

    // Enable editable fields for the saved address
    houseNumberInput.disabled = false;
    barangayInput.disabled = false;
    // Disable fixed fields
    regionInput.disabled = true;
    provinceInput.disabled = true;
    cityInput.disabled = true;

    // Hide the main form's edit button and show save/cancel buttons
    document.getElementById("editAddressBtn").style.display = "none";
    document.getElementById("saveAddressBtn").style.display = "inline-block";
    document.getElementById("cancelAddressBtn").style.display = "inline-block";
}

function handleAddressEditClick(data, addressId, cardElement) {
    document.querySelectorAll('.address-card.active-edit').forEach(card => {
        card.classList.remove('active-edit');
    });

    if (addressEditContainer) {
        cardElement.appendChild(addressEditContainer);
        addressEditContainer.style.display = "block";
    }

    cardElement.classList.add('active-edit');
    populateAddressForm(data, addressId);
}

async function loadAddressesIntoAddressTab() {
    try {
        const user = auth.currentUser;
        if (!user) return;

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

        if (userSnap.exists()) {
            const userData = userSnap.data();
            const defaultAddressStr = formatAddress({
                houseNumber: userData.houseNumber,
                barangay: userData.barangay,
                city: userData.city,
                province: userData.province,
                region: userData.region
            });

            if (defaultAddressStr) {
                const card = document.createElement("div");
                card.className = "address-card default-address-card";
                card.setAttribute('data-address-id', 'default');
                card.innerHTML = `
                    <div style="flex:1;">
                        <strong>Default Address</strong><br>
                        <span class="addr-text">${defaultAddressStr}</span>
                    </div>
                    <div style="margin-left:10px; display:flex; gap:8px;">
                        <button type="button" class="edit-address-btn btn-edit-addr" data-source="default">Edit</button>
                    </div>
                `;
                addressSavedListEl.appendChild(card);
                
                // --- DESIGN STYLES FOR EDIT BUTTON (Default Address) ---
                const editBtn = card.querySelector(".edit-address-btn");
                editBtn.style.padding = "5px 12px";
                editBtn.style.borderRadius = "5px";
                editBtn.style.border = "1px solid #552915";
                editBtn.style.backgroundColor = "#fff";
                editBtn.style.color = "#552915";
                editBtn.style.cursor = "pointer";
                // ----------------------------------------------------

                editBtn.addEventListener("click", () => {
                    // This click should activate the main edit button, which is outside the card.
                    // Instead of calling handleAddressEditClick, we trigger the main edit button's logic.
                    // This is for better separation of concerns, even though the layout might be confusing.
                    document.getElementById("editAddressBtn").click(); 
                });
                index++;
            }
        }

        const addrColRef = collection(db, "users", user.uid, "addresses");
        const snapshot = await getDocs(addrColRef);

        if (!snapshot.empty) {
            snapshot.forEach(docSnap => {
                const id = docSnap.id;
                const data = docSnap.data();
                const full = formatAddress(data);

                const card = document.createElement("div");
                card.className = "address-card saved-address-item";
                card.setAttribute('data-address-id', id);

                card.innerHTML = `
                    <div style="flex:1;">
                        <strong>Saved Address ${index}</strong><br>
                        <span class="addr-text">${full}</span>
                    </div>
                    <div style="margin-left:10px; display:flex; gap:8px;">
                        <button type="button" class="edit-address-btn btn-edit-addr" data-id="${id}">Edit</button>
                        <button type="button" class="delete-address-btn btn-delete-addr" data-id="${id}" title="Delete Address">Delete</button>
                    </div>
                `;

                addressSavedListEl.appendChild(card);
                
                // --- DESIGN STYLES FOR EDIT AND DELETE BUTTONS (Saved Addresses) ---
                const editBtn = card.querySelector(".edit-address-btn");
                const deleteBtn = card.querySelector(".delete-address-btn");
                
                // Edit Button Styles
                editBtn.style.padding = "5px 12px";
                editBtn.style.borderRadius = "5px";
                editBtn.style.border = "1px solid #552915";
                editBtn.style.backgroundColor = "#fff";
                editBtn.style.color = "#552915";
                editBtn.style.cursor = "pointer";
                
                // Delete Button Styles
                deleteBtn.style.padding = "5px 12px";
                deleteBtn.style.borderRadius = "5px";
                deleteBtn.style.border = "1px solid #dc3545"; // Red border
                deleteBtn.style.backgroundColor = "#dc3545"; // Red background
                deleteBtn.style.color = "#fff"; // White text
                deleteBtn.style.cursor = "pointer";
                // -----------------------------------------------------------------

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

                index++;
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

        // Ensure the address edit container is at the bottom and hidden initially/after load
        if (addressEditContainer && addressEditContainer.parentNode !== document.getElementById("addressTab")) {
            document.getElementById("addressTab").appendChild(addressEditContainer);
        }
        if (addressEditContainer) addressEditContainer.style.display = 'none';
        document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));

    } catch (err) {
        console.error("Error loading addresses into tab:", err);
        if (addressSavedListEl) addressSavedListEl.innerHTML = "<p>Failed to load saved addresses.</p>";
    }
}
