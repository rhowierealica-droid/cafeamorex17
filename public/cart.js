import { db } from './firebase-config.js';
import {
    collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
    serverTimestamp, onSnapshot, query, orderBy, limit, getDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


const deliveryFees = {
    "Aniban I": 57, "Aniban 557": 15, "Aniban III": 56,
    "Aniban 54": 25, "Aniban V": 55,
    "Ligas I": 50, "Ligas II": 57, "Ligas III": 58, "San Nicolas I": 61,
    "San Nicolas II": 64, "San Nicolas III": 104, "Zapote I": 62,
};


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

let inventoryMap = {};
let productMap = {};

const GUEST_CART_KEY = "guest_cart_v1";

function showToast(message, duration = 3000, color = "red", inline = false) {
    if (!toastDiv) {
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
    const sameIndex = guest.findIndex(g => {
        return g.productId === payload.productId &&
            g.sizeId === payload.sizeId &&
            JSON.stringify(g.addons || []) === JSON.stringify(payload.addons || []);
    });
    if (sameIndex !== -1) {
        guest[sameIndex].quantity = (guest[sameIndex].quantity || 1) + (payload.quantity || 1);
        guest[sameIndex].totalPrice = Number(guest[sameIndex].unitPrice || 0) * guest[sameIndex].quantity;
    } else {
        const id = `guest_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        guest.push({ id, ...payload });
    }
    saveGuestCart(guest);
    return guest;
}

async function mergeGuestCartToUser(uid) {
    const guest = loadGuestCart();
    if (!guest.length) return;
    try {
        const cartRef = collection(db, "users", uid, "cart");
        const snapshot = await getDocs(cartRef);
        const existing = snapshot.docs.map(ds => ({ id: ds.id, data: ds.data() }));

        for (const g of guest) {
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
        saveGuestCart([]);
        showToast("Guest cart merged to your account.", 2000, "green", true);
    } catch (err) {
        console.error("Failed to merge guest cart:", err);
    }
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        try {
            const userDocSnap = await getDoc(doc(db, "users", currentUser.uid));
            if (userDocSnap.exists()) {
                defaultUserDocData = userDocSnap.data();
            } else {
                defaultUserDocData = null;
            }
        } catch (err) {
            console.error("Failed to read user doc:", err);
        }

        await mergeGuestCartToUser(currentUser.uid);

        await loadSavedAddresses(true); 
        
        startRealtimeListeners(); 
    } else {
        currentUser = null;
        defaultUserDocData = null;
        userDeliveryFee = 0;
        selectedAddress = null;
        if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }
        startRealtimeListeners();
        cartItems = loadGuestCart();
        renderCartItemsFromState();
        loadSavedAddresses(); 
    }
});

export async function addToCart(product, selectedSize = null, selectedAddons = [], quantity = 1) {
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
            const guestPayload = {
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

function computeStockForCartItem(item) {

    if (!item) return { stock: 0, available: false };
    if (item.productId) {
        const prod = productMap[item.productId];
        if (prod && prod.available === false) return { stock: 0, available: false };
    }

    let possible = Infinity;
    const getComponentLimit = (component, requiredQtyPerProduct) => {
        if (!component || !component.id) return Infinity;
        const inv = inventoryMap[component.id];
        if (!inv || inv.active === false || Number(inv.quantity || 0) <= 0) return 0;
        const requiredQty = Math.max(Number(requiredQtyPerProduct) || 1, 1);
        return Math.floor(Number(inv.quantity || 0) / requiredQty);
    };

    if (item.sizeId) {
        const sizeLimit = getComponentLimit({ id: item.sizeId }, 1);
        possible = Math.min(possible, sizeLimit);
        if (possible === 0) return { stock: 0, available: false };
    }

    for (const ing of item.ingredients || []) {
        const limit = getComponentLimit(ing, ing.qty);
        possible = Math.min(possible, limit);
        if (possible === 0) return { stock: 0, available: false };
    }

    for (const addon of item.addons || []) {
        const limit = getComponentLimit(addon, addon.qty || 1);
        possible = Math.min(possible, limit);
        if (possible === 0) return { stock: 0, available: false };
    }

    for (const other of item.others || []) {
        const limit = getComponentLimit(other, other.qty);
        possible = Math.min(possible, limit);
        if (possible === 0) return { stock: 0, available: false };
    }

    if (possible === Infinity) return { stock: 0, available: false };
    return { stock: Math.max(possible, 0), available: possible > 0 };
}

function startRealtimeListeners() {
    if (unsubscribeInventory) unsubscribeInventory();
    unsubscribeInventory = onSnapshot(collection(db, "Inventory"), snapshot => {
        inventoryMap = {};
        snapshot.forEach(docSnap => {
            inventoryMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });
        renderCartItemsFromState();
    }, err => console.error("Inventory onSnapshot error:", err));

    if (unsubscribeProducts) unsubscribeProducts();
    unsubscribeProducts = onSnapshot(collection(db, "products"), snapshot => {
        productMap = {};
        snapshot.forEach(docSnap => {
            productMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });
        renderCartItemsFromState();
    }, err => console.error("Products onSnapshot error:", err));

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

function loadCartRealtime() {
    if (unsubscribeCart) { unsubscribeCart(); unsubscribeCart = null; }

    if (!currentUser) {
        cartItems = loadGuestCart();
        selectedCartItems = new Set();
        renderCartItemsFromState();
        return;
    }

    const cartRef = collection(db, "users", currentUser.uid, "cart");
    unsubscribeCart = onSnapshot(cartRef, async snapshot => {
        cartItems = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
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

function renderCartItemsFromState() {
    if (!cartItemsDiv) return;
    cartItemsDiv.innerHTML = "";

    if (!cartItems || !cartItems.length) {
        cartItemsDiv.innerHTML = "<p>Your cart is empty.</p>";
        if (cartTotalSpan) cartTotalSpan.textContent = "0.00";
        updateModalTotals();
        return;
    }

    const selectAllDiv = document.createElement("div");
    selectAllDiv.innerHTML = `<label><input type="checkbox" id="select-all-checkbox"> Select All Available Items</label>`;
    cartItemsDiv.appendChild(selectAllDiv);
    const selectAllCheckbox = selectAllDiv.querySelector("#select-all-checkbox");

    let deliveryDiv = document.getElementById("delivery-fee");
    if (!deliveryDiv) {
        deliveryDiv = document.createElement("div");
        deliveryDiv.id = "delivery-fee";
        deliveryDiv.style.textAlign = "right";
        deliveryDiv.style.marginTop = "12px";
        cartItemsDiv.appendChild(deliveryDiv); 
    } else {
        deliveryDiv.remove(); 
        cartItemsDiv.appendChild(deliveryDiv);
    }
    
    let totalContainer = document.getElementById("cart-total-container");
    if (!totalContainer) {
        totalContainer = document.createElement("div");
        totalContainer.id = "cart-total-container";
        totalContainer.style.textAlign = "right";
        totalContainer.style.marginTop = "8px";
        cartItemsDiv.appendChild(totalContainer);
    } else {
         totalContainer.remove(); 
         cartItemsDiv.appendChild(totalContainer);
    }

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

       itemDiv.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; flex:1; position: relative;">
            <input type="checkbox" class="cart-checkbox" data-id="${item.id}"
                ${selectedCartItems.has(item.id) ? "checked" : ""} ${disabledAttr}>
            <div style="position: relative;">
                <img src="${item.image || 'placeholder.png'}" alt="${item.name}"
                    style="height:70px; width:70px; object-fit:cover; border-radius:6px; flex-shrink:0;
                    ${!available || stock <= 0 ? 'filter: grayscale(100%); opacity:0.5;' : ''}">
            </div>
            <div style="flex:1; position: relative;">
                <div style="opacity:${!available || stock <= 0 ? 0.5 : 1};">
                    <strong>${item.name}</strong><br>
                    ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice || 0).toFixed(2)}` : 'Size: N/A'}<br>
                    ${addonsHTML}<br>
                    <label>Qty:
                        <input type="number" min="${stock > 0 ? 1 : 0}" max="${stock}" value="${displayQty}"
                            class="qty-input" style="width:60px;" data-id="${item.id}" ${disabledAttr}>
                    </label><br>
                    <small>Total: ₱${Number(item.totalPrice || 0).toFixed(2)}</small>
                </div>

                <span style="
                    position: absolute;
                    top: 0;
                    right: 0;
                    color: ${!available ? 'red' : (stock <= 0 ? 'orange' : 'green')};
                    font-weight: bold;
                    font-size: 1.3em;
                    padding: 2px 8px;
                    
                ">
                    ${statusLabel}
                </span>
            </div>
        </div>
        <button class="remove-btn" data-id="${item.id}" style="background:none; border:none; color:black; font-size:18px; cursor:pointer;">X</button>
    `;


        const removeBtn = itemDiv.querySelector(".remove-btn");
        removeBtn.addEventListener("click", async () => {
            try {
                if (currentUser && !String(item.id).startsWith("guest_")) {
                    await deleteDoc(doc(db, "users", currentUser.uid, "cart", item.id));
                } else {
                    const guest = loadGuestCart().filter(g => g.id !== item.id);
                    saveGuestCart(guest);
                    cartItems = guest;
                    renderCartItemsFromState();
                }
                selectedCartItems.delete(item.id);  
                showToast("Item removed from cart.", 2000, "red", true);
            } catch (err) {
                console.error("Failed to remove cart item:", err);
                showToast("Failed to remove item.", 2000, "red", true);
            }
        });


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
                updateCartTotal(); 
                updateModalTotals();
            } catch (err) {
                console.error("Error updating qty:", err);
                showToast("Failed to update quantity.", 2000, "red");
            }
        });
    }

// No stock
    const checkbox = itemDiv.querySelector(".cart-checkbox");
    if (checkbox) {
        if (!available || stock <= 0) {
            checkbox.disabled = true;
            selectedCartItems.delete(item.id);
        } else {
            checkbox.addEventListener("change", e => {
                if (e.target.checked) selectedCartItems.add(item.id);
                else selectedCartItems.delete(item.id);
                selectAllCheckbox.checked = availableItems.length > 0 && availableItems.every(i => selectedCartItems.has(i.id));
                updateCartTotal();
                updateModalTotals();
            });
        }
    }

    cartItemsDiv.insertBefore(itemDiv, deliveryDiv);
}

    // Delivery Fee show
   
    deliveryDiv.innerHTML = `<strong>Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}</strong>`;
    
    cartItemsDiv.appendChild(deliveryDiv);
    cartItemsDiv.appendChild(totalContainer);
    
    updateCartTotal();
}

function updateCartTotal() {
    // Select Product
    const currentCartTotalSpan = document.getElementById('cart-total');
    if (!currentCartTotalSpan) return;
    
    const grandTotal = cartItems
        .filter(i => selectedCartItems.has(i.id) && computeStockForCartItem(i).available !== false && computeStockForCartItem(i).stock > 0)
        .reduce((sum, i) => sum + Number(i.totalPrice || 0), 0);
        
    const finalTotal = selectedCartItems.size > 0 ? (grandTotal + userDeliveryFee) : 0;
    currentCartTotalSpan.textContent = finalTotal.toFixed(2);
    
    // Deliovery Fee show
    const deliveryDiv = document.getElementById("delivery-fee");
    if (deliveryDiv) {
         deliveryDiv.innerHTML = `<strong>Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}</strong>`;
    }
}

function updateModalTotals() {
    if (modalDeliveryFeeSpan) modalDeliveryFeeSpan.textContent = userDeliveryFee.toFixed(2);
    const total = cartItems
        .filter(i => selectedCartItems.has(i.id) && computeStockForCartItem(i).available !== false && computeStockForCartItem(i).stock > 0)
        .reduce((sum, i) => sum + Number(i.totalPrice || 0), 0) + (selectedCartItems.size > 0 ? userDeliveryFee : 0);
    if (modalGrandTotalSpan) modalGrandTotalSpan.textContent = total.toFixed(2);
}

function populateModalCart() {
    if (!modalCartItemsDiv) return;
    modalCartItemsDiv.innerHTML = "";
    cartItems.filter(i => selectedCartItems.has(i.id)).forEach(item => {
        let addonsHTML = "";
        if (Array.isArray(item.addons) && item.addons.length) {
            addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
        }
        const { stock, available } = computeStockForCartItem(item);
        const outOfStockLabel = !available || stock <= 0 ? " (Unavailable/Out of Stock)" : "";
        modalCartItemsDiv.innerHTML += `
            <div class="modal-cart-item" style="display:flex; align-items:center; gap:12px; justify-content:space-between; border-bottom:1px solid #ddd; padding:8px 0;">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <img src="${item.image || 'placeholder.png'}" alt="${item.name}"
                        style="height:60px; width:60px; object-fit:cover; border-radius:6px; flex-shrink:0;">
                    <div>
                        <strong>${item.name}${outOfStockLabel}</strong><br>
                        ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice).toFixed(2)}` : 'Size: N/A'}
                        ${addonsHTML}<br>
                        Qty: ${item.quantity} | Total: ₱${Number(item.totalPrice).toFixed(2)}
                    </div>
                </div>
            </div>
        `;
    });
}


