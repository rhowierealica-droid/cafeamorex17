// ==========================
// --- cart.js (FULL UPDATED - E-Payment Add-ons Deduction Fix) ---
// ==========================

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
    "Aniban IV": 25, "Aniban V": 30, "Aniban V": 30, "Banalo": 35,
    "Bayanan": 40, "Campo Santo": 45, "Daang Bukid": 50, "Digman": 55,
    "Dulong Bayan": 60, "Habay I": 65, "Habay II": 70, "Ligas I": 75,
    "Ligas II": 80, "Ligas III": 85, "Mabolo I": 90, "Mabolo II": 95,
    "Mabolo III": 100, "Maliksi I": 105, "Maliksi II": 110, "Maliksi III": 115,
    "Mambog I": 120, "Mambog II": 125, "Mambog III": 130, "Mambog IV": 135,
    "Mambog V": 140, "Molino I": 145, "Molino II": 150, "Molino III": 155,
    "Molino IV": 160, "Molino V": 165, "Molino VI": 170, "Molino VII": 175,
    "Niog I": 180, "Niog II": 185, "Niog III": 190, "P.F. Espiritu I (Panapaan)": 195,
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

// ==========================
const auth = getAuth();
let currentUser = null;
let cartItems = []; // unified representation: contains both guest items and user cart items
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
let productMap = {};  // productMap[id] = { id, ...productData }

// Guest cart localStorage key
const GUEST_CART_KEY = "guest_cart_v1";

