// ==========================
// --- imports ---
// ==========================
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
  serverTimestamp, onSnapshot, query, orderBy, limit, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================
// --- DELIVERY FEES ---
// ==========================
const deliveryFees = {
  "Alima": 5, "Aniban I": 10, "Aniban II": 15, "Aniban III": 20,
  "Aniban IV": 25, "Aniban V": 30, "Banalo": 35, "Bayanan": 40,
  "Campo Santo": 45, "Daang Bukid": 50, "Digman": 55, "Dulong Bayan": 60,
  "Habay I": 65, "Habay II": 70, "Ligas I": 75, "Ligas II": 80,
  "Ligas III": 85, "Mabolo I": 90, "Mabolo II": 95, "Mabolo III": 100,
  "Maliksi I": 105, "Maliksi II": 110, "Maliksi III": 115, "Mambog I": 120,
  "Mambog II": 125, "Mambog III": 130, "Mambog IV": 135, "Mambog V": 140,
  "Molino I": 145, "Molino II": 150, "Molino III": 155, "Molino IV": 160,
  "Molino V": 165, "Molino VI": 170, "Molino VII": 175, "Niog I": 180,
  "Niog II": 185, "Niog III": 190, "P.F. Espiritu I (Panapaan)": 195,
  "P.F. Espiritu II": 200, "P.F. Espiritu III": 205, "P.F. Espiritu IV": 210,
  "P.F. Espiritu V": 215, "P.F. Espiritu VI": 220, "P.F. Espiritu VII": 225,
  "P.F. Espiritu VIII": 230, "Queens Row Central": 235, "Queens Row East": 240,
  "Queens Row West": 245, "Real I": 250, "Real II": 255, "Salinas I": 260,
  "Salinas II": 265, "Salinas III": 270, "Salinas IV": 275, "San Nicolas I": 280,
  "San Nicolas II": 285, "San Nicolas III": 290, "Sineguelasan": 295,
  "Tabing Dagat (Poblacion)": 300, "Talaba I": 305, "Talaba II": 310,
  "Talaba III": 315, "Talaba IV": 320, "Talaba V": 325, "Talaba VI": 330,
  "Talaba VII": 335, "Zapote I": 340, "Zapote II": 345, "Zapote III": 350,
  "Zapote IV": 355, "Zapote V": 360
};

// ==========================
// --- DOM Elements ---
// ==========================
const cartItemsDiv = document.getElementById('cart-items');
const cartTotalSpan = document.getElementById('cart-total');
const confirmOrderBtn = document.getElementById('confirm-order-btn');
const modal = document.getElementById("confirmOrderModal");
const closeModalBtn = document.querySelector(".close-modal");
const finalConfirmBtn = document.getElementById("final-confirm-btn");
const savedAddressDiv = document.getElementById("saved-address");
const addAddressBtn = document.getElementById("add-address-btn");
const modalCartItemsDiv = document.getElementById("modal-cart-items");
const modalDeliveryFeeSpan = document.getElementById("modal-delivery-fee");
const modalGrandTotalSpan = document.getElementById("modal-grand-total");
const addressFormDiv = document.getElementById("address-form-div");
const addressForm = document.getElementById("address-form");
const toastDiv = document.getElementById("toast");

const auth = getAuth();
let currentUser = null;
let cartItems = [];
let selectedCartItems = new Set();
let unsubscribeCart = null;
let unsubscribeInventory = null;
let unsubscribeProducts = null;
let selectedAddress = null;
let userDeliveryFee = 0;
let defaultUserDocData = null;
let cartAddresses = [];

// Global realtime maps (single source of truth)
let inventoryMap = {}; // inventoryMap[id] = { id, name, quantity, active, ... }
let productMap = {};   // productMap[id] = { id, ...productData }

// ==========================
// --- TOAST FUNCTION ---
// ==========================
function showToast(message, duration = 3000, color = "red", inline = false) {
  toastDiv.textContent = message;
  toastDiv.style.backgroundColor = color;
  toastDiv.style.visibility = "visible";
  toastDiv.style.display = inline ? "inline-block" : "flex";
  toastDiv.style.textAlign = "center";
  toastDiv.style.justifyContent = inline ? "flex-start" : "center";
  toastDiv.style.padding = "8px 12px";
  toastDiv.style.borderRadius = "6px";
  toastDiv.style.color = "#fff";
  setTimeout(() => { toastDiv.style.visibility = "hidden"; }, duration);
}