// address

confirmOrderBtn?.addEventListener("click", () => {
    if (!currentUser) return showToast("Please log in to checkout.", 3000, "red");
    if (selectedCartItems.size === 0) return showToast("Select items to checkout.", 3000, "red");
    const isAnyItemSelectedAndAvailable = Array.from(selectedCartItems).some(id => {
        const item = cartItems.find(i => i.id === id);
        if (!item) return false;
        const { stock, available } = computeStockForCartItem(item);
        return stock > 0 && available;
    });
    if (!isAnyItemSelectedAndAvailable) return showToast("The selected item(s) are currently unavailable or out of stock.", 3000, "red");

    if (modal) modal.style.display = "block";
    loadSavedAddresses();
    populateModalCart();
});

closeModalBtn?.addEventListener("click", () => { if (modal) modal.style.display = "none"; });
window.addEventListener("click", e => { if (e.target === modal) modal.style.display = "none"; });

async function loadSavedAddresses(initialLoad = false) { 
    if (!savedAddressDiv) return;
    savedAddressDiv.innerHTML = "";
    cartAddresses = [];
    
    if (!initialLoad) selectedAddress = null; 

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
                
                // Default Address Check
                const isDefaultChecked = initialLoad || !selectedAddress; 
                div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${defaultAddr}" ${isDefaultChecked ? "checked" : ""}> Address 1 (Default): ${defaultAddr} (Fee: ₱${fee.toFixed(2)})</label>`;
                savedAddressDiv.appendChild(div);

                if (isDefaultChecked) {
                    selectedAddress = defaultAddr;
                    userDeliveryFee = fee;
                }
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
                
                // Prevent duplicate display of the default address
                if (full !== (cartAddresses[0]?.fullAddress || '')) {
                    cartAddresses.push({ fullAddress: full, deliveryFee: fee });
                    
                    const isChecked = selectedAddress === full;
                    const div = document.createElement("div");
                    div.classList.add("delivery-address");
                    div.innerHTML = `<label><input type="radio" name="selectedAddress" value="${full}" ${isChecked ? "checked" : ""}> Address ${i}: ${full} (Fee: ₱${fee.toFixed(2)})</label>`;
                    savedAddressDiv.appendChild(div);
                    i++;
                }
            });
        }

        // check and set the selected address
        if (!selectedAddress && cartAddresses.length > 0) {
            const firstRadio = savedAddressDiv.querySelector("input[name='selectedAddress']");
            if (firstRadio) {
                firstRadio.checked = true;
                selectedAddress = firstRadio.value;
                const selected = cartAddresses.find(a => a.fullAddress === selectedAddress);
                userDeliveryFee = selected ? Number(selected.deliveryFee) : 0;
            }
        } else if (selectedAddress) {
            // Update userDeliveryFee for a previous
             const selected = cartAddresses.find(a => a.fullAddress === selectedAddress);
             userDeliveryFee = selected ? Number(selected.deliveryFee) : 0;
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

        // Update total after select address
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
        showToast(`Address saved! Delivery fee: ₱${deliveryFee.toFixed(2)}`, 3000, "green", true);
        addressForm.reset();
        if (addressFormDiv) addressFormDiv.style.display = "none";
        loadSavedAddresses();
    } catch (err) {
        console.error(err);
        showToast("Failed to save address.", 3000, "red");
    }
});


