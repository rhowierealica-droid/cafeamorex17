import { db } from './firebase-config.js';
import { doc, setDoc, getDocs, collection, deleteDoc, query, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==========================
// DOM Elements
// ==========================
const employeeForm = document.getElementById('employeeForm');
const employeeTableBody = document.querySelector('#employeeTable tbody');
const credentialsDiv = document.getElementById('credentials');
const FIXED_PASSWORD = "CafeAmoreX17";

const addBtn = document.getElementById('addEmployeeBtn');
const modal = document.getElementById('employeeModal');
const closeModal = document.querySelector('.close-modal');

const confirmModal = document.getElementById('confirmModal');
const confirmMessage = document.getElementById('confirmMessage');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');

let confirmAction = null; // function to execute when yes is clicked

// ==========================
// Modal Controls
// ==========================
addBtn.addEventListener('click', () => modal.style.display = 'flex');
closeModal.addEventListener('click', () => modal.style.display = 'none');
window.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
window.addEventListener('click', e => { if (e.target === confirmModal) confirmModal.style.display = 'none'; });

// ==========================
// Helper Functions
// ==========================
function sanitizeName(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function generateEmail(firstName, lastName) {
    const f = sanitizeName(firstName), l = sanitizeName(lastName);
    return `${f}.${l}${Math.floor(100 + Math.random() * 900)}@company.com`;
}

async function isEmailTaken(email) {
    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("email", "==", email));
        const snapshot = await getDocs(q);
        return !snapshot.empty;
    } catch (error) { console.error(error); return true; }
}

// ==========================
// Show Confirmation Modal
// ==========================
function showConfirm(message, action) {
    confirmMessage.textContent = message;
    confirmAction = action;
    confirmModal.style.display = 'flex';
}

// Handle Yes / No buttons
confirmYes.addEventListener('click', () => { 
    confirmModal.style.display='none'; 
    if(confirmAction) confirmAction(); 
});
confirmNo.addEventListener('click', () => { 
    confirmModal.style.display='none'; 
    confirmAction=null; 
});

// ==========================
// Create Employee
// ==========================
employeeForm.addEventListener('submit', async e => {
    e.preventDefault();
    const firstName = document.getElementById('firstName').value.trim();
    const lastName = document.getElementById('lastName').value.trim();
    const role = document.getElementById('role').value;

    let email = generateEmail(firstName, lastName);
    while (await isEmailTaken(email)) email = generateEmail(firstName, lastName);

    try {
        const newDocRef = doc(collection(db, "users"));
        await setDoc(newDocRef, { firstName, lastName, role, email, password: FIXED_PASSWORD, verified: true });
        credentialsDiv.innerHTML = `<strong>Employee Created!</strong><br>Email: ${email}<br>Password: ${FIXED_PASSWORD}`;
        employeeForm.reset();
        modal.style.display = 'none';
        loadEmployees();
    } catch (error) { 
        console.error(error); 
        alert("Error creating employee: " + error.message); 
    }
});

// ==========================
// Load Employees (only Bartender, Cashier, Driver)
// ==========================
async function loadEmployees() {
    employeeTableBody.innerHTML = "";
    const snapshot = await getDocs(collection(db, "users"));

    snapshot.forEach(docSnap => {
        const data = docSnap.data();

        // Only show specific roles
        if (["Bartender", "Cashier", "Driver"].includes(data.role)) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${data.firstName}</td>
                <td>${data.lastName}</td>
                <td>${data.role}</td>
                <td>${data.email}</td>
                <td>${data.password}</td>
                <td>
                    <button class="resetBtn" data-uid="${docSnap.id}">Reset Password</button>
                    <button class="deleteBtn" data-uid="${docSnap.id}">Delete</button>
                </td>
            `;
            employeeTableBody.appendChild(tr);
        }
    });

    // ==========================
    // Reset Password Button
    // ==========================
    document.querySelectorAll(".resetBtn").forEach(btn => {
        btn.addEventListener("click", () => {
            const uid = btn.getAttribute("data-uid");
            showConfirm(`Reset this employee's password to ${FIXED_PASSWORD}?`, async () => {
                try {
                    await updateDoc(doc(db, "users", uid), { password: FIXED_PASSWORD });
                    loadEmployees();
                } catch (err) { console.error(err); }
            });
        });
    });

    // ==========================
    // Delete Employee Button
    // ==========================
    document.querySelectorAll(".deleteBtn").forEach(btn => {
        btn.addEventListener("click", () => {
            const uid = btn.getAttribute("data-uid");
            showConfirm("Are you sure you want to delete this employee?", async () => {
                try {
                    await deleteDoc(doc(db, "users", uid));
                    loadEmployees();
                } catch (err) { console.error(err); }
            });
        });
    });
}

// ==========================
// Initial Load
// ==========================
loadEmployees();
