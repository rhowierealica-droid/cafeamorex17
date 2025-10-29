import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, updateDoc, arrayUnion, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// NOTE: FOR PDF GENERATION TO WORK, YOU MUST INCLUDE THE LIBRARY IN YOUR HTML:
// <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
// The code below assumes 'html2pdf' is globally available.

const orderItemsDiv = document.getElementById("order-items");
const tabs = document.querySelectorAll(".tabs .tab-btn");
let currentTab = "Waiting for Payment";

const auth = getAuth();
let currentUser = null;
let currentUserEmail = null;
let unsubscribeOrders = null;

// --- POPUP/MODAL ELEMENTS ---
let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;
let popupReceiptContent = null; 

function injectPopupStyles() {
    const style = document.createElement("style");
    style.textContent = `
    .popup {
      display: none;
      position: fixed;
      inset: 0;
      background-color: rgba(0, 0, 0, 0.55);
      z-index: 9999;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .popup-content {
      background: #fff8f0;
      color: #552915;
      border-radius: 12px;
      padding: 25px;
      width: 90%;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      max-height: 90vh; 
      overflow-y: auto; 
    }
    .popup-content h3 {
      margin-bottom: 15px;
      font-size: 1.2rem;
      color: #6f4e37; 
    }
    #popupButtonsContainer {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: center;
      margin-top: 15px;
      border-top: 1px dashed #ccc;
      padding-top: 15px;
    }
    #popupButtonsContainer button {
      background-color: #8b5e3c;
      color: #fff;
      border: none;
      padding: 10px 15px;
      border-radius: 8px;
      cursor: pointer;
      transition: 0.2s ease;
      width: 80%;
      font-weight: bold;
    }
    #popupButtonsContainer button:hover {
      background-color: #6d4428;
    }
    #popupReceiptContent {
        text-align: left;
        margin-top: 15px;
        padding-top: 5px;
        max-height: 350px; 
        overflow-y: auto;
    }
    .print-receipt-btn { 
        background-color: #007bff; 
        color: white; 
        margin-top: 5px;
        padding: 8px 15px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
    }
    .print-receipt-btn:hover { 
        background-color: #0056b3; 
    }
    #downloadReceiptBtn { background-color: #28a745; color: white; }
    #downloadReceiptBtn:hover { background-color: #1e7e34; }
    #closeAlertBtn, #closeReceiptBtn { background-color: #6c757d; }
    #closeAlertBtn:hover, #closeReceiptBtn:hover { background-color: #5a6268; }
    `;
    document.head.appendChild(style);
}
injectPopupStyles();


function createPopup() {
    popup = document.createElement("div");
    popup.className = "popup";
    popup.innerHTML = `
      <div class="popup-content">
        <h3 id="popupTitle">Title</h3>
        <div id="popupReceiptContent"></div>
        <div id="popupButtonsContainer"></div>
      </div>
    `;
    document.body.appendChild(popup);
    popupTitle = popup.querySelector("#popupTitle");
    popupButtonsContainer = popup.querySelector("#popupButtonsContainer");
    popupReceiptContent = popup.querySelector("#popupReceiptContent"); 

    popup.addEventListener("click", e => {
        if (e.target === popup) closePopup();
    });
}

function customAlert(message) {
    if (!popup) createPopup();
    popupReceiptContent.innerHTML = ""; 
    popup.style.display = "flex";
    popupTitle.textContent = "Notification";
    popupButtonsContainer.innerHTML = `<p style="margin-bottom: 10px;">${message}</p><button id="closeAlertBtn">Close</button>`;
    document.getElementById("closeAlertBtn").onclick = closePopup;
}

function closePopup() {
    if (popup) {
        popup.style.display = "none";
    }
}

function formatQueueNumber(num) {
    return typeof num === 'string' ? num : (num ? num.toString().padStart(4, "0") : "----");
}

// --- END POPUP/MODAL ELEMENTS ---


onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    currentUserEmail = user.email?.toLowerCase();
    tabs.forEach(t => {
      if (t.dataset.status === currentTab) {
        t.classList.add("active");
      } else {
        t.classList.remove("active");
      }
    });
    listenOrders();
  } else {
    window.location.href = "login.html"; 
  }
});

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentTab = tab.dataset.status;
    listenOrders();
  });
});

