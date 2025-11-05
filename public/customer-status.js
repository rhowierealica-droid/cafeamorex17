import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, updateDoc, arrayUnion, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const orderItemsDiv = document.getElementById("order-items");
const tabs = document.querySelectorAll(".tabs .tab-btn");

const dateFilterSelect = document.getElementById("dateFilter");
const customRangeInput = document.getElementById("customRange");
const productFilterInput = document.getElementById("productFilter");
const filterSection = document.querySelector(".filter-section");

let currentTab = "Waiting for Payment";

const auth = getAuth();
let currentUser = null;
let currentUserEmail = null; // Stored user email
let unsubscribeOrders = null;
let dateRangeInstance = null; 

function timestampToDate(timestamp) {
    if (!timestamp || !timestamp.seconds) return null;
    return new Date(timestamp.seconds * 1000);
}

// Filter
function isDateInRange(date, start, end) {
    if (!date) return true;
    const time = date.getTime();
    return time >= start.getTime() && time <= end.getTime();
}

let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;
let popupReceiptContent = null; 

function injectPopupStyles() {
    const style = document.createElement("style");
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
    #popupButtonsContainer button {
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
    #popupButtonsContainer button:hover {
      background-color: #6d4428;
    }
    #popupReceiptContent {
        text-align: left;
        margin-top: 15px;
        padding-top: 5px;
        max-height: 350px; 
        overflow-y: auto;
    }
    .print-receipt-btn { 
        background-color: #007bff; 
        color: white; 
        margin-top: 5px;
        padding: 8px 15px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
    }
    .print-receipt-btn:hover { 
        background-color: #0056b3; 
    }
    #downloadReceiptBtn { background-color: #28a745; color: white; }
    #downloadReceiptBtn:hover { background-color: #1e7e34; }
    #closeAlertBtn, #closeReceiptBtn { background-color: #6c757d; }
    #closeAlertBtn:hover, #closeReceiptBtn:hover { background-color: #5a6268; }

    /* --- Feedback/Refund Modal Styles --- */
    .modal {
        position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.7); display: none;
        justify-content: center; align-items: center; z-index: 10000;
    }
    .modal-content {
        background: white; padding: 25px; border-radius: 8px; max-width: 90%; max-height: 90vh; overflow-y: auto; position: relative;
    }
    .close-btn { position: absolute; top: 10px; right: 20px; font-size: 24px; cursor: pointer; }
    .feedback-item { 
        border: 1px solid #ddd; 
        padding: 15px; 
        margin-bottom: 15px; 
        border-radius: 8px;
        background-color: #f9f9f9;
        text-align: left;
    }
    .feedback-item h4 { margin-top: 0; }
    .star-rating { 
        font-size: 24px; 
        color: gold; 
        margin-bottom: 10px;
    }
    .star { 
        cursor: pointer; 
        transition: color 0.2s; 
        margin-right: 5px;
        color: #ccc; /* Default color before selection */
    }
    .star[data-selected="1"] { 
        color: gold;
    }
    .feedback-item textarea {
        width: 100%;
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-sizing: border-box;
        resize: vertical;
    }
    .refund-item { margin-bottom: 10px; }
    .refund-item label { display: block; }
    /* ------------------------------------------------------------------- */
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
    if (popup) {
        popup.style.display = "none";
    }
}

function formatQueueNumber(num) {
    return typeof num === 'string' ? num : (num ? num.toString().padStart(4, "0") : "----");
}