// ==========================
// --- TOAST FUNCTION ---
// ==========================
function showToast(message, duration = 3000, color = "red", inline = false) {
    if (!toastDiv) {
        // graceful fallback
        console.log("Toast:", message);
        return;
    }
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
// --- GUEST CART HELPERS ---
// ==========================
function loadGuestCart() {
    try {
        const raw = localStorage.getItem(GUEST_CART_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed;
    } catch (e) {
        console.error("Failed to load guest cart:", e);
        return [];
    }
}

function saveGuestCart(guestArray) {
    try {
        localStorage.setItem(GUEST_CART_KEY, JSON.stringify(guestArray));
    } catch (e) {
        console.error("Failed to save guest cart:", e);
    }
}

function addToGuestCartPayload(payload) {
    const guest = loadGuestCart();
    // Try to find same product/size/addons combination
    const sameIndex = guest.findIndex(g => {
        return g.productId === payload.productId &&
            g.sizeId === payload.sizeId &&
            JSON.stringify(g.addons || []) === JSON.stringify(payload.addons || []);
    });
    if (sameIndex !== -1) {
        guest[sameIndex].quantity = (guest[sameIndex].quantity || 1) + (payload.quantity || 1);
        guest[sameIndex].totalPrice = Number(guest[sameIndex].unitPrice || 0) * guest[sameIndex].quantity;
    } else {
        // create unique id for guest items
        const id = `guest_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        guest.push({ id, ...payload });
    }
    saveGuestCart(guest);
    return guest;
}

// merge guest cart into firestore cart upon login
async function mergeGuestCartToUser(uid) {
    const guest = loadGuestCart();
    if (!guest.length) return;
    try {
        const cartRef = collection(db, "users", uid, "cart");
        const snapshot = await getDocs(cartRef);
        const existing = snapshot.docs.map(ds => ({ id: ds.id, data: ds.data() }));

        for (const g of guest) {
            // find existing same product/size/addons in user's cart
            const same = existing.find(e => {
                return e.data.productId === g.productId &&
                    e.data.sizeId === g.sizeId &&
                    JSON.stringify(e.data.addons || []) === JSON.stringify(g.addons || []);
            });
            if (same) {
                const newQty = (Number(same.data.quantity || 0) + Number(g.quantity || 0));
                await updateDoc(doc(db, "users", uid, "cart", same.id), {
                    quantity: newQty,
                    totalPrice: Number(g.unitPrice || g.totalPrice || 0) * newQty
                });
            } else {
                // add to user's cart
                const payload = {
                    productId: g.productId || null,
                    name: g.name || "Unnamed Product",
                    image: g.image || "placeholder.png",
                    basePrice: Number(g.basePrice || 0),
                    sizePrice: Number(g.sizePrice || 0),
                    addonsPrice: Number(g.addonsPrice || 0),
                    unitPrice: Number(g.unitPrice || 0),
                    totalPrice: Number(g.unitPrice || 0) * Number(g.quantity || 1),
                    quantity: Number(g.quantity || 1),
                    size: g.size,
                    sizeId: g.sizeId,
                    addons: g.addons,
                    ingredients: g.ingredients,
                    others: g.others,
                    addedAt: serverTimestamp(),
                    userId: uid,
                    available: g.available !== false
                };
                await addDoc(collection(db, "users", uid, "cart"), payload);
            }
        }
        // clear guest cart after merging
        saveGuestCart([]);
        showToast("Guest cart merged to your account.", 2000, "green", true);
    } catch (err) {
        console.error("Failed to merge guest cart:", err);
    }
}

// ==========================
// --- AUTH STATE ---
// ==========================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        try {
            const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
            if (userDocSnap.exists()) {
                defaultUserDocData = userDocSnap.data();
                userDeliveryFee = Number(defaultUserDocData.deliveryFee ?? 0);
            } else {
                defaultUserDocData = null;
                userDeliveryFee = 0;
            }
        } catch (err) {
            console.error("Failed to read user doc:", err);
        }

        // Merge guest cart into user cart if any
        await mergeGuestCartToUser(currentUser.uid);

        // start firestore-based cart realtime after merge
        startRealtimeListeners();
        loadSavedAddresses();
    } else {
        // Guest mode: do NOT redirect. Allow adding to guest cart.
        currentUser = null;
        defaultUserDocData = null;
        userDeliveryFee = 0;
        // Stop any previous user cart listener
        if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }
        // Start product/inventory listeners so stock info is live
        startRealtimeListeners(); // this handles cart listener safely (will not attach user cart)
        // load guest cart from localStorage into cartItems
        cartItems = loadGuestCart();
        // update UI
        renderCartItemsFromState();
        loadSavedAddresses(); // will show nothing for guest (and not crash)
    }
});

// ==========================
// --- ADD TO CART ---
// ==========================
/**
 * product: product object from product listing
 * selectedSize: object or null
 * selectedAddons: array
 * quantity: number
 */
export async function addToCart(product, selectedSize = null, selectedAddons = [], quantity = 1) {
    // Prevent adding unavailable products
    if (product.available === false) {
        return showToast("This product is currently unavailable.", 3000, "red", true);
    }

    const basePrice = Number(product.price || 0);
    const sizePrice = Number(selectedSize?.price || 0);
    const addons = (selectedAddons || []).map(a => ({
        name: a.name,
        price: Number(a.price || 0),
        id: a.id || null,
        qty: a.qty || 1
    }));
    const addonsPrice = addons.reduce((sum, a) => sum + a.price, 0);
    const unitPrice = basePrice + sizePrice + addonsPrice;
    const totalPrice = unitPrice * quantity;

    // Build payload for both guest and user
    const selectedSizeData = product.sizes?.find(s => s.id === selectedSize?.id) || {};
    const payload = {
        productId: product.id || null,
        name: product.name || "Unnamed Product",
        image: product.image || "placeholder.png",
        basePrice, sizePrice, addonsPrice, unitPrice, totalPrice,
        quantity: Number(quantity || 1),
        size: selectedSize?.name || null,
        sizeId: selectedSize?.id || null,
        addons,
        ingredients: selectedSizeData?.ingredients || [],
        others: selectedSizeData?.others || [],
        available: product.available !== false
    };

    try {
        if (currentUser) {
            // user: add to Firestore cart (merge if same)
            const cartRef = collection(db, "users", currentUser.uid, "cart");
            const snapshot = await getDocs(cartRef);
            let existingDoc = null;
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const sameProduct = data.productId === payload.productId;
                const sameSize = data.sizeId === payload.sizeId;
                const sameAddons = JSON.stringify(data.addons || []) === JSON.stringify(payload.addons || []);
                if (sameProduct && sameSize && sameAddons) existingDoc = { id: docSnap.id, data };
            });

            if (existingDoc) {
                const newQty = (existingDoc.data.quantity || 1) + payload.quantity;
                await updateDoc(doc(db, "users", currentUser.uid, "cart", existingDoc.id), {
                    quantity: newQty,
                    totalPrice: payload.unitPrice * newQty
                });
                showToast("Cart updated successfully!", 2000, "green", true);
            } else {
                await addDoc(cartRef, {
                    ...payload,
                    userId: currentUser.uid,
                    addedAt: serverTimestamp()
                });
                showToast("Added to cart successfully!", 2000, "green", true);
            }
        } else {
            // guest: save to localStorage
            const guestPayload = {
                // guest items keep same shape but ensure id and unitPrice fields exist
                productId: payload.productId,
                name: payload.name,
                image: payload.image,
                basePrice: payload.basePrice,
                sizePrice: payload.sizePrice,
                addonsPrice: payload.addonsPrice,
                unitPrice: payload.unitPrice,
                totalPrice: payload.unitPrice * payload.quantity,
                quantity: payload.quantity,
                size: payload.size,
                sizeId: payload.sizeId,
                addons: payload.addons,
                ingredients: payload.ingredients,
                others: payload.others,
                available: payload.available
            };
            const updatedGuest = addToGuestCartPayload(guestPayload);
            cartItems = updatedGuest;
            renderCartItemsFromState();
            showToast("Added to cart (guest) — it will be saved in your browser.", 2000, "green", true);
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
    if (!item) return { stock: 0, available: false };

    // If product is explicitly unavailable in productMap
    if (item.productId) {
        const prod = productMap[item.productId];
        if (prod && prod.available === false) return { stock: 0, available: false };
    }

    let possible = Infinity;
    const getComponentLimit = (component, requiredQtyPerProduct) => {
        if (!component || !component.id) return Infinity; // Treat null/undefined components as having infinite stock for now
        const inv = inventoryMap[component.id];
        if (!inv || inv.active === false || Number(inv.quantity || 0) <= 0) return 0;
        const requiredQty = Math.max(Number(requiredQtyPerProduct) || 1, 1);
        return Math.floor(Number(inv.quantity || 0) / requiredQty);
    };

    // Check size first
    if (item.sizeId) {
        const sizeLimit = getComponentLimit({ id: item.sizeId }, 1);
        possible = Math.min(possible, sizeLimit);
        if (possible === 0) return { stock: 0, available: false };
    }

    // Check ingredients
    for (const ing of item.ingredients || []) {
        const limit = getComponentLimit(ing, ing.qty);
        possible = Math.min(possible, limit);
        if (possible === 0) return { stock: 0, available: false };
    }

    // Check addons
    for (const addon of item.addons || []) {
        // addon.qty here is the number of units of the inventory item needed *per order item*
        const limit = getComponentLimit(addon, addon.qty || 1); 
        possible = Math.min(possible, limit);
        if (possible === 0) return { stock: 0, available: false };
    }

    // Check others
    for (const other of item.others || []) {
        const limit = getComponentLimit(other, other.qty);
        possible = Math.min(possible, limit);
        if (possible === 0) return { stock: 0, available: false };
    }

    if (possible === Infinity) return { stock: 0, available: false }; // Should not happen if a size or component is required
    return { stock: Math.max(possible, 0), available: possible > 0 };
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

    // Cart listener (per-user) - attach only if we have a currentUser
    loadCartRealtime();
}

function stopRealtimeListeners() {
    if (unsubscribeInventory) { unsubscribeInventory(); unsubscribeInventory = null; }
    if (unsubscribeProducts) { unsubscribeProducts(); unsubscribeProducts = null; }
    if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }
    inventoryMap = {};
    productMap = {};
    cartItems = [];
    selectedCartItems.clear();
    if (cartItemsDiv) cartItemsDiv.innerHTML = "";
}

// ==========================
// --- LOAD CART REALTIME ---
// ==========================
function loadCartRealtime() {
    // detach old listener if any
    if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }

    if (!currentUser) {
        // guest mode: load from localStorage
        cartItems = loadGuestCart();
        selectedCartItems = new Set();
        renderCartItemsFromState();
        return;
    }

    const cartRef = collection(db, "users", currentUser.uid, "cart");
    unsubscribeCart = onSnapshot(cartRef, async snapshot => {
        // Keep the cart items in state
        cartItems = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        // Keep selection consistent: remove selected ids that no longer exist
        const currentIds = new Set(cartItems.map(i => i.id));
        selectedCartItems = new Set(Array.from(selectedCartItems).filter(id => currentIds.has(id)));
        renderCartItemsFromState();
    }, err => {
        console.error("Error loading cart:", err);
        if (cartItemsDiv) cartItemsDiv.innerHTML = "<p>Failed to load cart.</p>";
        if (cartTotalSpan) cartTotalSpan.textContent = "0.00";
        updateModalTotals();
    });
}

// ==========================
// --- RENDER / UI HELPERS ---
// ==========================
function renderCartItemsFromState() {
    if (!cartItemsDiv) return;
    cartItemsDiv.innerHTML = "";

    if (!cartItems || !cartItems.length) {
        cartItemsDiv.innerHTML = "<p>Your cart is empty.</p>";
        if (cartTotalSpan) cartTotalSpan.textContent = "0.00";
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

    // precompute available items
    const availableItems = cartItems.filter(i => {
        const { stock, available } = computeStockForCartItem(i);
        return stock > 0 && available;
    });

    selectAllCheckbox.checked = availableItems.length > 0 && availableItems.every(i => selectedCartItems.has(i.id));

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

        // compute displayQty (avoid showing invalid qty)
        let displayQty = Math.max(Number(item.quantity || 1), 0);
        if (stock <= 0) {
            displayQty = 0;
        } else {
            displayQty = Math.min(displayQty || 1, stock);
        }

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
              <strong>${item.name}</strong> <span style="margin-left: 10px;">${statusLabel}</span><br>  
              ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice || 0).toFixed(2)}` : 'Size: N/A'}<br>
              ${addonsHTML}<br>
              <label>Qty: <input type="number" min="${stock > 0 ? 1 : 0}" max="${stock}" value="${displayQty}" class="qty-input" style="width:60px;" ${disabledAttr}></label><br>
              <small>Total: ₱${Number(item.totalPrice || 0).toFixed(2)}</small>
            </div>
          </div>
          <button class="remove-btn" style="background:none; border:none; font-size:18px; cursor:pointer;" ${disabledAttr}>❌</button>
        `;

        // remove
        const removeBtn = itemDiv.querySelector(".remove-btn");
        removeBtn.addEventListener("click", async () => {
            try {
                if (currentUser && !String(item.id).startsWith("guest_")) {
                    // firestore item
                    await deleteDoc(doc(db, "users", currentUser.uid, "cart", item.id));
                } else {
                    // guest item
                    const guest = loadGuestCart().filter(g => g.id !== item.id);
                    saveGuestCart(guest);
                    cartItems = guest;
                    renderCartItemsFromState();
                }
                showToast("Item removed from cart.", 2000, "red", true);
            } catch (err) {
                console.error("Failed to remove cart item:", err);
                showToast("Failed to remove item.", 2000, "red", true);
            }
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
                    if (currentUser && !String(item.id).startsWith("guest_")) {
                        await updateDoc(doc(db, "users", currentUser.uid, "cart", item.id), {
                            quantity: newQty,
                            unitPrice: newUnit,
                            totalPrice: newUnit * newQty
                        });
                    } else {
                        // guest update
                        const guest = loadGuestCart();
                        const idx = guest.findIndex(g => g.id === item.id);
                        if (idx !== -1) {
                            guest[idx].quantity = newQty;
                            guest[idx].unitPrice = newUnit;
                            guest[idx].totalPrice = newUnit * newQty;
                            saveGuestCart(guest);
                            cartItems = guest;
                            renderCartItemsFromState();
                        }
                    }
                } catch (err) {
                    console.error("Error updating qty:", err);
                    showToast("Failed to update quantity.", 2000, "red");
                }
            });
        }

        // checkbox selection
        const checkbox = itemDiv.querySelector(".cart-checkbox");
        if (checkbox) {
            if (!available || stock <= 0) {
                checkbox.disabled = true;
            } else {
                checkbox.addEventListener("change", e => {
                    if (e.target.checked) selectedCartItems.add(item.id);
                    else selectedCartItems.delete(item.id);
                    selectAllCheckbox.checked = cartItems.filter(i => {
                        const s = computeStockForCartItem(i);
                        return s.stock > 0 && s.available;
                    }).length === selectedCartItems.size;
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
// --- UPDATE TOTALS & MODAL (PART 2 START) ---
// ==========================
function updateCartTotal() {
    if (!cartTotalSpan) return;
    const grandTotal = cartItems
        .filter(i => selectedCartItems.has(i.id) && computeStockForCartItem(i).available !== false && computeStockForCartItem(i).stock > 0)
        .reduce((sum, i) => sum + Number(i.totalPrice || 0), 0);
    cartTotalSpan.textContent = selectedCartItems.size > 0 ? (grandTotal + userDeliveryFee).toFixed(2) : "0.00";
}

function updateModalTotals() {
    if (modalDeliveryFeeSpan) modalDeliveryFeeSpan.textContent = userDeliveryFee.toFixed(2);
    const total = cartItems
        .filter(i => selectedCartItems.has(i.id) && computeStockForCartItem(i).available !== false && computeStockForCartItem(i).stock > 0)
        .reduce((sum, i) => sum + Number(i.totalPrice || 0), 0) + (selectedCartItems.size > 0 ? userDeliveryFee : 0);
    if (modalGrandTotalSpan) modalGrandTotalSpan.textContent = total.toFixed(2);
}

// ==========================
// --- POPULATE MODAL ---
// ==========================
function populateModalCart() {
    if (!modalCartItemsDiv) return;
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
    if (!currentUser) return showToast("Please log in to checkout.", 3000, "red");
    if (selectedCartItems.size === 0) return showToast("Select items to checkout.", 3000, "red");
    if (modal) modal.style.display = "block";
    loadSavedAddresses();
    populateModalCart();
});

closeModalBtn?.addEventListener("click", () => { if (modal) modal.style.display = "none"; });
window.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });

// ==========================
// --- ADDRESSES ---
// ==========================
async function loadSavedAddresses() {
    if (!savedAddressDiv) return;
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

        if (currentUser) {
            const addrRef = collection(db, "users", currentUser.uid, "addresses");
            const snapshot = await getDocs(addrRef);

            let i = cartAddresses.length + 1;
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                const full = [data.houseNumber, data.barangay, data.city, data.province, data.region]
                    .filter(Boolean)
                    .join(", ");
                const fee = Number((data.deliveryFee ?? deliveryFees[data.barangay]) || 0);
                // Prevent adding a duplicate if the added address is the same as the default profile address
                if (full !== selectedAddress) {
                    cartAddresses.push({ fullAddress: full, deliveryFee: fee });

                    const div = document.createElement("div");
                    div.classList.add("delivery-address");
                    div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${full}"> Address ${i}: ${full}</label>`;
                    savedAddressDiv.appendChild(div);
                    i++;
                }
            });
        }

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
    if (addressFormDiv) addressFormDiv.style.display = "block";
});

