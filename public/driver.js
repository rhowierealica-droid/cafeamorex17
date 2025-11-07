import { db } from './firebase-config.js';
import {
    collection,
    onSnapshot,
    doc,
    updateDoc,
    serverTimestamp,
    getDocs,
    query,
    where,
    getDoc,
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"; 

const auth = getAuth();
const storage = getStorage(); 

let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;
let popupReceiptContent = null;
let currentDriverEmail = null; 

function injectPopupStyles() {
    if (document.getElementById("receipt-popup-style")) return;

    const style = document.createElement("style");
    style.id = "receipt-popup-style";
    style.textContent = `
    .popup {
      display: none;
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.55);
      z-index: 9999;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .popup-content {
      background: #fff8f0;
      color: #552915;
      border-radius: 12px;
      padding: 25px;
      width: 90%;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      max-height: 90vh; 
      overflow-y: auto; 
    }
    .popup-content h3 {
      margin-bottom: 15px;
      font-size: 1.2rem;
      color: #6f4e37; 
    }
    #popupButtonsContainer {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
      margin-top: 15px;
      border-top: 1px dashed #ccc;
      padding-top: 15px;
    }
    #popupButtonsContainer button, .print-receipt-btn, .view-proof-btn, .upload-proof-btn {
      background-color: #8b5e3c;
      color: #fff;
      border: none;
      padding: 10px 15px;
      border-radius: 8px;
      cursor: pointer;
      transition: 0.2s ease;
      width: 80%;
      font-weight: bold;
    }
    #popupButtonsContainer button:hover, .print-receipt-btn:hover, .view-proof-btn:hover, .upload-proof-btn:hover {
      background-color: #6d4428;
    }
    #popupReceiptContent {
        text-align: left;
        margin-top: 15px;
        padding-top: 5px;
        max-height: 350px; 
        overflow-y: auto;
    }
    #downloadReceiptBtn { background-color: #28a745; color: white; }
    #downloadReceiptBtn:hover { background-color: #1e7e34; }
    #closeAlertBtn, #closeReceiptBtn, #closeProofBtn { background-color: #6c757d; }
    #closeAlertBtn:hover, #closeReceiptBtn:hover, #closeProofBtn:hover { background-color: #5a6268; }
    
    /* MODIFICATION START: Use Flexbox for side-by-side buttons */
    .order-actions {
        display: flex; 
        gap: 10px; 
        flex-wrap: wrap;
        justify-content: center; /* Center the action buttons */
        padding-top: 10px;
    }
    /* Set equal width and margin for buttons in action area */
    .order-actions .print-receipt-btn, 
    .order-actions .view-proof-btn, 
    .order-actions .call-btn, 
    .order-actions .complete-btn { 
        width: calc(50% - 5px); /* Set to ~half width minus gap */
        margin-top: 0; /* Remove top margin that caused stacking */
        min-width: 130px; 
    }
    /* Ensure upload/complete button takes full width when alone */
    .order-actions .complete-btn { 
        width: 100%;
    }
    /* MODIFICATION END */
    
    #proofImageContainer img {
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        margin-top: 15px;
    }
    #uploadForm input[type="file"] {
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 6px;
        margin-bottom: 15px;
        width: 100%;
        box-sizing: border-box;
    }
    `;
    document.head.appendChild(style);
}
injectPopupStyles();

function createPopup() {
    popup = document.createElement("div");
    popup.className = "popup";
    popup.innerHTML = `
    <div class="popup-content">
      <h3 id="popupTitle">Title</h3>
      <div id="popupReceiptContent"></div>
      <div id="popupButtonsContainer"></div>
    </div>
  `;
    document.body.appendChild(popup);
    popupTitle = popup.querySelector("#popupTitle");
    popupButtonsContainer = popup.querySelector("#popupButtonsContainer");
    popupReceiptContent = popup.querySelector("#popupReceiptContent");

    popup.addEventListener("click", e => {
        if (e.target === popup) closePopup();
    });
}

function customAlert(message) {
    if (!popup) createPopup();
    popupReceiptContent.innerHTML = "";
    popup.style.display = "flex";
    popupTitle.textContent = "Notification";
    popupButtonsContainer.innerHTML = `<p style="margin-bottom: 10px;">${message}</p><button id="closeAlertBtn">Close</button>`;
    document.getElementById("closeAlertBtn").onclick = closePopup;
}

function closePopup() {
    if (popup) popup.style.display = "none";
}

function formatQueueNumber(num) {
    return typeof num === 'string' ? num : (num ? num.toString().padStart(4, "0") : "----");
}

function generateReceiptHTML(order) {
    const date = order.createdAt?.toDate() ? order.createdAt.toDate().toLocaleString() : new Date().toLocaleString();
    const orderItems = order.products || order.items || [];
    const productSubtotal = orderItems.reduce((sum, p) =>
        sum + (p.total || (((p.basePrice || 0) + (p.sizePrice || 0) + (p.addonsPrice || 0)) * (p.qty || p.quantity || 1)))
        , 0);
    const grandTotal = order.total || 0;
    const deliveryFee = order.deliveryFee || 0;

    let itemsHtml = orderItems.map(p => {
        const addons = p.addons?.length ? ` (+${p.addons.map(a => a.name).join(", ")})` : "";
        const sizeText = p.size ? (typeof p.size === "string" ? ` (${p.size})` : ` (${p.size.name})`) : "";
        const qty = p.qty || p.quantity || 1;
        const total = p.total || (((p.basePrice || 0) + (p.sizePrice || 0) + (p.addonsPrice || 0)) * qty);
        return `
      <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px;">
        <span style="flex-grow: 1;">${qty} x ${p.product || p.name}${sizeText}${addons}</span>
        <span>₱${total.toFixed(2)}</span>
      </div>
    `;
    }).join('');

    if (deliveryFee > 0) {
        itemsHtml += `
      <div style="font-weight: bold; font-size: 15px; margin-top: 10px; border-top: 1px dashed #aaa; padding-top: 5px;">
        Delivery Details:
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px;">
        <span style="flex-grow: 1;">Delivery Fee</span>
        <span>₱${deliveryFee.toFixed(2)}</span>
      </div>
    `;
    }

    return `
    <div style="width: 300px; padding: 20px; font-family: monospace; border: 1px solid #000; margin: 0 auto; background-color: #fff;">
      <h2 style="text-align: center; margin-bottom: 5px; font-size: 18px;">--- OFFICIAL RECEIPT ---</h2>
      <p style="text-align: center; font-size: 12px; margin-bottom: 15px;">Cafe Amore x17</p>
      <div style="font-size: 13px; border-bottom: 1px dashed #aaa; padding-bottom: 10px; margin-bottom: 10px;">
        <p>Order ID: ${order.id}</p>
        <p>Queue #: ${formatQueueNumber(order.queueNumber || order.queueNumberNumeric)}</p>
        <p>Date: ${date}</p>
        <p>Type: Delivery</p>
        <p>Status: ${order.status}</p>
        <p>Payment: ${order.paymentMethod || "N/A"}</p>
      </div>
      <div style="border-bottom: 1px dashed #aaa; padding-bottom: 10px; margin-bottom: 10px;">
        <div style="font-weight: bold; font-size: 15px; margin-bottom: 5px;">Items:</div>
        ${itemsHtml}
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin-bottom: 5px;">
        <span>SUBTOTAL (Products):</span>
        <span>₱${productSubtotal.toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; margin-top: 10px;">
        <span>GRAND TOTAL:</span>
        <span>₱${grandTotal.toFixed(2)}</span>
      </div>
      <div style="text-align: center; font-size: 12px; margin-top: 20px;">
        <p>Thank you for your order!</p>
        <p>Please come again.</p>
      </div>
    </div>
  `;
}

async function generateAndDownloadPDF(orderId, collectionName, orderData) {
    if (typeof html2pdf === 'undefined') {
        customAlert("PDF Library Missing: Please include 'html2pdf.bundle.min.js' in your HTML file.");
        return;
    }

    const content = generateReceiptHTML({ id: orderId, type: "Delivery", ...orderData });
    const element = document.createElement('div');
    element.innerHTML = content;

    const options = {
        margin: 10,
        filename: `receipt_Order_${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 3, logging: false },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
    };

    customAlert("Generating PDF receipt... Please wait.");
    document.body.appendChild(element);
    await html2pdf().set(options).from(element).save();
    document.body.removeChild(element);
    setTimeout(() => closePopup(), 1500);
}

async function showReceiptPopup(orderId, collectionName) {
    const orderRef = doc(db, collectionName, orderId);
    try {
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            customAlert(`Error: Order ${orderId} not found.`);
            return;
        }
        const orderData = orderSnap.data();
        const receiptHtml = generateReceiptHTML({ id: orderId, type: "Delivery", ...orderData });
        if (!popup) createPopup();
        popupTitle.textContent = `Receipt for Queue #${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}`;
        popupReceiptContent.innerHTML = receiptHtml;
        popupButtonsContainer.innerHTML = `
      <button id="downloadReceiptBtn" data-id="${orderId}" data-collection="${collectionName}">Download Receipt</button>
      <button id="closeReceiptBtn">Close</button>
    `;
        popup.style.display = "flex";
        document.getElementById("downloadReceiptBtn").onclick = () => generateAndDownloadPDF(orderId, collectionName, orderData);
        document.getElementById("closeReceiptBtn").onclick = closePopup;
    } catch (err) {
        console.error("Show Receipt Error:", err);
        customAlert("Failed to load order data for receipt.");
    }
}


async function showProofOfDeliveryPopup(orderId) {
    if (!popup) createPopup();
    popupTitle.textContent = `Upload Proof of Delivery`;
    popupReceiptContent.innerHTML = `
        <p style="text-align: center; margin-bottom: 15px;">Please upload an image (e.g., photo of the delivered item) before marking the order as completed.</p>
        <form id="uploadForm" style="display: flex; flex-direction: column; align-items: center;">
            <input type="file" id="proofImage" accept="image/*" required>
            <button type="submit" id="uploadProofBtn" class="upload-proof-btn" style="width: 100%;">Upload & Complete</button>
        </form>
    `;
    popupButtonsContainer.innerHTML = `<button id="closeProofBtn" style="background-color: #dc3545;">Cancel</button>`;
    popup.style.display = "flex";

    document.getElementById("closeProofBtn").onclick = closePopup;

    document.getElementById("uploadForm").onsubmit = async (e) => {
        e.preventDefault();
        const imageInput = document.getElementById("proofImage");
        const imageFile = imageInput.files[0];
        if (!imageFile) {
            customAlert("Please select an image file.");
            return;
        }

        if (!currentDriverEmail) {
            customAlert("Driver not logged in or email not found. Please re-login.");
            return;
        }

        const uploadBtn = document.getElementById("uploadProofBtn");

        uploadBtn.disabled = true;
        uploadBtn.textContent = "Uploading...";

        await uploadProofAndComplete(orderId, imageFile);
    };
}

async function uploadProofAndComplete(orderId, imageFile) {
    const uploadBtn = document.getElementById("uploadProofBtn");

    if (!uploadBtn) return;

    try {
        const storageRef = ref(storage, `proofs_of_delivery/${orderId}_${Date.now()}_${imageFile.name}`);

        await uploadBytes(storageRef, imageFile);

        const downloadURL = await getDownloadURL(storageRef);

        uploadBtn.textContent = "Mark as Completed";

        const proofDocRef = doc(collection(db, "DeliveryOrders", orderId, "proofsOfDelivery"));
        await setDoc(proofDocRef, {
            imageURL: downloadURL,
            uploadedBy: currentDriverEmail,
            uploadedAt: serverTimestamp(),
            fileName: imageFile.name
        });

        uploadBtn.textContent = "Finalizing...";
        await updateDoc(doc(db, "DeliveryOrders", orderId), {
            status: "Completed",
            proofOfDeliveryDocId: proofDocRef.id,
            proofOfDeliveryURL: downloadURL,
            completedAt: serverTimestamp()
        });

        closePopup();
        customAlert("Proof of Delivery uploaded and Order marked as Completed!");
    } catch (err) {
        console.error("Failed to upload proof and complete order:", err);
        customAlert(`Upload failed: ${err.message || "An unknown error occurred."} Please check your Firebase Storage Rules and Network connection.`);
    } finally {
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "Upload & Complete";
        }
    }
}

