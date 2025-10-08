import { db } from './firebase-config.js';
import { collection, doc, onSnapshot, updateDoc, getDocs, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


const auth = getAuth();
const ordersBody = document.getElementById("ordersBody");
const tabButtons = document.querySelectorAll(".tab-btn");

let ordersData = [];
let selectedTab = "Pending";
const pendingTimers = {};

// ---------------------
// Popup Module
// ---------------------
let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html"); // redirect
    return;
  }

  // User is logged in -> initialize the app
  // Assuming you have an init() function defined elsewhere or don't need it if this is the main logic
});

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

    const timeOptions = ["10 to 20 mins","20 to 30 mins","30 to 40 mins","40 to 50 mins","50 to 60 mins"];
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

// ---------------------
// Helper
// ---------------------
function formatQueueNumber(num) {
    return num ? num.toString().padStart(4, "0") : "----";
}

// ---------------------
// Tab Switch
// ---------------------
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTab = btn.dataset.status;
        renderOrders();
    });
});

// ---------------------
// Firestore listeners
// ---------------------
onSnapshot(collection(db, "InStoreOrders"), snapshot => handleOrderSnapshot(snapshot, "In-Store", "InStoreOrders"));
onSnapshot(collection(db, "DeliveryOrders"), snapshot => handleOrderSnapshot(snapshot, "Delivery", "DeliveryOrders"));

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

        // Timeout to cancel pending orders after 60 seconds
        if (order.data.status === "Pending" && !pendingTimers[order.id]) {
            pendingTimers[order.id] = setTimeout(() => {
                updateOrderStatus(order.id, order.collection, "Canceled");
                delete pendingTimers[order.id];
            }, 60000); // 60 seconds
        }

        // Clear timeout if status changes from pending
        if (order.data.status !== "Pending" && pendingTimers[order.id]) {
            clearTimeout(pendingTimers[order.id]);
            delete pendingTimers[order.id];
        }
    });

    renderOrders();
}

// ---------------------
// Render orders
// ---------------------
function renderOrders() {
    ordersBody.innerHTML = "";

    ordersData
        .filter(orderItem => {
            if (selectedTab === "Completed") {
                return ["Completed", "Refund Pending", "Refunded", "Refund Failed"].includes(orderItem.data.status);
            }
            if (selectedTab === "Canceled") {
                return ["Canceled", "Refund Failed"].includes(orderItem.data.status);
            }
            return orderItem.data.status === selectedTab;
        })
        .forEach(orderItem => {
            const order = orderItem.data;
            const orderId = orderItem.id;

            const tr = document.createElement("tr");

            let orderHtml = (order.products || order.items || []).map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}:₱${a.price}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                const sizePrice = p.sizePrice || 0;
                const addonsPrice = p.addonsPrice || 0;
                const totalPrice = ((sizePrice + addonsPrice) * qty).toFixed(2);

                return `<div>${qty} x ${p.product}${sizeText}${addons} - ₱${totalPrice}</div>`;
            }).join("");

            const grandTotal = (order.products || order.items || []).reduce((sum, p) => {
                const qty = p.qty || p.quantity || 1;
                const sizePrice = p.sizePrice || 0;
                const addonsPrice = p.addonsPrice || 0;
                return sum + ((sizePrice + addonsPrice) * qty);
            }, 0).toFixed(2);

            const queueNumber = formatQueueNumber(order.queueNumber);
            const estimatedTimeText = order.estimatedTime ? `<div>ETA: ${order.estimatedTime}</div>` : "";

            let statusBadge = `<td>${order.status}</td>`;
            if (["Completed","Canceled","Refund Pending","Refunded","Refund Failed"].includes(order.status)) {
                let refundStatusText = '';
                if(order.finalRefundStatus) {
                    refundStatusText = ` <span class="refund-badge refund-${order.finalRefundStatus.toLowerCase()}">${order.finalRefundStatus}</span>`;
                }
                statusBadge = `<td>${order.status}${refundStatusText}</td>`;
            }

            let actionBtnHtml = "";

            switch(order.status) {
                case "Pending":
                    if(order.refundRequest) {
                        actionBtnHtml = `<button class="view-refund-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Refund Request</button>`;
                    } else {
                        if(orderItem.type === "Delivery") {
                            actionBtnHtml = `<button class="accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-type="Delivery">Preparing (Set ET)</button>
                                             <button class="cancel-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Cancel</button>`;
                        } else {
                            actionBtnHtml = `<button class="accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-type="In-Store">Preparing</button>
                                             <button class="cancel-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Cancel</button>`;
                        }
                    }
                    break;

                case "Preparing":
                    if(orderItem.type === "Delivery") {
                        actionBtnHtml = `<button class="eta-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-status="Delivery">Set ET for Delivery</button>`;
                    } else {
                        actionBtnHtml = `<button class="complete-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Completed</button>`;
                    }
                    break;

                case "Delivery":
                    actionBtnHtml = `<button class="complete-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Completed</button>`;
                    break;

                case "Completed":
                    if(order.refundRequest) {
                        actionBtnHtml = `<button class="view-refund-btn" data-id="${orderId}" data-collection="${orderItem.collection}">View Refund Request</button>`;
                    }
                    break;
                
                case "Refund Pending": 
                case "Refunded":
                case "Refund Failed":
                case "Canceled":
                    actionBtnHtml = "";
                    break;
            }

            tr.innerHTML = `
                <td>${queueNumber}</td>
                <td>${orderItem.type}</td>
                <td>${orderHtml || "No products"}${estimatedTimeText}<div><strong>Total: ₱${grandTotal}</strong></div></td>
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
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => `${a.name}:₱${a.price}`).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                const qty = p.qty || p.quantity || 1;
                const sizePrice = p.sizePrice || 0;
                const addonsPrice = p.addonsPrice || 0;
                const totalPrice = ((sizePrice + addonsPrice) * qty).toFixed(2);

                return `<div>${qty} x ${p.product}${sizeText}${addons} - ₱${totalPrice}</div>`;
            }).join("");

            if(!popup) createPopup();
            popupTitle.textContent = `Refund Request for Order #${orderData.queueNumber || 'N/A'}`;

            // Calculate correct max refund per order
            const requestedRefund = (orderData.products || orderData.items || []).reduce((sum, p) => {
                const qty = p.qty || p.quantity || 1;
                const sizePrice = p.sizePrice || 0;
                const addonsPrice = p.addonsPrice || 0;
                return sum + ((sizePrice + addonsPrice) * qty);
            }, 0);

            // Show first popup with Accept/Decline
            popupButtonsContainer.innerHTML = `
                <div>${productsHtml}</div>
                <div style="margin-top:10px;">
                    <button id="acceptRefundBtn" style="margin-top:10px;">Accept Refund</button>
                    <button id="declineRefundBtn" style="margin-top:5px;">Decline Refund</button>
                </div>
            `;
            popup.style.display = "flex";

            document.getElementById("acceptRefundBtn").onclick = () => {
                closePopup();
                showRefundAmountPopup(orderId, collectionName, requestedRefund);
            };

            document.getElementById("declineRefundBtn").onclick = () => {
                closePopup();
                handleRefundAction(orderId, collectionName, "Canceled");
            };
        });
    });
}

