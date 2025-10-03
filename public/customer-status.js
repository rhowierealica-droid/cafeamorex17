// ==========================
// Imports
// ==========================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================
// DOM Elements
// ==========================
const orderItemsDiv = document.getElementById("order-items");
const tabs = document.querySelectorAll(".status-tabs .tab");
let currentTab = "Pending"; // default tab

// ==========================
// Auth
// ==========================
const auth = getAuth();
let currentUser = null;
let currentUserEmail = null;
let unsubscribeOrders = null;

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    currentUserEmail = user.email;
    listenOrders();
  } else {
    orderItemsDiv && (orderItemsDiv.innerHTML = "<p>Please log in to view your orders.</p>");
    if (unsubscribeOrders) unsubscribeOrders();
  }
});

// ==========================
// Tabs Click Handling
// ==========================
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.status;
    listenOrders();
  });
});

// ==========================
// Order Tracking & Action Buttons
// ==========================
function listenOrders() {
  if (!currentUser) return;
  if (unsubscribeOrders) unsubscribeOrders();

  unsubscribeOrders = onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
    const userOrders = [];

    snapshot.forEach(docSnap => {
      const order = docSnap.data();
      if (order.customerName?.toLowerCase() === currentUserEmail?.toLowerCase()) {
        userOrders.push({ id: docSnap.id, ...order });
      }
    });

    orderItemsDiv.innerHTML = "";

    const filteredOrders = userOrders.filter(order => {
      const status = order.status || "";
      if (currentTab === "To Rate") return status === "Completed by Customer" && !order.feedback;
      if (currentTab === "To Receive") return status === "Completed" && !order.feedback;
      if (currentTab === "Completed") return status === "Completed" || status === "Completed by Customer";
      return status === currentTab;
    });

    if (filteredOrders.length === 0) {
      orderItemsDiv.innerHTML = "<p>No orders found in this category.</p>";
      return;
    }

    filteredOrders.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    filteredOrders.forEach(order => {
      const orderContainer = document.createElement("div");
      orderContainer.className = "user-order-card";

      const orderHeader = document.createElement("div");
      orderHeader.className = "order-header";

      const orderTitle = document.createElement("h3");
      let titleText = `Order #${order.queueNumber} - Status: ${order.status}`;
      if (order.estimatedTime) titleText += ` | ETA: ${order.estimatedTime}`;
      if (order.refundRequest) titleText += ` | Refund: ${order.refundStatus || "Requested"}`;
      orderTitle.textContent = titleText;

      orderHeader.appendChild(orderTitle);
      orderContainer.appendChild(orderHeader);

      const itemsContainer = document.createElement("div");
      itemsContainer.className = "order-items-container";

      order.items?.forEach(p => {
        if (!p) return;
        const qty = p.qty || p.quantity || 1;
        const productName = p.product || p.name || "Unknown Product";
        const addonsText = (p.addons && p.addons.length > 0)
          ? p.addons.map(a => `${a.name}: ₱${a.price}`).join(", ")
          : "No add-ons";
        const productPrice = ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty;

        const div = document.createElement("div");
        div.classList.add("order-item-card");
        div.innerHTML = `
          ${p.image ? `<img src="${p.image}" alt="${productName}" style="width:60px;height:60px;object-fit:cover;margin-right:10px;border-radius:6px;">` : ""}
          <h4>${productName} (${p.size || "Medium"}) : ₱${p.sizePrice}</h4>
          <p>Add-ons: ${addonsText}</p>
          <p>Price for this Product: ₱${productPrice}</p>
        `;
        itemsContainer.appendChild(div);
      });

      const orderTotal = order.items?.reduce((sum, p) => {
        if (!p) return sum;
        const qty = p.qty || p.quantity || 1;
        return sum + (((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty);
      }, 0) || 0;

      const totalDiv = document.createElement("div");
      totalDiv.classList.add("order-total");
      totalDiv.innerHTML = `<h4>Total Price: ₱${orderTotal}</h4>`;
      itemsContainer.appendChild(totalDiv);

      const paymentMethod = order.paymentMethod?.toLowerCase() || "";

      // ==========================
      // Pending Tab Refund / Cancel
      // ==========================
      if (currentTab === "Pending") {
        if (paymentMethod === "gcash") {
          const btn = document.createElement("button");
          if (order.refundRequest) {
            btn.textContent = "Refund Requested";
            btn.disabled = true;
            btn.style.backgroundColor = "#ccc";
            btn.style.cursor = "not-allowed";
          } else {
            btn.textContent = "Request Refund";
            btn.onclick = () => handleRefundRequest(order.id);
          }
          btn.className = "action-btn";
          itemsContainer.appendChild(btn);
        } else if (paymentMethod === "COD") {
          const btn = document.createElement("button");
          btn.textContent = "Cancel";
          btn.className = "action-btn";
          btn.onclick = () => handleCancelOrder(order.id);
          itemsContainer.appendChild(btn);
        }
      }

      // ==========================
      // To Receive Tab Refund + Received
      // ==========================
      if (currentTab === "To Receive") {
        if (paymentMethod === "gcash") {
          const refundBtn = document.createElement("button");
          if (order.refundRequest) {
            refundBtn.textContent = `Refund: ${order.refundStatus || "Requested"}`;
            refundBtn.disabled = true;
            refundBtn.style.backgroundColor = "#ccc";
            refundBtn.style.cursor = "not-allowed";
          } else {
            refundBtn.textContent = "Request Refund";
            refundBtn.onclick = () => handleRefundRequest(order.id);
          }
          refundBtn.className = "action-btn";
          itemsContainer.appendChild(refundBtn);
        }

        if (order.status === "Completed" && !order.feedback) {
          const receivedBtn = document.createElement("button");
          receivedBtn.textContent = "Received Order";
          receivedBtn.className = "action-btn";
          receivedBtn.onclick = () => showConfirmModal(order.id);
          itemsContainer.appendChild(receivedBtn);
        }
      }

      // ==========================
      // To Rate Tab Feedback
      // ==========================
      if (order.status === "Completed by Customer" && !order.feedback && currentTab === "To Rate") {
        const btn = document.createElement("button");
        btn.textContent = "To Rate";
        btn.className = "action-btn";
        btn.onclick = () => openFeedbackModal(order.id, order.items);
        itemsContainer.appendChild(btn);
      }

      orderContainer.appendChild(itemsContainer);
      orderItemsDiv.appendChild(orderContainer);
    });
  });
}

