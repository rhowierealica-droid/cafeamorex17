// AutoCancel.js
import { db } from './firebase-config.js';
import { collection, doc, onSnapshot, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Time before auto-cancel (5 minutes)
const AUTO_CANCEL_DELAY = 5 * 60 * 1000; 
const pendingTimers = {};

// Listen for changes in both In-Store and Delivery orders
onSnapshot(collection(db, "InStoreOrders"), snapshot => handleOrdersSnapshot(snapshot, "InStoreOrders"));
onSnapshot(collection(db, "DeliveryOrders"), snapshot => handleOrdersSnapshot(snapshot, "DeliveryOrders"));

function handleOrdersSnapshot(snapshot, collectionName) {
    snapshot.docChanges().forEach(change => {
        const docSnap = change.doc;
        const order = {
            id: docSnap.id,
            collection: collectionName,
            data: { ...docSnap.data() }
        };

        // Clear timer if order removed
        if (change.type === "removed") {
            if (pendingTimers[docSnap.id]) {
                clearTimeout(pendingTimers[docSnap.id]);
                delete pendingTimers[docSnap.id];
            }
            return;
        }

        // Set auto-cancel timer if order is in specified statuses
        if (["Pending", "Waiting for Payment", "Wait for Admin to Accept"].includes(order.data.status)) {
            if (!pendingTimers[order.id]) {
                pendingTimers[order.id] = setTimeout(async () => {
                    try {
                        const currentSnap = await getDoc(doc(db, collectionName, order.id));
                        if (!currentSnap.exists()) return;

                        const currentStatus = currentSnap.data().status;
                        // Only cancel if still in the same statuses
                        if (["Pending", "Waiting for Payment", "Wait for Admin to Accept"].includes(currentStatus)) {
                            await updateDoc(doc(db, collectionName, order.id), {
                                status: "Canceled"
                            });
                            console.log(`✅ Order ${order.id} auto-canceled after 5 minutes in status: ${currentStatus}`);
                        }
                    } catch (err) {
                        console.error("Auto-cancel error for order:", order.id, err);
                    } finally {
                        delete pendingTimers[order.id];
                    }
                }, AUTO_CANCEL_DELAY);
            }
        } else {
            // Clear any existing timer if order changed to other status
            if (pendingTimers[order.id]) {
                clearTimeout(pendingTimers[order.id]);
                delete pendingTimers[order.id];
            }
        }
    });
}
