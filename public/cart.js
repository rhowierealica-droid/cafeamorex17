// --- imports ---
import { db } from './firebase-config.js';
import { 
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
  serverTimestamp, onSnapshot, query, orderBy, limit, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- NOTE: Define deliveryFees object here or import it ---
const deliveryFees = {
    "Alima": 50,
    "Aniban I": 60,
    // Add all your barangays and their fees
};

// --- DOM Elements ---
const cartItemsDiv = document.getElementById('cart-items');
const cartTotalSpan = document.getElementById('cart-total');
const confirmOrderBtn = document.getElementById('confirm-order-btn');

// Modal elements
const modal = document.getElementById("confirmOrderModal");
const closeModalBtn = document.querySelector(".close-modal");
const finalConfirmBtn = document.getElementById("final-confirm-btn");
const savedAddressDiv = document.getElementById("saved-address");
const addAddressBtn = document.getElementById("add-address-btn");
const modalCartItemsDiv = document.getElementById("modal-cart-items");
const modalDeliveryFeeSpan = document.getElementById("modal-delivery-fee");
const modalGrandTotalSpan = document.getElementById("modal-grand-total");

// Inline form
const addressFormDiv = document.getElementById("address-form-div");
const addressForm = document.getElementById("address-form");

const auth = getAuth();
let currentUser = null;
let cartItems = [];
let selectedCartItems = new Set(); 
let unsubscribeCart = null;
let selectedAddress = null;
let userDeliveryFee = 0;
let defaultUserDocData = null;
let cartAddresses = []; 

// ----------------------
// AUTH STATE
// ----------------------
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
    if (userDocSnap.exists()) {
      defaultUserDocData = userDocSnap.data();
      userDeliveryFee = Number(defaultUserDocData.deliveryFee ?? 0);
    }
    loadCartRealtime();
    loadSavedAddresses();
  } else {
    currentUser = null;
    if (cartItemsDiv) cartItemsDiv.innerHTML = '<p>Please log in to view your cart.</p>';
    if (cartTotalSpan) cartTotalSpan.textContent = '0.00';
    cartItems = [];
    selectedCartItems.clear();
    if (unsubscribeCart) unsubscribeCart();
  }
});

// ----------------------
// ADD TO CART
// ----------------------
export async function addToCart(product, selectedSize = null, selectedAddons = [], quantity = 1) {
  if (!currentUser) return alert("Please log in first.");
  const basePrice = Number(product.price || 0);
  const sizePrice = Number(selectedSize?.price || 0);
  const addons = (selectedAddons || []).map(a => ({ name: a.name, price: Number(a.price || 0), id: a.id || null }));
  const addonsPrice = addons.reduce((sum, a) => sum + a.price, 0);
  const unitPrice = basePrice + sizePrice + addonsPrice;
  const totalPrice = unitPrice * quantity;

  try {
    const cartRef = collection(db, "users", currentUser.uid, "cart");
    await addDoc(cartRef, {
      productId: product.id || null,
      name: product.name || "Unnamed Product",
      image: product.image || "placeholder.png",
      basePrice, sizePrice, addonsPrice, unitPrice, totalPrice,
      quantity,
      size: selectedSize?.name || null,
      sizeId: selectedSize?.id || null,
      addons,
      ingredients: product.ingredients || [],
      others: product.others || [],
      addedAt: new Date(),
      userId: currentUser.uid
    });
    alert(`${product.name || "Product"} added to cart!`);
  } catch (err) {
    console.error("Error adding to cart:", err);
    alert("Failed to add to cart.");
  }
}

