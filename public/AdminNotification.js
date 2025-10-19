import { onSnapshot, collection, doc, setDoc, getDocs, query, where, orderBy, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db } from './firebase-config.js';

const notifSound = new Audio('notification.mp3');

// --- Inventory Thresholds ---
const THRESHOLDS = {
    "volume": { low: 50, out: 0 },
    "count": { low: 10, out: 0 },
    "scoop": { low: 5, out: 0 },
    "sizes": { low: 30, out: 0 }
};

// --- Global State ---
let currentUser = null;
let listenersAttached = false; 
const displayedNotifs = new Set();
const inventoryStatusMap = {};
// processedDocIds tracks initial orders to prevent a flood of notifications on startup.
const processedDocIds = new Set(); 
let unreadCount = 0;

// --- Create containers (Functional styles only kept inline) ---
let bellContainer = document.getElementById("adminNotifBellContainer") || (() => {
    const el = document.createElement("div");
    el.id = "adminNotifBellContainer";
    // Functional styles: positioning, z-index, initial display
    el.innerHTML = `<i class="fas fa-bell"></i><span class="badge" style="display:none;">0</span>`;
    el.style.cssText = `position:fixed; top:20px; right:20px; cursor:pointer; z-index:9999; display:none;`; 
    document.body.appendChild(el);
    return el;
})();
const adminBadge = bellContainer.querySelector(".badge");


let notifDropdown = document.getElementById("adminNotifDropdown") || (() => {
    const el = document.createElement("div");
    el.id = "adminNotifDropdown";
    // Functional styles: positioning, z-index, layout
    el.style.cssText = `
        display: none;
        position: fixed;
        top: 60px;
        right: 20px;
        width: 320px;
        max-height: 400px;
        overflow-y: auto;
        z-index: 9999;
        flex-direction: column;
        padding: 8px 0;
    `;
    document.body.appendChild(el);
    return el;
})();

// Control buttons 
const controlContainer = document.createElement("div");
controlContainer.className = "control-container";
const readAllBtn = document.createElement("button");
readAllBtn.textContent = "Read All";
readAllBtn.id = "readAllBtn"; 
const clearAllBtn = document.createElement("button");
clearAllBtn.textContent = "Clear All";
clearAllBtn.id = "clearAllBtn"; 
controlContainer.appendChild(readAllBtn);
controlContainer.appendChild(clearAllBtn);
if (notifDropdown.firstChild !== controlContainer) {
    notifDropdown.prepend(controlContainer);
}

// Empty message
const emptyMessage = document.createElement("div");
emptyMessage.id = "notifEmpty";
emptyMessage.textContent = "No new admin notifications";
if (notifDropdown.lastChild !== emptyMessage) {
    notifDropdown.appendChild(emptyMessage);
}


// --- Toggle dropdown ---
bellContainer.addEventListener("click", () => {
    notifDropdown.style.display = notifDropdown.style.display === "flex" ? "none" : "flex";
});

// --- Auth state ---
const auth = getAuth();
onAuthStateChanged(auth, async user => {
    currentUser = user;

    if (user) {
        bellContainer.style.display = "inline-block";
        await loadUserNotifications();
        if (!listenersAttached) {
            await initializeProcessedTracker(); 
            listenAdminEvents();
            listenersAttached = true;
        }
    } else {
        bellContainer.style.display = "none";
        notifDropdown.style.display = "none";
        listenersAttached = false;
        Object.keys(inventoryStatusMap).forEach(key => delete inventoryStatusMap[key]);
        processedDocIds.clear();
        notifDropdown.querySelectorAll(".notifItem").forEach(el => el.remove()); 
        displayedNotifs.clear();
        unreadCount = 0;
        updateBadge();
        updateEmptyMessage();
    }
});

// -----------------------------------------------------------------
// --- CRITICAL FIX: INITIALIZE DOCUMENT TRACKER (Orders only) ---
// -----------------------------------------------------------------
async function initializeProcessedTracker() {
    const trackedCollections = ["InStoreOrders", "DeliveryOrders"]; 
    
    for (const coll of trackedCollections) {
        const snapshot = await getDocs(collection(db, coll));
        snapshot.forEach(docSnap => {
            // Use a combination of collection name and ID to ensure uniqueness across collections
            processedDocIds.add(`${coll}_${docSnap.id}`); 
        });
    }
    console.log(`✅ Initialized processed document list with ${processedDocIds.size} existing orders.`);
}


