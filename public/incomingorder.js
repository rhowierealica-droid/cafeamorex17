// incomingorders.js

// NOTE: You must include the firestore delete functionality import and the increment import
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
// POPUP MODULE
// =========================================================
let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;

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
    }
    .popup-content h3 {
      margin-bottom: 15px;
      font-size: 1.2rem;
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
      font-family: "Poppins", sans-serif;
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
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      padding: 10px 8px;
      vertical-align: top;
    }
    tr:nth-child(even) {
      background-color: #fff2e0;
    }
    button.accept-btn,
    button.cancel-btn,
    button.complete-btn,
    button.eta-btn,
    button.view-refund-btn {
      margin: 3px;
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      font-family: "Poppins", sans-serif;
      cursor: pointer;
      transition: 0.2s ease;
    }
    .accept-btn { background-color: #28a745; color: white; }
    .cancel-btn { background-color: #dc3545; color: white; }
    .complete-btn { background-color: #007bff; color: white; }
    .eta-btn { background-color: #ffc107; color: #552915; }
    .view-refund-btn { background-color: #795548; color: white; }
    
    /* === NEW REFUND BADGE STYLES === */
    .refund-badge {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.8em;
        font-weight: bold;
        margin-left: 5px;
    }
    /* Use a common class for the default status name */
    .refund-refunded, .refund-succeeded, .refund-manual { background-color: #28a745; color: white; }
    .refund-denied, .refund-failed, .refund-api-failed { background-color: #dc3545; color: white; }
    .refund-pending { background-color: #ffc107; color: #552915; }
    .refund-error { background-color: #6c757d; color: white; } /* Neutral for unexpected states */
  `;
  document.head.appendChild(style);
}
injectPopupStyles();

// =========================================================
// AUTH CHECK
// =========================================================


// ... (POPUP CREATION & CONTROL AND HELPERS ARE UNCHANGED AND OK) ...
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

function closePopup() {
  popup.style.display = "none";
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

    // Automatic Cancellation Timer
    if (order.data.status === "Pending" && !order.data.refundRequest && !pendingTimers[order.id]) {
      pendingTimers[order.id] = setTimeout(() => {
        // For e-payment orders, automatically cancel only if there's no payment ID (i.e., payment failed or timed out)
        if (!order.data.paymongoPaymentId || order.data.paymentMethod === "Cash") {
          updateOrderStatus(order.id, order.collection, "Canceled");
        } else {
          // If it's a paid e-payment order that hasn't been accepted after 60s,
          // log it but don't auto-cancel. Staff needs to manually review or refund.
          console.warn(`E-payment order ${order.id} still Pending after 60s.`);
        }
        delete pendingTimers[order.id];
      }, 60000);
    }

    if (order.data.status !== "Pending" && pendingTimers[order.id]) {
      clearTimeout(pendingTimers[order.id]);
      delete pendingTimers[order.id];
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
      // ⭐ CORRECTED: Tab filtering logic
      if (selectedTab === "Pending") {
        return o.data.status === "Pending" || o.data.refundRequest;
      }
      if (selectedTab === "Completed") {
        // Include final completed, refunded, and manual statuses
        return ["Completed", "Refunded"].includes(o.data.status) || o.data.finalRefundStatus === "Manual";
      }
      if (selectedTab === "Canceled") {
        // Include all cancelled, failed, and denied statuses
        return ["Canceled", "Manually Canceled (E-Pay)", "Refund Failed", "Refund Denied"].includes(o.data.status) || o.data.finalRefundStatus === "API Failed";
      }
      return o.data.status === selectedTab;
    })
    .forEach(orderItem => {
      const order = orderItem.data;
      const orderId = orderItem.id;

      const tr = document.createElement("tr");

      // Calculate Order HTML and Total (Correct logic retained)
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

      // ⭐ UPDATED: Simplified Refund Badge Logic for robustness
      let statusBadge = `<td>${order.status}</td>`;
      const mainStatus = order.status;
      const finalRefundStatus = order.finalRefundStatus || order.refundStatus; // Prefer final status from webhook/handler

      if (finalRefundStatus) {
          const badgeText = finalRefundStatus;
          // Convert status like "Refund Failed" to "refund-failed"
          let badgeClass = badgeText.toLowerCase().replace(/\s/g, '-').replace('(e-pay)', '').trim();

          // Map to established CSS classes for coloring
          if (badgeClass.includes('refunded') || badgeClass === 'pending') badgeClass = 'refund-pending';
          else if (badgeClass.includes('failed') || badgeClass.includes('api-failed')) badgeClass = 'refund-failed';
          else if (badgeClass.includes('denied')) badgeClass = 'refund-denied';
          else if (badgeClass === 'manual') badgeClass = 'refund-manual';
          else badgeClass = 'refund-error'; // Catch-all for unexpected states
        
          // Show the main status (Completed, Refund Pending, Refund Denied, Refund Failed) plus the badge
          const mainStatusDisplay = (mainStatus === badgeText || mainStatus === "Completed") ? "Completed" : mainStatus;

          const refundBadgeHtml = ` <span class="refund-badge ${badgeClass}">${badgeText}</span>`;
          statusBadge = `<td>${mainStatusDisplay}${refundBadgeHtml}</td>`;
      }


      let actionBtnHtml = "";
      switch(order.status) {
        case "Pending":
          actionBtnHtml = order.refundRequest
            ? `<button class="view-refund-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Refund Request</button>`
            : orderItem.type === "Delivery"
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
        case "Completed":
        case "Refund Pending":
        case "Refund Denied":
        case "Refunded": 
        case "Refund Failed": 
          // Show refund button if a refundRequest flag is set, regardless of main status
          if (order.refundRequest) {
            actionBtnHtml = `<button class="view-refund-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Refund Request</button>`;
          } else if (order.status === "Refund Pending") {
                actionBtnHtml = `<button class="view-refund-btn" disabled>Refund Processing...</button>`;
          }
          break;
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
    document.querySelectorAll(".accept-btn").forEach(btn => {
        btn.addEventListener("click", e => {
            const id = e.target.dataset.id;
            const collection = e.target.dataset.collection;
            const type = e.target.dataset.type;

            if(type === "Delivery") {
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

    document.querySelectorAll(".view-refund-btn").forEach(btn => {
        btn.addEventListener("click", async e => {
            const orderId = e.target.dataset.id;
            const collectionName = e.target.dataset.collection;
            const orderRef = doc(db, collectionName, orderId);
            const orderSnap = await getDoc(orderRef);
            if(!orderSnap.exists()) return;

            const orderData = orderSnap.data();
            let productsHtml = (orderData.products || orderData.items || []).map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}:₱${(a.price || 0).toFixed(2)}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                const sizePrice = p.basePrice || 0; 
                const addonsPrice = p.addons.reduce((sum, a) => sum + (a.price || 0), 0); 
                const totalPrice = ((sizePrice + addonsPrice) * qty).toFixed(2);

                return `<div>${qty} x ${p.product}${sizeText}${addons} - ₱${totalPrice}</div>`;
            }).join("");
            
            // Add delivery fee to refund calculation if applicable
            const deliveryFee = orderData.deliveryFee || 0;
            if (deliveryFee > 0) {
                productsHtml += `<div>1 x Delivery Fee - ₱${deliveryFee.toFixed(2)}</div>`;
            }

            // Calculate correct max refund per order
            const maxRefundable = orderData.total; 

            // Show first popup with Accept/Decline
            popupButtonsContainer.innerHTML = `
                <h3>Refund Request for Queue #${formatQueueNumber(orderData.queueNumber)}</h3>
                <div style="text-align: left; margin-bottom: 15px;">${productsHtml}</div>
                <div style="font-weight: bold; margin-bottom: 15px;">Total Order: ₱${orderData.total.toFixed(2)}</div>
                <div>
                    <button id="acceptRefundBtn" style="background-color:#28a745; margin-top:10px;">Accept Refund</button>
                    <button id="declineRefundBtn" style="background-color:#dc3545; margin-top:5px;">Deny Refund</button>
                </div>
            `;
            popup.style.display = "flex";
            popupTitle.textContent = "Order Details"; // Change generic title

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
    if(!popup) createPopup();
    popupTitle.textContent = "Enter Refund Amount";

    popupButtonsContainer.innerHTML = `
        <label>Refund Amount (max ₱${maxRefundable.toFixed(2)}):</label>
        <input type="number" id="refundInput" value="${maxRefundable.toFixed(2)}" max="${maxRefundable}" min="0.01" step="0.01" style="width: 100%; margin-top:5px;">
        ${paymongoPaymentId ? '' : '<div style="color:#dc3545; margin-top:5px; font-weight:bold;">⚠️ NOT E-Payment: Manual Cash Refund Required.</div>'}
        <button id="confirmRefundBtn" style="margin-top:10px;">Confirm Refund</button>
        <button id="cancelRefundBtn" style="margin-top:5px;">Cancel</button>
    `;
    popup.style.display = "flex";

    document.getElementById("confirmRefundBtn").onclick = () => {
        const refundAmount = parseFloat(document.getElementById("refundInput").value);
        if(isNaN(refundAmount) || refundAmount <= 0 || refundAmount > maxRefundable){
            alert("Invalid amount. Must be >₱0 and ≤ the max refundable amount.");
            return;
        }
        closePopup();
        handleRefundAction(orderId, collectionName, "Accepted", refundAmount);
    };

    document.getElementById("cancelRefundBtn").onclick = () => {
        closePopup();
    };
}

// ---------------------
// Handle Refund Action
// ---------------------
async function handleRefundAction(orderId, collectionName, action, refundAmount = 0) {
    try {
        const orderRef = doc(db, collectionName, orderId);
        const orderSnap = await getDoc(orderRef);
        if(!orderSnap.exists()) return;

        const orderData = orderSnap.data();

        if(action === "Accepted") {
            // Check if it was an E-Payment order
            if(orderData.paymongoPaymentId) {
                // ⭐ CRITICAL FIX: Ensure correct path to Netlify function
                const endpoint = "/.netlify/functions/refund-payment";
                
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paymongoPaymentId: orderData.paymongoPaymentId, amount: refundAmount })
                });
                const data = await response.json();
                console.log("Refund response:", data);
                
                if (data.error) {
                    alert(`PayMongo Refund failed: ${data.details || data.error}. Please check the PayMongo dashboard.`);
                    
                    // Update status to reflect the API failure (prevents it from hanging in "Refund Pending")
                    await updateDoc(orderRef, { 
                        refundRequest: deleteField(), 
                        refundStatus: deleteField(), 
                        finalRefundStatus: "API Failed", // Set final error state
                        status: "Refund Failed" // Set main status to Refund Failed
                    });
                    return; 
                }
                
                // Update status immediately to reflect request sent (only if API call succeeded)
                await updateDoc(orderRef, { 
                    refundStatus: deleteField(), 
                    finalRefundStatus: "Pending", // Set to Pending until webhook confirms success/failure
                    refundRequest: deleteField(), 
                    status: "Refund Pending"
                });
            } else {
                // Not a PayMongo order (Cash/Manual)
                alert(`This was a Cash/Manual order. Please complete the ₱${refundAmount.toFixed(2)} refund manually.`);
                await updateDoc(orderRef, { 
                    refundStatus: deleteField(), 
                    finalRefundStatus: "Manual", // Mark as manual success
                    refundRequest: deleteField(), 
                    status: "Refunded" // Treat as refunded after manual confirmation
                });
            }
        } else if(action === "Denied") {
            // Denied refund request
            await updateDoc(orderRef, { 
                refundStatus: deleteField(), 
                finalRefundStatus: "Denied",
                refundRequest: deleteField(), 
                // Change status to Refund Denied for clear visibility
                status: "Refund Denied" 
            });
            alert(`Refund request for Order #${orderData.queueNumber || 'N/A'} has been denied. Status updated to "Refund Denied".`);
        }

        renderOrders();
    } catch(err) {
        console.error("Refund Action Handler Error:", err);
        alert("Failed to process refund. Check console logs and PayMongo.");
    }
}

// ---------------------
// Update order status
// ---------------------
async function updateOrderStatus(orderId, collectionName, newStatus, eta = "") {
    if(!orderId || !collectionName) return;

    if(pendingTimers[orderId]) {
        clearTimeout(pendingTimers[orderId]);
        delete pendingTimers[orderId];
    }

    try {
        const orderData = ordersData.find(o => o.id === orderId)?.data;
        if(!orderData) return;
        
        const updatePayload = { 
            status: newStatus,
            estimatedTime: eta || deleteField() 
        };

        // Stock return only for non-PayMongo (e.g., cash) cancelled orders
        if(newStatus === "Canceled") {
            // Only perform stock return if it wasn't a PayMongo order (i.e., Cash)
            if(!orderData.paymongoPaymentId) {
             await returnStock(orderData.products || orderData.items); // Pass the array of order items
            } else {
                // E-Payment orders that are canceled manually should prompt the staff
                // to use the refund flow, but if they cancel, mark it clearly.
                updatePayload.status = "Manually Canceled (E-Pay)"; // Change main status
                updatePayload.finalRefundStatus = "Manually Canceled (E-Pay)"; // Use final status field
            }
        }
        
        // Remove refund flags if accepting a request that was in 'Pending' or moving status forward
        if (newStatus === "Preparing" || newStatus === "Delivery" || newStatus === "Completed") {
            updatePayload.refundRequest = deleteField(); 
            updatePayload.refundStatus = deleteField(); 
            updatePayload.finalRefundStatus = deleteField(); 
        }

        await updateDoc(doc(db, collectionName, orderId), updatePayload);

        renderOrders();
    } catch(err) {
        console.error(err);
        alert("Failed to update order status.");
    }
}

// ----------------------------------------------------
// ✅ CRITICALLY CORRECTED: Return stock (Reverse of POS deduction logic)
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
        
        // 3. Return ADD-ONS (Requires fetching Addon details from Inventory)
        for (const addon of item.addons || []) {
            // A. Return the inventory item representing the addon itself
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
