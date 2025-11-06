import { db } from './firebase-config.js';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = getAuth();

let popup = null;
let popupTitle = null;
let popupButtonsContainer = null;
let popupReceiptContent = null; 

function injectPopupStyles() {
  if (document.getElementById("receipt-popup-style")) return;

  const style = document.createElement("style");
  style.id = "receipt-popup-style";
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
  #popupButtonsContainer button, .print-receipt-btn {
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
  #popupButtonsContainer button:hover, .print-receipt-btn:hover {
    background-color: #6d4428;
  }
  #popupReceiptContent {
      text-align: left;
      margin-top: 15px;
      padding-top: 5px;
      max-height: 350px; 
      overflow-y: auto;
  }
  #downloadReceiptBtn { background-color: #28a745; color: white; }
  #downloadReceiptBtn:hover { background-color: #1e7e34; }
  #closeAlertBtn, #closeReceiptBtn { background-color: #6c757d; }
  #closeAlertBtn:hover, #closeReceiptBtn:hover { background-color: #5a6268; }
  .order-actions .print-receipt-btn { 
      width: 100%;
      margin-top: 10px;
  }
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
  if (popup) popup.style.display = "none";
}

function formatQueueNumber(num) {
  return typeof num === 'string' ? num : (num ? num.toString().padStart(4, "0") : "----");
}

function generateReceiptHTML(order) {
  const date = order.createdAt?.toDate() ? order.createdAt.toDate().toLocaleString() : new Date().toLocaleString();
  const orderItems = order.products || order.items || []; 
  const productSubtotal = orderItems.reduce((sum, p) => 
    sum + (p.total || (((p.basePrice || 0) + (p.sizePrice || 0) + (p.addonsPrice || 0)) * (p.qty || p.quantity || 1)))
  , 0);
  const grandTotal = order.total || 0; 
  const deliveryFee = order.deliveryFee || 0;

  let itemsHtml = orderItems.map(p => {
    const addons = p.addons?.length ? ` (+${p.addons.map(a => a.name).join(", ")})` : "";
    const sizeText = p.size ? (typeof p.size === "string" ? ` (${p.size})` : ` (${p.size.name})`) : "";
    const qty = p.qty || p.quantity || 1;
    const total = p.total || (((p.basePrice || 0) + (p.sizePrice || 0) + (p.addonsPrice || 0)) * qty); 
    return `
      <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 2px;">
        <span style="flex-grow: 1;">${qty} x ${p.product || p.name}${sizeText}${addons}</span>
        <span>₱${total.toFixed(2)}</span>
      </div>
    `;
  }).join('');

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
    <div style="width: 300px; padding: 20px; font-family: monospace; border: 1px solid #000; margin: 0 auto; background-color: #fff;">
      <h2 style="text-align: center; margin-bottom: 5px; font-size: 18px;">--- OFFICIAL RECEIPT ---</h2>
      <p style="text-align: center; font-size: 12px; margin-bottom: 15px;">Cafe Amore x17</p>
      <div style="font-size: 13px; border-bottom: 1px dashed #aaa; padding-bottom: 10px; margin-bottom: 10px;">
        <p>Order ID: ${order.id}</p>
        <p>Queue #: ${formatQueueNumber(order.queueNumber || order.queueNumberNumeric)}</p>
        <p>Date: ${date}</p>
        <p>Type: Delivery</p>
        <p>Status: ${order.status}</p>
        <p>Payment: ${order.paymentMethod || "N/A"}</p>
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

async function generateAndDownloadPDF(orderId, collectionName, orderData) {
  if (typeof html2pdf === 'undefined') {
    customAlert("PDF Library Missing: Please include 'html2pdf.bundle.min.js' in your HTML file.");
    return;
  }

  const content = generateReceiptHTML({ id: orderId, type: "Delivery", ...orderData });
  const element = document.createElement('div');
  element.innerHTML = content;
  
  const options = {
    margin: 10,
    filename: `receipt_Order_${formatQueueNumber(orderData.queueNumber || orderData.queueNumberNumeric)}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 3, logging: false },
    jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
  };

  customAlert("Generating PDF receipt... Please wait.");
  document.body.appendChild(element);
  await html2pdf().set(options).from(element).save();
  document.body.removeChild(element);
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
      <button id="downloadReceiptBtn" data-id="${orderId}" data-collection="${collectionName}">Download Receipt</button>
      <button id="closeReceiptBtn">Close</button>
    `;
    popup.style.display = "flex";
    document.getElementById("downloadReceiptBtn").onclick = () => generateAndDownloadPDF(orderId, collectionName, orderData);
    document.getElementById("closeReceiptBtn").onclick = closePopup;
  } catch (err) {
    console.error("Show Receipt Error:", err);
    customAlert("Failed to load order data for receipt.");
  }
}


// driver access

async function verifyDriverAccess() {
  try {
    return new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        let email = user ? user.email : sessionStorage.getItem("driverEmail");
        if (!email) {
          alert("Access Denied. Please log in as Driver first.");
          window.location.href = "index.html";
          return reject(false);
        }

        const q = query(
          collection(db, "users"),
          where("email", "==", email),
          where("role", "==", "Driver")
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
          alert("Access Denied. Invalid Driver account.");
          sessionStorage.clear();
          window.location.href = "index.html";
          return reject(false);
        }
        const driverData = snapshot.docs[0].data();
        console.log("✅ Driver verified:", driverData.firstName, driverData.lastName);
        const nameEl = document.querySelector(".profile-name");
        if (nameEl) nameEl.textContent = `${driverData.firstName} ${driverData.lastName}`;
        resolve(true);
      });
    });
  } catch (error) {
    console.error("Error verifying driver access:", error);
    alert("Unable to verify driver access.");
    window.location.href = "index.html";
    return false;
  }
}