// ----------------------
// LOAD CART
// ----------------------
function loadCartRealtime() {
  if (!currentUser) return;
  const cartRef = collection(db, "users", currentUser.uid, "cart");
  if (unsubscribeCart) unsubscribeCart();

  unsubscribeCart = onSnapshot(cartRef, snapshot => {
    cartItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    selectedCartItems.clear();
    if (cartItemsDiv) cartItemsDiv.innerHTML = "";

    if (!cartItems.length) {
      if (cartItemsDiv) cartItemsDiv.innerHTML = "<p>Your cart is empty.</p>";
      if (cartTotalSpan) cartTotalSpan.textContent = "0.00";
      updateModalTotals();
      return;
    }

    // Select All checkbox
    const selectAllDiv = document.createElement("div");
    selectAllDiv.innerHTML = `<label><input type="checkbox" id="select-all-checkbox"> Select All</label>`;
    if (cartItemsDiv) cartItemsDiv.appendChild(selectAllDiv);
    const selectAllCheckbox = document.getElementById("select-all-checkbox");
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener("change", () => {
        if (selectAllCheckbox.checked) {
          cartItems.forEach(item => selectedCartItems.add(item.id));
        } else {
          selectedCartItems.clear();
        }
        renderCartItems();
        updateCartTotal();
        updateModalTotals();
      });
    }

    function renderCartItems() {
      if (cartItemsDiv) cartItemsDiv.querySelectorAll(".cart-item").forEach(el => el.remove());
      
      cartItems.forEach(item => {
        const itemDiv = document.createElement("div");
        itemDiv.classList.add("cart-item");
        let addonsHTML = "";
        if (Array.isArray(item.addons) && item.addons.length) {
          addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
        }
        const checkedAttr = selectedCartItems.has(item.id) ? "checked" : "";
        itemDiv.innerHTML = `
          <div style="display:flex; align-items:center; gap:15px;">
            <input type="checkbox" class="cart-checkbox" data-id="${item.id}" ${checkedAttr}>
            <img src="${item.image || 'placeholder.png'}" alt="${item.name}" 
                style="height:80px; width:80px; object-fit:cover; border-radius:8px; flex-shrink:0;">
            <div class="item-info">
              <strong>${item.name}</strong><br>
              ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice).toFixed(2)}` : 'Size: N/A'}<br>
              ${addonsHTML}<br>
              <label>Qty: <input type="number" min="1" value="${item.quantity}" class="qty-input"></label><br>
              <small>Total: ₱${Number(item.totalPrice).toFixed(2)}</small>
            </div>
            <button class="remove-btn">❌</button>
          </div>
        `;

        const checkbox = itemDiv.querySelector(".cart-checkbox");
        checkbox.addEventListener("change", e => {
          if (e.target.checked) {
            selectedCartItems.add(item.id);
          } else {
            selectedCartItems.delete(item.id);
          }
          if (selectAllCheckbox) selectAllCheckbox.checked = selectedCartItems.size === cartItems.length;
          updateCartTotal();
          updateModalTotals();
        });

        const qtyInput = itemDiv.querySelector(".qty-input");
        qtyInput.addEventListener("change", async e => {
          let newQty = parseInt(e.target.value) || 1;
          e.target.value = newQty;
          const newUnit = Number(item.basePrice) + Number(item.sizePrice) + Number(item.addonsPrice);
          await updateDoc(doc(cartRef, item.id), {
            quantity: newQty,
            unitPrice: newUnit,
            totalPrice: newUnit * newQty
          });
        });

        const removeBtn = itemDiv.querySelector(".remove-btn");
        removeBtn.addEventListener("click", async () => {
          await deleteDoc(doc(cartRef, item.id));
        });

        if (cartItemsDiv) cartItemsDiv.appendChild(itemDiv);
      });

      const deliveryDiv = document.createElement("div");
      deliveryDiv.id = "delivery-fee";
      deliveryDiv.innerHTML = `<small>Delivery Fee: ₱${userDeliveryFee.toFixed(2)}</small>`;
      if (cartItemsDiv) cartItemsDiv.appendChild(deliveryDiv);
    }

    renderCartItems();
  }, err => {
    console.error("Error loading cart:", err);
    if (cartItemsDiv) cartItemsDiv.innerHTML = "<p>Failed to load cart.</p>";
    if (cartTotalSpan) cartTotalSpan.textContent = "0.00";
    updateModalTotals();
  });
}

// ----------------------
// UPDATE TOTALS
// ----------------------
function updateCartTotal() {
  if (!cartTotalSpan) return;
  const grandTotal = cartItems
    .filter(item => selectedCartItems.has(item.id))
    .reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  cartTotalSpan.textContent = selectedCartItems.size > 0 ? (grandTotal + userDeliveryFee).toFixed(2) : "0.00";
  const deliveryDiv = document.getElementById("delivery-fee");
  if (deliveryDiv) deliveryDiv.textContent = `Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}`;
}

function updateModalTotals() {
  if (!modalDeliveryFeeSpan || !modalGrandTotalSpan) return;
  modalDeliveryFeeSpan.textContent = selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00";
  const total = cartItems
    .filter(item => selectedCartItems.has(item.id))
    .reduce((sum, item) => sum + Number(item.totalPrice || 0), 0) + (selectedCartItems.size > 0 ? userDeliveryFee : 0);
  modalGrandTotalSpan.textContent = total.toFixed(2);
  populateModalCart();
}

function populateModalCart() {
  if (!modalCartItemsDiv) return;
  modalCartItemsDiv.innerHTML = "";
  cartItems
    .filter(item => selectedCartItems.has(item.id))
    .forEach(item => {
      let addonsHTML = "";
      if (Array.isArray(item.addons) && item.addons.length) {
        addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
      }
      modalCartItemsDiv.innerHTML += `
        <div class="modal-cart-item" style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
          <img src="${item.image || 'placeholder.png'}" alt="${item.name}" 
              style="height:60px; width:60px; object-fit:cover; border-radius:6px; flex-shrink:0;">
          <div>
            <strong>${item.name}</strong><br>
            ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice).toFixed(2)}` : 'Size: N/A'}
            ${addonsHTML}<br>
            Qty: ${item.quantity} | Total: ₱${Number(item.totalPrice).toFixed(2)}
          </div>
        </div>
      `;
    });
}

