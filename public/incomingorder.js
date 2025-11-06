import { db } from './firebase-config.js';
import {
    collection, doc, onSnapshot, updateDoc, getDocs, getDoc,
    deleteField, increment, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = getAuth();
const ordersBody = document.getElementById("ordersBody");
const tabButtons = document.querySelectorAll(".tab-btn"); 
const filterContainer = document.getElementById("filterContainer"); 
const orderTypeFilterSelect = document.getElementById("orderTypeFilter");
const dateFilterSelect = document.getElementById("dateFilter");
const customRangeInput = document.getElementById("customRange");
const productSearchInput = document.getElementById("productSearch");

let ordersData = [];
let selectedTab = "Order Approval"; 
let currentOrderType = "All"; 
let dateRangeFilter = "all";
let productSearchTerm = "";
let customDateStart = null;
let customDateEnd = null;
const pendingTimers = {};

let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;
let popupReceiptContent = null; 

// Assuming flatpickr is loaded externally
const dateRangePicker = flatpickr(customRangeInput, {
    mode: "range",
    dateFormat: "Y-m-d",
    onChange: function(selectedDates, dateStr, instance) {
        if (selectedDates.length === 2) {
            customDateStart = selectedDates[0];
            customDateEnd = selectedDates[1];
            renderOrders();
        } else {
            customDateStart = null;
            customDateEnd = null;
        }
    }
});
customRangeInput.style.display = 'none'; 

function injectPopupStyles() {
    const style = document.createElement("style");
    style.textContent = `
    .popup { display: none; position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.55); z-index: 9999; justify-content: center; align-items: center; padding: 20px; }
    .popup-content { background: #fff8f0; color: #552915; border-radius: 12px; padding: 25px; width: 90%; max-width: 420px; text-align: center; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); max-height: 90vh; overflow-y: auto; }
    .popup-content h3 { margin-bottom: 15px; font-size: 1.2rem; color: #6f4e37; }
    #popupButtonsContainer { display: flex; flex-direction: column; gap: 10px; align-items: center; }
    #popupButtonsContainer button { background-color: #8b5e3c; color: #fff; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; transition: 0.2s ease; width: 80%; font-weight: bold; }
    #popupButtonsContainer button:hover { background-color: #6d4428; }
    #popupReceiptContent { text-align: left; margin-top: 15px; padding-top: 15px; border-top: 1px dashed #ccc; max-height: 300px; overflow-y: auto; }
    .refund-badge { display: inline-block; padding: 2px 6px; border-radius: 6px; font-size: 0.8em; font-weight: bold; margin-left: 5px; color: white; }
    .refund-refunded, .refund-manual { background-color: #4caf50; } 
    .refund-denied, .refund-failed, .refund-api-failed { background-color: #f44336; } 
    .refund-pending { background-color: #ff9800; color: white; } 
    .refund-error { background-color: #6c757d; } 
    .view-refund-btn { background-color: #795548; color: white; }
    .view-refund-btn:hover { background-color: #5d4037; }
    .admin-accept-btn { background-color: #4CAF50; }
    .admin-accept-btn:hover { background-color: #45a049; }
    .admin-decline-btn { background-color: #f44336; }
    .admin-decline-btn:hover { background-color: #d32f2f; }
    .print-receipt-btn { background-color: #007bff; color: white; margin-top: 5px;}
    .print-receipt-btn:hover { background-color: #0056b3; }
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
function showETPopup(title, callback) {
    if (!popup) createPopup();
    popupReceiptContent.innerHTML = ""; 
    popup.style.display = "flex";
    popupTitle.textContent = title;
    const timeOptions = ["10–20 mins", "20–30 mins", "30–40 mins", "40–50 mins", "50–60 mins"];
    popupButtonsContainer.innerHTML = timeOptions.map(t => `<button>${t}</button>`).join("");
    Array.from(popupButtonsContainer.children).forEach(btn => {
        btn.onclick = () => {
            callback(btn.textContent);
            closePopup();
        };
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

function toggleFilterVisibility() {
    const isVisible = selectedTab === "Completed" || selectedTab === "Canceled" ;
    
    if (isVisible) {
        filterContainer.style.display = 'flex'; 
    } else {
        filterContainer.style.display = 'none';
        
        orderTypeFilterSelect.value = 'All';
        dateFilterSelect.value = 'all';
        productSearchInput.value = '';
        customRangeInput.style.display = 'none';
        
        currentOrderType = 'All';
        dateRangeFilter = 'all';
        productSearchTerm = '';
        customDateStart = null;
        customDateEnd = null;
    }
}

tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTab = btn.dataset.status;
        
        toggleFilterVisibility(); 
        
        renderOrders();
    });
});

orderTypeFilterSelect.addEventListener("change", () => {
    currentOrderType = orderTypeFilterSelect.value;
    renderOrders();
});

productSearchInput.addEventListener("input", () => {
    productSearchTerm = productSearchInput.value.toLowerCase().trim();
    renderOrders();
});

dateFilterSelect.addEventListener("change", () => {
    dateRangeFilter = dateFilterSelect.value;
    
    if (dateRangeFilter === 'custom') {
        customRangeInput.style.display = 'inline-block';
        dateRangePicker.open(); 
    } else {
        customRangeInput.style.display = 'none';
        customDateStart = null;
        customDateEnd = null;
        renderOrders();
    }
});

function isDateInFilter(timestamp) {
    if (!timestamp) return true; 
    
    const orderDate = new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);

    switch (dateRangeFilter) {
        case 'all':
            return true;
        case 'today':
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return orderDate >= today;
        case 'week':
            const startOfWeek = new Date();
            startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); 
            startOfWeek.setHours(0, 0, 0, 0);
            return orderDate >= startOfWeek;
        case 'month':
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            return orderDate >= startOfMonth;
        case 'custom':
            if (customDateStart && customDateEnd) {
                const endOfDay = new Date(customDateEnd);
                endOfDay.setHours(23, 59, 59, 999);
                return orderDate >= customDateStart && orderDate <= endOfDay;
            }
            return true; 
        default:
            return true;
    }
}


onSnapshot(collection(db, "InStoreOrders"), s => handleOrderSnapshot(s, "In-Store", "InStoreOrders"));
onSnapshot(collection(db, "DeliveryOrders"), s => handleOrderSnapshot(s, "Delivery", "DeliveryOrders"));

function handleOrderSnapshot(snapshot, type, collectionName) {
    snapshot.docChanges().forEach(change => {
        const docSnap = change.doc;
        const order = {
            id: docSnap.id,
            type: type, 
            collection: collectionName,
            data: { 
                status: docSnap.data().status || "Pending", 
                timestamp: docSnap.data().timestamp || new Date().toISOString(), 
                ...docSnap.data() 
            }
        };

        const existingIndex = ordersData.findIndex(o => o.id === docSnap.id);
        if (change.type === "removed") {
            ordersData = ordersData.filter(o => o.id !== docSnap.id);
            if (pendingTimers[docSnap.id]) {
                clearTimeout(pendingTimers[docSnap.id]);
                delete pendingTimers[docSnap.id];
            }
        } else if (existingIndex >= 0) {
            ordersData[existingIndex] = order;
        } else {
            ordersData.push(order);
        }

        if (order.data.status === "Pending" && !order.data.refundRequest && !pendingTimers[order.id]) {
            pendingTimers[order.id] = setTimeout(async () => {
            
                if (!order.data.paymongoPaymentId && order.data.status !== "Wait for Admin to Accept") {
                    const currentOrderSnap = await getDoc(doc(db, order.collection, order.id));
                    if (currentOrderSnap.exists() && currentOrderSnap.data().status === "Pending") {
                        await updateOrderStatus(order.id, order.collection, "Canceled");
                    }
                } else {
                    console.warn(`Order ${order.id} still Pending after 60s. Awaiting staff action.`);
                }
                delete pendingTimers[order.id];
            }, 60000);
        }

        if (order.data.status !== "Pending" && pendingTimers[order.id]) {
            clearTimeout(pendingTimers[docSnap.id]);
            delete pendingTimers[docSnap.id];
        }
    });
    renderOrders();
}

function renderOrders() {
    ordersBody.innerHTML = "";

    toggleFilterVisibility(); 

    const isFilteredTab = selectedTab === "Completed" || selectedTab === "Canceled" ;

    const filteredOrders = ordersData
        .filter(o => {
            const status = o.data.status;
            const finalRefundStatus = o.data.finalRefundStatus;
            
            let tabMatch = false;
            switch (selectedTab) {
                case "Order Approval":
                    tabMatch = status === "Wait for Admin to Accept";
                    break;
                case "Pending":
                    tabMatch = status === "Pending" || status === "Waiting for Payment" || o.data.refundRequest;
                    break;
                case "Preparing":
                    tabMatch = status === "Preparing";
                    break;
                case "Delivery":
                    tabMatch = status === "Delivery";
                    break;
                case "Completed":
                    tabMatch = status === "Completed" || ["Succeeded", "Manual", "Refunded"].includes(finalRefundStatus) || status === "Refunded";
                    break;
                case "Canceled":
                    tabMatch = status === "Canceled" || ["Failed", "API Failed", "Denied", "Canceled"].includes(finalRefundStatus) || status === "Refund Failed" || status === "Refund Denied";
                    break;
                default:
                    tabMatch = false; 
            }

            if (!tabMatch) return false;

            if (isFilteredTab) {
                if (currentOrderType !== 'All') {
                    if (currentOrderType !== o.type) return false;
                }

                if (productSearchTerm) {
                    const search = productSearchTerm;
                    const products = o.data.products || o.data.items || [];
                    const productMatch = products.some(p => (p.product || '').toLowerCase().includes(search));
                    if (!productMatch) return false;
                }

                if (!isDateInFilter(o.data.timestamp)) return false;
            }

            return true;
        })
        .sort((a, b) => {
            if (a.data.refundRequest && !b.data.refundRequest) return -1;
            if (!a.data.refundRequest && b.data.refundRequest) return 1;
            
            // newest/highest number 
            const queueA = a.data.queueNumberNumeric || 0;
            const queueB = b.data.queueNumberNumeric || 0;
            return queueB - queueA;
        });


    filteredOrders.forEach(orderItem => {
            const order = orderItem.data;
            const orderId = orderItem.id;

            const tr = document.createElement("tr");
            
            const products = order.products || order.items || [];

            const orderHtml = products.map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}: ₱${(a.price || 0).toFixed(2)}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                const total = p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty; 
                return `<div>${qty} × ${p.product}${sizeText}${addons} — ₱${total.toFixed(2)}</div>`;
            }).join("");
            
            // Dlivery fee show
            const deliveryFee = order.deliveryFee || 0;
            const deliveryFeeHtml = deliveryFee > 0 
                ? `<div style="margin-top: 5px; border-top: 1px dashed #ccc; padding-top: 5px;">Delivery Fee: ₱${deliveryFee.toFixed(2)}</div>` 
                : '';

            const grandTotal = order.total;
            const totalDisplay = grandTotal ? grandTotal.toFixed(2) : "0.00";

            const queue = formatQueueNumber(order.queueNumber || order.queueNumberNumeric);
            const etaText = order.estimatedTime ? `<div>ETA: ${order.estimatedTime}</div>` : "";

            const mainStatus = order.status;
            const finalRefundStatus = order.finalRefundStatus;
            let mainStatusDisplay = mainStatus;
            let refundBadgeHtml = "";
            let badgeClass = '';


            if (finalRefundStatus) {
                const badgeText = finalRefundStatus;
                badgeClass = 'refund-error';

                switch (badgeText) {
                    case "Succeeded": case "Manual": case "Refunded":
                        badgeClass = 'refund-refunded';
                        mainStatusDisplay = "Refunded"; 
                        break;
                    case "Pending":
                        badgeClass = 'refund-pending';
                        mainStatusDisplay = "Refunded (Processing)"; 
                        break;
                    case "Failed": case "API Failed": case "Denied": case "Canceled":
                        badgeClass = 'refund-failed';
                        if (badgeText === "Denied") mainStatusDisplay = "Refund Denied";
                        else if (badgeText === "Canceled") mainStatusDisplay = "Canceled";
                        else mainStatusDisplay = "Refund Failed";
                        break;
                }

                refundBadgeHtml = ` <span class="refund-badge ${badgeClass}">${badgeText}</span>`;
            }
            
            if (finalRefundStatus && ["Succeeded", "Manual", "Refunded", "Pending"].includes(finalRefundStatus)) {
                mainStatusDisplay = finalRefundStatus === "Pending" ? "Refunded (Processing)" : "Refunded";
            } else if (mainStatus === "Refunded" || mainStatus === "Refund Denied") {
                 mainStatusDisplay = mainStatus;
            }


            const statusBadge = `<td>${mainStatusDisplay}${refundBadgeHtml}</td>`;

            let actionBtnHtml = "";
            const printButton = `<button class="print-receipt-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Receipt</button>`;


            if (order.refundRequest) {
                actionBtnHtml = `<button class="view-refund-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Refund Request</button>`;
            } else {
                switch (order.status) {
                    case "Wait for Admin to Accept":
                        actionBtnHtml = `<button class="admin-accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Accept Order</button>
                                         <button class="admin-decline-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Decline Order</button>`;
                        break;
                    case "Waiting for Payment":
                        actionBtnHtml = "";
                        break;
                    case "Pending":
                        actionBtnHtml = orderItem.type === "Delivery"
                            ? `<button class="accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-type="Delivery">Preparing (Set ET)</button>
                               <button class="cancel-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Cancel</button>`
                            : `<button class="accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-type="In-Store">Preparing</button>
                               <button class="cancel-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Cancel</button>`;
                        break;
                    case "Preparing":
                        actionBtnHtml = orderItem.type === "Delivery"
                            ? `<button class="eta-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-status="Delivery">Set ET for Delivery</button>`
                            : `<button class="complete-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Completed</button>`;
                        break;
                    case "Delivery":
                        actionBtnHtml = `<button class="complete-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Completed</button>`;
                        break;
                    case "Refund Pending":
                        actionBtnHtml = `<button class="view-refund-btn" disabled>Refund Processing...</button>`;
                        break;
                    case "Completed": 
                    case "Canceled":
                    case "Refund Denied":
                    case "Refund Failed":
                    case "Refunded": 
                        actionBtnHtml = printButton;
                        break;
                }
            }
            
            // Add Print Receipt button
            if (["Completed", "Canceled", "Refund Denied", "Refund Failed", "Refunded"].includes(order.status) && !actionBtnHtml.includes("View Receipt")) {
                    actionBtnHtml += printButton;
            }

            tr.innerHTML = `
                <td>${queue}</td>
                <td>${orderItem.type}</td>
                <td>${orderHtml}${deliveryFeeHtml}${etaText}<div><strong>Total: ₱${totalDisplay}</strong></div></td>
                ${statusBadge}
                <td>${actionBtnHtml}</td>
            `;
            ordersBody.appendChild(tr);
        });

    attachActionHandlers();
}
//  Receipt/Refund Functions

