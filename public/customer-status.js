// ==========================
// Imports
// ==========================
import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, updateDoc, arrayUnion, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================
// DOM Elements
// ==========================
const orderItemsDiv = document.getElementById("order-items");
const tabs = document.querySelectorAll(".tabs .tab-btn");
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
    currentUserEmail = user.email?.toLowerCase();
    listenOrders();
  } else {
    window.location.href = "login.html"; 
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

  console.log("Listening for orders for:", currentUserEmail);

  unsubscribeOrders = onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
    const userOrders = [];

    snapshot.forEach(docSnap => {
      const order = docSnap.data();
      const customerEmail = order.customerEmail?.toLowerCase() || order.customerName?.toLowerCase();
      if (customerEmail === currentUserEmail) {
        userOrders.push({ id: docSnap.id, ...order });
      }
    });

    orderItemsDiv.innerHTML = "";

    const filteredOrders = userOrders.filter(order => {
      const status = (order.status || "").toLowerCase();
      const refundStatus = (order.refundStatus || "").toLowerCase();
      const tab = (currentTab || "").toLowerCase();

      if (tab === "to rate") return status === "completed by customer" && !order.feedback;
      if (tab === "to receive") return status === "completed" && !order.feedback;
      if (tab === "completed") return ["completed", "completed by customer"].includes(status);
      if (tab === "refund") return ["requested", "accepted", "denied"].includes(refundStatus);

      return status === tab;
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

      // ✅ Fixed: Always display order status
      const orderTitle = document.createElement("h3");
      let titleText = `Order #${order.queueNumber || "N/A"} - Status: ${order.status || "Unknown"}`;
      if (order.estimatedTime) titleText += ` | ETA: ${order.estimatedTime}`;
      if (currentTab === "Refund") titleText += ` | Refund: ${order.refundStatus || "Requested"}`;
      orderTitle.textContent = titleText;

      orderHeader.appendChild(orderTitle);
      orderContainer.appendChild(orderHeader);

      // Items container
      const itemsContainer = document.createElement("div");
      itemsContainer.className = "order-items-container";

      order.items?.forEach(p => {
        if (!p) return;
        const qty = p.qty || p.quantity || 1;
        const productName = p.product || p.name || "Unknown Product";
        const size = p.size || "Medium";
        const sizePrice = p.sizePrice || 0;
        const addonsText = (p.addons && p.addons.length > 0)
          ? p.addons.map(a => `${a.name}: ₱${a.price}`).join(", ")
          : "No add-ons";
        const addonsPrice = p.addonsPrice || 0;
        const totalPrice = (sizePrice + addonsPrice) * qty;

        const div = document.createElement("div");
        div.classList.add("order-item-card");
        div.innerHTML = `
          ${p.image ? `<img src="${p.image}" alt="${productName}" style="width:60px;height:60px;object-fit:cover;margin-right:10px;border-radius:6px;">` : ""}
          <h4>${productName} (${size}) x${qty} - ₱${totalPrice}</h4>
          <p>Add-ons: ${addonsText} (₱${addonsPrice})</p>
        `;
        itemsContainer.appendChild(div);
      });

      // Total price
      const orderTotal = order.items?.reduce((sum, p) => {
        if (!p) return sum;
        const qty = p.qty || p.quantity || 1;
        const sizePrice = p.sizePrice || 0;
        const addonsPrice = p.addonsPrice || 0;
        return sum + ((sizePrice + addonsPrice) * qty);
      }, 0) || 0;

      const totalDiv = document.createElement("div");
      totalDiv.classList.add("order-total");
      totalDiv.innerHTML = `<h4>Total Price: ₱${orderTotal}</h4>`;
      itemsContainer.appendChild(totalDiv);

      const paymentMethod = (order.paymentMethod || "").toLowerCase();

      // Pending Tab Refund / Cancel
      if (currentTab === "Pending") {
        if (paymentMethod.includes("e-payment") || paymentMethod === "g" || paymentMethod === "gcash") {
          const btn = document.createElement("button");
          btn.textContent = order.refundRequest ? `Refund: ${order.refundStatus}` : "Request Refund";
          btn.disabled = !!order.refundRequest;
          btn.className = "action-btn";
          btn.style.backgroundColor = order.refundRequest ? "#ccc" : "";
          btn.style.cursor = order.refundRequest ? "not-allowed" : "pointer";
          btn.addEventListener("click", () => openRefundModal(order.id, order.items));
          itemsContainer.appendChild(btn);
        } else if (paymentMethod === "cash" || paymentMethod === "c") {
          const btn = document.createElement("button");
          btn.textContent = "Cancel";
          btn.className = "action-btn cancel-refund-btn";
          btn.addEventListener("click", () => handleCancelOrder(order.id, order.items));
          itemsContainer.appendChild(btn);
        }
      }

      // To Receive Tab
      if (currentTab === "To Receive") {
        if (paymentMethod.includes("e-payment") || paymentMethod === "g" || paymentMethod === "gcash") {
          const refundBtn = document.createElement("button");
          refundBtn.textContent = order.refundRequest ? `Refund: ${order.refundStatus}` : "Request Refund";
          refundBtn.disabled = !!order.refundRequest;
          refundBtn.className = "action-btn cancel-refund-btn"; 
          refundBtn.style.backgroundColor = order.refundRequest ? "#ccc" : "";
          refundBtn.style.cursor = order.refundRequest ? "not-allowed" : "pointer";
          refundBtn.addEventListener("click", () => openRefundModal(order.id, order.items));
          itemsContainer.appendChild(refundBtn);
        }

        if (order.status === "Completed" && !order.feedback) {
          const receivedBtn = document.createElement("button");
          receivedBtn.textContent = "Received Order";
          receivedBtn.className = "action-btn";
          receivedBtn.addEventListener("click", () => showConfirmModal(order.id));
          itemsContainer.appendChild(receivedBtn);
        }
      }

      // Refund Tab
      if (currentTab === "Refund") {
        const refundBtn = document.createElement("button");
        refundBtn.textContent = order.refundStatus;
        refundBtn.disabled = true;
        refundBtn.className = "action-btn";
        refundBtn.style.cursor = "not-allowed";

        if (order.refundStatus === "Requested") refundBtn.style.backgroundColor = "yellow";
        else if (order.refundStatus === "Accepted") refundBtn.style.backgroundColor = "green";
        else if (order.refundStatus === "Denied") refundBtn.style.backgroundColor = "red";
        else refundBtn.style.backgroundColor = "#ccc"; 

        itemsContainer.appendChild(refundBtn);
      }

      // To Rate Tab
      if (order.status === "Completed by Customer" && !order.feedback && currentTab === "To Rate") {
        const btn = document.createElement("button");
        btn.textContent = "To Rate";
        btn.className = "action-btn";
        btn.addEventListener("click", () => openFeedbackModal(order.id, order.items));
        itemsContainer.appendChild(btn);
      }

      orderContainer.appendChild(itemsContainer);
      orderItemsDiv.appendChild(orderContainer);
    });
  });
}