// ==========================
// --- AUTH STATE ---
// ==========================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (userDocSnap.exists()) {
      defaultUserDocData = userDocSnap.data();
      userDeliveryFee = Number(defaultUserDocData.deliveryFee ?? 0);
    }
    startRealtimeListeners();
    loadSavedAddresses();
  } else {
    currentUser = null;
    cartItemsDiv.innerHTML = '<p>Please log in to view your cart.</p>';
    window.location.href = "login.html";
    cartTotalSpan.textContent = '0.00';
    cartItems = [];
    selectedCartItems.clear();
    stopRealtimeListeners();
  }
});

// ==========================
// --- ADD TO CART ---
// ==========================
export async function addToCart(product, selectedSize = null, selectedAddons = [], quantity = 1) {
  if (!currentUser) return showToast("Please log in first.", 3000, "red");

  // Prevent adding unavailable products
  if (product.available === false) {
    return showToast("This product is currently unavailable.", 3000, "red", true);
  }

  const basePrice = Number(product.price || 0);
  const sizePrice = Number(selectedSize?.price || 0);
  const addons = (selectedAddons || []).map(a => ({
    name: a.name,
    price: Number(a.price || 0),
    id: a.id || null
  }));
  const addonsPrice = addons.reduce((sum, a) => sum + a.price, 0);
  const unitPrice = basePrice + sizePrice + addonsPrice;
  const totalPrice = unitPrice * quantity;

  try {
    const cartRef = collection(db, "users", currentUser.uid, "cart");
    const snapshot = await getDocs(cartRef);
    let existingDoc = null;
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const sameProduct = data.productId === product.id;
      const sameSize = data.sizeId === selectedSize?.id;
      const sameAddons = JSON.stringify(data.addons || []) === JSON.stringify(addons || []);
      if (sameProduct && sameSize && sameAddons) existingDoc = { id: docSnap.id, data };
    });

    if (existingDoc) {
      const newQty = (existingDoc.data.quantity || 1) + quantity;
      await updateDoc(doc(cartRef, existingDoc.id), {
        quantity: newQty,
        totalPrice: unitPrice * newQty
      });
      showToast("Cart updated successfully!", 2000, "green", true);
    } else {
      const selectedSizeData = product.sizes?.find(s => s.id === selectedSize?.id);
      await addDoc(cartRef, {
        productId: product.id || null,
        name: product.name || "Unnamed Product",
        image: product.image || "placeholder.png",
        basePrice, sizePrice, addonsPrice, unitPrice, totalPrice,
        quantity,
        size: selectedSize?.name || null,
        sizeId: selectedSize?.id || null,
        addons,
        ingredients: selectedSizeData?.ingredients || [],
        others: selectedSizeData?.others || [],
        addedAt: new Date(),
        userId: currentUser.uid,
        available: product.available !== false // Store product availability snapshot (UI-friendly)
      });
      showToast("Added to cart successfully!", 2000, "green", true);
    }
  } catch (err) {
    console.error("Error adding to cart:", err);
    showToast("Failed to add to cart.", 3000, "red");
  }
}