function generateReceiptHTML(order) {
    const date = order.timestamp ? new Date(order.timestamp.seconds ? order.timestamp.seconds * 1000 : order.timestamp).toLocaleString() : new Date().toLocaleString();
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
                <span style="flex-grow: 1;">${qty} x ${p.product}${sizeText}${addons}</span>
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
                <p>Type: ${order.type}</p>
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

async function generateAndDownloadPDF(orderId, collectionName, orderData, orderType) {
    if (typeof html2pdf === 'undefined') {
        customAlert("PDF Library Missing: Please include 'html2pdf.bundle.min.js' in your HTML file to enable PDF printing.");
        return;
    }

    const content = generateReceiptHTML({ id: orderId, type: orderType, ...orderData });
    
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
        const orderType = collectionName === "InStoreOrders" ? "In-Store" : "Delivery";

        const receiptHtml = generateReceiptHTML({ id: orderId, type: orderType, ...orderData });

        if (!popup) createPopup();
        popupTitle.textContent = `Receipt for Queue #${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}`;
        
        popupReceiptContent.innerHTML = receiptHtml;

        popupButtonsContainer.innerHTML = `
            <button id="downloadReceiptBtn" data-id="${orderId}" data-collection="${collectionName}" data-type="${orderType}">Download Receipt</button>
            <button id="closeReceiptBtn">Close</button>
        `;
        popup.style.display = "flex";

        document.getElementById("downloadReceiptBtn").onclick = (e) => {
            const btn = e.target;
            generateAndDownloadPDF(btn.dataset.id, btn.dataset.collection, orderData, btn.dataset.type); 
        };

        document.getElementById("closeReceiptBtn").onclick = closePopup;

    } catch (err) {
        console.error("Show Receipt Error:", err);
        customAlert("Failed to load order data for receipt.");
    }
}