// --- Core Listener Function ---
function listenAdminEvents() {
    listenOrderChanges(); // Now handles NEW orders AND MODIFIED statuses (including refund)
    listenInventoryChanges();
}

// -----------------------------------------------------------------
// --- 1. ORDER CHANGES LISTENER (NEW ORDERS & REFUND REQUESTS) ---
// -----------------------------------------------------------------
function listenOrderChanges() {
    const orderCollections = ["InStoreOrders", "DeliveryOrders"];
    
    orderCollections.forEach(coll => {
        // Log to confirm listener attachment
        console.log(`Attaching listener to ${coll} for order/refund changes.`);

        onSnapshot(collection(db, coll), snapshot => {
            snapshot.docChanges().forEach(async change => {
                const order = change.doc.data();
                const orderId = change.doc.id;
                const docKey = `${coll}_${orderId}`;
                const orderType = coll === "InStoreOrders" ? "In-Store" : "Delivery";

                let message = null;
                let notifType = null;
                
                // --- A) NEW ORDER ---
                if (change.type === "added" && !processedDocIds.has(docKey)) {
                    processedDocIds.add(docKey); 
                    message = `🚨 NEW ORDER: ${orderType} Order #${order.queueNumber || orderId} received.`;
                    notifType = 'order';
                } 
                
                // --- B) REFUND REQUEST (STATUS MODIFIED) ---
                else if (change.type === "modified") {
                    // Check the previous state of the document
                    const oldOrder = change.oldDoc.data();
                    const currentRefundStatus = order.refundStatus;
                    // Fallback to empty string if field is missing in old document
                    const previousRefundStatus = oldOrder.refundStatus || ""; 

                    // CRITICAL CHECK: Refund status is currently "Requested" AND it was NOT "Requested" before
                    if (currentRefundStatus === "Requested" && previousRefundStatus !== "Requested") {
                        
                        console.log(`💸 REFUND DETECTED: Order ${orderId}. Old Status: ${previousRefundStatus}. New Status: ${currentRefundStatus}`); 
                        
                        message = `💸 **REFUND REQUEST**: Order #${order.queueNumber || orderId} requires review.`;
                        notifType = 'refund';
                    }
                }
                
                if (message && currentUser) {
                    // Create Notification Document for the Admin
                    const notifRef = doc(collection(db, "Notifications"));
                    await setDoc(notifRef, {
                        userId: currentUser.uid, 
                        message,
                        type: notifType,
                        read: false,
                        timestamp: Date.now()
                    });
                    showNotification(message, notifRef.id, true);
                }
            });
        }, (error) => {
            // CRITICAL: Log errors to catch Security Rule issues
            console.error(`❌ Firestore listener error on ${coll}:`, error);
        });
    });
}

// -----------------------------------------------------------------
// --- 2. INVENTORY CHANGE LISTENER ---
// -----------------------------------------------------------------
function getInventoryStatus(item){
    const qty = Number(item.quantity) || 0;
    const category = item.category;
    const unit = item.unit;

    // Helper to get threshold based on item properties
    const getThreshold = (u) => {
        if (["g", "ml"].includes(u)) return THRESHOLDS.volume;
        if (["slice", "piece", "squeeze"].includes(u)) return THRESHOLDS.count;
        if (u === "scoop") return THRESHOLDS.scoop;
        if (category === "Sizes") return THRESHOLDS.sizes;
        return { low: 0, out: 0 }; 
    };
    
    const threshold = getThreshold(unit);

    if (qty === threshold.out) return "Out of Stock";
    if (qty < threshold.low) return "Low Stock";
    
    return "In Stock";
}

function listenInventoryChanges() {
    onSnapshot(collection(db, "Inventory"), snapshot => {
        snapshot.docChanges().forEach(async change => {
            const item = change.doc.data();
            const itemId = change.doc.id;
            const currentStatus = getInventoryStatus(item);
            const previousStatus = inventoryStatusMap[itemId];

            inventoryStatusMap[itemId] = currentStatus;

            // Only notify if status changes TO 'Low Stock' or 'Out of Stock'
            if (previousStatus && previousStatus !== currentStatus) {
                let message = "";
                let shouldNotify = false;

                if (currentStatus === "Low Stock" && previousStatus !== "Low Stock") {
                    message = `⚠️ LOW STOCK: ${item.name} (${item.quantity} ${item.unit}) is running low!`;
                    shouldNotify = true;
                } else if (currentStatus === "Out of Stock" && previousStatus !== "Out of Stock") {
                    message = `🔴 OUT OF STOCK: ${item.name} is now depleted!`;
                    shouldNotify = true;
                }
                
                if (shouldNotify && currentUser) {
                    const notifRef = doc(collection(db, "Notifications"));
                    await setDoc(notifRef, {
                        userId: currentUser.uid, 
                        message,
                        type: 'stock',
                        read: false,
                        timestamp: Date.now()
                    });
                    showNotification(message, notifRef.id, true);
                }
            }
        });
    }, (error) => {
        console.error("Error listening to inventory:", error);
    });
}

