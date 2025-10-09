// ==========================
// --- imports ---
// ==========================
import { db } from './firebase-config.js';
import {
    collection, addDoc, getDocs, updateDoc, deleteDoc, doc,
    serverTimestamp, onSnapshot, query, orderBy, limit, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ==========================
// --- DELIVERY FEES ---
// ==========================
const deliveryFees = {
    "Alima": 50,
    "Aniban I": 60,
    // Add all your barangays and their fees
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
let selectedAddress = null;
let userDeliveryFee = 0;
let defaultUserDocData = null;
let cartAddresses = [];

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
        loadCartRealtime();
        loadSavedAddresses();
    } else {
        currentUser = null;
        cartItemsDiv.innerHTML = '<p>Please log in to view your cart.</p>';
        window.location.href = "login.html";
        cartTotalSpan.textContent = '0.00';
        cartItems = [];
        selectedCartItems.clear();
        if (unsubscribeCart) unsubscribeCart();
    }
});

// ==========================
// --- ADD TO CART (MERGE DUPLICATES) ---
// ==========================
export async function addToCart(product, selectedSize = null, selectedAddons = [], quantity = 1) {
    if (!currentUser) return showToast("Please log in first.", 3000, "red");
    const basePrice = Number(product.price || 0);
    const sizePrice = Number(selectedSize?.price || 0);
    const addons = (selectedAddons || []).map(a => ({ name: a.name, price: Number(a.price || 0), id: a.id || null }));
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
                disabled: product.disabled || false
            });
            showToast("Added to cart successfully!", 2000, "green", true);
        }
    } catch (err) {
        console.error("Error adding to cart:", err);
        showToast("Failed to add to cart.", 3000, "red");
    }
}

// ==========================
// --- FETCH STOCK FOR CART ITEM ---
// ==========================
async function fetchCartItemStock(item) {
    const inventoryMap = {};
    const snapshot = await getDocs(collection(db, "Inventory"));
    snapshot.forEach(docSnap => {
        const data = docSnap.data();
        inventoryMap[docSnap.id] = { ...data, quantity: Number(data.quantity || 0) };
    });

    if (item.disabled) return 0;

    let possible = Infinity;

    const getComponentLimit = (component, requiredQtyPerProduct) => {
        const invItem = inventoryMap[component.id];
        if (!invItem || !invItem.active || invItem.quantity <= 0) return 0;
        const requiredQty = Math.max(Number(requiredQtyPerProduct) || 1, 1);
        return Math.floor(invItem.quantity / requiredQty);
    };

    if (item.sizeId) {
        const sizeLimit = getComponentLimit({ id: item.sizeId }, 1);
        possible = Math.min(possible, sizeLimit);
        if (possible === 0) return 0;
    }

    for (const ing of item.ingredients || []) {
        const ingLimit = getComponentLimit(ing, ing.qty);
        possible = Math.min(possible, ingLimit);
        if (possible === 0) return 0;
    }

    for (const addon of item.addons || []) {
        const addonLimit = getComponentLimit(addon, 1);
        possible = Math.min(possible, addonLimit);
        if (possible === 0) return 0;
    }

    for (const other of item.others || []) {
        const otherLimit = getComponentLimit(other, other.qty);
        possible = Math.min(possible, otherLimit);
        if (possible === 0) return 0;
    }

    return possible === Infinity ? 0 : possible;
}

