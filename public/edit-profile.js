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

const sidebarLinks = document.querySelectorAll('.login-link, .profile-card, .logout');
sidebarLinks.forEach(link => link.classList.remove('active'));
document.querySelector('.profile-card').classList.add('active');

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

const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");

const emailInput = document.getElementById("email");
const currentEmailInput = document.getElementById("currentEmailInput");
const newEmailInput = document.getElementById("newEmail");
const currentPasswordInput = document.getElementById("currentPassword");

const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");
const currentPasswordForChange = document.getElementById("currentPasswordForChange");

const phoneInput = document.getElementById("phone");
const currentPhoneInput = document.getElementById("currentPhoneInput");
const newPhoneInput = document.getElementById("newPhone");
const currentPhonePasswordInput = document.getElementById("currentPhonePassword");

const barangayInput = document.getElementById("barangay");
const houseNumberInput = document.getElementById("houseNumber");
const regionInput = document.getElementById("region");
const provinceInput = document.getElementById("province");
const cityInput = document.getElementById("city");
const editingAddressIdInput = document.getElementById("editingAddressId");

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

const addressEditContainer = document.getElementById("addressEditContainer");

const emailEditFields = document.getElementById("emailEditFields");
const phoneEditFields = document.getElementById("phoneEditFields");
const passwordEditFields = document.getElementById("passwordEditFields");

let currentAddressOriginalValues = {};

const otpPopup = document.getElementById("otpPopup");
const otpCode = document.getElementById("otpCode");
const otpError = document.getElementById("otpError");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const closeOtpBtn = document.getElementById("closeOtpBtn");
const recaptchaContainer = document.getElementById('recaptcha-container');

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
        if (newPhoneInput) newPhoneInput.value = "";
        if (currentPhonePasswordInput) currentPhonePasswordInput.value = "";
    });
}

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

/**
 * ☕ Calculates a hypothetical delivery fee based on the barangay.
 * This should ideally come from a Firestore collection or a robust distance matrix API.
 * For this example, we use a simple lookup.
 * @param {string} barangay 
 * @returns {number} The delivery fee in PHP.
 */
function calculateDeliveryFee(barangay) {
    const fees = {
        "Aniban I": 50,
        "Aniban II": 50,
        "Aniban III": 60,
        "Aniban IV": 60,
        "Aniban V": 70,
        "San Nicolas I": 40,
        "San Nicolas II": 40,
        "San Nicolas III": 50,
        "Ligas I": 70,
        "Ligas II": 80,
        "Ligas III": 80,
        "Zapote 1": 90
    };
    // Default fee for areas not listed or addresses outside the main delivery zone
    return fees[barangay] || 100; 
}