// ==========================
// --- STOCK COMPUTATION (uses maps) ---
// ==========================
function computeStockForCartItem(item) {
  // Uses inventoryMap and productMap (both kept realtime)
  // Return { stock: number, available: boolean }
  // available = product.available && inventory components active
  if (!item) return { stock: 0, available: false };

  // Check product availability live (productMap)
  if (item.productId) {
    const prod = productMap[item.productId];
    if (prod && prod.available === false) return { stock: 0, available: false };
  }

  let possible = Infinity;
  const getComponentLimit = (component, requiredQtyPerProduct) => {
    if (!component || !component.id) return 0;
    const inv = inventoryMap[component.id];
    if (!inv || inv.active === false || Number(inv.quantity || 0) <= 0) return 0;
    const requiredQty = Math.max(Number(requiredQtyPerProduct) || 1, 1);
    return Math.floor(Number(inv.quantity || 0) / requiredQty);
  };

  // If there's a sizeId used in cart (size is a component), consider it:
  if (item.sizeId) {
    const sizeLimit = getComponentLimit({ id: item.sizeId }, 1);
    possible = Math.min(possible, sizeLimit);
    if (possible === 0) return { stock: 0, available: true };
  }

  for (const ing of item.ingredients || []) {
    const limit = getComponentLimit(ing, ing.qty);
    possible = Math.min(possible, limit);
    if (possible === 0) return { stock: 0, available: true };
  }

  for (const addon of item.addons || []) {
    const limit = getComponentLimit(addon, addon.qty || 1);
    possible = Math.min(possible, limit);
    if (possible === 0) return { stock: 0, available: true };
  }

  for (const other of item.others || []) {
    const limit = getComponentLimit(other, other.qty);
    possible = Math.min(possible, limit);
    if (possible === 0) return { stock: 0, available: true };
  }

  return { stock: possible === Infinity ? 0 : possible, available: true };
}

// ==========================
// --- REALTIME LISTENERS SETUP / TEARDOWN ---
// ==========================
function startRealtimeListeners() {
  // Inventory listener
  if (unsubscribeInventory) unsubscribeInventory();
  unsubscribeInventory = onSnapshot(collection(db, "Inventory"), snapshot => {
    inventoryMap = {};
    snapshot.forEach(docSnap => {
      inventoryMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });
    // Re-render cart using up-to-date inventory
    renderCartItemsFromState();
  }, err => console.error("Inventory onSnapshot error:", err));

  // Products listener
  if (unsubscribeProducts) unsubscribeProducts();
  unsubscribeProducts = onSnapshot(collection(db, "products"), snapshot => {
    productMap = {};
    snapshot.forEach(docSnap => {
      productMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });
    // Re-render cart as product availability could change
    renderCartItemsFromState();
  }, err => console.error("Products onSnapshot error:", err));

  // Cart listener (per-user)
  loadCartRealtime(); // will attach/unattach cart snapshot listener
}

function stopRealtimeListeners() {
  if (unsubscribeInventory) { unsubscribeInventory(); unsubscribeInventory = null; }
  if (unsubscribeProducts) { unsubscribeProducts(); unsubscribeProducts = null; }
  if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }
  inventoryMap = {};
  productMap = {};
  cartItems = [];
  selectedCartItems.clear();
  cartItemsDiv.innerHTML = "";
}

// ==========================
// --- LOAD CART REALTIME ---
// ==========================
function loadCartRealtime() {
  if (!currentUser) return;
  const cartRef = collection(db, "users", currentUser.uid, "cart");
  if (unsubscribeCart) unsubscribeCart();

  unsubscribeCart = onSnapshot(cartRef, async snapshot => {
    // Keep the cart items in state
    cartItems = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

    // Keep selection consistent: remove selected ids that no longer exist
    const currentIds = new Set(cartItems.map(i => i.id));
    selectedCartItems = new Set(Array.from(selectedCartItems).filter(id => currentIds.has(id)));

    renderCartItemsFromState();
  }, err => {
    console.error("Error loading cart:", err);
    cartItemsDiv.innerHTML = "<p>Failed to load cart.</p>";
    cartTotalSpan.textContent = "0.00";
    updateModalTotals();
  });
}