// ==========================
// Refund & Cancel Handlers
// ==========================
async function handleRefundRequest(orderId) {
  await updateDoc(doc(db, "DeliveryOrders", orderId), { refundRequest: true, refundStatus: "Requested" });
  alert("Refund request submitted. Waiting for admin approval.");
}

async function handleCancelOrder(orderId) {
  await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Canceled" });
  alert("Order canceled successfully.");
}

// ==========================
// Confirmation Modal
// ==========================
function showConfirmModal(orderId) {
  const confirmModal = document.createElement("div");
  confirmModal.className = "modal";
  confirmModal.style.display = "flex";

  const modalContent = document.createElement("div");
  modalContent.className = "modal-content";
  modalContent.innerHTML = `
    <h2>Confirm Order Received</h2>
    <p>If you accept this, there is no refund.</p>
    <div style="margin-top:20px; display:flex; justify-content:center; gap:15px;">
      <button id="confirm-yes" class="action-btn">Yes</button>
      <button id="confirm-no" class="action-btn" style="background:#ccc;color:#333;">No</button>
    </div>
  `;
  confirmModal.appendChild(modalContent);
  document.body.appendChild(confirmModal);

  function closeModal() { confirmModal.remove(); }

  modalContent.querySelector("#confirm-yes").onclick = async () => {
    await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Completed by Customer" });
    closeModal();
    tabs.forEach(t => t.classList.remove("active"));
    currentTab = "To Rate";
    document.querySelector(`.tab[data-status="To Rate"]`).classList.add("active");
    listenOrders();
  };

  modalContent.querySelector("#confirm-no").onclick = closeModal;
  confirmModal.addEventListener("click", e => { if (e.target === confirmModal) closeModal(); });
}

// ==========================
// Feedback Modal with Star Rating
// ==========================
function openFeedbackModal(orderId, items) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.display = "flex";

  const modalContent = document.createElement("div");
  modalContent.className = "modal-content";

  const closeBtn = document.createElement("span");
  closeBtn.className = "close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.onclick = () => modal.remove();

  const form = document.createElement("form");
  form.id = "feedback-form";

  items.forEach((item, index) => {
    if (!item) return;
    const productName = item.product || item.name || "Unknown Product";

    const itemDiv = document.createElement("div");
    itemDiv.className = "feedback-item";

    const stars = Array.from({ length: 5 }, (_, i) => `<span class="star" data-value="${i + 1}">&#9734;</span>`).join('');

    itemDiv.innerHTML = `
      <h4>${productName}</h4>
      <div class="star-rating">${stars}</div>
      <textarea placeholder="Write your feedback..." required data-item-index="${index}"></textarea>
    `;
    form.appendChild(itemDiv);
  });

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "action-btn";
  submitBtn.textContent = "Submit Feedback";
  form.appendChild(submitBtn);

  modalContent.appendChild(closeBtn);
  modalContent.appendChild(form);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  form.querySelectorAll(".star-rating").forEach(starContainer => {
    const stars = starContainer.querySelectorAll(".star");
    stars.forEach(star => {
      star.addEventListener("mouseover", () => {
        stars.forEach(s => s.innerHTML = "☆");
        for (let i = 0; i < star.dataset.value; i++) stars[i].innerHTML = "★";
      });
      star.addEventListener("click", () => {
        stars.forEach(s => s.dataset.selected = 0);
        for (let i = 0; i < star.dataset.value; i++) stars[i].dataset.selected = 1;
      });
      starContainer.addEventListener("mouseout", () => {
        stars.forEach(s => s.innerHTML = s.dataset.selected == 1 ? "★" : "☆");
      });
    });
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const feedbacks = [];
    const ratings = [];

    form.querySelectorAll(".feedback-item").forEach((itemDiv) => {
      const text = itemDiv.querySelector("textarea").value;
      feedbacks.push(text);

      const stars = itemDiv.querySelectorAll(".star");
      let starValue = 0;
      stars.forEach((s, i) => {
        if (s.dataset.selected == 1) starValue = i + 1;
      });
      ratings.push(starValue);
    });

    try {
      await updateDoc(doc(db, "DeliveryOrders", orderId), { 
        feedback: arrayUnion(...feedbacks),
        feedbackRating: arrayUnion(...ratings)
      });
      alert("Thank you for your feedback!");
      modal.remove();
      listenOrders();
    } catch (err) {
      console.error("Error saving feedback:", err);
      alert("Failed to save feedback. Please try again.");
    }
  };
}
