// --- imports ---
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, updateDoc, doc,
  serverTimestamp, onSnapshot, query, orderBy, limit, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- DOM Elements ---
const productList = document.getElementById("productList");
const productPopup = document.getElementById("productPopup");
const popupProductName = document.getElementById("popupProductName");
const sizeContainer = document.getElementById("sizeContainer");
const addonContainer = document.getElementById("addonContainer");
const quantityInput = document.getElementById("quantityInput");
const addToOrderBtn = document.getElementById("addToOrderBtn");
const cancelPopupBtn = document.getElementById("cancelPopupBtn");

const currentOrderList = document.getElementById("currentOrderList");
const orderTotal = document.getElementById("orderTotal");
const doneOrderBtn = document.getElementById("doneOrderBtn");
const cancelOrderBtn = document.getElementById("cancelOrderBtn");

const paymentPopup = document.getElementById("paymentPopup");
const cashBtn = document.getElementById("cashBtn");
const epaymentBtn = document.getElementById("epaymentBtn");
const cancelPaymentBtn = document.getElementById("cancelPaymentBtn");

const cashPopup = document.getElementById("cashPopup");
const cashTotal = document.getElementById("cashTotal");
const cashInput = document.getElementById("cashInput");
const cashChange = document.getElementById("cashChange");
const cashDoneBtn = document.getElementById("cashDoneBtn");
const cashCancelBtn = document.getElementById("cashCancelBtn");

const epaymentPopup = document.getElementById("epaymentPopup");
const epayYesBtn = document.getElementById("epayYesBtn");
const epayNoBtn = document.getElementById("epayNoBtn");

const cancelConfirmPopup = document.getElementById("cancelConfirmPopup");
const cancelYesBtn = document.getElementById("cancelYesBtn");
const cancelNoBtn = document.getElementById("cancelNoBtn");

// ✅ NEW: popup message element
const messagePopup = document.getElementById("messagePopup");

// --- State Variables ---
let currentOrder = [];
let selectedProduct = null;
let totalPrice = 0;

// --- Helper: Show toast message ---
function showMessage(msg, type = "success") {
  messagePopup.textContent = msg;
  messagePopup.style.backgroundColor = (type === "error") ? "#e53935" : "#4caf50";
  messagePopup.classList.add("show");

  setTimeout(() => {
    messagePopup.classList.remove("show");
  }, 2500);
}

// --- Helper: Close all popups ---
function closeAllPopups() {
  [productPopup, paymentPopup, cashPopup, epaymentPopup, cancelConfirmPopup].forEach(p => p.style.display = "none");
}

// --- Helper: Get next queue number ---
async function getNextQueueNumber() {
  const q = query(collection(db, "InStoreOrders"), orderBy("queueNumber", "desc"), limit(1));
  const snapshot = await getDocs(q);
  return !snapshot.empty ? (snapshot.docs[0].data().queueNumber || 0) + 1 : 1;
}

// --- Load products dynamically ---
function loadProducts() {
  onSnapshot(collection(db, "Inventory"), invSnap => {
    const inventoryData = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    onSnapshot(collection(db, "products"), snapshot => {
      productList.innerHTML = "";

      snapshot.forEach(docSnap => {
        const product = docSnap.data();
        const displayName = product.name || product.flavor;
        if (!displayName) return;

        const div = document.createElement("div");
        div.classList.add("product-box");
        div.textContent = displayName;

        // --- Check availability ---
        let available = true;

        if (product.available === false) available = false;

        if (available) {
          for (const ing of product.ingredients || []) {
            const inv = inventoryData.find(d => d.id === ing.id);
            if (!inv || inv.quantity < (ing.qty || 1)) {
              available = false;
              break;
            }
          }
        }

        if (available) {
          for (const other of product.others || []) {
            const inv = inventoryData.find(d => d.id === other.id);
            if (!inv || inv.quantity < (other.qty || 1)) {
              available = false;
              break;
            }
          }
        }

        if (!available) {
          div.classList.add("disabled");
          const span = document.createElement("span");
          
          div.appendChild(span);
        } else {
          div.addEventListener("click", () => openProductPopup(product, displayName));
        }

        productList.appendChild(div);
      });
    });
  });
}