async function getNextQueueNumber(paymentMethod) {
    const collectionRef = collection(db, "DeliveryOrders");
    const q = query(collectionRef, orderBy("queueNumberNumeric", "desc"), limit(1));
    const snapshot = await getDocs(q);

    let nextNumeric = 1;
    if (!snapshot.empty) {
        const lastNumeric = Number(snapshot.docs[0].data().queueNumberNumeric || 0);
        nextNumeric = lastNumeric + 1;
    }

    const prefix = paymentMethod === "Cash" ? "C" : "E";
    const formattedQueueNumber = `${prefix}${nextNumeric.toString().padStart(4, "0")}`;

    return {
        formatted: formattedQueueNumber,
        numeric: nextNumeric
    };
}

function getUserFullName() {
    const firstName = defaultUserDocData?.firstName || '';
    const lastName = defaultUserDocData?.lastName || '';
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    return fullName || currentUser?.displayName || currentUser?.email || "Customer";
}

function prepareLineItems(orderItems, deliveryFee, currentUser) {
    const lineItems = orderItems.flatMap(item => {
        const qty = Number(item.qty || 1);

        const itemsArray = [
            {
                name: `${item.product} (${item.size})`,
                currency: "PHP",
                amount: Math.round((item.basePrice + item.sizePrice) * 100),
                quantity: qty,
            },
        ];

        (item.addons || []).forEach(addon => {
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

    if (deliveryFee > 0) {
        lineItems.push({
            name: "Delivery Fee",
            currency: "PHP",
            amount: Math.round(deliveryFee * 100),
            quantity: 1,
        });
    }

    const customerDetails = {
        name: getUserFullName(), 
        email: currentUser.email,
        phone: defaultUserDocData?.phoneNumber || "N/A",  
        address: selectedAddress,
    };

    return { lineItems, customerDetails };
}


finalConfirmBtn?.addEventListener("click", async () => {
    if (!currentUser) return showToast("Log in first.", 3000, "red");
    if (selectedCartItems.size === 0) return showToast("Select items to checkout.", 3000, "red");
    if (!selectedAddress) return showToast("Select an address.", 3000, "red");

    const paymentMethod = document.querySelector("input[name='payment']:checked")?.value || "Cash";

    const phoneNumber = defaultUserDocData?.phoneNumber || null;
    if (!phoneNumber) {
        return showToast("Your phone number is missing! Please update your profile or primary address.", 4000, "red");
    }


    const customerFullName = getUserFullName(); 

    try {
        const { formatted: queueNumber, numeric: queueNumberNumeric } = await getNextQueueNumber(paymentMethod);

        const cartRef = collection(db, "users", currentUser.uid, "cart");
        const selectedItems = cartItems.filter(item => selectedCartItems.has(item.id));
        const selectedItemIds = Array.from(selectedCartItems);


        const inventoryUpdates = new Map();
        for (const item of selectedItems) {
            const requiredQty = item.quantity || 1;
            const { stock, available } = computeStockForCartItem(item);

            if (!available || stock <= 0 || requiredQty > stock) {
                return showToast(`Stock check failed for item: ${item.name}. Available: ${stock}, Requested: ${requiredQty}. Cannot place order.`, 4000, "red", true);
            }

            const components = [
                { id: item.sizeId, qty: 1 },
                ...(item.ingredients || []),
                ...(item.others || []),
                ...(item.addons || [])
            ].filter(c => c && c.id);

            for (const component of components) {
                const componentId = component.id;
                const totalDeduction = (component.qty || 1) * requiredQty;
                const currentStock = inventoryUpdates.has(componentId) ? inventoryUpdates.get(componentId) : Number(inventoryMap[componentId]?.quantity || 0);
                const finalNewQty = currentStock - totalDeduction;

                if (finalNewQty < 0) {
                    return showToast(`Insufficient stock for component ID: ${componentId} (for item: ${item.name}) due to combined order requirements. Cannot place order.`, 4000, "red", true);
                }
                inventoryUpdates.set(componentId, finalNewQty);
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
            const batch = writeBatch(db);

            const newOrderRef = doc(collection(db, "DeliveryOrders"));
            batch.set(newOrderRef, {
                userId: currentUser.uid,
                customerName: customerFullName, 
                address: selectedAddress,
                phoneNumber: phoneNumber, 
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

            for (const [componentId, newQty] of inventoryUpdates.entries()) {
                const invRef = doc(db, "Inventory", componentId);
                batch.update(invRef, { quantity: newQty });
            }

            for (const itemId of selectedItemIds) {
                batch.delete(doc(cartRef, itemId));
            }

            await batch.commit();

            showToast(`Order placed! Queue #${queueNumber}. (Payment: Cash)`, 3000, "green", true);
            if (modal) modal.style.display = "none";
            window.location.href = `customer-status.html?orderId=${newOrderRef.id}&col=DeliveryOrders`;
        } else if (paymentMethod === "E-Payment") {
            const { lineItems, customerDetails } = prepareLineItems(orderItems, userDeliveryFee, currentUser);
            

            customerDetails.phone = phoneNumber;
            customerDetails.name = customerFullName; 

            const paymentMetadata = {
                userId: currentUser.uid,
                customerName: customerFullName, 
                queueNumber,
                address: selectedAddress,
                deliveryFee: userDeliveryFee,
                orderTotal,
                cartItemIds: selectedItemIds,
                inventoryUpdates: Object.fromEntries(inventoryUpdates),
                amount: orderTotalInCentavos,
                currency: "PHP",
                description: `Order #${queueNumber} by ${currentUser.email}`,
                lineItems,
                customerDetails,
            };

            const batch = writeBatch(db);
            const newOrderRef = doc(collection(db, "DeliveryOrders"));
            batch.set(newOrderRef, {
                userId: currentUser.uid,
                customerName: customerFullName, 
                address: selectedAddress,
                phoneNumber: phoneNumber, 
                queueNumber,
                queueNumberNumeric,
                orderType: "Delivery",
                items: orderItems,
                deliveryFee: userDeliveryFee,
                total: orderTotal,
                paymentMethod,
                status: "Wait for Admin to Accept",
                createdAt: serverTimestamp(),
                paymentMetadata: paymentMetadata
            });

            for (const itemId of selectedItemIds) {
                batch.delete(doc(cartRef, itemId));
            }

            await batch.commit();

            showToast(`Order placed! Queue #${queueNumber}. Status: WAITING FOR ADMIN APPROVAL. You will receive a separate payment link shortly.`, 6000, "orange", true);
            if (modal) modal.style.display = "none";
            window.location.href = `customer-status.html?orderId=${newOrderRef.id}&col=DeliveryOrders`;
        }

    } catch (err) {
        console.error("Order failed:", err);
        showToast("Order failed. Try again. Error details: " + err.message, 4000, "red", true);
    }
});

export function showLoginPopup() {
    try {
        const loginPopup = document.getElementById('loginPopup');
        if (loginPopup) {
            loginPopup.style.display = 'flex';
            return;
        }
    } catch (e) {
        
    }
    window.location.href = 'login.html';
}