addressForm?.addEventListener("submit", async e => {
    e.preventDefault();
    if (!currentUser) return showToast("Please log in to save an address.", 3000, "red");
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
        if (addressFormDiv) addressFormDiv.style.display = "none";
        loadSavedAddresses();
    } catch (err) {
        console.error(err);
        showToast("Failed to save address.", 3000, "red");
    }
});

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

    // Prefix C for Cash, E for E-Payment/GCash
    const prefix = paymentMethod === "Cash" ? "C" : "E";
    const formattedQueueNumber = `${prefix}${nextNumeric.toString().padStart(4, "0")}`;

    return {
        formatted: formattedQueueNumber,
        numeric: nextNumeric
    };
}

// ==========================
// --- PAYMONGO HELPER (REQUIRED) ---
// ==========================
function prepareLineItems(orderItems, deliveryFee, currentUser) {
    const lineItems = orderItems.flatMap(item => {
        const qty = Number(item.qty || 1);

        const itemsArray = [
            {
                name: `${item.product} (${item.size})`,
                currency: "PHP",
                // Combine basePrice + sizePrice for the main item line item
                amount: Math.round((item.basePrice + item.sizePrice) * 100),
                quantity: qty,
            },
        ];

        // Add-ons as separate line items (since they have their own prices)
        (item.addons || []).forEach(addon => {
            // Only add if addon has a price > 0 to avoid PayMongo issues
            if (Number(addon.price || 0) > 0) { 
                itemsArray.push({
                    name: `Add-on: ${addon.name}`,
                    currency: "PHP",
                    amount: Math.round(Number(addon.price || 0) * 100),
                    quantity: qty,
                });
            }
        });

        return itemsArray;
    });

    // Delivery Fee
    if (deliveryFee > 0) {
        lineItems.push({
            name: "Delivery Fee",
            currency: "PHP",
            amount: Math.round(deliveryFee * 100),
            quantity: 1,
        });
    }

    // Include customer details for PayMongo checkout
    const customerDetails = {
        name: currentUser.displayName || currentUser.email || "Customer",
        email: currentUser.email,
        // Assuming phone number input is present in your checkout modal/form
        phone: document.getElementById('phone-number')?.value || "N/A",
        // Address details for PayMongo checkout page display
        address: selectedAddress,
    };

    return { lineItems, customerDetails };
}