async function showProofImagePopup(orderId) {
    const orderRef = doc(db, "DeliveryOrders", orderId);
    let orderSnap;
    try {
        orderSnap = await getDoc(orderRef);
    } catch (e) {
        console.error("Error fetching order for proof:", e);
        customAlert("Failed to load order data.");
        return;
    }

    const orderData = orderSnap.data();
    const proofDocId = orderData.proofOfDeliveryDocId;

    if (!proofDocId) {
        customAlert("Proof of Delivery document ID not found for this order.");
        return;
    }

    const proofRef = doc(db, "DeliveryOrders", orderId, "proofsOfDelivery", proofDocId);
    const proofSnap = await getDoc(proofRef);

    if (!proofSnap.exists()) {
        customAlert("Proof of Delivery record not found in the subcollection.");
        return;
    }

    const proofData = proofSnap.data();
    const imageUrl = proofData.imageURL;
    const uploadedAt = proofData.uploadedAt?.toDate()?.toLocaleString() || 'N/A';
    const uploadedBy = proofData.uploadedBy || 'N/A';


    if (!popup) createPopup();
    popupTitle.textContent = `Proof of Delivery (Order #${orderData.queueNumber || 'N/A'})`;
    popupReceiptContent.innerHTML = `
        <p style="text-align: center;">Image proof uploaded:</p>
        <p style="text-align: center; font-size: 14px; margin-bottom: 5px;">
            <i class="fas fa-user"></i> By: <strong>${uploadedBy}</strong>
        </p>
        <p style="text-align: center; font-size: 14px; margin-bottom: 15px;">
            <i class="fas fa-clock"></i> At: ${uploadedAt}
        </p>
        <div id="proofImageContainer" style="text-align: center;">
            <img src="${imageUrl}" alt="Proof of Delivery Image">
        </div>
    `;
    popupButtonsContainer.innerHTML = `<button id="closeProofBtn">Close</button>`;
    popup.style.display = "flex";
    document.getElementById("closeProofBtn").onclick = closePopup;
}