async function loadUserData() {
    const user = auth.currentUser;
    if (!user) return;

    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        const data = docSnap.data();
        firstNameInput.value = data.firstName || "";
        lastNameInput.value = data.lastName || "";

        emailInput.value = maskEmail(user.email || data.email || "");
        phoneInput.value = maskPhone(data.phoneNumber || "");

        barangayInput.value = data.barangay || "";
        houseNumberInput.value = data.houseNumber || "";
        regionInput.value = data.region || "South Luzon";
        provinceInput.value = data.province || "Cavite";
        cityInput.value = data.city || "Bacoor";

        // Calculate and display fee for the default address
        const defaultFee = calculateDeliveryFee(data.barangay);
        // You'll need an element for this in your HTML, e.g., <p id="defaultAddressFee"></p>
        const feeEl = document.getElementById("defaultAddressFee");
        if (feeEl) feeEl.textContent = ` (Delivery Fee: ₱${defaultFee})`;


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

function setupEditSaveCancel(editBtnId, saveBtnId, cancelBtnId, inputs, formId, onSave, onEditExtra = null, onCancelExtra = null) {
    const editBtn = document.getElementById(editBtnId);
    const saveBtn = document.getElementById(saveBtnId);
    const cancelBtn = document.getElementById(cancelBtnId);
    const form = document.getElementById(formId);

    if (!editBtn || !saveBtn || !cancelBtn || !form) return;

    let originalValues = {};

    editBtn.addEventListener("click", () => {
        if (formId !== "addressForm") {
            inputs.forEach(i => originalValues[i.id] = i.value);
            inputs.forEach(i => i.disabled = false);
        } else {
            editingAddressIdInput.value = 'default';
            const addressInputs = [houseNumberInput, barangayInput, regionInput, provinceInput, cityInput];
            addressInputs.forEach(i => originalValues[i.id] = i.value);

            houseNumberInput.disabled = false;
            barangayInput.disabled = false;
            houseNumberInput.removeAttribute('disabled');
            barangayInput.removeAttribute('disabled');
            regionInput.disabled = true;
            provinceInput.disabled = true;
            cityInput.disabled = true;

            if (addressEditContainer) addressEditContainer.style.display = 'block';
        }

        editBtn.style.display = "none";
        saveBtn.style.display = "inline-block";
        cancelBtn.style.display = "inline-block";
        if (onEditExtra) onEditExtra();

        if (formId === "addressForm" && addressEditContainer) {
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
        if (formId !== "addressForm") {
            inputs.forEach(i => i.value = originalValues[i.id]);
            inputs.forEach(i => i.disabled = true);

            if (formId === "emailForm") {
                emailInput.value = maskEmail(auth.currentUser.email);
                if (currentEmailInput) currentEmailInput.value = "";
            }
            if (formId === "phoneForm") {
                loadUserData();
                if (currentPhoneInput) currentPhoneInput.value = "";
            }

        } else {

            const sourceValues = editingAddressIdInput.value === 'default' ? originalValues : currentAddressOriginalValues;

            const addressInputs = [houseNumberInput, barangayInput, regionInput, provinceInput, cityInput];

            addressInputs.forEach(i => {
                if (sourceValues[i.id] !== undefined) {
                    i.value = sourceValues[i.id];
                }
                i.disabled = true;
            });
            editingAddressIdInput.value = '';

            regionInput.disabled = true;
            provinceInput.disabled = true;
            cityInput.disabled = true;
            if (addressEditContainer) {
                document.getElementById("addressTab").appendChild(addressEditContainer);
                addressEditContainer.style.display = 'none';
                document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
            }
        }

        editBtn.style.display = "inline-block";
        saveBtn.style.display = "none";
        cancelBtn.style.display = "none";

        if (onCancelExtra) onCancelExtra();
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            await onSave();

            await loadUserData();

            if (formId !== "addressForm") {
                inputs.forEach(i => i.disabled = true);

                if (formId === "emailForm" && currentEmailInput) {
                    currentEmailInput.value = "";
                }
                if (formId === "phoneForm" && currentPhoneInput) {
                    currentPhoneInput.value = "";
                }

            } else {
                barangayInput.disabled = true;
                houseNumberInput.disabled = true;
                regionInput.disabled = true;
                provinceInput.disabled = true;
                cityInput.disabled = true;

                if (addressEditContainer) {
                    document.getElementById("addressTab").appendChild(addressEditContainer);
                    addressEditContainer.style.display = 'none';
                    document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));
                }
            }

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

setupEditSaveCancel(
    "editEmailBtn",
    "saveEmailBtn",
    "cancelEmailBtn",
    [emailInput, newEmailInput, currentPasswordInput],
    "emailForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");

        const confirmEmail = currentEmailInput.value.trim();
        const newEmail = newEmailInput.value.trim();
        const currentPassword = currentPasswordInput.value;

        if (!confirmEmail || !newEmail || !currentPassword)
            throw new Error("All fields are required");

        if (confirmEmail !== user.email)
            throw new Error("The entered current email does not match your account email.");

        await reload(user);

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
        if (currentEmailInput) currentEmailInput.disabled = false;
    },
    () => {
        if (emailEditFields) emailEditFields.style.display = "none";
        if (emailInput) emailInput.disabled = true;
        if (currentEmailInput) currentEmailInput.value = "";
        if (newEmailInput) newEmailInput.value = "";
        if (currentPasswordInput) currentPasswordInput.value = "";
    }
);

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

setupEditSaveCancel(
    "editPhoneBtn",
    "savePhoneBtn",
    "cancelPhoneBtn",
    [phoneInput, newPhoneInput, currentPhonePasswordInput],
    "phoneForm",
    async () => {
        const user = auth.currentUser;
        if (!user) throw new Error("No account detected.");

        const confirmPhone = currentPhoneInput.value.trim();
        const newPhone = newPhoneInput.value.trim();
        const currentPassword = currentPhonePasswordInput.value;

        if (!confirmPhone || !newPhone || !currentPassword)
            throw new Error("All fields are required");

        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) throw new Error("User data not found.");
        const data = docSnap.data();

        
        if (confirmPhone !== data.phoneNumber) {
             throw new Error("The entered current phone number does not match your account's phone number.");
        }


        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        let newPhoneNumber = newPhone;
        if (newPhoneNumber.startsWith("09")) newPhoneNumber = "+63" + newPhoneNumber.slice(1);
        else if (!newPhoneNumber.startsWith("+63")) newPhoneNumber = "+63" + newPhoneNumber.replace(/[^0-9]/g, "").slice(-10);

        if (!recaptchaVerifierInitialized) {
            if (!recaptchaContainer) throw new Error("reCAPTCHA container not found.");
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
            recaptchaVerifierInitialized = true;
        }

        try {
            const confirmationResult = await signInWithPhoneNumber(auth, newPhoneNumber, window.recaptchaVerifier);
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
                        await updateDoc(docRef, { phoneNumber: newPhoneNumber });
                        otpPopup.style.display = "none";
                        showReLoginPopup("Phone number updated successfully! Please login again.");
                        resolve();
                    } catch (e) {
                        console.error("OTP confirmation error:", e);
                        showOtpError("Wrong OTP. Please try again.");
                        verifyOtpBtn.addEventListener('click', handleVerify);
                    }
                };

                verifyOtpBtn.addEventListener('click', handleVerify);
            });
        } catch (err) {
            console.error("OTP send error:", err);
            throw new Error("Failed to send OTP. Check phone number format or reCAPTCHA setup.");
        }
    },
    () => {
        if (phoneEditFields) phoneEditFields.style.display = "block";
        if (phoneInput) phoneInput.disabled = true;
        if (currentPhoneInput) {
            currentPhoneInput.disabled = false;
            currentPhoneInput.value = "";
            currentPhoneInput.placeholder = "Enter your current full phone number (e.g., +639XXXXXXXXX)";
        }
    },
    () => {
        if (phoneEditFields) phoneEditFields.style.display = "none";
        if (phoneInput) phoneInput.disabled = true;
        if (currentPhoneInput) {
            currentPhoneInput.value = "";
            currentPhoneInput.placeholder = "";
        }
        if (newPhoneInput) newPhoneInput.value = "";
        if (currentPhonePasswordInput) currentPhonePasswordInput.value = "";
    }
);