// ==========================
// --- FINAL CONFIRM ORDER (FIXED INVENTORY DEDUCTION) ---
// ==========================
finalConfirmBtn?.addEventListener("click", async () => {
    if (!currentUser) return showToast("Log in first.", 3000, "red");
    if (selectedCartItems.size === 0) return showToast("Select items to checkout.", 3000, "red");
    if (!selectedAddress) return showToast("Select an address.", 3000, "red");

    const paymentMethod = document.querySelector("input[name='payment']:checked")?.value || "Cash";

    try {
        const { formatted: queueNumber, numeric: queueNumberNumeric } = await getNextQueueNumber(paymentMethod);

        const cartRef = collection(db, "users", currentUser.uid, "cart");
        const selectedItems = cartItems.filter(item => selectedCartItems.has(item.id));
        const selectedItemIds = Array.from(selectedCartItems);

        // --- PRE-ORDER INVENTORY VALIDATION & READS ---
        // inventoryUpdates is a Map: { componentId: new_stock_qty_after_all_deductions }
        const inventoryUpdates = new Map();
        for (const item of selectedItems) {
            const requiredQty = item.quantity || 1;

            // Collect all components (size, ingredients, others, AND ADDONS)
            const components = [
                { id: item.sizeId, qty: 1 },
                ...(item.ingredients || []),
                ...(item.others || []),
                ...(item.addons || []) // *** Correctly includes addons ***
            ].filter(c => c && c.id);

            for (const component of components) {
                const componentId = component.id;
                const totalDeduction = (component.qty || 1) * requiredQty;
                
                // Get current stock (prioritizes aggregated updates for concurrent items)
                const currentStock = Number(inventoryMap[componentId]?.quantity || 0);

                // Initialize/Retrieve the quantity after previous aggregated deductions
                // If it's the first time processing this component in the loop, start with the raw stock.
                const currentNewQty = inventoryUpdates.has(componentId) ? inventoryUpdates.get(componentId) : currentStock;

                // Calculate the final new quantity after this item's deduction
                const finalNewQty = currentNewQty - totalDeduction;

                // Check stock validity based on live data and previous aggregated deductions
                if (finalNewQty < 0) {
                     return showToast(`Insufficient stock for component ID: ${componentId} (for item: ${item.name}) due to combined order requirements. Cannot place order.`, 4000, "red", true);
                }

                // Store the calculated new quantity
                inventoryUpdates.set(componentId, finalNewQty);
            }
        }
        // --- END OF INVENTORY VALIDATION & READS ---


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

        // =========================================
        // --- CASH ON DELIVERY (COD) LOGIC) ---
        // =========================================
        if (paymentMethod === "Cash") {
            const batch = writeBatch(db);

            // 1. Add Order
            const newOrderRef = doc(collection(db, "DeliveryOrders"));
            batch.set(newOrderRef, {
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
                status: "Pending", // Initial status for cash is Pending
                createdAt: serverTimestamp()
            });

            // 2. Deduct Stock (using the pre-validated map for batch updates)
            for (const [componentId, newQty] of inventoryUpdates.entries()) {
                const invRef = doc(db, "Inventory", componentId);
                batch.update(invRef, { quantity: newQty });
            }

            // 3. Clear Cart (using batch for atomicity)
            for (const itemId of selectedItemIds) {
                batch.delete(doc(cartRef, itemId));
            }

            // Commit batch (order creation + inventory deduction + cart clearing)
            await batch.commit();

            showToast(`Order placed! Queue #${queueNumber}. (Payment: Cash)`, 3000, "green", true);
            if (modal) modal.style.display = "none";
            // Redirect to customer status page
            window.location.href = `customer-status.html?orderId=${newOrderRef.id}&col=DeliveryOrders`;

            // =========================================
            // --- E-PAYMENT (ADMIN APPROVAL) LOGIC) ---
            // =========================================
        } else if (paymentMethod === "E-Payment") {

            // Generate PayMongo line items and customer details
            const { lineItems, customerDetails } = prepareLineItems(orderItems, userDeliveryFee, currentUser);

            // **CRITICAL: Store all necessary data for future PayMongo call in the order document.**
            const paymentMetadata = {
                userId: currentUser.uid,
                customerName: currentUser.displayName || currentUser.email || "Customer",
                queueNumber,
                address: selectedAddress,
                deliveryFee: userDeliveryFee,
                orderTotal,
                cartItemIds: selectedItemIds,
                
                // *** FIX CONFIRMED HERE: Store final inventory changes as an object (Map to Object) ***
                inventoryUpdates: Object.fromEntries(inventoryUpdates), 

                // Details needed by the Netlify function to generate the payment link
                amount: orderTotalInCentavos,
                currency: "PHP",
                description: `Order #${queueNumber} by ${currentUser.email}`,

                // Add the line items and customer details here
                lineItems,
                customerDetails,
            };

            const batch = writeBatch(db);

            // 1. Add Order (Status: Wait for Admin to Accept)
            const newOrderRef = doc(collection(db, "DeliveryOrders"));
            batch.set(newOrderRef, {
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
                status: "Wait for Admin to Accept", // Initial status
                createdAt: serverTimestamp(),
                paymentMetadata: paymentMetadata // Store PayMongo generation details
            });

            // 2. Clear Cart (using batch)
            // Clear the cart now since the customer has officially checked out.
            for (const itemId of selectedItemIds) {
                batch.delete(doc(cartRef, itemId));
            }

            // Commit batch (order creation + cart clearing). DO NOT deduct inventory yet!
            await batch.commit();

            showToast(`Order placed! Queue #${queueNumber}. Status: WAITING FOR ADMIN APPROVAL. You will receive a separate payment link shortly.`, 6000, "orange", true);
            if (modal) modal.style.display = "none";
            // Redirect to customer status page, including the collection name
            window.location.href = `customer-status.html?orderId=${newOrderRef.id}&col=DeliveryOrders`;
        }

    } catch (err) {
        console.error("Order failed:", err);
        showToast("Order failed. Try again. Error details: " + err.message, 4000, "red", true);
    }
});

// ==========================
// --- Exported helper: showLoginPopup ---
// ==========================
// index.js imports this; provide a robust fallback (open login popup if present, else redirect)
export function showLoginPopup() {
    try {
        const loginPopup = document.getElementById('loginPopup');
        if (loginPopup) {
            loginPopup.style.display = 'flex';
            return;
        }
    } catch (e) { /* ignore */ }
    // fallback redirect
    window.location.href = 'login.html';
}