// ---------------------
// Show Refund Amount Popup (Second Popup)
// ---------------------
function showRefundAmountPopup(orderId, collectionName, requestedRefund) {
    if(!popup) createPopup();
    popupTitle.textContent = "Enter Refund Amount";

    popupButtonsContainer.innerHTML = `
        <label>Refund Amount (max ₱${requestedRefund.toFixed(2)}):</label>
        <input type="number" id="refundInput" value="${requestedRefund}" max="${requestedRefund}" min="0.01" step="0.01" style="width: 100%; margin-top:5px;">
        <button id="confirmRefundBtn" style="margin-top:10px;">Confirm Refund</button>
        <button id="cancelRefundBtn" style="margin-top:5px;">Cancel</button>
    `;
    popup.style.display = "flex";

    document.getElementById("confirmRefundBtn").onclick = () => {
        const refundAmount = parseFloat(document.getElementById("refundInput").value);
        if(isNaN(refundAmount) || refundAmount <= 0 || refundAmount > requestedRefund){
            alert("Invalid amount. Must be >0 and ≤ requested refund.");
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
            if(orderData.paymongoPaymentId) {
const response = await fetch("/.netlify/functions/refund-payment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paymongoPaymentId: orderData.paymongoPaymentId, amount: refundAmount })
                });
                const data = await response.json();
                console.log("Refund response:", data);
                if (data.error) {
                    alert(`PayMongo Refund failed: ${data.details || data.error}`);
                    return; 
                }
                
                // ⭐ CRITICAL FIX APPLIED: Removed returnStock(orderData) call here. 
                // Stock return for paid orders must be handled by the backend's webhook 
                // upon receiving the 'refund.succeeded' event.
            }
            
            // Update status immediately to reflect request sent
            await updateDoc(orderRef, { 
                refundStatus: "Pending", // Set to Pending until webhook confirms success/failure
                refundRequest: false,
                status: "Refund Pending"
            });
        } else if(action === "Canceled") {
            // Denied refund request
            await updateDoc(orderRef, { 
                refundStatus: "Denied", 
                refundRequest: false,
            });
        }

        renderOrders();
    } catch(err) {
        console.error(err);
        alert("Failed to process refund. Check server logs.");
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

        // Stock return only for non-PayMongo (e.g., cash) cancelled orders
        if(newStatus === "Canceled" && !orderData.paymongoPaymentId) {
             await returnStock(orderData);
        }

        await updateDoc(doc(db, collectionName, orderId), { 
            status: newStatus,
            estimatedTime: eta
        });

        renderOrders();
    } catch(err) {
        console.error(err);
        alert("Failed to update order status.");
    }
}

// ---------------------
// Return stock (Only used for local/cash cancellations)
// ---------------------
async function returnStock(orderData) {
    // WARNING: This method is prone to race conditions. 
    // It is acceptable for manual staff-triggered events (like cash cancellation)
    // but the backend webhook should use Firebase Transactions/Increment for safety.
    const inventorySnapshot = await getDocs(collection(db, "Inventory"));

    for(const product of orderData.products || orderData.items || []) {
        const itemsToReturn = [];
        (product.ingredients || []).forEach(item => itemsToReturn.push(item));
        (product.addons || []).forEach(item => itemsToReturn.push(item));
        (product.others || []).forEach(item => itemsToReturn.push(item));
        
        if(product.size) {
            if(product.size.id) {
                itemsToReturn.push({ id: product.size.id, name: product.size.name, qty: product.size.qty || 1 });
            }
        }

        for(const item of itemsToReturn) {
            const invDoc = inventorySnapshot.docs.find(d => 
                (item.id && d.id === item.id) || d.data().name === item.name
            );

            if(!invDoc) continue;

            const invData = invDoc.data();
            const qtyUsed = (item.qty || 1) * (product.qty || 1);
            await updateDoc(doc(db, "Inventory", invDoc.id), { quantity: (invData.quantity || 0) + qtyUsed });
            console.log(`✅ Returned ${qtyUsed} of ${invDoc.data().name} (ID: ${invDoc.id}) to stock.`);
        }
    }
}
