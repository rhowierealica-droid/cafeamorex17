import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// DOM
const auth = getAuth();  // ← this was missing
const feedbackContainer = document.getElementById('feedback-container');

// Redirect if not logged in
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html"); // redirect
    return;
  }

  // User is logged in -> initialize the app
  await init();
});

// Fetch all DeliveryOrders and display feedback with product name
async function loadFeedback() {
  feedbackContainer.innerHTML = '';
  const ordersRef = collection(db, "DeliveryOrders");
  const q = query(ordersRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  let hasFeedback = false;

  snapshot.forEach(docSnap => {
    const order = docSnap.data();
    if (order.feedback && order.feedback.length > 0 && order.items?.length > 0) {
      hasFeedback = true;

      order.items.forEach((item, index) => {
        const feedbackText = order.feedback[index];
        if (feedbackText) {
          const card = document.createElement('div');
          card.className = 'feedback-card';
          card.innerHTML = `
            <div class="order-info">
              Order #${order.queueNumber || docSnap.id} - ${order.customerName}
            </div>
            <div class="feedback-text">
              <p>💬 <strong>${item.product}</strong>: ${feedbackText}</p>
            </div>
          `;
          feedbackContainer.appendChild(card);
        }
      });
    }
  });

  if (!hasFeedback) {
    feedbackContainer.innerHTML = '<p class="no-feedback">No feedback available yet.</p>';
  }
}

// Init
loadFeedback();