// ==========================
// Return Items to Inventory
// ==========================
async function returnItemsToInventory(orderItems) {
  if (!orderItems || orderItems.length === 0) return;
  const inventoryUpdates = {};

  for (const item of orderItems) {
    if (!item) continue;
    const productQtyOrdered = item.qty || item.quantity || 1;
    if (productQtyOrdered <= 0) continue;

    const aggregateItem = (id, consumptionPerProduct) => {
      if (!id) return;
      const totalConsumption = consumptionPerProduct * productQtyOrdered;
      inventoryUpdates[id] = (inventoryUpdates[id] || 0) + totalConsumption;
    };

    aggregateItem(item.sizeId, item.sizeQty || 1);
    item.ingredients?.forEach(ing => aggregateItem(ing.id, ing.qty || 1));
    item.addons?.forEach(addon => aggregateItem(addon.id, addon.qty || 1));
    item.others?.forEach(other => aggregateItem(other.id, other.qty || 1));
  }

  const batch = writeBatch(db);
  const inventoryCollection = collection(db, "Inventory");

  for (const [inventoryId, qtyToReturn] of Object.entries(inventoryUpdates)) {
    const inventoryRef = doc(inventoryCollection, inventoryId);
    try {
      const inventorySnap = await getDoc(inventoryRef);
      if (inventorySnap.exists()) {
        const currentQuantity = inventorySnap.data().quantity || 0;
        batch.update(inventoryRef, { quantity: currentQuantity + qtyToReturn });
        console.log(`Returned ${qtyToReturn} units to Inventory ID: ${inventoryId}`);
      }
    } catch (error) {
      console.error(`Error fetching inventory item ${inventoryId}:`, error);
    }
  }

  await batch.commit();
  console.log("✅ All items returned to inventory successfully.");
}