// Filter
function calculateDateRange(filterValue, customRange) {
    const now = new Date();
    let start = new Date(0); 
    let end = new Date(8640000000000000); // Max Date

    if (filterValue === 'today') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start.setHours(0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (filterValue === 'week') {
        const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0, Sun=6
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        start.setHours(0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek));
        end.setHours(23, 59, 59, 999);
    } else if (filterValue === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of month
        end.setHours(23, 59, 59, 999);
    } else if (filterValue === 'year') {
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (filterValue === 'custom' && customRange) {
        const [startDateStr, endDateStr] = customRange.split(" to ");
        if (startDateStr) start = new Date(startDateStr);
        if (endDateStr) end = new Date(endDateStr);
        if (end && !endDateStr) end.setHours(23, 59, 59, 999);
    }

    return { start, end };
}


// custom date range
function initializeDateRange() {
    if (typeof flatpickr !== 'undefined' && customRangeInput) {
        if (dateRangeInstance) {
            dateRangeInstance.destroy();
        }
        dateRangeInstance = flatpickr(customRangeInput, {
            mode: "range",
            dateFormat: "Y-m-d",
            onClose: listenOrders,
            altInput: true,
            altFormat: "F j, Y",
            placeholder: "Select date range"
        });
        //hide the Flatpickr input elements until "Custom" is selected
        customRangeInput.style.display = "none";
        if (dateRangeInstance.altInput) dateRangeInstance.altInput.style.display = "none";
    }
}
initializeDateRange();

if (dateFilterSelect) {
    dateFilterSelect.addEventListener("change", () => {
        if (dateFilterSelect.value === "custom") {
            if (dateRangeInstance && dateRangeInstance.altInput) dateRangeInstance.altInput.style.display = "inline-block";
        } else {
            // Hide input when not custom
            if (dateRangeInstance && dateRangeInstance.altInput) dateRangeInstance.altInput.style.display = "none";
            listenOrders();
        }
    });
}

if (productFilterInput) {
    productFilterInput.addEventListener("input", listenOrders);
}

onAuthStateChanged(auth, user => {
    currentUser = user;
    if (user) {
        currentUserEmail = user.email?.toLowerCase(); // Save user email
        tabs.forEach(t => {
            if (t.dataset.status === currentTab) {
                t.classList.add("active");
            } else {
                t.classList.remove("active");
            }
        });
        
        const filterableTabs = ["To Receive", "To Rate", "Completed", "Canceled", "Refund"];
        if (filterSection && !filterableTabs.includes(currentTab)) filterSection.style.display = "none";

        listenOrders();
    } else {
        window.location.href = "login.html"; 
    }
});

tabs.forEach(tab => {
    tab.addEventListener("click", () => {
        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        currentTab = tab.dataset.status;
        listenOrders();
    });
});

function listenOrders() {
    if (!currentUser) return;
    if (unsubscribeOrders) unsubscribeOrders();

    console.log("Listening for orders for:", currentUser.uid, "Email:", currentUserEmail);

    const filterableTabs = ["To Receive", "To Rate", "Completed", "Canceled", "Refund"];
    if (filterSection) {
        if (filterableTabs.includes(currentTab)) {
            filterSection.style.display = "flex";
        } else {
            filterSection.style.display = "none";
        }
    }
    
    const dateFilterValue = dateFilterSelect ? dateFilterSelect.value : 'all';
    const customRangeValue = dateFilterValue === 'custom' ? (customRangeInput ? customRangeInput.value : '') : '';
    const dateRange = calculateDateRange(dateFilterValue, customRangeValue);
    const productSearchTerm = productFilterInput ? productFilterInput.value.trim().toLowerCase() : '';

    unsubscribeOrders = onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
        const userOrders = [];

        snapshot.forEach(docSnap => {
            const order = docSnap.data();
            const isMatch = order.userId === currentUser.uid;

            if (isMatch) {
                userOrders.push({ id: docSnap.id, ...order });
            }
        });

        orderItemsDiv.innerHTML = "";

        const filteredOrders = userOrders.filter(order => {
            const status = (order.status || "").toLowerCase();
            const tab = (currentTab || "").toLowerCase();
            const finalRefundStatus = (order.finalRefundStatus || "").toLowerCase();

            let statusMatch = false;
            if (tab === "waiting for payment") statusMatch = status === "waiting for payment";
            // Corrected: Order must be marked 'Completed by Customer' but not have feedback yet
            else if (tab === "to rate") statusMatch = status === "completed by customer" && !order.feedback;
            // Corrected: Order must be marked 'Completed' (by staff) but not yet marked as received by customer, and no refund request
            else if (tab === "to receive") statusMatch = status === "completed" && !order.refundRequest; 
            // Corrected: Order must be fully 'Completed' (by customer) and have feedback
            else if (tab === "completed") statusMatch = status === "completed by customer" && order.feedback; 
            // FIX: Added 'refunded' and the typo 'refundend' to statusMatch for the Refund tab
            else if (tab === "refund") statusMatch = order.refundRequest || ["succeeded", "manual", "failed", "denied", "refund pending"].includes(finalRefundStatus) || status === "refunded" || status === "refundend";
            else statusMatch = status === tab;
            
            if (!statusMatch) return false;

            // Filter by Date 
            if (filterableTabs.includes(currentTab) && dateFilterValue !== 'all') {
                const orderDate = timestampToDate(order.createdAt);
                if (!isDateInRange(orderDate, dateRange.start, dateRange.end)) {
                    return false;
                }
            }
            // 3. Filter by Product Name 
            if (filterableTabs.includes(currentTab) && productSearchTerm) {
                const itemMatch = order.items?.some(p => {
                    const productName = (p.product || p.name || "").toLowerCase();
                    return productName.includes(productSearchTerm);
                });
                if (!itemMatch) return false;
            }

            return true;
        });

        if (filteredOrders.length === 0) {
            orderItemsDiv.innerHTML = "<p>No orders found in this category.</p>";
            return;
        }

        filteredOrders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        filteredOrders.forEach(order => {
            const orderContainer = document.createElement("div");
            orderContainer.className = "user-order-card";

            const orderHeader = document.createElement("div");
            orderHeader.className = "order-header";

            const orderTitle = document.createElement("h3");
            let titleText = `Order #${formatQueueNumber(order.queueNumber || order.queueNumberNumeric || "N/A")} - Status: ${order.status || "Unknown"}`;
            if (order.estimatedTime) titleText += ` | ETA: ${order.estimatedTime}`;
            // if (currentTab === "Refund" || order.finalRefundStatus) titleText += ` | Refund: ${order.finalRefundStatus || order.refundStatus || "Refund"}`;
            orderTitle.textContent = titleText;

            orderHeader.appendChild(orderTitle);
            orderContainer.appendChild(orderHeader);

            const itemsContainer = document.createElement("div");
            itemsContainer.className = "order-items-container";

            order.items?.forEach(p => {
                if (!p) return;
                const qty = p.qty || p.quantity || 1;
                const productName = p.product || p.name || "Unknown Product";
                const size = p.size || "Medium";
                const sizePrice = p.sizePrice || 0;
                const addonsText = (p.addons && p.addons.length > 0)
                    ? p.addons.map(a => `${a.name}: ₱${(a.price || 0).toFixed(2)}`).join(", ")
                    : "No add-ons";
                const addonsPrice = p.addonsPrice || 0;
                const totalPrice = (p.total || ((p.basePrice || 0) + (sizePrice || 0) + (addonsPrice || 0)) * qty) || 0;

                const div = document.createElement("div");
                div.classList.add("order-item-card");
                div.innerHTML = `
                    ${p.image ? `<img src="${p.image}" alt="${productName}" style="width:60px;height:60px;object-fit:cover;margin-right:10px;border-radius:6px;">` : ""}
                    <div>
                        <h4>${productName} (${size}) x${qty} - ₱${totalPrice.toFixed(2)}</h4>
                        <p>Add-ons: ${addonsText} (₱${addonsPrice.toFixed(2)})</p>
                    </div>
                `;
                itemsContainer.appendChild(div);
            });

            // Display Delivery Fee
            const deliveryFee = Number(order.deliveryFee || 0);
            if (deliveryFee > 0) {
                const feeDiv = document.createElement("div");
                feeDiv.classList.add("order-fee");
                feeDiv.innerHTML = `<p style="text-align:right; font-weight:bold;">Delivery Fee: ₱${deliveryFee.toFixed(2)}</p>`;
                itemsContainer.appendChild(feeDiv);
            }

            // Calculate and display Grand Total
            const orderTotal = Number(order.total || 0); 
            const calculatedTotal = (order.items?.reduce((sum, p) => sum + (p.total || 0), 0) || 0) + deliveryFee;
            const finalTotal = orderTotal > 0 ? orderTotal : calculatedTotal; 

            const totalDiv = document.createElement("div");
            totalDiv.classList.add("order-total");
            totalDiv.innerHTML = `<h3>Grand Total: ₱${finalTotal.toFixed(2)}</h3>`;
            itemsContainer.appendChild(totalDiv);

            const paymentMethod = (order.paymentMethod || "").toLowerCase();

            const isFinalState = ["Completed", "Completed by Customer", "Canceled", "Refunded", "Refund Denied", "Refund Failed", "Refundend"].includes(order.status);


            if (currentTab === "Waiting for Payment") {
                if (order.checkoutUrl) {
                    const paymentBtn = document.createElement("button");
                    paymentBtn.textContent = "Complete Payment (Gcash)";
                    paymentBtn.className = "action-btn paymongo-btn";
                    paymentBtn.style.backgroundColor = "#28a745";

                    paymentBtn.addEventListener("click", () => {
                        console.log(`Redirecting to PayMongo Checkout: ${order.checkoutUrl}`);
                        window.location.href = order.checkoutUrl; 
                    });
                    itemsContainer.appendChild(paymentBtn);
                } else {
                    const statusDiv = document.createElement("div");
                    statusDiv.innerHTML = "<p style='color:#dc3545; font-weight:bold;'>Error: No payment URL found. Contact support.</p>";
                    itemsContainer.appendChild(statusDiv);
                }

                const cancelBtn = document.createElement("button");
                cancelBtn.textContent = "Cancel Order";
                cancelBtn.className = "action-btn cancel-refund-btn";
                cancelBtn.addEventListener("click", () => handleCancelOrder(order.id, order.items));
                itemsContainer.appendChild(cancelBtn);
            }

            if (currentTab === "Pending") {
                // If payment is e-payment allow refund request
                if (paymentMethod.includes("e-payment") || paymentMethod === "g" || paymentMethod === "gcash") {
                    const btn = document.createElement("button");
                    btn.textContent = order.refundRequest ? `Refund: ${order.refundStatus || "Requested"}` : "Request Refund";
                    btn.disabled = !!order.refundRequest;
                    btn.className = "action-btn cancel-refund-btn";
                    btn.style.backgroundColor = order.refundRequest ? "#ccc" : "#dc3545"; // Red for refund, unless requested
                    btn.style.cursor = order.refundRequest ? "not-allowed" : "pointer";
                    if (!order.refundRequest) {
                        btn.addEventListener("click", () => openRefundModal(order.id, order.items));
                    }
                    itemsContainer.appendChild(btn);
                } else if (paymentMethod === "cash" || paymentMethod === "c") {
                    const btn = document.createElement("button");
                    btn.textContent = "Cancel";
                    btn.className = "action-btn cancel-refund-btn";
                    btn.addEventListener("click", () => handleCancelOrder(order.id, order.items));
                    itemsContainer.appendChild(btn);
                }
            }

            if (currentTab === "To Receive") {
                // Refund request logic for "To Receive"
                if (paymentMethod.includes("e-payment") || paymentMethod === "g" || paymentMethod === "gcash") {
                    const refundBtn = document.createElement("button");
                    refundBtn.textContent = order.refundRequest ? `Refund: ${order.refundStatus || "Requested"}` : "Request Refund";
                    refundBtn.disabled = !!order.refundRequest;
                    refundBtn.className = "action-btn cancel-refund-btn";
                    refundBtn.style.backgroundColor = order.refundRequest ? "#ccc" : "#dc3545";
                    refundBtn.style.cursor = order.refundRequest ? "not-allowed" : "pointer";
                    if (!order.refundRequest) {
                        refundBtn.addEventListener("click", () => openRefundModal(order.id, order.items));
                    }
                    itemsContainer.appendChild(refundBtn);
                }

                const receivedBtn = document.createElement("button");
                receivedBtn.textContent = "Received Order";
                receivedBtn.className = "action-btn";
                receivedBtn.addEventListener("click", () => showConfirmModal(order.id));
                itemsContainer.appendChild(receivedBtn);
            }

            if (currentTab === "To Rate") {
                if (order.status === "Completed by Customer" && !order.feedback) {
                    const btn = document.createElement("button");
                    btn.textContent = "Leave Feedback";
                    btn.className = "action-btn";
                    btn.addEventListener("click", () => openFeedbackModal(order.id, order.items));
                    itemsContainer.appendChild(btn);
                }
            }

           /* if (currentTab === "Refund") {
                const refundBtn = document.createElement("button");
                refundBtn.textContent = order.finalRefundStatus || order.refundStatus || "Requested";
                refundBtn.disabled = true;
                refundBtn.className = "action-btn";
                refundBtn.style.cursor = "not-allowed";

                if (order.finalRefundStatus === "Pending" || order.refundStatus === "Requested") refundBtn.style.backgroundColor = "orange";
                else if (order.finalRefundStatus === "Succeeded" || order.finalRefundStatus === "Manual") refundBtn.style.backgroundColor = "green";
                else if (order.finalRefundStatus === "Denied" || order.finalRefundStatus === "Failed" || order.finalRefundStatus === "API Failed") refundBtn.style.backgroundColor = "red";
                else refundBtn.style.backgroundColor = "#ccc";

                itemsContainer.appendChild(refundBtn);
            }
                */
            
            // Print Receipt button to completed
            if (isFinalState || order.status === "Completed by Customer" || (order.status === "Completed" && order.feedback) ) {
                const printButton = document.createElement("button");
                printButton.textContent = "View Receipt";
                printButton.className = "print-receipt-btn";
                printButton.dataset.id = order.id;
                printButton.dataset.collection = "DeliveryOrders";
                printButton.addEventListener("click", () => showReceiptPopup(order.id, "DeliveryOrders"));
                itemsContainer.appendChild(printButton);
            }


            orderContainer.appendChild(itemsContainer);
            orderItemsDiv.appendChild(orderContainer);
        });
    });
}