// driver access

async function verifyDriverAccess() {
    try {
        return new Promise((resolve, reject) => {
            onAuthStateChanged(auth, async (user) => {
                let email = user ? user.email : sessionStorage.getItem("driverEmail");
                if (!email) {
                    window.location.href = "login.html"; 
                    return reject(false);
                }

                const q = query(
                    collection(db, "users"),
                    where("email", "==", email),
                    where("role", "==", "Driver")
                );
                const snapshot = await getDocs(q);
                if (snapshot.empty) {
                    sessionStorage.clear();
                    window.location.href = "login.html"; 
                    return reject(false);
                }
                const driverData = snapshot.docs[0].data();
                currentDriverEmail = email; 
                console.log("✅ Driver verified:", driverData.firstName, driverData.lastName);
                const nameEl = document.querySelector(".profile-name");
                if (nameEl) nameEl.textContent = `${driverData.firstName} ${driverData.lastName}`;
                resolve(true);
            });
        });
    } catch (error) {
        console.error("Error verifying driver access:", error);
        alert("Unable to verify driver access.");
        window.location.href = "login.html"; 
        return false;
    }
}


/**
 * @param {Date} date 
 * @returns {Date}
 */
function normalizeDateToStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**

 * @param {string} filterValue 
 * @param {string} customRange 
 * @returns {{start: Date|null, end: Date|null}}
 */
