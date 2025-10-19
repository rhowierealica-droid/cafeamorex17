// incomingorders.js

// NOTE: Ensure you have initialized Firebase correctly in firebase-config.js
import { db } from './firebase-config.js';
import {
    collection, doc, onSnapshot, updateDoc, getDocs, getDoc,
    deleteField, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = getAuth();
const ordersBody = document.getElementById("ordersBody");
const tabButtons = document.querySelectorAll(".tab-btn");

let ordersData = [];
let selectedTab = "Pending";
const pendingTimers = {};

// =========================================================
// POPUP MODULE (Custom Modal for Alerts/Confirmations)
// =========================================================
let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;

function injectPopupStyles() {
    const style = document.createElement("style");
    // Ensure styles are included to support the refund badge classes (e.g., refund-refunded, refund-pending)
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
    }
    .popup-content h3 {
      margin-bottom: 15px;
      font-size: 1.2rem;
      color: #6f4e37; /* Match main content h1 color */
    }
    #popupButtonsContainer {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
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
    #popupButtonsContainer input {
      padding: 8px;
      width: 80%;
      border-radius: 6px;
      border: 1px solid #ccc;
      font-size: 1rem;
      text-align: center;
    }
    /* Override for refund buttons in popup */
    #acceptRefundBtn { background-color: #4caf50; } /* Green */
    #acceptRefundBtn:hover { background-color: #3e8e41; }

    #declineRefundBtn { background-color: #f44336; } /* Red */
    #declineRefundBtn:hover { background-color: #d32f2f; }

    #confirmRefundBtn { background-color: #6f4e37; } /* Brown */
    #confirmRefundBtn:hover { background-color: #50382b; }

    #cancelRefundBtn { background-color: #6c757d; } /* Grey */
    #cancelRefundBtn:hover { background-color: #5a6268; }

    
    /* === REFUND BADGE STYLES (MATCH CSS FILE) === */
    .refund-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 6px; /* Matched the 6px in CSS */
      font-size: 0.8em;
      font-weight: bold;
      margin-left: 5px;
      color: white;
    }
    /* Use established classes for coloring, matching the CSS definitions */
    .refund-refunded, .refund-manual { background-color: #4caf50; } /* Green */
    .refund-denied, .refund-failed, .refund-api-failed { background-color: #f44336; } /* Red */
    .refund-pending { background-color: #ff9800; color: white; } /* Orange */
    .refund-error { background-color: #6c757d; } /* Grey for unexpected states */

    /* Match the view-refund-btn style from your provided CSS overrides/buttons */
    .view-refund-btn { 
      background-color: #795548; /* Brown/Muted color for viewing details */ 
      color: white; 
    }
    .view-refund-btn:hover { 
      background-color: #5d4037; 
    }
    
    /* New styles for admin approval buttons */
    .admin-accept-btn { background-color: #4CAF50; }
    .admin-accept-btn:hover { background-color: #45a049; }
    .admin-decline-btn { background-color: #f44336; }
    .admin-decline-btn:hover { background-color: #d32f2f; }
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
        <div id="popupButtonsContainer"></div>
      </div>
    `;
    document.body.appendChild(popup);
    popupTitle = popup.querySelector("#popupTitle");
    popupButtonsContainer = popup.querySelector("#popupButtonsContainer");

    popup.addEventListener("click", e => {
        if (e.target === popup) closePopup();
    });
}

function showETPopup(title, callback) {
    if (!popup) createPopup();
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

// Custom alert function to replace window.alert
function customAlert(message) {
    if (!popup) createPopup();
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

// =========================================================
// HELPERS
// =========================================================
function formatQueueNumber(num) {
    return num ? num.toString().padStart(4, "0") : "----";
}

// =========================================================
// TAB SWITCH
// =========================================================
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTab = btn.dataset.status;
        renderOrders();
    });
});

// =========================================================
// FIRESTORE SNAPSHOTS
// =========================================================
onSnapshot(collection(db, "InStoreOrders"), s => handleOrderSnapshot(s, "In-Store", "InStoreOrders"));
onSnapshot(collection(db, "DeliveryOrders"), s => handleOrderSnapshot(s, "Delivery", "DeliveryOrders"));

function handleOrderSnapshot(snapshot, type, collectionName) {
    snapshot.docChanges().forEach(change => {
        const docSnap = change.doc;
        const order = {
            id: docSnap.id,
            type,
            collection: collectionName,
            data: { status: docSnap.data().status || "Pending", ...docSnap.data() }
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

        // Automatic Cancellation Timer (60 seconds) for standard Pending orders
        if (order.data.status === "Pending" && !order.data.refundRequest && !pendingTimers[order.id]) {
            pendingTimers[order.id] = setTimeout(async () => {
                // For e-payment orders, automatically cancel only if there's no payment ID (i.e., payment failed or timed out)
                // Also, do not auto-cancel if it's an admin approval wait state.
                if (!order.data.paymongoPaymentId && order.data.status !== "Wait for Admin to Accept") {
                    // Stock is returned in updateOrderStatus only if no payment ID is present
                    await updateOrderStatus(order.id, order.collection, "Canceled");
                } else {
                    // For paid E-Payment orders or Admin Approval orders, staff must manually accept/cancel
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

// =========================================================
// RENDER ORDERS
// =========================================================
function renderOrders() {
    ordersBody.innerHTML = "";

    ordersData
        .filter(o => {
            const status = o.data.status;
            const finalRefundStatus = o.data.finalRefundStatus;

            switch (selectedTab) {
                case "Order Approval":
                    return status === "Wait for Admin to Accept";
                case "Pending":
                    // Show all orders that are Pending OR have an active refund request
                    return status === "Pending" || o.data.refundRequest;
                case "Completed":
                    // Include final completed, refunded, and manual refund success statuses
                    return status === "Completed" || ["Succeeded", "Manual", "Refunded"].includes(status) || ["Succeeded", "Manual"].includes(finalRefundStatus);
                case "Canceled":
                    // Include all cancelled, failed, and denied statuses
                    return ["Canceled", "Refund Failed", "Refund Denied"].includes(status) ||
                        ["Failed", "API Failed", "Denied", "Canceled"].includes(finalRefundStatus);
                default:
                    // For Preparing, Delivery, and Waiting for Payment tabs
                    return status === selectedTab;
            }
        })
        .forEach(orderItem => {
            const order = orderItem.data;
            const orderId = orderItem.id;

            const tr = document.createElement("tr");

            // Calculate Order HTML and Total
            const orderHtml = (order.products || order.items || []).map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}: ₱${(a.price || 0).toFixed(2)}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                // Use saved total from POS for consistency
                const total = (p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty);
                return `<div>${qty} × ${p.product}${sizeText}${addons} — ₱${total.toFixed(2)}</div>`;
            }).join("");

            const grandTotal = order.total; // Use the saved total from POS for consistency
            const totalDisplay = grandTotal.toFixed(2);

            const queue = formatQueueNumber(order.queueNumber);
            const etaText = order.estimatedTime ? `<div>ETA: ${order.estimatedTime}</div>` : "";

            // UPDATED: Refund Badge Logic for robustness
            const mainStatus = order.status;
            const finalRefundStatus = order.finalRefundStatus;
            let mainStatusDisplay = mainStatus;
            let refundBadgeHtml = "";

            if (finalRefundStatus) {
                const badgeText = finalRefundStatus;
                let badgeClass = 'refund-error';

                switch (badgeText) {
                    case "Succeeded": case "Manual":
                        badgeClass = 'refund-refunded';
                        mainStatusDisplay = "Refunded"; // Clearer main status
                        break;
                    case "Pending":
                        badgeClass = 'refund-pending';
                        mainStatusDisplay = "Refund Pending";
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

            const statusBadge = `<td>${mainStatusDisplay}${refundBadgeHtml}</td>`;

            let actionBtnHtml = "";

            // If an active refund request exists, show the action button regardless of main status
            if (order.refundRequest) {
                actionBtnHtml = `<button class="view-refund-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Refund Request</button>`;
            } else {
                switch (order.status) {
                    case "Wait for Admin to Accept":
                        actionBtnHtml = `<button class="admin-accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Accept Order</button>
                                         <button class="admin-decline-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Decline Order</button>`;
                        break;
                    case "Waiting for Payment":
                        // No action needed in this view, waiting for customer payment/system webhook
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
                    case "Completed": // Keep the action cell blank for final states
                    case "Canceled":
                    case "Refund Denied":
                    case "Refund Failed":
                    case "Refunded": // Added this final status
                        actionBtnHtml = "";
                        break;
                }
            }

            tr.innerHTML = `
                <td>${queue}</td>
                <td>${orderItem.type}</td>
                <td>${orderHtml || "No products"}${etaText}<div><strong>Total: ₱${totalDisplay}</strong></div></td>
                ${statusBadge}
                <td>${actionBtnHtml}</td>
            `;
            ordersBody.appendChild(tr);
        });

    attachActionHandlers();
}

// ---------------------
// Attach handlers
// ---------------------
function attachActionHandlers() {
    // New Admin Approval Handlers
    document.querySelectorAll(".admin-accept-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Waiting for Payment"));
    });

    document.querySelectorAll(".admin-decline-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Canceled"));
    });

    // Existing Handlers
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

    // =========================================================
    // CRITICALLY UPDATED: Refund Button Logic
    // =========================================================
    document.querySelectorAll(".view-refund-btn").forEach(btn => {
        btn.addEventListener("click", async e => {
            const orderId = e.target.dataset.id;
            const collectionName = e.target.dataset.collection;
            const orderRef = doc(db, collectionName, orderId);
            const orderSnap = await getDoc(orderRef);
            if (!orderSnap.exists()) return;

            const orderData = orderSnap.data();

            // Ensure a refund request is actually pending staff action
            if (!orderData.refundRequest) {
                customAlert("There is no active refund request for this order.");
                return;
            }

            // --- Calculate Refundable Total (Excluding Delivery Fee) ---
            const productsTotal = (orderData.products || orderData.items || []).reduce((sum, p) => 
                sum + (p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * (p.qty || p.quantity || 1))
            , 0);

            // Refundable amount is ONLY the products/items total, NOT the delivery fee.
            const maxRefundable = productsTotal;
            
            // --- Build Order Details HTML for Popup ---
            let productsHtml = (orderData.products || orderData.items || []).map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}:₱${(a.price || 0).toFixed(2)}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                const totalPrice = (p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty).toFixed(2);
                return `<div>${qty} x ${p.product}${sizeText}${addons} - ₱${totalPrice}</div>`;
            }).join("");

            const deliveryFee = orderData.deliveryFee || 0;
            if (deliveryFee > 0) {
                productsHtml += `<div>1 x Delivery Fee - ₱${deliveryFee.toFixed(2)}</div>`;
            }

            // --- Show First Refund Popup (Accept/Deny) ---
            if (!popup) createPopup();
            popupTitle.textContent = "Order Details";

            popupButtonsContainer.innerHTML = `
                <h3>Refund Request for Queue #${formatQueueNumber(orderData.queueNumber)}</h3>
                <div style="text-align: left; margin-bottom: 15px; width: 90%; max-width: 350px;">${productsHtml}</div>
                <div style="font-weight: bold; margin-bottom: 5px;">Products Total: ₱${maxRefundable.toFixed(2)}</div>
                <div style="font-weight: bold; margin-bottom: 15px; color: #dc3545;">(Delivery Fee: ₱${deliveryFee.toFixed(2)} - NOT REFUNDABLE)</div>
                <div>
                    <button id="acceptRefundBtn">Accept Refund</button>
                    <button id="declineRefundBtn">Deny Refund</button>
                </div>
            `;
            popup.style.display = "flex";

            document.getElementById("acceptRefundBtn").onclick = () => {
                closePopup();
                showRefundAmountPopup(orderId, collectionName, maxRefundable, orderData.paymongoPaymentId);
            };

            document.getElementById("declineRefundBtn").onclick = () => {
                closePopup();
                handleRefundAction(orderId, collectionName, "Denied");
            };
        });
    });
}

