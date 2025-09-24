// notification.js
import { db } from './firebase-config.js';
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export function initOrderBadge() {
  const orderCollections = ["InStoreOrders", "DeliveryOrders"];

  // Find the Orders menu item in your sidebar
  const ordersMenuItem = document.querySelector('aside.sidebar nav ul li:nth-child(4)'); 
  ordersMenuItem.style.position = 'relative'; // for badge absolute positioning

  // Create badge
  let badge = ordersMenuItem.querySelector('.badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'badge';
    badge.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      min-width: 18px;
      height: 18px;
      line-height: 18px;
      background: red;
      color: white;
      font-size: 12px;
      font-weight: bold;
      border-radius: 50%;
      text-align: center;
      padding: 0 6px;
      display: none;
    `;
    ordersMenuItem.appendChild(badge);
  }

  // Count all pending orders
  async function countPendingOrders() {
    let total = 0;
    await Promise.all(orderCollections.map(async col => {
      const snapshot = await new Promise(resolve => {
        onSnapshot(collection(db, col), snap => resolve(snap), { includeMetadataChanges: true });
      });
      snapshot.docs.forEach(docSnap => {
        if (docSnap.data().status === "Pending") total++;
      });
    }));
    return total;
  }

  // Update badge
  async function updateBadge() {
    const count = await countPendingOrders();
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  // Initial update
  updateBadge();

  // Real-time listener
  orderCollections.forEach(col => {
    const ordersRef = collection(db, col);
    onSnapshot(ordersRef, snapshot => {
      snapshot.docChanges().forEach(change => {
        const data = change.doc.data();
        if (data.status === "Pending") updateBadge();
      });
    }, { includeMetadataChanges: true });
  });

  // Refresh every 30 seconds
  setInterval(updateBadge, 30000);
}