// ==========================
// Cancel Order
// ==========================
async function handleCancelOrder(orderId, orderItems) {
  if (!confirm("Are you sure you want to cancel this order?")) return;

  try {
    await returnItemsToInventory(orderItems);
    await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Canceled" });
    alert("✅ Order canceled successfully and stock returned.");
    listenOrders();
  } catch (err) {
    console.error("Error canceling order:", err);
    alert("❌ Failed to cancel order. Please try again.");
  }
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

  const closeModal = () => confirmModal.remove();

  modalContent.querySelector("#confirm-yes").onclick = async () => {
    await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Completed by Customer" });
    closeModal();
    currentTab = "To Rate";
    tabs.forEach(t => t.classList.remove("active"));
    document.querySelector(`.tab-btn[data-status="To Rate"]`).classList.add("active");
    listenOrders();
  };

  modalContent.querySelector("#confirm-no").onclick = closeModal;
  confirmModal.addEventListener("click", e => { if (e.target === confirmModal) closeModal(); });
}

// ==========================
// Refund Modal
// ==========================
function openRefundModal(orderId, orderItems) {
  const modal = document.getElementById("refund-modal");
  const refundForm = modal.querySelector("#refund-form");
  const refundItemsDiv = modal.querySelector("#refund-items");

  refundItemsDiv.innerHTML = "";

  orderItems.forEach((item, index) => {
    if (!item) return;
    const productName = item.product || item.name || "Unknown Product";
    const qty = item.qty || item.quantity || 1;
    const size = item.size || "Medium";
    const totalPrice = ((item.sizePrice || 0) + (item.addonsPrice || 0)) * qty;

    const div = document.createElement("div");
    div.className = "refund-item";
    div.innerHTML = `
      <label>
        <input type="checkbox" name="refund" value="${index}">
        ${productName} (${size}) x${qty} - ₱${totalPrice}
      </label>
    `;
    refundItemsDiv.appendChild(div);
  });

  modal.style.display = "flex";

  modal.querySelector(".close-btn").onclick = () => modal.style.display = "none";
  modal.onclick = e => { if (e.target === modal) modal.style.display = "none"; }

  refundForm.onsubmit = async (e) => {
    e.preventDefault();
    const selectedIndexes = Array.from(refundForm.querySelectorAll('input[name="refund"]:checked')).map(input => parseInt(input.value));
    if (selectedIndexes.length === 0) {
      alert("Please select at least one product to refund.");
      return;
    }
    const selectedItems = selectedIndexes.map(i => orderItems[i]);
    try {
      await updateDoc(doc(db, "DeliveryOrders", orderId), {
        refundRequest: true,
        refundStatus: "Requested",
        refundItems: selectedItems
      });
      alert("Refund request submitted. Waiting for admin approval.");
      modal.style.display = "none";
      listenOrders();
    } catch (err) {
      console.error("Error submitting refund:", err);
      alert("Failed to submit refund. Please try again.");
    }
  };
}

// ==========================
// Feedback Modal
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