function formatAddress(data = {}) {
    // Add delivery fee to the address data object before passing it to formatAddress, 
    // or calculate it here if the data has the necessary info (barangay)
    const fee = data.barangay ? calculateDeliveryFee(data.barangay) : null;
    let addressParts = [data.houseNumber, data.barangay, data.city, data.province, data.region].filter(Boolean);
    
    // Append the delivery fee information to the formatted string
    if (fee !== null) {
        addressParts.push(`(Fee: ₱${fee})`);
    }

    return addressParts.join(", ");
}

function populateAddressForm(data, addressId) {
    if (editingAddressIdInput) editingAddressIdInput.value = addressId;

    houseNumberInput.value = data.houseNumber || "";
    barangayInput.value = data.barangay || "";
    cityInput.value = data.city || "";
    provinceInput.value = data.province || "";
    regionInput.value = data.region || "";

    currentAddressOriginalValues = {
        houseNumber: houseNumberInput.value,
        barangay: barangayInput.value,
        city: cityInput.value,
        province: provinceInput.value,
        region: regionInput.value,
        editingAddressId: editingAddressIdInput.value
    };

    houseNumberInput.disabled = false;
    barangayInput.disabled = false;

    houseNumberInput.removeAttribute('disabled');
    barangayInput.removeAttribute('disabled');

    regionInput.disabled = true;
    provinceInput.disabled = true;
    cityInput.disabled = true;

    document.getElementById("editAddressBtn").style.display = "none";
    document.getElementById("saveAddressBtn").style.display = "inline-block";
    document.getElementById("cancelAddressBtn").style.display = "inline-block";
}

function handleAddressEditClick(data, addressId, cardElement) {
    document.querySelectorAll('.address-card.active-edit').forEach(card => card.classList.remove('active-edit'));

    if (addressEditContainer && addressEditContainer.parentNode !== document.getElementById("addressTab")) {
        document.getElementById("addressTab").appendChild(addressEditContainer);
        addressEditContainer.style.display = "none";
    }

    document.getElementById("editAddressBtn").style.display = "none";
    if (addressEditContainer) {
        cardElement.appendChild(addressEditContainer);
        addressEditContainer.style.display = "block";
        cardElement.classList.add('active-edit'); // Add this line which was the end of Part 2
    }
    
    populateAddressForm(data, addressId);

    // Ensure save/cancel buttons are shown (part of your original logic)
    document.getElementById("saveAddressBtn").style.display = "inline-block";
    document.getElementById("cancelAddressBtn").style.display = "inline-block";
}