function showRefundAmountPopup(orderId, collectionName, maxRefundable, paymongoPaymentId) {
    if (!popup) createPopup();
    popupTitle.textContent = "Enter Refund Amount";
    popupReceiptContent.innerHTML = ""; 

    const isEPayment = !!paymongoPaymentId;
    const warningHtml = isEPayment ? '' : '<div style="color:#dc3545; margin-top:5px; font-weight:bold;">⚠️ NOT E-Payment: Manual Cash Refund Required.</div>';

    popupButtonsContainer.innerHTML = `
        <label>Refund Amount (max ₱${maxRefundable.toFixed(2)}):</label>
        <input type="number" id="refundInput" value="${maxRefundable.toFixed(2)}" max="${maxRefundable}" min="0.01" step="0.01" style="width: 100%; margin-top:5px;">
        ${warningHtml}
        <button id="confirmRefundBtn" style="margin-top:10px;">Confirm Refund</button>
        <button id="cancelRefundBtn" style="margin-top:5px;">Cancel</button>
    `;
    popup.style.display = "flex";

    document.getElementById("confirmRefundBtn").onclick = () => {
        const inputElement = document.getElementById("refundInput");
        const refundAmount = parseFloat(inputElement.value);

        if (isNaN(refundAmount) || refundAmount <= 0 || refundAmount > maxRefundable) {
            customAlert("Invalid amount. Must be >₱0 and ≤ the max refundable amount (product total).");
            return;
        }

        closePopup();
        handleRefundAction(orderId, collectionName, "Accepted", refundAmount, isEPayment, paymongoPaymentId);
    };

    document.getElementById("cancelRefundBtn").onclick = () => {
        closePopup();
    };
}

