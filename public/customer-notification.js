import { db } from './firebase-config.js';
import { collection, query, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// DOM container for notifications
const notificationsContainer = document.createElement('div');
notificationsContainer.className = 'notifications-container';
document.body.appendChild(notificationsContainer);

const auth = getAuth();
let currentUser = null;
let lastStatuses = {}; // Keep track of previous statuses

// Listen for auth state
onAuthStateChanged(auth, user => {
    currentUser = user;
    if (currentUser) {
        listenOrders();
    }
});

// Listen to DeliveryOrders collection
function listenOrders() {
    const ordersRef = query(collection(db, "DeliveryOrders"), orderBy("createdAt", "desc"));

    onSnapshot(ordersRef, snapshot => {
        snapshot.docChanges().forEach(change => {
            const order = change.doc.data();
            const orderId = change.doc.id;

            if (!order.userId || order.userId !== currentUser.uid) return;

            const previousStatus = lastStatuses[orderId];
            const newStatus = order.status || "Pending";

            // Only notify if status changed
            if (previousStatus !== newStatus) {
                showNotification(order.queueNumber, newStatus);
                lastStatuses[orderId] = newStatus;
            }
        });
    });
}

// Show notification popup
function showNotification(queueNumber, status) {
    const notif = document.createElement('div');
    notif.className = 'notification';

    // Set color based on status
    switch(status.toLowerCase()) {
        case 'pending':
        case 'preparing':
            notif.style.backgroundColor = '#2196f3'; // Blue
            break;
        case 'delivery':
            notif.style.backgroundColor = '#ff9800'; // Orange
            break;
        case 'completed':
            notif.style.backgroundColor = '#4caf50'; // Green
            break;
        case 'canceled':
        case 'cancelled':
            notif.style.backgroundColor = '#f44336'; // Red
            break;
        default:
            notif.style.backgroundColor = '#555';
    }

    notif.textContent = `Order #${queueNumber || "----"} status: ${status}`;

    notificationsContainer.appendChild(notif);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        notif.remove();
    }, 5000);
}
