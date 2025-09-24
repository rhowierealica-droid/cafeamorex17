import { db } from './firebase-config.js';
import { collection, doc, onSnapshot, updateDoc, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

function createPopup() {
    popup = document.createElement("div");
    popup.className = "popup";
    popup.innerHTML = `
        <div class="popup-content">
            <h3 id="popupTitle">Select Estimated Time</h3>
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

        if (order.data.status === "Pending" && !pendingTimers[order.id]) {
            pendingTimers[order.id] = setTimeout(() => {
                updateOrderStatus(order.id, order.collection, "Canceled");
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

// ---------------------
// Render orders
// ---------------------
function renderOrders() {
    ordersBody.innerHTML = "";

    ordersData
        .filter(orderItem => orderItem.data.status === selectedTab)
        .forEach(orderItem => {
            const order = orderItem.data;
            const orderId = orderItem.id;

            const tr = document.createElement("tr");

            let orderHtml = (order.products || order.items || []).map(p => {
                const addons = p.addons?.length ? ` (Add-ons: ${p.addons.map(a => a.name).join(", ")})` : "";
                const sizeText = p.size ? (typeof p.size === "string" ? ` [${p.size}]` : ` [${p.size.name}]`) : "";
                return `<div>${p.qty} x ${p.product}${sizeText}${addons}</div>`;
            }).join("");

            const queueNumber = formatQueueNumber(order.queueNumber);
            const estimatedTimeText = order.estimatedTime ? `<div>ETA: ${order.estimatedTime}</div>` : "";

            let actionBtnHtml = "";

            switch(order.status) {
                case "Pending":
                    // Pending → click Preparing → show ET for Preparing (Delivery) or mark Preparing (In-Store)
                    if(orderItem.type === "Delivery") {
                        actionBtnHtml = `<button class="accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-type="Delivery">Preparing (Set ET)</button>
                                         <button class="cancel-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Cancel</button>`;
                    } else {
                        actionBtnHtml = `<button class="accept-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-type="In-Store">Preparing</button>
                                         <button class="cancel-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Cancel</button>`;
                    }
                    break;

                case "Preparing":
                    if(orderItem.type === "Delivery") {
                        // Preparing → click Delivery → show ET for Delivery
                        actionBtnHtml = `<button class="eta-btn" data-id="${orderId}" data-collection="${orderItem.collection}" data-status="Delivery">Set ET for Delivery</button>`;
                    } else {
                        // In-Store: Preparing → Complete
                        actionBtnHtml = `<button class="complete-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Completed</button>`;
                    }
                    break;

                case "Delivery":
                    // Delivery → Complete
                    actionBtnHtml = `<button class="complete-btn" data-id="${orderId}" data-collection="${orderItem.collection}">Completed</button>`;
                    break;

                case "Completed":
                case "Canceled":
                    actionBtnHtml = "";
                    break;
            }

            tr.innerHTML = `
                <td>${queueNumber}</td>
                <td>${orderItem.type}</td>
                <td>${orderHtml || "No products"}${estimatedTimeText}</td>
                <td>${order.status}</td>
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
            const status = e.target.dataset.status; // Delivery
            showETPopup(`Select ET for ${status}`, eta => updateOrderStatus(id, collection, status, eta));
        });
    });

    document.querySelectorAll(".cancel-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Canceled"));
    });

    document.querySelectorAll(".complete-btn").forEach(btn => {
        btn.addEventListener("click", e => updateOrderStatus(e.target.dataset.id, e.target.dataset.collection, "Completed"));
    });
}

// ---------------------
// Update order status
// ---------------------
async function updateOrderStatus(orderId, collectionName, newStatus, eta = "") {
    if (!orderId || !collectionName) return;

    if (pendingTimers[orderId]) {
        clearTimeout(pendingTimers[orderId]);
        delete pendingTimers[orderId];
    }

    try {
        const orderData = ordersData.find(o => o.id === orderId)?.data;
        if (!orderData) return;

        if (newStatus === "Canceled") await returnStock(orderData);

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
// Return stock
// ---------------------
async function returnStock(orderData) {
    const inventorySnapshot = await getDocs(collection(db, "Inventory"));

    for (const product of orderData.products || orderData.items || []) {
        const itemsUsed = [...(product.ingredients || []), ...(product.addons || []), ...(product.others || [])];

        if (product.size) {
            if (typeof product.size === "string") itemsUsed.push({ name: product.size, qty: 1 });
            else if (product.size.name) itemsUsed.push({ name: product.size.name, qty: product.size.qty || 1 });
        }

        for (const item of itemsUsed) {
            const invDoc = inventorySnapshot.docs.find(d => d.data().name === item.name);
            if (!invDoc) continue;

            const invData = invDoc.data();
            const qtyUsed = (item.qty || 1) * (product.qty || 1);
            await updateDoc(doc(db, "Inventory", invDoc.id), { quantity: (invData.quantity || 0) + qtyUsed });
        }
    }
}