// ----------------------
// MODAL & ADDRESSES
// ----------------------
confirmOrderBtn?.addEventListener("click", () => {
  if (!currentUser) return alert("Please log in.");
  if (selectedCartItems.size === 0) return alert("Select items to checkout."); 
  if (modal) modal.style.display = "block";
  loadSavedAddresses();
});

closeModalBtn?.addEventListener("click", () => { if (modal) modal.style.display = "none"; });
window.addEventListener("click", e => { if (e.target === modal) { if (modal) modal.style.display = "none"; } });

async function loadSavedAddresses() {
  if (!currentUser) return;
  if (savedAddressDiv) savedAddressDiv.innerHTML = "";
  cartAddresses = [];
  try {
    const userDoc = defaultUserDocData;
    if (userDoc) {
      const defaultAddr = [userDoc.houseNumber, userDoc.barangay, userDoc.city, userDoc.province, userDoc.region].filter(Boolean).join(", ");
      if (defaultAddr) {
        const fee = Number((userDoc.deliveryFee ?? deliveryFees[userDoc.barangay]) || 0);
        cartAddresses.push({ fullAddress: defaultAddr, deliveryFee: fee });
        const div = document.createElement("div");
        div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${defaultAddr}" checked>Address 1: ${defaultAddr}</label>`;
        if (savedAddressDiv) savedAddressDiv.appendChild(div);
        selectedAddress = defaultAddr;
        userDeliveryFee = cartAddresses[0].deliveryFee;
      }
    }

    const addrRef = collection(db, "users", currentUser.uid, "addresses");
    const snapshot = await getDocs(addrRef);
    let i = cartAddresses.length + 1;
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const full = [data.houseNumber, data.barangay, data.city, data.province, data.region].filter(Boolean).join(", ");
      const fee = Number((data.deliveryFee ?? deliveryFees[data.barangay]) || 0);
      cartAddresses.push({ fullAddress: full, deliveryFee: fee });
      const div = document.createElement("div");
      div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${full}">Address ${i}: ${full}</label>`;
      if (savedAddressDiv) savedAddressDiv.appendChild(div);
      i++;
    });

    if (savedAddressDiv) {
        savedAddressDiv.querySelectorAll("input[name='selectedAddress']").forEach(radio => {
        radio.addEventListener("change", e => {
          selectedAddress = e.target.value;
          const selected = cartAddresses.find(a => a.fullAddress === selectedAddress);
          userDeliveryFee = selected ? Number(selected.deliveryFee) : 0;
          updateCartTotal();
          updateModalTotals();
        });
      });
    }

    updateCartTotal();
    updateModalTotals();
  } catch (err) {
    console.error(err);
    if (savedAddressDiv) savedAddressDiv.innerHTML = "<p>Failed to load addresses.</p>";
  }
}