async function initializeDeliveryPage() {
  const allowed = await verifyDriverAccess();
  if (!allowed) return;

  const deliveriesNav = document.querySelector(".sidebar nav ul li.active");
  const editProfileText = document.querySelector(".edit-text");
  
 
  if (deliveriesNav) {
    deliveriesNav.style.cursor = "pointer"; 
    deliveriesNav.addEventListener("click", () => {
        window.location.href = "Driver.html"; 
    });
  }

  if (editProfileText) {
    editProfileText.style.cursor = "pointer"; 
    editProfileText.addEventListener("click", () => {
        window.location.href = "Employee-EditProfile.html"; 
    });
  }

  const ordersContainer = document.getElementById('ordersContainer');
  const tabButtons = document.querySelectorAll(".tab-btn");
  let selectedStatus = "Delivery";
  let allOrders = [];

  function calculateItemSubtotal(item) {
    if (item.total) return Number(item.total);
    const qty = Number(item.qty || item.quantity || 1);
    const basePrice = Number(item.basePrice || 0);
    const sizePrice = Number(item.sizePrice || 0);
    const addonsPrice = Number(item.addonsPrice || 0);
    return ((basePrice + sizePrice) * qty) + addonsPrice;
  }

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedStatus = btn.dataset.status;
      renderOrders();
    });
  });

  onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
    allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderOrders();
  });

  function renderOrders() {
    ordersContainer.innerHTML = "";
    const filtered = allOrders.filter(o => o.status === selectedStatus);

    if (selectedStatus === "Delivery") {
      filtered.sort((a, b) => (a.queueNumberNumeric || 0) - (b.queueNumberNumeric || 0));
    }

    if (!filtered.length) {
      ordersContainer.innerHTML = `<p>No ${selectedStatus.toLowerCase()} orders.</p>`;
      return;
    }

    filtered.forEach(order => {
      const card = document.createElement("div");
      card.className = "order-card";

      const itemSubtotal = Array.isArray(order.items)
        ? order.items.reduce((sum, i) => sum + calculateItemSubtotal(i), 0)
        : 0;
      const deliveryFee = Number(order.deliveryFee || 0);
      const grandTotal = Number(order.total || (itemSubtotal + deliveryFee));

      const itemsHtml = Array.isArray(order.items)
        ? order.items.map(i => `<p>• ${i.qty || 1} x ${i.product}${i.size ? ` (${i.size})` : ""}</p>`).join("")
        : "<p>No items listed.</p>";

      let actionsHtml = "";

      if (order.status === "Delivery") {
        actionsHtml += `
          ${order.phoneNumber || order.customerPhone ? `
            <button class="call-btn" onclick="window.location.href='tel:${order.phoneNumber || order.customerPhone}'">
              <i class="fas fa-phone"></i> Call
            </button>` : ""}
          <button class="complete-btn" onclick="markCompleted('${order.id}')">
            <i class="fas fa-check-circle"></i> Mark Completed
          </button>`;
      } else if (order.status === "Completed" || order.status === "Completed by Customer") {
        actionsHtml += `
          <button class="print-receipt-btn" onclick="showReceiptPopup('${order.id}', 'DeliveryOrders')">
            <i class="fas fa-receipt"></i> View Receipt
          </button>`;
      }

      card.innerHTML = `
        <div class="order-card-wrapper">
          <span class="queue-number">#${order.queueNumber || "N/A"}</span>
          <div class="header-info">
            <p>Customer: <strong>${order.customerName || "N/A"}</strong></p>
            <p>Payment: <strong>${order.paymentMethod || "N/A"}</strong></p>
            <p>Total: <strong>₱${grandTotal.toFixed(2)}</strong></p>
          </div>
          <span class="expand-arrow"><i class="fas fa-chevron-down"></i></span>
        </div>

        <div class="order-products">
          <h4>Delivery Details</h4>
          <p><strong>Address:</strong> ${order.address || "N/A"}</p>
          <p><strong>Phone:</strong> ${order.phoneNumber || order.customerPhone || "N/A"}</p>

          <h4>Order Items</h4>
          ${itemsHtml}

          <div class="price-summary">
            <p><span>Price (Items):</span> <span>₱${itemSubtotal.toFixed(2)}</span></p>
            <p><span>Delivery Fee:</span> <span>₱${deliveryFee.toFixed(2)}</span></p>
            <h4><span>Grand Total:</span> <span>₱${grandTotal.toFixed(2)}</span></h4>
          </div>
        </div>

        <div class="order-actions">${actionsHtml}</div>
      `;

      card.querySelector(".order-card-wrapper").addEventListener("click", () => {
        card.classList.toggle("expanded");
      });

      ordersContainer.appendChild(card);
    });
  }

  window.markCompleted = async function(orderId) {
    try {
      await updateDoc(doc(db, "DeliveryOrders", orderId), {
        status: "Completed",
        completedAt: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to mark completed:", err);
    }
  };

  window.showReceiptPopup = showReceiptPopup; 

  const logoutBtn = document.querySelector(".logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      const confirmLogout = confirm("Are you sure you want to log out?");
      if (!confirmLogout) return;
      try {
        await signOut(auth);
      } catch (err) {
        console.warn("No Firebase session found:", err.message);
      }
      sessionStorage.clear();
      window.location.href = "index.html";
    });
  }
}

initializeDeliveryPage();