// ---------------------
// Show Refund Amount Popup (Second Popup)
// ---------------------
function showRefundAmountPopup(orderId, collectionName, maxRefundable, paymongoPaymentId) {
    if (!popup) createPopup();
    popupTitle.textContent = "Enter Refund Amount";

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
        // Pass the PayMongo ID status to handleRefundAction
        handleRefundAction(orderId, collectionName, "Accepted", refundAmount, isEPayment);
    };

    document.getElementById("cancelRefundBtn").onclick = () => {
        closePopup();
    };
}

// ---------------------
// Handle Refund Action
// ---------------------
async function handleRefundAction(orderId, collectionName, action, refundAmount = 0, isEPayment = false) {
    const orderRef = doc(db, collectionName, orderId);
    let originalStatus; // Declare outside try for use in catch

    try {
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) return;

        const orderData = orderSnap.data();
        originalStatus = orderData.status;

        if (action === "Accepted") {
            // ---------- CASE: Stock Return (Original status = Pending or 'Wait for Admin to Accept') ----------
            if (originalStatus === "Pending" || originalStatus === "Wait for Admin to Accept") {
                // Return stock first
                await returnStock(orderData.products || orderData.items);

                // Update order to canceled and clear refundRequest
                await updateDoc(orderRef, {
                    refundRequest: deleteField(),
                    // e-payment: pending until webhook; manual: marked Manual
                    finalRefundStatus: isEPayment ? "Pending" : "Manual", 
                    status: "Canceled" // Main status should be Canceled
                });

                customAlert(`Refund accepted: Order #${orderData.queueNumber || 'N/A'} canceled and stock returned.`);
            }
            // ---------- CASE: NO Stock Return (Original status = Paid, Completed, or in-progress) ----------
            else if (originalStatus === "Completed" || originalStatus === "Preparing" || originalStatus === "Delivery") {
                
                if (isEPayment) {
                    // For E-Payment on completed orders, call the refund API and set pending states.
                    const endpoint = "/netlify/functions/refund-payment";

                    // 1. Temporarily update status while API call is in progress
                    await updateDoc(orderRef, {
                        status: "Refund Pending",
                        refundRequest: deleteField(),
                        finalRefundStatus: "Pending" // Webhook will update to Succeeded/Failed
                    });
                    customAlert("PayMongo refund initiated. Status is 'Refund Pending'.");

                    const response = await fetch(endpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        // PayMongo uses centavos
                        body: JSON.stringify({ paymongoPaymentId: orderData.paymongoPaymentId, amount: refundAmount * 100 }) 
                    });

                    // 🛑 CRITICAL FIX: Check for HTTP error status (4xx or 5xx) before JSON parsing
                    if (!response.ok) {
                        const errorBody = await response.json().catch(() => ({})); 
                        const errorDetail = errorBody.details || errorBody.error || `HTTP Error ${response.status}`;

                        customAlert(`PayMongo Refund Failed (Server): ${errorDetail}. Status reverted to ${originalStatus}.`);
                        // Revert status/flags to original state
                        await updateDoc(orderRef, {
                            status: originalStatus,
                            finalRefundStatus: deleteField(),
                            refundRequest: true
                        });
                        return;
                    }
                    // -------------------------------------------------------------------------------------

                    const data = await response.json();
                    console.log("Refund response:", data);

                    if (data.error) {
                        // API Call Failed - Update status to final error state
                        customAlert(`PayMongo Refund failed: ${data.details || data.error}. Please check the PayMongo dashboard.`);
                        await updateDoc(orderRef, {
                            finalRefundStatus: "API Failed",
                            status: "Refund Failed"
                        });
                        return;
                    }

                    // If call succeeds, keep pending status; webhook will set Succeeded or Failed
                } else {
                    // Manual cash refund for a completed order: mark as final Refunded, no stock return
                    await updateDoc(orderRef, {
                        refundRequest: deleteField(),
                        finalRefundStatus: "Manual",
                        status: "Refunded"
                    });
                    customAlert(`Manual refund completed: Order #${orderData.queueNumber || 'N/A'} marked as Refunded.`);
                }
            }
            // ---------- Other statuses (fallback: no stock return) ----------
            else {
                 // Default fallback: treat as Completed refund flow (do NOT return stock)
                if (isEPayment) {
                    const endpoint = "/netlify/functions/refund-payment";
                    await updateDoc(orderRef, {
                        status: "Refund Pending", // Should transition to 'Refunded' after webhook
                        refundRequest: deleteField(),
                        finalRefundStatus: "Pending"
                    });
                    customAlert("PayMongo refund initiated. Status is 'Refund Pending'.");

                    const response = await fetch(endpoint, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ paymongoPaymentId: orderData.paymongoPaymentId, amount: refundAmount * 100 })
                    });
                    
                    // 🛑 CRITICAL FIX: Check for HTTP error status (4xx or 5xx) before JSON parsing
                    if (!response.ok) {
                        const errorBody = await response.json().catch(() => ({})); 
                        const errorDetail = errorBody.details || errorBody.error || `HTTP Error ${response.status}`;

                        customAlert(`PayMongo Refund Failed (Server): ${errorDetail}. Status reverted to ${originalStatus}.`);
                        // Revert status/flags to original state
                        await updateDoc(orderRef, {
                            status: originalStatus,
                            finalRefundStatus: deleteField(),
                            refundRequest: true
                        });
                        return;
                    }
                    // -------------------------------------------------------------------------------------

                    const data = await response.json();
                    console.log("Refund response:", data);

                    if (data.error) {
                        customAlert(`PayMongo Refund failed: ${data.details || data.error}. Please check the PayMongo dashboard.`);
                        await updateDoc(orderRef, {
                            finalRefundStatus: "API Failed",
                            status: "Refund Failed"
                        });
                        return;
                    }
                } else {
                    await updateDoc(orderRef, {
                        refundRequest: deleteField(),
                        finalRefundStatus: "Manual",
                        status: "Refunded"
                    });
                    customAlert(`Manual refund completed: Order #${orderData.queueNumber || 'N/A'} marked as Refunded.`);
                }
            }
        } else if (action === "Denied") {
            // Denied refund request - Final Status
            await updateDoc(orderRef, {
                refundRequest: deleteField(),
                finalRefundStatus: "Denied",
                status: "Refund Denied"
            });
            customAlert(`Refund request for Order #${orderData.queueNumber || 'N/A'} has been denied. Status updated.`);
        }

        renderOrders(); // Re-render to show the updated status
    } catch (err) {
        console.error("Refund Action Handler Error:", err);
        customAlert("A critical error occurred while processing the refund action.");
        // In case of error, try to reset a few flags safely
        try {
            if (originalStatus) { // Check if originalStatus was successfully retrieved
                await updateDoc(orderRef, {
                    status: originalStatus, // Revert to original status
                    refundRequest: true // Re-enable the button for staff to try again
                });
            }
        } catch (resetErr) {
            console.error("Failed to reset order status after refund error:", resetErr);
        }
    }
}