// RECEIPT FUNCTIONS

function generateReceiptHTML(order) {
    const date = order.createdAt ? timestampToDate(order.createdAt).toLocaleString() : (order.timestamp ? new Date(order.timestamp).toLocaleString() : new Date().toLocaleString());
    const orderItems = order.products || order.items || [];
    const productSubtotal = orderItems.reduce((sum, p) =>
        sum + (p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * (p.qty || p.quantity || 1))
    , 0);
    const grandTotal = order.total || 0;
    const deliveryFee = order.deliveryFee || 0;

    let itemsHtml = orderItems.map(p => {
        const addons = p.addons?.length ? ` (+${p.addons.map(a => a.name).join(", ")})` : "";
        const sizeText = p.size ? (typeof p.size === "string" ? ` (${p.size})` : ` (${p.size.name})`) : "";
        const qty = p.qty || p.quantity || 1;
        const total = p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty;

        return `
            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px;">
                <span style="flex-grow: 1;">${qty} x ${p.product || p.name}${sizeText}${addons}</span>
                <span>₱${total.toFixed(2)}</span>
            </div>
        `;
    }).join('');

    // Delivery Fee
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
        <div style="width: 300px; padding: 20px; font-family: monospace; border: 1px solid #000; margin: 0 auto;">
            <h2 style="text-align: center; margin-bottom: 5px; font-size: 18px;">--- OFFICIAL RECEIPT ---</h2>
            <p style="text-align: center; font-size: 12px; margin-bottom: 15px;">Cafe Amore x17</p>

            <div style="font-size: 13px; border-bottom: 1px dashed #aaa; padding-bottom: 10px; margin-bottom: 10px;">
                <p>Order ID: ${order.id}</p>
                <p>Queue #: ${formatQueueNumber(order.queueNumber || order.queueNumberNumeric)}</p>
                <p>Date: ${date}</p>
                <p>Type: Delivery</p>
                <p>Status: ${order.status}</p>
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

// PDF generation
async function generateAndDownloadPDF(orderId, collectionName, orderData) {
    if (typeof html2pdf === 'undefined') {
        customAlert("PDF Library Missing: Please include 'html2pdf.bundle.min.js' in your HTML file to enable PDF printing.");
        return;
    }

    const content = generateReceiptHTML({ id: orderId, type: "Delivery", ...orderData });
    const element = document.createElement('div');
    element.innerHTML = content;

    const options = {
        margin: 10,
        filename: `receipt_Order_${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 3, logging: false, dpi: 192, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
    };

    customAlert("Generating PDF receipt... Please wait.");
    await html2pdf().set(options).from(element).save();

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
            <button id="downloadReceiptBtn" data-id="${orderId}" data-collection="${collectionName}">Download Receipt (PDF)</button>
            <button id="closeReceiptBtn">Close</button>
        `;
        popup.style.display = "flex";

        document.getElementById("downloadReceiptBtn").onclick = () => {
            generateAndDownloadPDF(orderId, collectionName, orderData);
        };

        document.getElementById("closeReceiptBtn").onclick = closePopup;

    } catch (err) {
        console.error("Show Receipt Error:", err);
        customAlert("Failed to load order data for receipt.");
    }
}

async function returnItemsToInventory(orderItems) {
    if (!orderItems || orderItems.length === 0) return;
    const inventoryUpdates = {};

    for (const item of orderItems) {
        if (!item) continue;
        const productQtyOrdered = item.qty || item.quantity || 1;
        if (productQtyOrdered <= 0) continue;

        const aggregateItem = (id, consumptionPerProduct) => {
            if (!id) return;
            const totalConsumption = (consumptionPerProduct || 1) * productQtyOrdered;
            inventoryUpdates[id] = (inventoryUpdates[id] || 0) + totalConsumption;
        };
        
        // --- START OF SECOND PART ---
        aggregateItem(item.sizeId, item.sizeQty || 1);
        item.ingredients?.forEach(ing => aggregateItem(ing.id, ing.qty || 1));
        item.addons?.forEach(addon => aggregateItem(addon.id, addon.qty || 1));
        item.others?.forEach(other => aggregateItem(other.id, other.qty || 1));
    }

    const batch = writeBatch(db);
    const inventoryCollection = collection(db, "Inventory");

    for (const [inventoryId, qtyToReturn] of Object.entries(inventoryUpdates)) {
        const inventoryRef = doc(inventoryCollection, inventoryId);
        try {
            const inventorySnap = await getDoc(inventoryRef);
            if (inventorySnap.exists()) {
                const currentQuantity = inventorySnap.data().quantity || 0;
                batch.update(inventoryRef, { quantity: currentQuantity + qtyToReturn });
                console.log(`Returned ${qtyToReturn} units to Inventory ID: ${inventoryId}`);
            } else {
                console.warn(`Inventory item ${inventoryId} not found. Skipping stock return.`);
            }
        } catch (error) {
            console.error(`Error fetching inventory item ${inventoryId}:`, error);
        }
    }

    await batch.commit();
    console.log("✅ All items returned to inventory successfully.");
}

// --- Customer Action Functions ---

async function handleCancelOrder(orderId, orderItems) {
    if (!confirm("Are you sure you want to cancel this order? Stock will be returned.")) return;

    try {
        await returnItemsToInventory(orderItems);
        await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Canceled" });

        alert("✅ Order canceled successfully and stock returned.");
        listenOrders();
    } catch (err) {
        console.error("Error canceling order:", err);
        alert("❌ Failed to cancel order. Please try again.");
    }
}

function showConfirmModal(orderId) {
    const existingModal = document.querySelector(".modal");
    if(existingModal) existingModal.remove(); 

    const confirmModal = document.createElement("div");
    confirmModal.className = "modal";
    confirmModal.style.display = "flex";

    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";
    modalContent.innerHTML = `
        <h2>Confirm Order Received</h2>
        <p>This action is irreversible and marks the order as complete. You will then be able to leave feedback.</p>
        <div style="margin-top:20px; display:flex; justify-content:center; gap:15px;">
            <button id="confirm-yes" class="action-btn">Yes, I Received It</button>
            <button id="confirm-no" class="action-btn" style="background:#ccc;color:#333;">Not Yet</button>
        </div>
    `;
    confirmModal.appendChild(modalContent);
    document.body.appendChild(confirmModal);

    const closeModal = () => confirmModal.remove();

    modalContent.querySelector("#confirm-yes").onclick = async () => {
        try {
            // Update status to mark as received by customer, preparing for "To Rate"
            await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Completed by Customer" });
            closeModal();
            // Automatically switch to the "To Rate" tab
            currentTab = "To Rate";
            tabs.forEach(t => t.classList.remove("active"));
            // This line assumes you have a tab button with data-status="To Rate"
            const toRateTab = document.querySelector(`.tab-btn[data-status="To Rate"]`);
            if(toRateTab) toRateTab.classList.add("active");
            listenOrders();
        } catch (error) {
            console.error("Error confirming order:", error);
            alert("Failed to confirm order receipt. Please try again.");
        }
    };

    modalContent.querySelector("#confirm-no").onclick = closeModal;
    confirmModal.addEventListener("click", e => { if (e.target === confirmModal) closeModal(); });
}

function openRefundModal(orderId, orderItems) {
    // NOTE: This assumes a static modal structure with id="refund-modal" in the HTML.
    // If not present, this will alert the user.
    const modal = document.getElementById("refund-modal"); 
    if (!modal) {
        alert("Refund modal structure (id='refund-modal') not found in HTML. Check your HTML file.");
        return;
    }
    const refundForm = modal.querySelector("#refund-form");
    const refundItemsDiv = modal.querySelector("#refund-items");

    refundItemsDiv.innerHTML = "";
    let totalRefundable = 0;

    orderItems.forEach((item, index) => {
        if (!item) return;
        const productName = item.product || item.name || "Unknown Product";
        const qty = item.qty || item.quantity || 1;
        const size = item.size || "Medium";
        const totalPrice = item.total || (((item.sizePrice || 0) + (item.addonsPrice || 0)) * qty); 
        totalRefundable += totalPrice;

        const div = document.createElement("div");
        div.className = "refund-item";
        div.innerHTML = `
            <label>
                <input type="checkbox" name="refund" value="${index}">
                ${productName} (${size}) x${qty} - ₱${totalPrice.toFixed(2)}
            </label>
        `;
        refundItemsDiv.appendChild(div);
    });

    modal.querySelector("#total-refundable").textContent = `Total Refundable: ₱${totalRefundable.toFixed(2)}`;

    modal.style.display = "flex";

    modal.querySelector(".close-btn").onclick = () => modal.style.display = "none";
    modal.onclick = e => { if (e.target === modal) modal.style.display = "none"; }

    refundForm.onsubmit = async (e) => {
        e.preventDefault();
        const selectedIndexes = Array.from(refundForm.querySelectorAll('input[name="refund"]:checked')).map(input => parseInt(input.value));
        if (selectedIndexes.length === 0) {
            alert("Please select at least one product to refund.");
            return;
        }
        const selectedItems = selectedIndexes.map(i => orderItems[i]);

        const refundAmount = selectedItems.reduce((sum, item) => 
            sum + (item.total || (((item.sizePrice || 0) + (item.addonsPrice || 0)) * (item.qty || item.quantity || 1)))
        , 0);

        try {
            await updateDoc(doc(db, "DeliveryOrders", orderId), {
                refundRequest: true,
                refundStatus: "Requested",
                refundAmount: refundAmount,
                refundItems: selectedItems
            });
            alert("Refund request submitted. Waiting for admin approval.");
            modal.style.display = "none";
            listenOrders();
        } catch (err) {
            console.error("Error submitting refund:", err);
            alert("Failed to submit refund. Please try again.");
        }
    };
}

function openFeedbackModal(orderId, items) {
    const existingModal = document.querySelector("#feedback-dynamic-modal");
    if(existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.id = "feedback-dynamic-modal";
    modal.style.display = "flex";

    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";
    
    const closeBtn = document.createElement("span");
    closeBtn.className = "close-btn";
    closeBtn.innerHTML = "&times;";
    closeBtn.onclick = () => modal.remove();

    const form = document.createElement("form");
    form.id = "feedback-form";

    const feedbackItemsDiv = document.createElement("div");
    feedbackItemsDiv.id = "feedback-items-container";
    
    form.onsubmit = null; 

    items.forEach((item) => {
        if (!item) return;
        const productName = item.product || item.name || "Unknown Product";

        const itemDiv = document.createElement("div");
        itemDiv.className = "feedback-item";

        const stars = Array.from({ length: 5 }, (_, i) => `<span class="star" data-value="${i + 1}" data-selected="0">&#9734;</span>`).join('');

        itemDiv.innerHTML = `
            <h4>${productName}</h4>
            <div class="star-rating">${stars}</div>
            <textarea placeholder="Write your feedback..." required></textarea>
        `;
        feedbackItemsDiv.appendChild(itemDiv);
    });

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "action-btn";
    submitBtn.textContent = "Submit Feedback";

    modalContent.innerHTML = `<h2>Leave Product Feedback</h2>`; // Add modal title
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(form);
    form.appendChild(feedbackItemsDiv);
    form.appendChild(submitBtn);

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });


    feedbackItemsDiv.querySelectorAll(".star-rating").forEach(starContainer => {
        const stars = starContainer.querySelectorAll(".star");
        stars.forEach(star => {
            star.addEventListener("mouseover", () => {
                stars.forEach(s => s.innerHTML = "☆");
                for (let i = 0; i < star.dataset.value; i++) stars[i].innerHTML = "★";
            });
            star.addEventListener("click", () => {
                stars.forEach(s => {
                    s.dataset.selected = 0;
                    s.innerHTML = "☆";
                });
                for (let i = 0; i < star.dataset.value; i++) {
                    stars[i].dataset.selected = 1;
                    stars[i].innerHTML = "★";
                }
            });
            starContainer.addEventListener("mouseout", () => {
                stars.forEach(s => s.innerHTML = s.dataset.selected == 1 ? "★" : "☆");
            });
        });
    });

    form.onsubmit = async (e) => {
        e.preventDefault();
        const feedbacks = [];
        const ratings = [];

        // FIX: Capture the current user's email for the feedback record
        const userEmailForFeedback = currentUserEmail || (currentUser ? currentUser.email : 'anonymous@noemail.com');

        feedbackItemsDiv.querySelectorAll(".feedback-item").forEach((itemDiv, index) => {
            const text = itemDiv.querySelector("textarea").value;
            const item = items[index];
            const productName = item.product || item.name || "Unknown Product";

            const stars = itemDiv.querySelectorAll(".star");
            let starValue = 0;
            stars.forEach((s) => {
                if (s.dataset.selected == 1) starValue = parseInt(s.dataset.value);
            });

            feedbacks.push({
                productName: productName || 'N/A',
                rating: starValue || 0,
                comment: text || '',
                productId: item.id || null, 
                timestamp: new Date().getTime(),
                // --- FIX APPLIED HERE ---
                customerEmail: userEmailForFeedback,
                customerId: currentUser?.uid || null
                // -------------------------
            });
            ratings.push(starValue); // For validation
        });

        if (ratings.some(r => r === 0)) {
            alert("Please provide a star rating for all products before submitting.");
            return;
        }

        try {
            await updateDoc(doc(db, "DeliveryOrders", orderId), {
                feedback: arrayUnion(...feedbacks),
                // This status update moves the order from "To Rate" to "Completed" tab
                status: "Completed by Customer", // Keep the status as "Completed by Customer" to trigger the "Completed" tab filter which checks for feedback.
                // NOTE: Your filter logic for the "Completed" tab is: status === "completed by customer" && order.feedback
                // If you update the status to "Completed" here, you need to update the filter logic accordingly, but this structure seems intentional.
            });

            alert("Thank you for your feedback! The order is now marked as Completed.");
            modal.remove();
            listenOrders();
        } catch (err) {
            console.error("Error saving feedback:", err);
            alert("Failed to save feedback. Please try again. Check console for details.");
        }
    };
}