// --- Open product popup ---
function openProductPopup(product, displayName) {
  selectedProduct = product;
  popupProductName.textContent = displayName;

  // Sizes
  sizeContainer.innerHTML = "";
  (product.sizes || []).forEach((s, i) => {
    const wrapper = document.createElement("div");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "size";
    radio.value = s.price || 0;
    radio.dataset.name = s.name || null;
    radio.dataset.id = s.id || null;
    radio.id = `size_${i}`;
    const label = document.createElement("label");
    label.htmlFor = radio.id;
    label.textContent = `${s.name || "Size"} (₱${s.price || 0})`;
    wrapper.append(radio, label);
    sizeContainer.appendChild(wrapper);
  });

  // Add-ons
  addonContainer.innerHTML = "";
  if (product.addons?.length) {
    const h4 = document.createElement("h4");
    h4.textContent = "Add-ons (optional):";
    addonContainer.appendChild(h4);

    product.addons.forEach((a, i) => {
      const wrapper = document.createElement("div");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = a.price || 0;
      checkbox.dataset.name = a.name || null;
      checkbox.dataset.id = a.id || null;
      checkbox.id = `addon_${i}`;
      const label = document.createElement("label");
      label.htmlFor = checkbox.id;
      label.textContent = `${a.name || "Addon"} (₱${a.price || 0})`;
      wrapper.append(checkbox, label);
      addonContainer.appendChild(wrapper);
    });
  }

  quantityInput.value = 1;
  productPopup.style.display = "flex";
}

// --- Close popup ---
cancelPopupBtn.addEventListener("click", () => {
  productPopup.style.display = "none";
  selectedProduct = null;
});

// --- Add to order ---
addToOrderBtn.addEventListener("click", () => {
  if (!selectedProduct) return;

  const qty = parseInt(quantityInput.value) || 1;
  let basePrice = 0, sizeName = null, sizeId = null;

  if (selectedProduct.sizes?.length) {
    const sizeInput = document.querySelector("input[name='size']:checked");
    if (!sizeInput) return showMessage("Please select a size.", "error");
    basePrice = parseFloat(sizeInput.value) || 0;
    sizeName = sizeInput.dataset.name || null;
    sizeId = sizeInput.dataset.id || null;
  }

  const addons = [];
  let addonsPrice = 0;
  addonContainer.querySelectorAll("input[type='checkbox']:checked").forEach(cb => {
    const price = parseFloat(cb.value) || 0;
    addons.push({ name: cb.dataset.name || null, price, id: cb.dataset.id || null });
    addonsPrice += price;
  });

  const itemTotal = (basePrice + addonsPrice) * qty;
  currentOrder.push({
    product: selectedProduct.name || selectedProduct.flavor || "Unknown",
    productId: selectedProduct.id || null,
    size: sizeName,
    sizeId,
    qty,
    basePrice,
    addons,
    ingredients: selectedProduct.ingredients || [],
    others: selectedProduct.others || [],
    total: itemTotal
  });

  renderOrder();
  productPopup.style.display = "none";
  selectedProduct = null;
});

