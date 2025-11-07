import { onSnapshot, collection, doc, setDoc, getDocs, query, where, orderBy, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db } from './firebase-config.js';

const notifSound = new Audio('notification.mp3');

const THRESHOLDS = {
    "volume": { low: 50, out: 0 },
    "count": { low: 10, out: 0 },
    "scoop": { low: 5, out: 0 },
    "sizes": { low: 30, out: 0 }
};

let currentUser = null;
let listenersAttached = false; 
const displayedNotifs = new Set();
const inventoryStatusMap = {};
const processedDocIds = new Set(); 
let unreadCount = 0;

let bellContainer = document.getElementById("adminNotifBellContainer") || (() => {
    const el = document.createElement("div");
    el.id = "adminNotifBellContainer";
    el.innerHTML = `<i class="fas fa-bell"></i><span class="badge" style="display:none;">0</span>`;
    el.style.cssText = `position:fixed; top:20px; right:20px; cursor:pointer; z-index:9999; display:none;`; 
    document.body.appendChild(el);
    return el;
})();
const adminBadge = bellContainer.querySelector(".badge");


let notifDropdown = document.getElementById("adminNotifDropdown") || (() => {
    const el = document.createElement("div");
    el.id = "adminNotifDropdown";
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

const emptyMessage = document.createElement("div");
emptyMessage.id = "notifEmpty";
emptyMessage.textContent = "No new admin notifications";
if (notifDropdown.lastChild !== emptyMessage) {
    notifDropdown.appendChild(emptyMessage);
}

bellContainer.addEventListener("click", () => {
    notifDropdown.style.display = notifDropdown.style.display === "flex" ? "none" : "flex";
});

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

async function initializeProcessedTracker() {
    const trackedCollections = ["InStoreOrders", "DeliveryOrders"]; 
    
    for (const coll of trackedCollections) {
        const snapshot = await getDocs(collection(db, coll));
        snapshot.forEach(docSnap => {
            processedDocIds.add(`${coll}_${docSnap.id}`); 
        });
    }
    console.log(`✅ Initialized processed document list with ${processedDocIds.size} existing orders.`);
}


function listenAdminEvents() {
    listenOrderChanges(); 
    listenInventoryChanges();
}

function listenOrderChanges() {
    const orderCollections = ["InStoreOrders", "DeliveryOrders"];
    
    orderCollections.forEach(coll => {
        console.log(`Attaching listener to ${coll} for order/refund changes.`);

        onSnapshot(collection(db, coll), snapshot => {
            snapshot.docChanges().forEach(async change => {
                const order = change.doc.data();
                const orderId = change.doc.id;
                const docKey = `${coll}_${orderId}`;
                const orderType = coll === "InStoreOrders" ? "In-Store" : "Delivery";

                let message = null;
                let notifType = null;

                if (change.type === "added" && !processedDocIds.has(docKey)) {
                    processedDocIds.add(docKey); 
                    message = `🚨 NEW ORDER: ${orderType} Order #${order.queueNumber || orderId} received.`;
                    notifType = 'order';
                } 
                
                else if (change.type === "modified") {
                    const oldOrder = change.oldDoc.data();
                    const currentRefundStatus = order.refundStatus;
                    const previousRefundStatus = oldOrder.refundStatus || ""; 

                    if (currentRefundStatus === "Requested" && previousRefundStatus !== "Requested") {
                        
                        console.log(`💸 REFUND DETECTED: Order ${orderId}. Old Status: ${previousRefundStatus}. New Status: ${currentRefundStatus}`); 
                        
                        message = `💸 **REFUND REQUEST**: Order #${order.queueNumber || orderId} requires review.`;
                        notifType = 'refund';
                    }
                }
                
                if (message && currentUser) {
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
            console.error(`❌ Firestore listener error on ${coll}:`, error);
        });
    });
}

function getInventoryStatus(item){
    const qty = Number(item.quantity) || 0;
    const category = item.category;
    const unit = item.unit;

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

            // Stock
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

function showNotification(message, docId, isUnread = true) {
    if (displayedNotifs.has(docId)) return;
    displayedNotifs.add(docId);

    const notifItem = document.createElement("div");
    notifItem.className = "notifItem";
    notifItem.dataset.docId = docId; 
    
    notifItem.style.cssText = "display:flex; justify-content:space-between; align-items:center;";

    if (isUnread) {
        notifItem.classList.add("unread");
        notifItem.style.backgroundColor = "#fffde7"; 
    }

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

function updateEmptyMessage() {
    const hasNotifs = notifDropdown.querySelectorAll(".notifItem").length > 0;
    emptyMessage.style.display = hasNotifs ? "none" : "block";
}

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

function updateBadge() {
    adminBadge.textContent = unreadCount;
    adminBadge.style.display = unreadCount > 0 ? "inline-block" : "none";
}