// Render helper which always uses inventoryMap + productMap + cartItems
function renderCartItemsFromState() {
  cartItemsDiv.innerHTML = "";

  if (!cartItems.length) {
    cartItemsDiv.innerHTML = "<p>Your cart is empty.</p>";
    cartTotalSpan.textContent = "0.00";
    updateModalTotals();
    return;
  }

  // Select All UI
  const selectAllDiv = document.createElement("div");
  selectAllDiv.innerHTML = `<label><input type="checkbox" id="select-all-checkbox"> Select All</label>`;
  cartItemsDiv.appendChild(selectAllDiv);
  const selectAllCheckbox = selectAllDiv.querySelector("#select-all-checkbox");

  // delivery div placeholder
  let deliveryDiv = document.getElementById("delivery-fee");
  if (!deliveryDiv) {
    deliveryDiv = document.createElement("div");
    deliveryDiv.id = "delivery-fee";
    deliveryDiv.style.textAlign = "right";
    deliveryDiv.style.marginTop = "12px";
    cartItemsDiv.appendChild(deliveryDiv);
  }

  selectAllCheckbox.checked = cartItems.filter(i => {
    const { stock, available } = computeStockForCartItem(i);
    return stock > 0 && available;
  }).length > 0 && Array.from(selectedCartItems).length > 0 &&
    Array.from(selectedCartItems).every(id => {
      const found = cartItems.find(ci => ci.id === id);
      if (!found) return false;
      const s = computeStockForCartItem(found);
      return s.stock > 0 && s.available;
    });

  selectAllCheckbox.addEventListener("change", () => {
    if (selectAllCheckbox.checked) {
      cartItems.forEach(item => {
        const { stock, available } = computeStockForCartItem(item);
        if (stock > 0 && available) selectedCartItems.add(item.id);
      });
    } else {
      selectedCartItems.clear();
    }
    renderCartItemsFromState();
    updateCartTotal();
    updateModalTotals();
  });

  // Build items
  for (const item of cartItems) {
    const { stock, available } = computeStockForCartItem(item);
    const itemDiv = document.createElement("div");
    itemDiv.classList.add("cart-item");
    if (!available || stock <= 0) itemDiv.classList.add("unavailable");
    itemDiv.style.display = "flex";
    itemDiv.style.alignItems = "center";
    itemDiv.style.justifyContent = "space-between";
    itemDiv.style.gap = "12px";
    itemDiv.style.padding = "10px 0";
    itemDiv.style.borderBottom = "1px solid #ddd";

    const disabledAttr = (!available || stock <= 0) ? "disabled" : "";
    let statusLabel = "";
    if (!available) statusLabel = " (Unavailable)";
    else if (stock <= 0) statusLabel = " (Out of stock)";
    else statusLabel = ` (Stock: ${stock})`;

    // compute displayQty (avoid showing 0 as qty)
    let displayQty = item.quantity;
    if (stock <= 0) displayQty = 1;
    else displayQty = Math.min(item.quantity || 1, stock);

    let addonsHTML = "";
    if (Array.isArray(item.addons) && item.addons.length) {
      addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
    }

    // Stock available
    itemDiv.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; flex:1;">
        <input type="checkbox" class="cart-checkbox" data-id="${item.id}" ${selectedCartItems.has(item.id) ? "checked" : ""} ${disabledAttr}>
        <img src="${item.image || 'placeholder.png'}" alt="${item.name}"
            style="height:70px; width:70px; object-fit:cover; border-radius:6px; flex-shrink:0;">
        <div style="flex:1; opacity:${!available ? 0.5 : 1};">
          <strong>${item.name}                             </strong> <span style="margin-left: 10px;">(Stock: ${stock})</span><br>  
          ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice || item.sizePrice || 0).toFixed(2)}` : 'Size: N/A'}<br>
          ${addonsHTML}<br>
          <label>Qty: <input type="number" min="1" max="${stock}" value="${displayQty}" class="qty-input" style="width:60px;" ${disabledAttr}></label><br>
          <small>Total: ₱${Number(item.totalPrice).toFixed(2)}</small>
        </div>
      </div>
      <button class="remove-btn" style="background:none; border:none; font-size:18px; cursor:pointer;" ${disabledAttr}>❌</button>
    `;
    // remove
    const removeBtn = itemDiv.querySelector(".remove-btn");
    removeBtn.addEventListener("click", async () => {
      try {
        await deleteDoc(doc(collection(db, "users", currentUser.uid, "cart").parent.path ? db : db, "users", currentUser.uid, "cart", item.id));
      } catch (err) {
        // fallback (use doc with path)
        await deleteDoc(doc(db, "users", currentUser.uid, "cart", item.id));
      }
      showToast("Item removed from cart.", 2000, "red", true);
    });

    // qty input
    const qtyInput = itemDiv.querySelector(".qty-input");
    if (qtyInput && !(stock <= 0 || !available)) {
      qtyInput.addEventListener("change", async e => {
        let newQty = parseInt(e.target.value) || 1;
        if (newQty > stock) newQty = stock;
        if (newQty < 1) newQty = 1;
        e.target.value = newQty;
        const newUnit = Number(item.basePrice || 0) + Number(item.sizePrice || 0) + Number(item.addonsPrice || 0);
        try {
          await updateDoc(doc(db, "users", currentUser.uid, "cart", item.id), {
            quantity: newQty,
            unitPrice: newUnit,
            totalPrice: newUnit * newQty
          });
        } catch (err) {
          console.error("Error updating qty:", err);
          showToast("Failed to update quantity.", 2000, "red");
        }
      });
    }

    // checkbox selection
    const checkbox = itemDiv.querySelector(".cart-checkbox");
    if (checkbox) {
      // ensure it's disabled if not available
      if (!available || stock <= 0) {
        checkbox.disabled = true;
      } else {
        checkbox.addEventListener("change", e => {
          if (e.target.checked) selectedCartItems.add(item.id);
          else selectedCartItems.delete(item.id);
          selectAllCheckbox.checked = cartItems.filter(i => computeStockForCartItem(i).stock > 0 && computeStockForCartItem(i).available).length === selectedCartItems.size;
          updateCartTotal();
          updateModalTotals();
        });
      }
    }

    cartItemsDiv.insertBefore(itemDiv, deliveryDiv);
  }

  deliveryDiv.innerHTML = `<strong>Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}</strong>`;
  updateCartTotal();
}