async function handleRefundAction(orderId, collectionName, action, refundAmount = 0, isEPayment = false, paymongoPaymentId = null) {
    const orderRef = doc(db, collectionName, orderId);
    let originalStatus; 

    try {
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) return;

        const orderData = orderSnap.data();
        originalStatus = orderData.status;

        if (action === "Accepted") {
            const refundItems = orderData.refundItems || []; 
            const needsStockReturn = originalStatus === "Wait for Admin to Accept" || originalStatus === "Pending" || originalStatus === "Waiting for Payment";

            if (needsStockReturn) {
                await returnStock(refundItems);
            }
            
            if (isEPayment) {
                //const endpoint = "http://localhost:3000/refund-payment";
                const endpoint = "/.netlify/functions/refund-payment";

                if (paymongoPaymentId && !paymongoPaymentId.startsWith('pay_')) {
                    console.error(`PayMongo Refund Error: Expected a 'pay_' ID but received '${paymongoPaymentId}'.`);
                    customAlert("Configuration Error: The stored PayMongo ID is incorrect. Status reverted.");
                    await updateDoc(orderRef, {
                        finalRefundStatus: "API Failed",
                        status: originalStatus, 
                        refundRequest: false
                    });
                    return;
                }
                
                await updateDoc(orderRef, {
                    status: "Refunded", 
                    refundRequest: deleteField(),
                    finalRefundStatus: "Refunded", 
                    refundAmount: refundAmount 
                });
                customAlert("PayMongo refund initiated. Status is set to 'Refunded'. Please confirm success on PayMongo dashboard.");

                const refundAmountInCentavos = Math.round(refundAmount * 100); 
                
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        paymongoPaymentId: paymongoPaymentId, 
                        amount: refundAmountInCentavos, 
                        orderId: orderId, 
                        collectionName: collectionName 
                    }) 
                });

                const data = await response.json();

                if (data.error || !response.ok) {
                    console.error("PayMongo Refund failed:", data.details || data.error || "Unknown server error");
                    customAlert(`PayMongo Refund failed: ${data.details || data.error || 'Server error'}. Status reverted to 'Refund Failed'.`);
                    
                    await updateDoc(orderRef, {
                        finalRefundStatus: "API Failed",
                        status: "Refund Failed", 
                        refundRequest: false 
                    });
                    return;
                }
                
            } else { 
                await updateDoc(orderRef, {
                    refundRequest: deleteField(),
                    finalRefundStatus: "Manual",
                    
                    status: "Refunded", 
                    refundAmount: refundAmount
                });
                customAlert(`Manual refund completed: Order #${orderData.queueNumber || orderData.queueNumberNumeric || 'N/A'} marked as Refunded.`);
            }
        } else if (action === "Denied") { 
            await updateDoc(orderRef, {
                refundRequest: deleteField(),
                finalRefundStatus: "Denied",
                status: "Refund Denied" 
            });
            customAlert(`Refund request for Order #${orderData.queueNumber || orderData.queueNumberNumeric || 'N/A'} has been denied. Status updated.`);
        }

        renderOrders(); 
    } catch (err) {
        console.error("Refund Action Handler Error:", err);
        customAlert("A critical error occurred while processing the refund action.");
        try {
            if (originalStatus) { 
                await updateDoc(orderRef, {
                    status: originalStatus, 
                    refundRequest: true,
                    finalRefundStatus: deleteField()
                });
            }
        } catch (resetErr) {
            console.error("Failed to reset order status after refund error:", resetErr);
        }
    }
}