async function promoteAddressToDefault(savedAddressId, savedAddressData, defaultAddressData) {
    const user = auth.currentUser;
    if (!user) throw new Error("No account detected.");

    const userDocRef = doc(db, "users", user.uid);
    const savedAddressDocRef = doc(db, "users", user.uid, "addresses", savedAddressId);

    const newSavedAddressData = {
        houseNumber: defaultAddressData.houseNumber || "",
        barangay: defaultAddressData.barangay || "",
        city: defaultAddressData.city || "",
        province: defaultAddressData.province || "",
        region: defaultAddressData.region || "",
    };

    // Update the saved address with the old default address data
    await setDoc(savedAddressDocRef, newSavedAddressData);

    // Update the default address with the new data (from the saved address)
    await updateDoc(userDocRef, {
        houseNumber: savedAddressData.houseNumber,
        barangay: savedAddressData.barangay,
        city: savedAddressData.city,
        province: savedAddressData.province,
        region: savedAddressData.region,
        // Crucially, you must also update the deliveryFee if you save it to the user's root document
        deliveryFee: calculateDeliveryFee(savedAddressData.barangay) 
    });

    alert("Default Address updated successfully! The old default is now a saved address.");
    await loadUserData();
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
        let defaultAddressData = {};
        if (userSnap.exists()) {
            const userData = userSnap.data();
            defaultAddressData = {
                houseNumber: userData.houseNumber,
                barangay: userData.barangay,
                city: userData.city,
                province: userData.province,
                region: userData.region
            };

            const defaultFee = calculateDeliveryFee(userData.barangay); // Calculate fee
            const defaultAddressStr = formatAddress({ ...defaultAddressData, deliveryFee: defaultFee });

            if (defaultAddressStr) {
                const card = document.createElement("div");
                card.className = "address-card default-address-card";
                card.setAttribute('data-address-id', 'default');
                card.innerHTML = `
                    <div style="flex:1;">
                        <strong>Default Address </strong> <span style="color: #552915;">(Fee: ₱${defaultFee})</span><br>
                        <span class="addr-text">${formatAddress(defaultAddressData)}</span> 
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
                const fee = calculateDeliveryFee(data.barangay); // Calculate fee for saved address
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

        if (addressEditContainer && addressEditContainer.parentNode !== document.getElementById("addressTab")) {
            document.getElementById("addressTab").appendChild(addressEditContainer);
        }
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
            // Calculate and save the delivery fee
            deliveryFee: calculateDeliveryFee(barangayInput.value) 
        };

        const addressId = editingAddressIdInput.value;

        if (addressId === 'default') {
            await updateDoc(doc(db, "users", user.uid), {
                ...addressData
            });
            alert("Default Address updated successfully! (Barangay/House Number/Fee changed)");
        } else {
            // Update an existing saved address
            if (addressId) {
                await updateDoc(doc(db, "users", user.uid, "addresses", addressId), addressData);
                alert("Saved Address updated successfully! (Barangay/House Number/Fee changed)");
            } else {
                // Add a new saved address (assuming the logic is to add one if no ID is present, 
                // but your setup seems focused on editing the default or saved ones).
                // To ADD a new one, you'd use addDoc(collection(db, "users", user.uid, "addresses"), addressData);
                // For now, let's assume this save button is strictly for editing as per your provided logic.
                throw new Error("Cannot save: Unknown address ID. Please use the edit buttons.");
            }
        }

        await loadAddressesIntoAddressTab();
    },
    () => {
        // onEditExtra
        editingAddressIdInput.value = 'default';
        if (addressEditContainer) {
            document.getElementById("addressTab").appendChild(addressEditContainer);
        }
    },
    () => {
        // onCancelExtra
        editingAddressIdInput.value = '';
    }
);

if (addressEditContainer) {
    const closeAddressEditBtn = document.getElementById("closeAddressEditBtn");
    if (closeAddressEditBtn) {
        closeAddressEditBtn.addEventListener("click", () => {
            document.getElementById("cancelAddressBtn").click(); 
        });
    }
}

const logoutLink = document.querySelector('.logout a');
if (logoutLink) {
    logoutLink.addEventListener('click', (e) => {
        e.preventDefault();
        auth.signOut().then(() => {
            window.location.href = "login.html"; 
        }).catch((error) => {
            console.error("Logout Error:", error);
            alert("Failed to log out: " + error.message);
        });
    });
}
