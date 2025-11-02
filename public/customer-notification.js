import { db } from './firebase-config.js';
import { collection, query, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const notificationsContainer = document.createElement('div');
notificationsContainer.className = 'notifications-container';
document.body.appendChild(notificationsContainer);

const auth = getAuth();
let currentUser = null;
let lastStatuses = {}; 

onAuthStateChanged(auth, user => {
    currentUser = user;
    if (currentUser) {
        listenOrders();
    }
});

function listenOrders() {
    const ordersRef = query(collection(db, "DeliveryOrders"), orderBy("createdAt", "desc"));

    onSnapshot(ordersRef, snapshot => {
        snapshot.docChanges().forEach(change => {
            const order = change.doc.data();
            const orderId = change.doc.id;

            if (!order.userId || order.userId !== currentUser.uid) return;

            const previousStatus = lastStatuses[orderId];
            const newStatus = order.status || "Pending";

            if (previousStatus !== newStatus) {
                showNotification(order.queueNumber, newStatus);
                lastStatuses[orderId] = newStatus;
            }
        });
    });
}

function showNotification(queueNumber, status) {
    const notif = document.createElement('div');
    notif.className = 'notification';

    switch(status.toLowerCase()) {
        case 'pending':
        case 'preparing':
            notif.style.backgroundColor = '#2196f3'; 
            break;
        case 'delivery':
            notif.style.backgroundColor = '#ff9800'; 
            break;
        case 'completed':
            notif.style.backgroundColor = '#4caf50'; 
            break;
        case 'canceled':
        case 'cancelled':
            notif.style.backgroundColor = '#f44336'; 
            break;
        default:
            notif.style.backgroundColor = '#555';
    }

    notif.textContent = `Order #${queueNumber || "----"} status: ${status}`;

    notificationsContainer.appendChild(notif);

    setTimeout(() => {
        notif.remove();
    }, 5000);
}