addAddressBtn?.addEventListener("click", () => { if (addressFormDiv) addressFormDiv.style.display = "block"; });
addressForm?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!currentUser) return alert("Log in first.");
  const region = document.getElementById("region")?.value;
  const province = document.getElementById("province")?.value;
  const city = document.getElementById("city")?.value;
  const barangay = document.getElementById("barangay")?.value;
  const houseNumber = document.getElementById("houseNumber")?.value || "";
  const deliveryFee = deliveryFees[barangay] || 0;

  try {
    await addDoc(collection(db, "users", currentUser.uid, "addresses"), { region, province, city, barangay, houseNumber, deliveryFee });
    alert(`Address saved! Delivery fee: ₱${deliveryFee}`);
    if (addressForm) addressForm.reset();
    if (addressFormDiv) addressFormDiv.style.display = "none";
    loadSavedAddresses();
  } catch (err) {
    console.error(err);
    alert("Failed to save address.");
  }
});

// ----------------------
// DEDUCT INVENTORY
// ----------------------
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

// ----------------------
// FINAL CONFIRM ORDER
// ----------------------
finalConfirmBtn?.addEventListener("click", async () => {
  if (!currentUser) return alert("Log in first.");
  if (selectedCartItems.size === 0) return alert("Select at least one item to proceed.");
  if (!selectedAddress) return alert("Select an address.");

  const paymentMethod = document.querySelector("input[name='payment']:checked")?.value || "COD";

  try {
    const queueNumber = await getNextQueueNumber();
    const cartRef = collection(db, "users", currentUser.uid, "cart");

    const selectedItems = cartItems.filter(item => selectedCartItems.has(item.id));
    const selectedItemIds = Array.from(selectedCartItems); 

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

    if (paymentMethod === "COD") {
      await addDoc(collection(db, "DeliveryOrders"), {
        userId: currentUser.uid,
        customerName: currentUser.displayName || currentUser.email || "Customer",
        address: selectedAddress,
        queueNumber,
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: userDeliveryFee,
        total: orderTotal,
        paymentMethod,
        status: "Pending",
        createdAt: serverTimestamp()
      });

      await deductInventory(orderItems);
      for (const itemId of selectedItemIds) {
        await deleteDoc(doc(cartRef, itemId));
      }

      alert(`Order placed! Queue #${queueNumber}. (Payment: COD)`);
      if (modal) modal.style.display = "none";
    } else if (paymentMethod === "GCash") {
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
            queueNumber: queueNumber,
            address: selectedAddress,
            orderItems: JSON.stringify(orderItems),
            deliveryFee: userDeliveryFee,
            orderTotal: orderTotal,
            cartItemIds: JSON.stringify(selectedItemIds)
          }
        }),
      });

      const data = await response.json();

      if (response.ok && data?.checkout_url) {
        alert("Redirecting to GCash payment page...");
        window.location.href = data.checkout_url;
      } else {
        alert(`Failed to create GCash payment: ${data.error || 'Unknown error'}.`);
        console.error("PayMongo Checkout Error:", data.error || data);
      }
    }
  } catch (err) {
    console.error(err);
    alert("Order failed. Try again.");
  }
});

// ----------------------
// QUEUE NUMBER
// ----------------------
async function getNextQueueNumber() {
  const q = query(collection(db, "DeliveryOrders"), orderBy("queueNumber", "desc"), limit(1));
  const snapshot = await getDocs(q);
  return !snapshot.empty ? (snapshot.docs[0].data().queueNumber || 0) + 1 : 1;
}