// ==========================
// --- UPDATE TOTALS & MODAL ---
// ==========================
function updateCartTotal() {
  const grandTotal = cartItems
    .filter(i => selectedCartItems.has(i.id) && computeStockForCartItem(i).available !== false && computeStockForCartItem(i).stock > 0)
    .reduce((sum, i) => sum + Number(i.totalPrice || 0), 0);
  cartTotalSpan.textContent = selectedCartItems.size > 0 ? (grandTotal + userDeliveryFee).toFixed(2) : "0.00";
}

function updateModalTotals() {
  modalDeliveryFeeSpan.textContent = userDeliveryFee.toFixed(2);
  const total = cartItems
    .filter(i => selectedCartItems.has(i.id) && computeStockForCartItem(i).available !== false && computeStockForCartItem(i).stock > 0)
    .reduce((sum, i) => sum + Number(i.totalPrice || 0), 0) + (selectedCartItems.size > 0 ? userDeliveryFee : 0);
  modalGrandTotalSpan.textContent = total.toFixed(2);
}

// ==========================
// --- POPULATE MODAL ---
// ==========================
function populateModalCart() {
  modalCartItemsDiv.innerHTML = "";
  cartItems.filter(i => selectedCartItems.has(i.id)).forEach(item => {
    let addonsHTML = "";
    if (Array.isArray(item.addons) && item.addons.length) {
      addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
    }
    const { stock } = computeStockForCartItem(item);
    const outOfStockLabel = stock <= 0 ? " (Unavailable)" : "";
    modalCartItemsDiv.innerHTML += `
      <div class="modal-cart-item" style="display:flex; align-items:center; gap:12px; justify-content:space-between; border-bottom:1px solid #ddd; padding:8px 0;">
        <div style="display:flex; align-items:center; gap:10px; flex:1;">
          <img src="${item.image || 'placeholder.png'}" alt="${item.name}"
              style="height:60px; width:60px; object-fit:cover; border-radius:6px; flex-shrink:0;">
          <div>
            <strong>${item.name}${outOfStockLabel} (Stock: ${stock ?? 'N/A'})</strong><br>
            ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice).toFixed(2)}` : 'Size: N/A'}
            ${addonsHTML}<br>
            Qty: ${item.quantity} | Total: ₱${Number(item.totalPrice).toFixed(2)}
          </div>
        </div>
      </div>
    `;
  });
}

// ==========================
// --- MODAL & ADDRESSES ---
// ==========================
confirmOrderBtn?.addEventListener("click", () => {
  if (!currentUser) return showToast("Please log in.", 3000, "red");
  if (selectedCartItems.size === 0) return showToast("Select items to checkout.", 3000, "red");
  modal.style.display = "block";
  loadSavedAddresses();
  populateModalCart();
});

closeModalBtn?.addEventListener("click", () => { modal.style.display = "none"; });
window.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });

// ==========================
// --- ADDRESSES ---
// ==========================
async function loadSavedAddresses() {
  savedAddressDiv.innerHTML = "";
  cartAddresses = [];

  try {
    const userDoc = defaultUserDocData;
    if (userDoc) {
      const defaultAddr = [userDoc.houseNumber, userDoc.barangay, userDoc.city, userDoc.province, userDoc.region]
        .filter(Boolean)
        .join(", ");

      if (defaultAddr) {
        const fee = Number((userDoc.deliveryFee ?? deliveryFees[userDoc.barangay]) || 0);
        cartAddresses.push({ fullAddress: defaultAddr, deliveryFee: fee });

        const div = document.createElement("div");
        div.classList.add("delivery-address");
        div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${defaultAddr}" checked> Address 1 (Default): ${defaultAddr}</label>`;
        savedAddressDiv.appendChild(div);

        selectedAddress = defaultAddr;
        userDeliveryFee = fee;
      }
    }

    const addrRef = collection(db, "users", currentUser.uid, "addresses");
    const snapshot = await getDocs(addrRef);

    let i = cartAddresses.length + 1;
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const full = [data.houseNumber, data.barangay, data.city, data.province, data.region]
        .filter(Boolean)
        .join(", ");
      const fee = Number((data.deliveryFee ?? deliveryFees[data.barangay]) || 0);
      cartAddresses.push({ fullAddress: full, deliveryFee: fee });

      const div = document.createElement("div");
      div.classList.add("delivery-address");
      div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${full}"> Address ${i}: ${full}</label>`;
      savedAddressDiv.appendChild(div);
      i++;
    });

    savedAddressDiv.querySelectorAll("input[name='selectedAddress']").forEach(radio => {
      radio.addEventListener("change", e => {
        selectedAddress = e.target.value;
        const selected = cartAddresses.find(a => a.fullAddress === selectedAddress);
        userDeliveryFee = selected ? Number(selected.deliveryFee) : 0;
        updateCartTotal();
        updateModalTotals();
      });
    });

    updateCartTotal();
    updateModalTotals();
  } catch (err) {
    console.error(err);
    savedAddressDiv.innerHTML = "<p>Failed to load addresses.</p>";
  }
}