async function returnStock(orderItems) {
    const returnItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        try {
            await updateDoc(invRef, { quantity: increment(Math.abs(amount)) });
            console.log(`✅ Returned ${Math.abs(amount)} of ID: ${id} to stock.`);
        } catch (e) {
            console.error(`Failed to return ${amount} to ID: ${id}.`, e);
        }
    };
    for (const item of orderItems || []) {
        const productQty = item.qty || item.quantity || 1;
        
        for (const ing of item.ingredients || []) {
            await returnItem(ing.id, (ing.qty || 1) * productQty);
        }
        for (const other of item.others || []) {
            await returnItem(other.id, (other.qty || 1) * productQty);
        }
        
        if (item.sizeId) {
            await returnItem(item.sizeId, productQty);
            const productSizeData = (item.productSizes || []).find(s => s.id === item.sizeId);

            if (productSizeData) {
                for (const ing of productSizeData.ingredients || []) {
                    await returnItem(ing.id, (ing.qty || 1) * productQty);
                }
                for (const other of productSizeData.others || []) {
                    await returnItem(other.id, (other.qty || 1) * productQty);
                }
            }
        }
        for (const addon of item.addons || []) {
            await returnItem(addon.id, productQty); 
            
            try {
                const addonSnap = await getDoc(doc(db, "Inventory", addon.id));
                const addonData = addonSnap.data();

                if (addonData) {
                    for (const ing of addonData.ingredients || []) {
                        await returnItem(ing.id, (ing.qty || 1) * productQty);
                    }
                    for (const other of addonData.others || []) {
                        await returnItem(other.id, (other.qty || 1) * productQty);
                    }
                }
            } catch (e) {
                console.warn(`Could not fetch Addon ID ${addon.id} for stock return. Skipping nested return.`);
            }
        }
    }
}