// ==========================
// --- LOAD CART ---
// ==========================
function loadCartRealtime() {
    if (!currentUser) return;
    const cartRef = collection(db, "users", currentUser.uid, "cart");
    if (unsubscribeCart) unsubscribeCart();

    unsubscribeCart = onSnapshot(cartRef, async snapshot => {
        cartItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        selectedCartItems.clear();
        cartItemsDiv.innerHTML = "";

        if (!cartItems.length) {
            cartItemsDiv.innerHTML = "<p>Your cart is empty.</p>";
            cartTotalSpan.textContent = "0.00";
            updateModalTotals();
            return;
        }

        const selectAllDiv = document.createElement("div");
        selectAllDiv.innerHTML = `<label><input type="checkbox" id="select-all-checkbox"> Select All</label>`;
        cartItemsDiv.appendChild(selectAllDiv);
        const selectAllCheckbox = document.getElementById("select-all-checkbox");

        let deliveryDiv = document.getElementById("delivery-fee");
        if (!deliveryDiv) {
            deliveryDiv = document.createElement("div");
            deliveryDiv.id = "delivery-fee";
            deliveryDiv.style.textAlign = "right";
            deliveryDiv.style.marginTop = "12px";
            cartItemsDiv.appendChild(deliveryDiv);
        }

        selectAllCheckbox.addEventListener("change", () => {
            if (selectAllCheckbox.checked) {
                cartItems.forEach(item => { if(item.stock > 0) selectedCartItems.add(item.id) });
            } else {
                selectedCartItems.clear();
            }
            renderCartItems();
            updateCartTotal();
            updateModalTotals();
        });

        async function renderCartItems() {
            cartItemsDiv.querySelectorAll(".cart-item").forEach(el => el.remove());

            const stockPromises = cartItems.map(item => fetchCartItemStock(item).then(stock => ({ ...item, stock })));
            const updatedCartItems = await Promise.all(stockPromises);
            cartItems = updatedCartItems;

            for (const item of cartItems) {
                const stock = item.stock;
                const itemDiv = document.createElement("div");
                itemDiv.classList.add("cart-item");
                if (stock <= 0) itemDiv.classList.add("unavailable");
                itemDiv.style.display = "flex";
                itemDiv.style.alignItems = "center";
                itemDiv.style.justifyContent = "space-between";
                itemDiv.style.gap = "12px";
                itemDiv.style.padding = "10px 0";
                itemDiv.style.borderBottom = "1px solid #ddd";

                let addonsHTML = "";
                if (Array.isArray(item.addons) && item.addons.length) {
                    addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
                }
                const checkedAttr = selectedCartItems.has(item.id) ? "checked" : "";
                const disabledAttr = stock <= 0 ? "disabled" : "";
                const outOfStockLabel = stock <= 0 ? " (Unavailable)" : "";

                let displayQty = Math.min(item.quantity, stock > 0 ? stock : 1);
                if (stock <= 0) displayQty = 1;

                itemDiv.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px; flex:1;">
                        <input type="checkbox" class="cart-checkbox" data-id="${item.id}" ${checkedAttr} ${disabledAttr}>
                        <img src="${item.image || 'placeholder.png'}" alt="${item.name}"
                            style="height:70px; width:70px; object-fit:cover; border-radius:6px; flex-shrink:0;">
                        <div style="flex:1;">
                            <strong>${item.name}${outOfStockLabel}</strong> <span style="margin-left: 10px;">(Stock: ${stock})</span>
<br>
                            ${item.size ? `Size: ${item.size} - ₱${Number(item.sizePrice).toFixed(2)}` : 'Size: N/A'}<br>
                            ${addonsHTML}<br>
                            <label>Qty: <input type="number" min="1" max="${stock}" value="${displayQty}" class="qty-input" style="width:60px;" ${disabledAttr}></label><br>
                            <small>Total: ₱${Number(item.totalPrice).toFixed(2)}</small>
                        </div>
                    </div>
                    <button class="remove-btn" style="background:none; border:none; font-size:18px; cursor:pointer;" ${disabledAttr}>❌</button>
                `;

                const checkbox = itemDiv.querySelector(".cart-checkbox");
                checkbox.addEventListener("change", e => {
                    if (e.target.checked) selectedCartItems.add(item.id);
                    else selectedCartItems.delete(item.id);
                    selectAllCheckbox.checked = selectedCartItems.size === cartItems.filter(i => i.stock > 0).length;
                    updateCartTotal();
                    updateModalTotals();
                });

                const qtyInput = itemDiv.querySelector(".qty-input");
                if (qtyInput) {
                    qtyInput.addEventListener("change", async e => {
                        let newQty = parseInt(e.target.value) || 1;
                        if (newQty > stock) newQty = stock;
                        e.target.value = newQty;
                        const newUnit = Number(item.basePrice) + Number(item.sizePrice) + Number(item.addonsPrice);
                        await updateDoc(doc(cartRef, item.id), {
                            quantity: newQty,
                            unitPrice: newUnit,
                            totalPrice: newUnit * newQty
                        });
                    });
                }

                const removeBtn = itemDiv.querySelector(".remove-btn");
                removeBtn.addEventListener("click", async () => {
                    await deleteDoc(doc(cartRef, item.id));
                    showToast("Item removed from cart.", 2000, "red", true);
                });

                cartItemsDiv.insertBefore(itemDiv, deliveryDiv);
            }

            deliveryDiv.innerHTML = `<strong>Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}</strong>`;
            updateCartTotal();
        }

        renderCartItems();
    }, err => {
        console.error("Error loading cart:", err);
        cartItemsDiv.innerHTML = "<p>Failed to load cart.</p>";
        cartTotalSpan.textContent = "0.00";
        updateModalTotals();
    });
}

// ==========================
// --- UPDATE TOTALS ---
// ==========================
function updateCartTotal() {
    const grandTotal = cartItems.filter(i => selectedCartItems.has(i.id)).reduce((sum, i) => sum + Number(i.totalPrice || 0), 0);
    cartTotalSpan.textContent = selectedCartItems.size > 0 ? (grandTotal + userDeliveryFee).toFixed(2) : "0.00";
    const deliveryDiv = document.getElementById("delivery-fee");
    if (deliveryDiv) deliveryDiv.innerHTML = `<strong>Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}</strong>`;
}

// ==========================
// --- UPDATE MODAL TOTALS ---
// ==========================
function updateModalTotals() {
    modalDeliveryFeeSpan.textContent = selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00";
    const total = cartItems.filter(i => selectedCartItems.has(i.id)).reduce((sum, i) => sum + Number(i.totalPrice || 0), 0) + (selectedCartItems.size > 0 ? userDeliveryFee : 0);
    modalGrandTotalSpan.textContent = total.toFixed(2);
    populateModalCart();
}

function populateModalCart() {
    modalCartItemsDiv.innerHTML = "";
    cartItems.filter(i => selectedCartItems.has(i.id)).forEach(item => {
        let addonsHTML = "";
        if (Array.isArray(item.addons) && item.addons.length) {
            addonsHTML = "<br><small>Add-ons:<br>" + item.addons.map(a => `&nbsp;&nbsp;${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>") + "</small>";
        }
        const outOfStockLabel = item.stock <= 0 ? " (Unavailable)" : "";
        modalCartItemsDiv.innerHTML += `
            <div class="modal-cart-item" style="display:flex; align-items:center; gap:12px; justify-content:space-between; border-bottom:1px solid #ddd; padding:8px 0;">
                <div style="display:flex; align-items:center; gap:10px; flex:1;">
                    <img src="${item.image || 'placeholder.png'}" alt="${item.name}"
                               style="height:60px; width:60px; object-fit:cover; border-radius:6px; flex-shrink:0;">
                    <div>
                        <strong>${item.name}${outOfStockLabel} (Stock: ${item.stock ?? 'N/A'})</strong><br>
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
            const defaultAddr = [userDoc.houseNumber, userDoc.barangay, userDoc.city, userDoc.province, userDoc.region].filter(Boolean).join(", ");
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
            const full = [data.houseNumber, data.barangay, data.city, data.province, data.region].filter(Boolean).join(", ");
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

addAddressBtn?.addEventListener("click", () => { addressFormDiv.style.display = "block"; });
addressForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const region = document.getElementById("region")?.value;
    const province = document.getElementById("province")?.value;
    const city = document.getElementById("city")?.value;
    const barangay = document.getElementById("barangay")?.value;
    const houseNumber = document.getElementById("houseNumber")?.value || "";
    const deliveryFee = deliveryFees[barangay] || 0;

    try {
        await addDoc(collection(db, "users", currentUser.uid, "addresses"), { region, province, city, barangay, houseNumber, deliveryFee });
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
    const q = query(
        collectionRef,
        orderBy("queueNumberNumeric", "desc"),
        limit(1)
    );
    const snapshot = await getDocs(q);

    let nextNumeric = 1;
    if (!snapshot.empty) {
        const lastNumeric = Number(snapshot.docs[0].data().queueNumberNumeric || 0);
        nextNumeric = lastNumeric + 1;
    }
    
    const prefix = paymentMethod === 'Cash' ? 'C' : 'G';
    const formattedQueueNumber = `${prefix}${nextNumeric.toString().padStart(4, '0')}`;

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

        const commonOrderData = {
            userId: currentUser.uid,
            customerName: currentUser.displayName || defaultUserDocData?.customerName || "Customer",
            address: selectedAddress,
            queueNumber,
            queueNumberNumeric,
            orderType: "Delivery",
            items: orderItems,
            deliveryFee: userDeliveryFee,
            total: orderTotal,
            paymentMethod,
            status: "Pending", // ⭐ ALWAYS Pending initially
            cartItemIds: selectedItemIds, // Added for E-Payment cleanup
            createdAt: serverTimestamp()
        };

        let orderRef = null;

        if (paymentMethod === "Cash") {
            // 1. Add order to DeliveryOrders with "Pending" status
            await addDoc(collection(db, "DeliveryOrders"), commonOrderData);

            // 2. Deduct inventory and clear cart immediately
            await deductInventory(orderItems);
            for (const itemId of selectedItemIds) await deleteDoc(doc(cartRef, itemId));

            showToast(`Order placed! Queue #${queueNumber}. (Payment: Cash)`, 3000, "green", true);
            modal.style.display = "none";
        } else if (paymentMethod === "E-Payment") {
            showToast("Preparing E-Payment...", 3000, "blue", true);
            
            // 1. Add order to DeliveryOrders with "Pending" status
            orderRef = await addDoc(collection(db, "DeliveryOrders"), commonOrderData);

            // 2. Call the Netlify Function for checkout
            const response = await fetch("/.netlify/functions/create-checkout", { // ⭐ CHANGE APPLIED HERE
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    amount: orderTotalInCentavos,
                    currency: "PHP",
                    description: `Order #${queueNumber} (ID: ${orderRef.id})`,
                    metadata: {
                        orderId: orderRef.id, // CRITICAL: Pass the new DeliveryOrder ID
                        userId: currentUser.uid,
                    }
                }),
            });

            const data = await response.json();

            if (response.ok && data?.checkout_url) {
                showToast("Redirecting to GCash payment page...", 3000, "green", true);
                window.location.href = data.checkout_url;
            } else {
                // If payment creation fails, delete the 'Pending' order to prevent confusion
                await deleteDoc(orderRef);
                showToast(`Payment setup failed: ${data.error || 'Unknown error'}.`, 4000, "red", true);
                console.error("PayMongo Checkout Error:", data.error || data);
            }
        }
        modal.style.display = "none";
    } catch (err) {
        console.error(err);
        showToast("Order failed. Try again.", 4000, "red", true);
    }
});