addAddressBtn?.addEventListener("click", () => {
  addressFormDiv.style.display = "block";
});

addressForm?.addEventListener("submit", async e => {
  e.preventDefault();
  const region = document.getElementById("region")?.value;
  const province = document.getElementById("province")?.value;
  const city = document.getElementById("city")?.value;
  const barangay = document.getElementById("barangay")?.value;
  const houseNumber = document.getElementById("houseNumber")?.value || "";
  const deliveryFee = deliveryFees[barangay] || 0;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "addresses"), {
      region,
      province,
      city,
      barangay,
      houseNumber,
      deliveryFee
    });
    showToast(`Address saved! Delivery fee: ₱${deliveryFee}`, 3000, "green", true);
    addressForm.reset();
    addressFormDiv.style.display = "none";
    loadSavedAddresses();
  } catch (err) {
    console.error(err);
    showToast("Failed to save address.", 3000, "red");
  }
});

// ==========================
// --- INVENTORY DEDUCTION ---
// ==========================
async function deductInventory(order) {
  const deductItem = async (id, amount) => {
    if (!id) return;
    const invRef = doc(db, "Inventory", id);
    const invSnap = await getDoc(invRef);
    const invQty = invSnap.exists() ? Number(invSnap.data().quantity || 0) : 0;
    await updateDoc(invRef, { quantity: Math.max(invQty - amount, 0) });
  };

  for (const item of order) {
    for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * item.qty);
    for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * item.qty);
    if (item.sizeId) await deductItem(item.sizeId, item.qty);
    for (const addon of item.addons || []) await deductItem(addon.id, item.qty);
  }
}