// --- Render order ---
function renderOrder() {
  currentOrderList.innerHTML = "";
  totalPrice = 0;

  currentOrder.forEach((o, idx) => {
    const baseLine = `<div style="margin-left:20px;">${o.qty} × ₱${o.basePrice.toFixed(2)} = ₱${(o.qty * o.basePrice).toFixed(2)}</div>`;
    const addonLines = o.addons.map(a => `<div style="margin-left:20px;">${a.name}: ₱${a.price.toFixed(2)}</div>`).join("");
    const div = document.createElement("div");
    div.classList.add("order-item");
    div.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><div><strong>${o.product}${o.size ? ` (${o.size})` : ""}</strong>${baseLine}${addonLines}</div><button class="remove-btn" data-index="${idx}">❌</button></div>`;
    currentOrderList.appendChild(div);
    totalPrice += o.total;
  });

  orderTotal.textContent = `Total: ₱${totalPrice.toFixed(2)}`;

  currentOrderList.querySelectorAll(".remove-btn").forEach(btn =>
    btn.addEventListener("click", e => {
      currentOrder.splice(e.target.dataset.index, 1);
      renderOrder();
    })
  );
}

// --- Deduct inventory ---
async function deductInventory(order) {
  const deductItem = async (id, amount) => {
    if (!id) return;
    const invRef = doc(db, "Inventory", id);
    const invSnap = await getDoc(invRef);
    const invQty = invSnap.exists() ? invSnap.data().quantity || 0 : 0;
    await updateDoc(invRef, { quantity: Math.max(invQty - amount, 0) });
  };

  for (const item of order) {
    for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * item.qty);
    for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * item.qty);
    if (item.sizeId) await deductItem(item.sizeId, item.qty);
    for (const addon of item.addons || []) await deductItem(addon.id, item.qty);
  }
}

// --- Save order ---
async function saveOrder(paymentType, cash = 0) {
  try {
    if (!currentOrder.length) return showMessage("No items in order.", "error");
    if (totalPrice <= 0) return showMessage("Invalid order total.", "error");

    const queueNumber = await getNextQueueNumber();
    const sanitizedOrder = currentOrder.map(item => ({
      product: item.product,
      productId: item.productId || null,
      size: item.size || null,
      sizeId: item.sizeId || null,
      qty: item.qty,
      basePrice: item.basePrice,
      addons: item.addons.map(a => ({ name: a.name || null, price: a.price || 0, id: a.id || null })),
      ingredients: item.ingredients || [],
      others: item.others || [],
      total: item.total
    }));

    await addDoc(collection(db, "InStoreOrders"), {
      items: sanitizedOrder,
      total: totalPrice,
      paymentType,
      cashGiven: cash,
      change: cash - totalPrice,
      status: "Pending",
      queueNumber,
      createdAt: serverTimestamp()
    });

    await deductInventory(currentOrder);
    showMessage("Order saved successfully!", "success");

    currentOrder = [];
    renderOrder();
    closeAllPopups();

  } catch (err) {
    console.error(err);
    showMessage("Failed to save order: " + err.message, "error");
  }
}

// --- Button Handlers ---
doneOrderBtn.addEventListener("click", () => {
  if (!currentOrder.length) return showMessage("No items in the order.", "error");
  paymentPopup.style.display = "flex";
});

cancelOrderBtn.addEventListener("click", () => {
  if (!currentOrder.length) return showMessage("No items to cancel.", "error");
  cancelConfirmPopup.style.display = "flex";
});

cancelYesBtn.addEventListener("click", () => {
  currentOrder = [];
  renderOrder();
  cancelConfirmPopup.style.display = "none";
  showMessage("Order cancelled.", "success");
});

cancelNoBtn.addEventListener("click", () => cancelConfirmPopup.style.display = "none");

// --- Cash payment ---
cashBtn.addEventListener("click", () => {
  paymentPopup.style.display = "none";
  cashPopup.style.display = "flex";
  cashTotal.textContent = `Total: ₱${totalPrice.toFixed(2)}`;
  cashInput.value = "";
  cashChange.textContent = "";
  cashDoneBtn.disabled = true;
});

cashCancelBtn.addEventListener("click", () => {
  cashPopup.style.display = "none";
  paymentPopup.style.display = "flex";
});

cashInput.addEventListener("input", () => {
  const cash = parseFloat(cashInput.value);
  if (isNaN(cash) || cash < totalPrice) {
    cashChange.textContent = "Insufficient cash!";
    cashChange.style.color = "red";
    cashDoneBtn.disabled = true;
  } else {
    cashChange.textContent = `Change: ₱${(cash - totalPrice).toFixed(2)}`;
    cashChange.style.color = "green";
    cashDoneBtn.disabled = false;
  }
});

cashDoneBtn.addEventListener("click", () => {
  const cash = parseFloat(cashInput.value);
  if (isNaN(cash) || cash < totalPrice) return;
  saveOrder("Cash", cash);
});

// --- E-Payment ---
epaymentBtn.addEventListener("click", () => {
  paymentPopup.style.display = "none";
  epaymentPopup.style.display = "flex";
});

cancelPaymentBtn.addEventListener("click", () => {
  paymentPopup.style.display = "none";
});

epayYesBtn.addEventListener("click", () => {
  saveOrder("E-Payment");
});

epayNoBtn.addEventListener("click", () => {
  epaymentPopup.style.display = "none";
  paymentPopup.style.display = "flex";
});

// --- Initialize ---
loadProducts();