function listenOrders() {
  if (!currentUser) return;
  if (unsubscribeOrders) unsubscribeOrders();

  console.log("Listening for orders for:", currentUser.uid, "Email:", currentUserEmail);

  // Only listening to DeliveryOrders based on your provided code structure
  unsubscribeOrders = onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
    const userOrders = [];

    snapshot.forEach(docSnap => {
      const order = docSnap.data();
      const isMatch = order.userId === currentUser.uid;

      // Check for orders tied to the user ID
      if (isMatch) {
        userOrders.push({ id: docSnap.id, ...order });
      }
    });

    orderItemsDiv.innerHTML = "";

    const filteredOrders = userOrders.filter(order => {
      const status = (order.status || "").toLowerCase();
      const refundStatus = (order.refundStatus || "").toLowerCase();
      const tab = (currentTab || "").toLowerCase();
      const finalRefundStatus = (order.finalRefundStatus || "").toLowerCase();


      if (tab === "waiting for payment") return status === "waiting for payment";
      if (tab === "to rate") return status === "completed by customer" && !order.feedback;
      if (tab === "to receive") return status === "completed" && !order.feedback;
      if (tab === "completed") return ["completed", "completed by customer"].includes(status) || ["succeeded", "manual"].includes(finalRefundStatus);
      if (tab === "refund") return order.refundRequest || ["succeeded", "manual", "failed", "denied"].includes(finalRefundStatus);
      
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

      const orderTitle = document.createElement("h3");
      let titleText = `Order #${formatQueueNumber(order.queueNumber || order.queueNumberNumeric || "N/A")} - Status: ${order.status || "Unknown"}`;
      if (order.estimatedTime) titleText += ` | ETA: ${order.estimatedTime}`;
      if (currentTab === "Refund" || order.finalRefundStatus) titleText += ` | Refund: ${order.finalRefundStatus || order.refundStatus || "Requested"}`;
      orderTitle.textContent = titleText;

      orderHeader.appendChild(orderTitle);
      orderContainer.appendChild(orderHeader);

      const itemsContainer = document.createElement("div");
      itemsContainer.className = "order-items-container";

      // Display the actual ordered items
      order.items?.forEach(p => {
        if (!p) return;
        const qty = p.qty || p.quantity || 1;
        const productName = p.product || p.name || "Unknown Product";
        const size = p.size || "Medium";
        const sizePrice = p.sizePrice || 0;
        const addonsText = (p.addons && p.addons.length > 0)
          ? p.addons.map(a => `${a.name}: ₱${(a.price || 0).toFixed(2)}`).join(", ")
          : "No add-ons";
        const addonsPrice = p.addonsPrice || 0;
        const totalPrice = (p.total || ((p.basePrice || 0) + (sizePrice || 0) + (addonsPrice || 0)) * qty) || 0;

        const div = document.createElement("div");
        div.classList.add("order-item-card");
        div.innerHTML = `
          ${p.image ? `<img src="${p.image}" alt="${productName}" style="width:60px;height:60px;object-fit:cover;margin-right:10px;border-radius:6px;">` : ""}
          <h4>${productName} (${size}) x${qty} - ₱${totalPrice.toFixed(2)}</h4>
          <p>Add-ons: ${addonsText} (₱${addonsPrice.toFixed(2)})</p>
        `;
        itemsContainer.appendChild(div);
      });
      
      // Display Delivery Fee
      const deliveryFee = Number(order.deliveryFee || 0);
      if (deliveryFee > 0) {
          const feeDiv = document.createElement("div");
          feeDiv.classList.add("order-fee");
          feeDiv.innerHTML = `<p style="text-align:right; font-weight:bold;">Delivery Fee: ₱${deliveryFee.toFixed(2)}</p>`;
          itemsContainer.appendChild(feeDiv);
      }

      // Calculate and display Grand Total
      const orderTotal = Number(order.total || 0); 
      const calculatedTotal = order.items?.reduce((sum, p) => sum + (p.total || 0), 0) + deliveryFee;
      const finalTotal = orderTotal > 0 ? orderTotal : calculatedTotal; 
      
      const totalDiv = document.createElement("div");
      totalDiv.classList.add("order-total");
      totalDiv.innerHTML = `<h3>Grand Total: ₱${finalTotal.toFixed(2)}</h3>`;
      itemsContainer.appendChild(totalDiv);

      const paymentMethod = (order.paymentMethod || "").toLowerCase();
      
      const isFinalState = ["Completed", "Completed by Customer", "Canceled", "Refunded", "Refund Denied", "Refund Failed"].includes(order.status);


      if (currentTab === "Waiting for Payment") {
          if (order.checkoutUrl) {
              const paymentBtn = document.createElement("button");
              paymentBtn.textContent = "Complete Payment (Gcash)";
              paymentBtn.className = "action-btn paymongo-btn";
              paymentBtn.style.backgroundColor = "#28a745";
              
              paymentBtn.addEventListener("click", () => {
                console.log(`Redirecting to PayMongo Checkout: ${order.checkoutUrl}`);
                window.location.href = order.checkoutUrl; 
              });
              itemsContainer.appendChild(paymentBtn);
          } else {
              const statusDiv = document.createElement("div");
              statusDiv.innerHTML = "<p style='color:#dc3545; font-weight:bold;'>Error: No payment URL found. Contact support.</p>";
              itemsContainer.appendChild(statusDiv);
          }

          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "Cancel Order";
          cancelBtn.className = "action-btn cancel-refund-btn";
          cancelBtn.addEventListener("click", () => handleCancelOrder(order.id, order.items));
          itemsContainer.appendChild(cancelBtn);
      }
      
      if (currentTab === "Pending") {

        if (paymentMethod.includes("e-payment") || paymentMethod === "g" || paymentMethod === "gcash") {
          const btn = document.createElement("button");
          btn.textContent = order.refundRequest ? `Refund: ${order.refundStatus || "Requested"}` : "Request Refund";
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

      if (currentTab === "To Receive") {
        if (paymentMethod.includes("e-payment") || paymentMethod === "g" || paymentMethod === "gcash") {
          const refundBtn = document.createElement("button");
          refundBtn.textContent = order.refundRequest ? `Refund: ${order.refundStatus || "Requested"}` : "Request Refund";
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

      if (currentTab === "Refund") {
        const refundBtn = document.createElement("button");
        refundBtn.textContent = order.finalRefundStatus || order.refundStatus || "Requested";
        refundBtn.disabled = true;
        refundBtn.className = "action-btn";
        refundBtn.style.cursor = "not-allowed";

        if (order.finalRefundStatus === "Pending" || order.refundStatus === "Requested") refundBtn.style.backgroundColor = "orange";
        else if (order.finalRefundStatus === "Succeeded" || order.finalRefundStatus === "Manual") refundBtn.style.backgroundColor = "green";
        else if (order.finalRefundStatus === "Denied" || order.finalRefundStatus === "Failed" || order.finalRefundStatus === "API Failed") refundBtn.style.backgroundColor = "red";
        else refundBtn.style.backgroundColor = "#ccc"; 

        itemsContainer.appendChild(refundBtn);
      }

      if (order.status === "Completed by Customer" && !order.feedback && currentTab === "To Rate") {
        const btn = document.createElement("button");
        btn.textContent = "To Rate";
        btn.className = "action-btn";
        btn.addEventListener("click", () => openFeedbackModal(order.id, order.items));
        itemsContainer.appendChild(btn);
      }
      
      // Add Print Receipt button to completed/final states
      if (isFinalState) {
          const printButton = document.createElement("button");
          printButton.textContent = "View/Download Receipt";
          printButton.className = "print-receipt-btn";
          printButton.dataset.id = order.id;
          printButton.dataset.collection = "DeliveryOrders"; // Hardcoded for this file's context
          printButton.addEventListener("click", () => showReceiptPopup(order.id, "DeliveryOrders"));
          itemsContainer.appendChild(printButton);
      }


      orderContainer.appendChild(itemsContainer);
      orderItemsDiv.appendChild(orderContainer);
    });
  });
}

// --- RECEIPT FUNCTIONS (COPIED/MODIFIED FROM ADMIN FILE) ---

function generateReceiptHTML(order) {
    const date = order.timestamp ? new Date(order.timestamp).toLocaleString() : new Date().toLocaleString();
    
    // Check both product fields (though your customer code uses 'items')
    const orderItems = order.products || order.items || []; 
    
    // Calculate the product-only subtotal for clarity
    const productSubtotal = orderItems.reduce((sum, p) => 
        sum + (p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * (p.qty || p.quantity || 1))
    , 0);

    // Get Grand Total from the top-level 'total' field
    const grandTotal = order.total || 0; 
    const deliveryFee = order.deliveryFee || 0;

    let itemsHtml = orderItems.map(p => {
        const addons = p.addons?.length ? ` (+${p.addons.map(a => a.name).join(", ")})` : "";
        const sizeText = p.size ? (typeof p.size === "string" ? ` (${p.size})` : ` (${p.size.name})`) : "";
        const qty = p.qty || p.quantity || 1;
        // The individual item total calculation
        const total = p.total || ((p.sizePrice || 0) + (p.addonsPrice || 0)) * qty; 
        
        return `
            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px;">
                <span style="flex-grow: 1;">${qty} x ${p.product || p.name}${sizeText}${addons}</span>
                <span>₱${total.toFixed(2)}</span>
            </div>
        `;
    }).join('');

    // Add Delivery Fee section only if applicable
    if (deliveryFee > 0) {
        itemsHtml += `
            <div style="font-weight: bold; font-size: 15px; margin-top: 10px; border-top: 1px dashed #aaa; padding-top: 5px;">
                Delivery Details:
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px;">
                <span style="flex-grow: 1;">Delivery Fee</span>
                <span>₱${deliveryFee.toFixed(2)}</span>
            </div>
        `;
    }

    return `
        <div style="width: 300px; padding: 20px; font-family: monospace; border: 1px solid #000; margin: 0 auto;">
            <h2 style="text-align: center; margin-bottom: 5px; font-size: 18px;">--- OFFICIAL RECEIPT ---</h2>
            <p style="text-align: center; font-size: 12px; margin-bottom: 15px;">Cafe Amore x17</p>
            
            <div style="font-size: 13px; border-bottom: 1px dashed #aaa; padding-bottom: 10px; margin-bottom: 10px;">
                <p>Order ID: ${order.id}</p>
                <p>Queue #: ${formatQueueNumber(order.queueNumber || order.queueNumberNumeric)}</p>
                <p>Date: ${date}</p>
                <p>Type: Delivery</p>
                <p>Status: ${order.status}</p>
            </div>

            <div style="border-bottom: 1px dashed #aaa; padding-bottom: 10px; margin-bottom: 10px;">
                <div style="font-weight: bold; font-size: 15px; margin-bottom: 5px;">Items:</div>
                ${itemsHtml}
            </div>

            <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: bold; margin-bottom: 5px;">
                <span>SUBTOTAL (Products):</span>
                <span>₱${productSubtotal.toFixed(2)}</span>
            </div>

            <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 16px; margin-top: 10px;">
                <span>GRAND TOTAL:</span>
                <span>₱${grandTotal.toFixed(2)}</span>
            </div>
            
            <div style="text-align: center; font-size: 12px; margin-top: 20px;">
                <p>Thank you for your order!</p>
                <p>Please come again.</p>
            </div>
        </div>
    `;
}

// Helper to handle the actual PDF generation logic
async function generateAndDownloadPDF(orderId, collectionName, orderData) {
    if (typeof html2pdf === 'undefined') {
        customAlert("PDF Library Missing: Please include 'html2pdf.bundle.min.js' in your HTML file to enable PDF printing.");
        return;
    }

    const content = generateReceiptHTML({ id: orderId, type: "Delivery", ...orderData });
    const element = document.createElement('div');
    element.innerHTML = content;
    
    const options = {
        margin: 10,
        filename: `receipt_Order_${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 3, logging: false, dpi: 192, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
    };

    customAlert("Generating PDF receipt... Please wait.");
    await html2pdf().set(options).from(element).save();
    
    setTimeout(() => closePopup(), 1500);
}


async function showReceiptPopup(orderId, collectionName) {
    const orderRef = doc(db, collectionName, orderId);
    try {
        const orderSnap = await getDoc(orderRef);
        if (!orderSnap.exists()) {
            customAlert(`Error: Order ${orderId} not found.`);
            return;
        }
        const orderData = orderSnap.data();

        const receiptHtml = generateReceiptHTML({ id: orderId, type: "Delivery", ...orderData });

        if (!popup) createPopup();
        popupTitle.textContent = `Receipt for Queue #${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}`;
        
        popupReceiptContent.innerHTML = receiptHtml;

        popupButtonsContainer.innerHTML = `
            <button id="downloadReceiptBtn" data-id="${orderId}" data-collection="${collectionName}">Download Receipt (PDF)</button>
            <button id="closeReceiptBtn">Close</button>
        `;
        popup.style.display = "flex";

        document.getElementById("downloadReceiptBtn").onclick = () => {
            generateAndDownloadPDF(orderId, collectionName, orderData); 
        };

        document.getElementById("closeReceiptBtn").onclick = closePopup;

    } catch (err) {
        console.error("Show Receipt Error:", err);
        customAlert("Failed to load order data for receipt.");
    }
}

// --- END RECEIPT FUNCTIONS ---

async function returnItemsToInventory(orderItems) {
  if (!orderItems || orderItems.length === 0) return;
  const inventoryUpdates = {};

  for (const item of orderItems) {
    if (!item) continue;
    const productQtyOrdered = item.qty || item.quantity || 1;
    if (productQtyOrdered <= 0) continue;

    const aggregateItem = (id, consumptionPerProduct) => {
      if (!id) return;
      const totalConsumption = (consumptionPerProduct || 1) * productQtyOrdered;
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
      } else {
        console.warn(`Inventory item ${inventoryId} not found. Skipping stock return.`);
      }
    } catch (error) {
      console.error(`Error fetching inventory item ${inventoryId}:`, error);
    }
  }

  await batch.commit();
  console.log("✅ All items returned to inventory successfully.");
}

async function handleCancelOrder(orderId, orderItems) {
  if (!confirm("Are you sure you want to cancel this order? Stock will be returned.")) return;

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

function openRefundModal(orderId, orderItems) {
  const modal = document.getElementById("refund-modal");
  const refundForm = modal.querySelector("#refund-form");
  const refundItemsDiv = modal.querySelector("#refund-items");

  refundItemsDiv.innerHTML = "";
  let totalRefundable = 0;

  orderItems.forEach((item, index) => {
    if (!item) return;
    const productName = item.product || item.name || "Unknown Product";
    const qty = item.qty || item.quantity || 1;
    const size = item.size || "Medium";
    // Use the 'total' field if available, otherwise calculate it
    const totalPrice = item.total || (((item.sizePrice || 0) + (item.addonsPrice || 0)) * qty); 
    totalRefundable += totalPrice;

    const div = document.createElement("div");
    div.className = "refund-item";
    div.innerHTML = `
      <label>
        <input type="checkbox" name="refund" value="${index}">
        ${productName} (${size}) x${qty} - ₱${totalPrice.toFixed(2)}
      </label>
    `;
    refundItemsDiv.appendChild(div);
  });
  
  modal.querySelector("#total-refundable").textContent = `Total Refundable: ₱${totalRefundable.toFixed(2)}`;

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

  items.forEach((item) => {
    if (!item) return;
    const productName = item.product || item.name || "Unknown Product";

    const itemDiv = document.createElement("div");
    itemDiv.className = "feedback-item";

    const stars = Array.from({ length: 5 }, (_, i) => `<span class="star" data-value="${i + 1}">&#9734;</span>`).join('');

    itemDiv.innerHTML = `
      <h4>${productName}</h4>
      <div class="star-rating">${stars}</div>
      <textarea placeholder="Write your feedback..." required></textarea>
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