// ==========================
// --- QUEUE NUMBER ---
// ==========================
async function getNextQueueNumber(paymentMethod) {
  const collectionRef = collection(db, "DeliveryOrders");
  const q = query(collectionRef, orderBy("queueNumberNumeric", "desc"), limit(1));
  const snapshot = await getDocs(q);

  let nextNumeric = 1;
  if (!snapshot.empty) {
    const lastNumeric = Number(snapshot.docs[0].data().queueNumberNumeric || 0);
    nextNumeric = lastNumeric + 1;
  }

  const prefix = paymentMethod === "Cash" ? "C" : "G";
  const formattedQueueNumber = `${prefix}${nextNumeric.toString().padStart(4, "0")}`;

  return {
    formatted: formattedQueueNumber,
    numeric: nextNumeric
  };
}

// ==========================
// --- FINAL CONFIRM ORDER ---
// ==========================
finalConfirmBtn?.addEventListener("click", async () => {
  if (!currentUser) return showToast("Log in first.", 3000, "red");
  if (selectedCartItems.size === 0) return showToast("Select at least one item.", 3000, "red");
  if (!selectedAddress) return showToast("Select an address.", 3000, "red");

  const paymentMethod = document.querySelector("input[name='payment']:checked")?.value || "Cash";

  try {
    const { formatted: queueNumber, numeric: queueNumberNumeric } = await getNextQueueNumber(paymentMethod);

    const cartRef = collection(db, "users", currentUser.uid, "cart");
    const selectedItems = cartItems.filter(item => selectedCartItems.has(item.id));
    const selectedItemIds = Array.from(selectedCartItems);

    // Re-validate stock before placing order (prevent race)
    for (const item of selectedItems) {
      const { stock, available } = computeStockForCartItem(item);
      if (!available || stock < (item.quantity || 1)) {
        return showToast(`Item "${item.name}" is no longer available in requested quantity.`, 4000, "red", true);
      }
    }

    const orderItems = selectedItems.map(item => ({
      product: item.name,
      productId: item.productId || null,
      size: item.size || null,
      sizeId: item.sizeId || null,
      qty: item.quantity || 1,
      basePrice: Number(item.basePrice || 0),
      sizePrice: Number(item.sizePrice || 0),
      addonsPrice: Number(item.addonsPrice || 0),
      addons: item.addons || [],
      ingredients: item.ingredients || [],
      others: item.others || [],
      total: Number(item.totalPrice || 0)
    }));

    const orderTotal = orderItems.reduce((sum, i) => sum + i.total, 0) + userDeliveryFee;
    const orderTotalInCentavos = Math.round(orderTotal * 100);

    if (paymentMethod === "Cash") {
      await addDoc(collection(db, "DeliveryOrders"), {
        userId: currentUser.uid,
        customerName: currentUser.displayName || currentUser.email || "Customer",
        address: selectedAddress,
        queueNumber,
        queueNumberNumeric,
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: userDeliveryFee,
        total: orderTotal,
        paymentMethod,
        status: "Pending",
        createdAt: serverTimestamp()
      });

      await deductInventory(orderItems);
      for (const itemId of selectedItemIds) await deleteDoc(doc(cartRef, itemId));

      showToast(`Order placed! Queue #${queueNumber}. (Payment: Cash)`, 3000, "green", true);
      modal.style.display = "none";
    } else if (paymentMethod === "E-Payment") {
        const response = await fetch("/.netlify/functions/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: orderTotalInCentavos,
          currency: "PHP",
          description: `Order #${queueNumber} by ${currentUser.email}`,
          metadata: {
            userId: currentUser.uid,
            customerName: currentUser.displayName || currentUser.email || "Customer",
            queueNumber,
            queueNumberNumeric,
            address: selectedAddress,
            orderItems,
            deliveryFee: userDeliveryFee,
            orderTotal,
            cartItemIds: selectedItemIds
          }
        })
      });

      const data = await response.json();

      if (response.ok && data?.checkout_url) {
        showToast("Redirecting to GCash payment page...", 3000, "green", true);
        window.location.href = data.checkout_url;
      } else {
        showToast(`Failed to create GCash payment: ${data.error || "Unknown error"}.`, 4000, "red", true);
        console.error("PayMongo Checkout Error:", data.error || data);
      }
    }
  } catch (err) {
    console.error(err);
    showToast("Order failed. Try again.", 4000, "red", true);
  }
});