function getDateRange(filterValue, customRange) {
    const today = normalizeDateToStartOfDay(new Date());
    let start = null;
    let end = new Date(today);
    end.setDate(end.getDate() + 1); // Set end to the start of the next day

    switch (filterValue) {
        case 'today':
            start = today;
            break;
        case 'week':
            // Start of the current week (Sunday)
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay()); 
            break;
        case 'month':
            // Start of the current month
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'custom':
            if (customRange) {
                const parts = customRange.split(' to ');
                if (parts.length === 2) {
                    start = normalizeDateToStartOfDay(new Date(parts[0]));
                    // Set end to the start of the day AFTER the selected end date
                    end = normalizeDateToStartOfDay(new Date(parts[1]));
                    end.setDate(end.getDate() + 1); 
                }
            }
            break;
        case 'all':
        default:
            return { start: null, end: null };
    }

    if (start && isNaN(start.getTime())) start = null;
    if (end && isNaN(end.getTime())) end = null;

    return { start, end };
}

async function initializeDeliveryPage() {
    const allowed = await verifyDriverAccess();
    if (!allowed) return;

    const dateFilterSelect = document.getElementById('dateFilter');
    const customRangeInput = document.getElementById('customRange');
    const productFilterInput = document.getElementById('productFilter');

    if (typeof flatpickr !== 'undefined') {
        flatpickr(customRangeInput, {
            mode: "range",
            dateFormat: "Y-m-d",
            onReady: () => customRangeInput.style.display = 'none',
            onChange: () => renderOrders()
        });
    }


    dateFilterSelect.addEventListener('change', () => {
        customRangeInput.style.display = dateFilterSelect.value === 'custom' ? 'block' : 'none';
        customRangeInput.value = ''; 
        renderOrders();
    });

    productFilterInput.addEventListener('input', renderOrders);

    const ordersContainer = document.getElementById('ordersContainer');
    const tabButtons = document.querySelectorAll(".tabs .tab-btn");

    let selectedStatus = "Delivery"; 
    let allOrders = [];

    function calculateItemSubtotal(item) {
        if (item.total) return Number(item.total);
        const qty = Number(item.qty || item.quantity || 1);
        const basePrice = Number(item.basePrice || 0);
        const sizePrice = Number(item.sizePrice || 0);
        const addonsPrice = Number(item.addonsPrice || 0);
        return ((basePrice + sizePrice) * qty) + addonsPrice;
    }

    tabButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            tabButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectedStatus = btn.dataset.status;
            renderOrders();
        });
    });

    onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
        allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderOrders(); 
    });

    function renderOrders() {
        ordersContainer.innerHTML = "";

        const dateFilterValue = dateFilterSelect.value;
        const customRangeValue = customRangeInput.value;
        const productFilterText = productFilterInput.value.toLowerCase().trim();
        const { start: dateStart, end: dateEnd } = getDateRange(dateFilterValue, customRangeValue);

        let filtered = allOrders.filter(order => {
            if (order.status !== selectedStatus) return false;

            // Date Filter 
            if (dateStart && order.createdAt && order.createdAt.toDate) {
                const orderDate = order.createdAt.toDate();
                if (orderDate < dateStart || orderDate >= dateEnd) return false;
            }

            // Product Filter 
            if (productFilterText) {
                const items = order.items || [];
                const productMatch = items.some(item => 
                    (item.product && item.product.toLowerCase().includes(productFilterText)) ||
                    (item.name && item.name.toLowerCase().includes(productFilterText))
                );
                if (!productMatch) return false;
            }

            return true; 
        });

        if (selectedStatus === "Delivery") {
            filtered.sort((a, b) => (a.queueNumberNumeric || 0) - (b.queueNumberNumeric || 0));
        }

        if (!filtered.length) {
            ordersContainer.innerHTML = `<p>No ${selectedStatus.toLowerCase()} orders match the current filters.</p>`;
            return;
        }

        filtered.forEach(order => {
            const card = document.createElement("div");
            card.className = "order-card";

            const itemSubtotal = Array.isArray(order.items)
                ? order.items.reduce((sum, i) => sum + calculateItemSubtotal(i), 0)
                : 0;
            const deliveryFee = Number(order.deliveryFee || 0);
            const grandTotal = Number(order.total || (itemSubtotal + deliveryFee));

            const itemsHtml = Array.isArray(order.items)
                ? order.items.map(i => `<p>• ${i.qty || 1} x ${i.product}${i.size ? ` (${i.size})` : ""}</p>`).join("")
                : "<p>No items listed.</p>";

            let actionsHtml = "";

            if (order.status === "Delivery") {
                actionsHtml += `
            ${order.phoneNumber || order.customerPhone ? `
              <button class="call-btn" onclick="window.location.href='tel:${order.phoneNumber || order.customerPhone}'">
                <i class="fas fa-phone"></i> Call
              </button>` : ""}
            <button class="complete-btn" onclick="showProofOfDeliveryPopup('${order.id}')">
              <i class="fas fa-camera"></i> Upload Proof & Complete
            </button>`;
            } else if (order.status === "Completed" || order.status === "Completed by Customer") {
                // View Receipt (Left)
                actionsHtml += `
                <button class="print-receipt-btn" onclick="showReceiptPopup('${order.id}', 'DeliveryOrders')">
                    <i class="fas fa-receipt"></i> View Receipt
                </button>`; 
                
                // View Proof of Delivery (Right)
                if (order.proofOfDeliveryDocId) {
                    actionsHtml += `
                    <button class="view-proof-btn" onclick="showProofImagePopup('${order.id}')">
                        <i class="fas fa-image"></i> View Proof of Delivery
                    </button>`; 
                }
            }

            card.innerHTML = `
          <div class="order-card-wrapper">
            <span class="queue-number">#${order.queueNumber || "N/A"}</span>
            <div class="header-info">
              <p>Customer: <strong>${order.customerName || "N/A"}</strong></p>
              <p>Payment: <strong>${order.paymentMethod || "N/A"}</strong></p>
              <p>Total: <strong>₱${grandTotal.toFixed(2)}</strong></p>
            </div>
            <span class="expand-arrow"><i class="fas fa-chevron-down"></i></span>
          </div>

          <div class="order-products">
            <h4>Delivery Details</h4>
            <p><strong>Address:</strong> ${order.address || "N/A"}</p>
            <p><strong>Phone:</strong> ${order.phoneNumber || order.customerPhone || "N/A"}</p>

            <h4>Order Items</h4>
            ${itemsHtml}

            <div class="price-summary">
              <p><span>Price (Items):</span> <span>₱${itemSubtotal.toFixed(2)}</span></p>
              <p><span>Delivery Fee:</span> <span>₱${deliveryFee.toFixed(2)}</span></p>
              <h4><span>Grand Total:</span> <span>₱${grandTotal.toFixed(2)}</span></h4>
            </div>
          </div>

          <div class="order-actions">${actionsHtml}</div>
        `;

            card.querySelector(".order-card-wrapper").addEventListener("click", () => {
                card.classList.toggle("expanded");
            });

            ordersContainer.appendChild(card);
        });
    }
    

    window.showProofOfDeliveryPopup = showProofOfDeliveryPopup; 
    window.showProofImagePopup = showProofImagePopup; 
    window.showReceiptPopup = showReceiptPopup;

    const logoutBtn = document.querySelector(".logout");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async () => {
            try {
                await signOut(auth);
            } catch (err) {
                console.warn("No Firebase session found:", err.message);
            }
            sessionStorage.clear();
            window.location.href = "login.html";
        });
    }
}

initializeDeliveryPage();
