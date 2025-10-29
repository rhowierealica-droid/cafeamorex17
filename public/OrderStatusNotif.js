import { onSnapshot, collection, doc, setDoc, getDocs, query, where, orderBy, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db } from './firebase-config.js';

const notifSound = new Audio('notification.mp3');

let bellContainer = document.getElementById("notifBellContainer") || (() => {
    const el = document.createElement("div");
    el.id = "notifBellContainer";
    el.innerHTML = `<i class="fas fa-bell"></i><span class="badge">0</span>`;
    el.style.cssText = `position:fixed; top:20px; right:20px; font-size:24px; cursor:pointer; display:none;`; 
    document.body.appendChild(el);
    return el;
})();

let notifDropdown = document.getElementById("notifDropdown") || (() => {
    const el = document.createElement("div");
    el.id = "notifDropdown";
    el.style.cssText = `
        display: none;
        position: fixed;
        top: 60px;
        right: 20px;
        width: 320px;
        max-height: 400px;
        overflow-y: auto;
        background: #fff;
        border: 1px solid #ccc;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 9999;
        flex-direction: column;
        gap: 4px;
        padding: 8px 0;
        font-family: Arial, sans-serif;
    `;
    document.body.appendChild(el);
    return el;
})();

let toastContainer = document.getElementById("toastContainer") || (() => {
    const el = document.createElement("div");
    el.id = "toastContainer";
    el.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
    `;
    document.body.appendChild(el);
    return el;
})();

const controlContainer = document.createElement("div");
controlContainer.style.cssText = `display:flex; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid #eee;`;
const readAllBtn = document.createElement("button");
readAllBtn.textContent = "Read All";
readAllBtn.style.cssText = "cursor:pointer; background:#f59e0b; color:#fff; border:none; border-radius:4px; padding:4px 8px;";
const clearAllBtn = document.createElement("button");
clearAllBtn.textContent = "Clear All";
clearAllBtn.style.cssText = "cursor:pointer; background:#ef4444; color:#fff; border:none; border-radius:4px; padding:4px 8px;";
controlContainer.appendChild(readAllBtn);
controlContainer.appendChild(clearAllBtn);
if (notifDropdown.firstChild !== controlContainer) {
    notifDropdown.prepend(controlContainer);
}

const emptyMessage = document.createElement("div");
emptyMessage.id = "notifEmpty";
emptyMessage.textContent = "You don't have notifications";
emptyMessage.style.cssText = "padding: 12px; text-align: center; color: #555; font-size: 14px;";
if (notifDropdown.lastChild !== emptyMessage) {
    notifDropdown.appendChild(emptyMessage);
}

bellContainer.addEventListener("click", () => {
    notifDropdown.style.display = notifDropdown.style.display === "flex" ? "none" : "flex";
});

let unreadCount = 0;
const badge = bellContainer.querySelector(".badge");
const orderStatusMap = {};
let currentUser = null;
let listenersAttached = false; 
const displayedNotifs = new Set(); 

const auth = getAuth();
onAuthStateChanged(auth, async user => {
    currentUser = user;

    if (user) {
        bellContainer.style.display = "inline-block";
        notifDropdown.style.display = "none"; 

        await loadUserNotifications();
        if (!listenersAttached) {
            listenOrders();
            listenersAttached = true;
        }
    } else {
        bellContainer.style.display = "none";
        notifDropdown.style.display = "none";
        listenersAttached = false;
        Object.keys(orderStatusMap).forEach(key => delete orderStatusMap[key]);
        notifDropdown.querySelectorAll(".notifItem").forEach(el => el.remove()); 
        displayedNotifs.clear();
        unreadCount = 0;
        updateBadge();
        updateEmptyMessage();
    }
});

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

function listenOrders() {
    if (!currentUser || !currentUser.uid) {
        console.error("Cannot listen to orders: currentUser is null.");
        return;
    }
    
    const currentUserId = currentUser.uid;
    const orderCollections = ["InStoreOrders", "DeliveryOrders"];
    
    orderCollections.forEach(coll => {
                const userOrderQuery = query(
            collection(db, coll), 
            where("userId", "==", currentUserId) 
        );

        onSnapshot(userOrderQuery, snapshot => {
            snapshot.docChanges().forEach(async change => {
                const order = change.doc.data();
                const orderId = change.doc.id;

                if (!orderStatusMap[orderId]) {
                    orderStatusMap[orderId] = order.status;
                    return;
                }

                if (orderStatusMap[orderId] !== order.status) {
                    orderStatusMap[orderId] = order.status;
                    
                    if (!currentUser) return; 
                    
                    const message = `Order #${order.queueNumber || orderId} status changed to ${order.status}`;

                    const notifRef = doc(collection(db, "Notifications"));
                    await setDoc(notifRef, {
                        userId: currentUser.uid, 
                        message,
                        read: false,
                        timestamp: Date.now()
                    });

                    showNotification(message, notifRef.id, true);
                    showToast(message);
                }
            });
        }, (error) => {
             console.error(`Error listening to user's orders in ${coll}:`, error);
        });
    });
}

function showNotification(message, docId, isUnread = true) {
    if (displayedNotifs.has(docId)) return;
    displayedNotifs.add(docId);

    const notifItem = document.createElement("div");
    notifItem.className = "notifItem";
    notifItem.dataset.docId = docId; 

    notifItem.style.cssText = "padding: 12px 16px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; background-color: white; transition: background-color 0.3s;";

    if (isUnread) {
        notifItem.classList.add("unread");
        notifItem.style.backgroundColor = "#f0f7ff";
    }

    notifItem.innerHTML = `<div class="notifText" style="flex-grow:1; cursor:pointer;">${message}</div><div class="notifClose" style="cursor:pointer; font-size:18px; color:#aaa; margin-left:10px;">&times;</div>`;
    
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
    
    document.querySelectorAll(".notifItem.unread").forEach(el => {
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
    
    document.querySelectorAll(".notifItem").forEach(el => el.remove());
    displayedNotifs.clear();
    unreadCount = 0;
    updateBadge();
    updateEmptyMessage();
});

function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toast.style.cssText = "background:#f59e0b;color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transform:translateX(100%);transition:opacity 0.3s ease, transform 0.3s ease; max-width: 300px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;";
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300); 
    }, 3000);
}

function updateBadge() {
    badge.textContent = unreadCount;
    badge.style.display = unreadCount > 0 ? "inline-block" : "none";
}