async function updateOrderStatus(orderId, collectionName, newStatus, eta = "") {
    if (!orderId || !collectionName) return;

    if (pendingTimers[orderId]) {
        clearTimeout(pendingTimers[orderId]);
        delete pendingTimers[orderId];
    }

    const orderRef = doc(db, collectionName, orderId);
    let orderData;
    let originalStatus;

    try {
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            customAlert(`Error: Order ${orderId} not found.`);
            return;
        }
        orderData = orderSnap.data();
        originalStatus = orderData.status;

        const updatePayload = {
            status: newStatus,
            estimatedTime: eta || deleteField(),
            timestamp: new Date().toISOString()
        };
        
        if (originalStatus === "Wait for Admin to Accept" && newStatus === "Waiting for Payment") {
            if (!orderData.paymentMetadata || !orderData.total) {
                customAlert("Error: Cannot accept. Payment metadata is missing from the order.");
                return;
            }

            
            //const endpoint = "http://localhost:3000/generate-paymongo-link";
            const endpoint = "/.netlify/functions/generate-paymongo-link";
            customAlert("Generating secure payment link... Please wait. Do not navigate away.");

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orderId: orderId,
                    collectionName: collectionName,
                    amount: orderData.total,
                    lineItems: orderData.paymentMetadata.lineItems,
                    customerDetails: orderData.paymentMetadata.customerDetails,
                    description: `Order ${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}`
                })
            });

            const data = await response.json();
            
            if (data.error || !data.checkoutUrl) {
                console.error("PayMongo Link Generation Failed:", data.details || data.error);
                customAlert(`Payment link failed to generate: ${data.details || data.error}. Status reverted.`);
                await updateDoc(orderRef, { status: originalStatus }); 
                return;
            }

            updatePayload.checkoutUrl = data.checkoutUrl;
            updatePayload.status = "Waiting for Payment"; 
            updatePayload.paymentMetadata = deleteField(); 
            customAlert("Payment link generated successfully. Status updated to 'Waiting for Payment'.");
        }
        
        else if (newStatus === "Canceled") {
            const orderProducts = orderData.products || orderData.items;

            if (!orderData.paymongoPaymentId || originalStatus === "Wait for Admin to Accept" || originalStatus === "Pending" || originalStatus === "Waiting for Payment") {
                await returnStock(orderProducts);
                customAlert(`Order #${orderData.queueNumber || orderData.queueNumberNumeric} canceled and stock returned.`);
            } else {
                customAlert(`Order #${orderData.queueNumber || orderData.queueNumberNumeric} is E-Payment. It was manually canceled. Refund must be processed separately.`);
            }
            
            updatePayload.finalRefundStatus = "Canceled"; 
            updatePayload.refundRequest = deleteField();
        }

        if (newStatus === "Preparing" || newStatus === "Delivery" || newStatus === "Completed" || newStatus === "Waiting for Payment") {
            updatePayload.refundRequest = deleteField();
            if (newStatus === "Completed") {
                updatePayload.finalRefundStatus = deleteField(); 
            }
        }
        
        await updateDoc(orderRef, updatePayload);
        
        renderOrders();
    } catch (e) {
        console.error(`Error updating status for ${orderId}:`, e);
        customAlert(`A critical error occurred while updating the order status: ${e.message}`);

        if (originalStatus && originalStatus !== "Processing") {
              await updateDoc(orderRef, { status: originalStatus }).catch(err => console.error("Failed to revert status:", err));
        }
    }
}