// -----------------------------------------------------------------
// --- GENERIC NOTIFICATION FUNCTIONS ---
// -----------------------------------------------------------------

// --- Load notifications (Admin filter) ---
async function loadUserNotifications() {
    if (!currentUser) return;
    
    notifDropdown.querySelectorAll(".notifItem").forEach(el => el.remove()); 
    displayedNotifs.clear();
    unreadCount = 0;

    const notifQuery = query(
        collection(db, "Notifications"),
        where("userId", "==", currentUser.uid),
        orderBy("timestamp", "desc")
    );
    const snapshot = await getDocs(notifQuery);
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        showNotification(data.message, docSnap.id, !data.read);
    });
    updateEmptyMessage();
    updateBadge();
}

// --- Show notification (CSS cleanup: minimal functional inline styles kept) ---
function showNotification(message, docId, isUnread = true) {
    if (displayedNotifs.has(docId)) return;
    displayedNotifs.add(docId);

    const notifItem = document.createElement("div");
    notifItem.className = "notifItem";
    notifItem.dataset.docId = docId; 
    
    // Only essential layout styles remain inline
    notifItem.style.cssText = "display:flex; justify-content:space-between; align-items:center;";

    if (isUnread) {
        notifItem.classList.add("unread");
        // Keep dynamic background color inline for simplicity
        notifItem.style.backgroundColor = "#fffde7"; 
    }

    // Class names are added to inner elements for CSS styling
    notifItem.innerHTML = `<div class="notifText" tabindex="0">${message}</div><div class="notifClose">&times;</div>`;
    
    notifDropdown.insertBefore(notifItem, notifDropdown.children[1]); 

    if (isUnread) {
        unreadCount++;
        updateBadge();
    }

    notifItem.querySelector(".notifText").addEventListener("click", async () => {
        if (notifItem.classList.contains("unread")) {
            await updateDoc(doc(db, "Notifications", docId), { read: true });
            
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadge();

            notifItem.classList.remove("unread");
            notifItem.style.backgroundColor = "white"; 
        }
    });

    notifItem.querySelector(".notifClose").addEventListener("click", async () => {
        const wasUnread = notifItem.classList.contains("unread");
        
        await deleteDoc(doc(db, "Notifications", docId));
        notifItem.remove();
        displayedNotifs.delete(docId);
        
        if (wasUnread) {
            unreadCount = Math.max(0, unreadCount - 1);
            updateBadge();
        }
        updateEmptyMessage();
    });

    updateEmptyMessage();

    if (isUnread) {
        notifSound.currentTime = 0;
        notifSound.play().catch(e => console.log("Sound play blocked:", e));
    }
}

// --- Empty message ---
function updateEmptyMessage() {
    const hasNotifs = notifDropdown.querySelectorAll(".notifItem").length > 0;
    emptyMessage.style.display = hasNotifs ? "none" : "block";
}

// --- Read all ---
readAllBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const notifDocs = await getDocs(query(collection(db, "Notifications"), where("userId", "==", currentUser.uid), where("read", "==", false)));
    
    notifDocs.forEach(docSnap => {
        updateDoc(doc(db, "Notifications", docSnap.id), { read: true });
    });
    
    document.querySelectorAll("#adminNotifDropdown .notifItem.unread").forEach(el => {
        el.classList.remove("unread");
        el.style.backgroundColor = "white";
    });
    
    unreadCount = 0;
    updateBadge();
});

// --- Clear all ---
clearAllBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const notifDocs = await getDocs(query(collection(db, "Notifications"), where("userId", "==", currentUser.uid)));
    
    notifDocs.forEach(docSnap => deleteDoc(doc(db, "Notifications", docSnap.id)));
    
    document.querySelectorAll("#adminNotifDropdown .notifItem").forEach(el => el.remove());
    displayedNotifs.clear();
    unreadCount = 0;
    updateBadge();
    updateEmptyMessage();
});

// --- Update badge ---
function updateBadge() {
    adminBadge.textContent = unreadCount;
    adminBadge.style.display = unreadCount > 0 ? "inline-block" : "none";
}