// ----------------------------------------------------
// CRITICALLY CORRECTED: Return stock (Reverse of POS deduction logic)
// ----------------------------------------------------
async function returnStock(orderItems) {
    // Helper function to safely return to inventory using the imported increment
    const returnItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        try {
            // Use the imported increment() function to add stock back
            await updateDoc(invRef, { quantity: increment(Math.abs(amount)) });
            console.log(`✅ Returned ${Math.abs(amount)} of ID: ${id} to stock.`);
        } catch (e) {
            console.error(`Failed to return ${amount} to ID: ${id}.`, e);
        }
    };

    // We get the order items from orderData.items (or .products)
    for (const item of orderItems || []) {
        const productQty = item.qty || item.quantity || 1;

        // 1. Return all BASE ingredients/others required for the product
        for (const ing of item.ingredients || []) {
            await returnItem(ing.id, (ing.qty || 1) * productQty);
        }
        for (const other of item.others || []) {
            await returnItem(other.id, (other.qty || 1) * productQty);
        }

        // 2. Return the SIZE item itself and its associated raw materials
        if (item.sizeId) {
            // A. Return the inventory item representing the size (e.g., the cup/container)
            await returnItem(item.sizeId, productQty);

            // B. Look up the size item's NESTED raw material requirements from the saved productSizes
            const productSizeData = (item.productSizes || []).find(s => s.id === item.sizeId);

            if (productSizeData) {
                // Return ingredients/others associated with the SIZE
                for (const ing of productSizeData.ingredients || []) {
                    await returnItem(ing.id, (ing.qty || 1) * productQty);
                }
                for (const other of productSizeData.others || []) {
                    await returnItem(other.id, (other.qty || 1) * productQty);
                }
            }
        }

        // 3. Return ADD-ONS
        for (const addon of item.addons || []) {
            // A. Return the inventory item representing the addon itself (This assumes addon is an inventory item)
            await returnItem(addon.id, productQty);

            // B. Look up the add-on item's NESTED raw material requirements from Inventory
            try {
                const addonSnap = await getDoc(doc(db, "Inventory", addon.id));
                const addonData = addonSnap.data();

                if (addonData) {
                    // Return ingredients/others associated with the ADDON
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


// ---------------------
// Update order status (Includes Admin Approval Flow)
// ---------------------
async function updateOrderStatus(orderId, collectionName, newStatus, eta = "") {
    if (!orderId || !collectionName) return;

    // Clear auto-cancel timer if it exists
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
        
        // --- 1. ADMIN APPROVAL: 'Wait for Admin to Accept' -> 'Waiting for Payment' ---
        if (originalStatus === "Wait for Admin to Accept" && newStatus === "Waiting for Payment") {
            if (!orderData.paymentMetadata || !orderData.total) {
                customAlert("Error: Cannot accept. Payment metadata is missing from the order.");
                return;
            }

            // A. Generate PayMongo Checkout Link via Netlify Function
            const endpoint = "/netlify/functions/generate-paymongo-link";
            customAlert("Generating secure payment link... Please wait. Do not navigate away.");

            // Temporarily set status to "Processing" to prevent double-clicking 
            await updateDoc(orderRef, { status: "Processing" });

            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    orderId: orderId,
                    collectionName: collectionName,
                    amount: orderData.total, // Send amount in PHP, server will handle centavos
                    lineItems: orderData.paymentMetadata.lineItems,
                    customerDetails: orderData.paymentMetadata.customerDetails,
                    description: `Order ${formatQueueNumber(orderData.queueNumber)}`
                })
            });
            
            // 🛑 CRITICAL FIX: Check for HTTP error status (4xx or 5xx) before JSON parsing
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({})); 
                const errorDetail = errorBody.details || errorBody.error || `HTTP Error ${response.status}`;

                console.error("PayMongo Link Generation Failed - HTTP Error:", errorDetail);
                customAlert(`Payment link failed to generate: ${errorDetail}. Status reverted.`);
                // Revert status to allow re-try
                await updateDoc(orderRef, { status: originalStatus }); 
                return;
            }
            // -----------------------------------------------------------------------------

            const data = await response.json();
            
            if (data.error || !data.checkoutUrl) {
                console.error("PayMongo Link Generation Failed:", data.details || data.error);
                customAlert(`Payment link failed to generate: ${data.details || data.error}. Status reverted.`);
                // Revert status to allow re-try
                await updateDoc(orderRef, { status: originalStatus }); 
                return;
            }

            // B. Success: Update Order with new Status and the generated URL
            updatePayload.checkoutUrl = data.checkoutUrl;
            updatePayload.status = "Waiting for Payment"; // Final status after successful link generation
            updatePayload.paymentMetadata = deleteField(); // Clean up metadata

            customAlert("Payment link generated successfully. Status updated to 'Waiting for Payment'.");
        }
        
        // --- 2. CANCELLATION / DECLINE: New status is "Canceled" ---
        else if (newStatus === "Canceled") {
            // Logic moved from the old place, simplified:
            // If the order has no payment ID (cash/timed out) OR is being declined during approval, return stock.
            if (!orderData.paymongoPaymentId || originalStatus === "Wait for Admin to Accept") {
                await returnStock(orderData.products || orderData.items);
                customAlert(`Order #${orderData.queueNumber} canceled and stock returned.`);
            } else {
                // E-Payment order canceled after being paid (or Waiting for Payment - rare but handled)
                customAlert(`Order #${orderData.queueNumber} is E-Payment. It was manually canceled. Refund must be processed separately.`);
            }
            
            // Finalize cancellation flags
            updatePayload.finalRefundStatus = "Canceled"; 
            updatePayload.refundRequest = deleteField();
        }

        // --- 3. Clear refund flags when moving to a new non-refund status ---
        if (newStatus === "Preparing" || newStatus === "Delivery" || newStatus === "Completed" || newStatus === "Waiting for Payment") {
            updatePayload.refundRequest = deleteField();
            if (newStatus === "Completed") {
                // Clear final status only if it's a clean completion
                updatePayload.finalRefundStatus = deleteField();
            }
        }
        
        // --- Final Firestore Update ---
        await updateDoc(orderRef, updatePayload);
        renderOrders(); // Re-render the list immediately

    } catch (err) {
        console.error("Critical Error in updateOrderStatus:", err);
        customAlert(`A critical error occurred while updating the order status for Order ${orderId}.`);
        
        // Attempt to reset status if it was stuck in "Processing" from the approval block
        if (originalStatus === "Wait for Admin to Accept" && newStatus === "Waiting for Payment") {
            try {
                await updateDoc(orderRef, { status: originalStatus });
                console.warn("Status reverted to 'Wait for Admin to Accept' after API failure.");
            } catch(resetErr) {
                console.error("Failed to revert status:", resetErr);
            }
        }
    }
}


// =========================================================
// INITIALIZATION
// =========================================================

function checkAdminAuth() {
    onAuthStateChanged(auth, user => {
        if (!user) {
            // Redirect to login if not authenticated
            // window.location.href = "login.html"; 
            console.warn("User not authenticated. Assuming access for development.");
        }
        // Once auth is checked, start listening for orders (already started via onSnapshot)
    });
}

checkAdminAuth();

// Initial render to show any orders loaded before the snapshot completes
renderOrders();