function attachActionHandlers() {
    document.querySelectorAll(".admin-accept-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Waiting for Payment"));
    });

    document.querySelectorAll(".admin-decline-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Canceled"));
    });

    document.querySelectorAll(".accept-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.target.dataset.id;
            const collection = e.target.dataset.collection;
            const type = e.target.dataset.type;

            if (type === "Delivery") {
                showETPopup("Select ET for Preparing", eta => updateOrderStatus(id, collection, "Preparing", eta));
            } else {
                updateOrderStatus(id, collection, "Preparing");
            }
        });
    });

    document.querySelectorAll(".eta-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.target.dataset.id;
            const collection = e.target.dataset.collection;
            const status = e.target.dataset.status;
            showETPopup(`Select ET for ${status}`, eta => updateOrderStatus(id, collection, status, eta));
        });
    });

    document.querySelectorAll(".cancel-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Canceled"));
    });

    document.querySelectorAll(".complete-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Completed"));
    });
    
    document.querySelectorAll(".print-receipt-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            showReceiptPopup(e.target.dataset.id, e.target.dataset.collection);
        });
    });

    document.querySelectorAll(".view-refund-btn").forEach(btn => {
        btn.addEventListener("click", async e => {
            const orderId = e.target.dataset.id;
            const collectionName = e.target.dataset.collection;
            const orderRef = doc(db, collectionName, orderId);
            const orderSnap = await getDoc(orderRef);
            if (!orderSnap.exists()) return;

            const orderData = orderSnap.data();
            if (!orderData.refundRequest) {
                customAlert("There is no active refund request for this order.");
                return;
            }

            const refundItems = orderData.refundItems || [];
            const maxRefundable = orderData.refundAmount || 0; 
            const paymongoPaymentId = orderData.paymongoPaymentId || null;

            let productsHtml = refundItems.map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}:₱${(a.price || 0).toFixed(2)}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                const totalPrice = (p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty).toFixed(2);
                return `<div>${qty} x ${p.product}${sizeText}${addons} - ₱${totalPrice}</div>`;
            }).join("");

            if (refundItems.length === 0) {
                 productsHtml = '<div>No specific items selected for refund (Full Order Refund assumed if amount is max).</div>';
            }

            if (!popup) createPopup();
            popupTitle.textContent = `Refund Request: Queue #${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}`;
            
            popupReceiptContent.innerHTML = `
                <div style="text-align: left; margin-bottom: 15px; width: 100%;">
                    <div style="font-weight: bold; margin-bottom: 5px; border-bottom: 1px dashed #aaa; padding-bottom: 5px;">Requested Items:</div>
                    ${productsHtml}
                </div>
            `;

            popupButtonsContainer.innerHTML = `
                <div style="font-weight: bold; color: #dc3545; margin-bottom: 15px;">Max Refundable Amount (Products Only): ₱${maxRefundable.toFixed(2)}</div>
                <button class="admin-accept-btn" id="acceptRefundBtn">Refund</button>
                <button class="admin-decline-btn" id="denyRefundBtn">Decline Refund</button>
                <button id="closeDetailsBtn">Close</button>
            `;
            popup.style.display = "flex";

            document.getElementById("acceptRefundBtn").onclick = () => {
                closePopup();
                showRefundAmountPopup(orderId, collectionName, maxRefundable, paymongoPaymentId);
            };
            document.getElementById("denyRefundBtn").onclick = () => {
                closePopup();
                handleRefundAction(orderId, collectionName, "Denied");
            };
            document.getElementById("closeDetailsBtn").onclick = closePopup;
        }); 
    }); 
}

function checkAdminAuth() {
    onAuthStateChanged(auth, user => {
        if (!user) {
            console.warn("User not authenticated. Assuming access for development.");
        }
    });
}

checkAdminAuth();
renderOrders();
