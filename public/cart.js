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
            
            // Check for deep equality of addons
            const existingAddons = JSON.stringify(data.addons || []);
            const newAddons = JSON.stringify(addons || []);
            const sameAddons = existingAddons === newAddons;
            
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
        // Ensure requiredQty is at least 1 to prevent division by zero or errors
        const requiredQty = Math.max(Number(requiredQtyPerProduct) || 1, 1); 
        return Math.floor(invItem.quantity / requiredQty);
    };
    
    // Check stock for the size variant
    if (item.sizeId) {
        const sizeLimit = getComponentLimit({ id: item.sizeId }, 1); 
        possible = Math.min(possible, sizeLimit);
        if (possible === 0) return 0;
    }

    // Check stock for ingredients
    for (const ing of item.ingredients || []) {
        const ingLimit = getComponentLimit(ing, ing.qty);
        possible = Math.min(possible, ingLimit);
        if (possible === 0) return 0;
    }

    // Check stock for addons (usually qty of 1 per product)
    for (const addon of item.addons || []) {
        const addonLimit = getComponentLimit(addon, 1); 
        possible = Math.min(possible, addonLimit);
        if (possible === 0) return 0;
    }

    // Check stock for others
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
        
        // Retain selected items only if they still exist in the cart
        const currentItemIds = new Set(cartItems.map(item => item.id));
        selectedCartItems = new Set([...selectedCartItems].filter(id => currentItemIds.has(id)));
        
        cartItemsDiv.innerHTML = "";

        if (!cartItems.length) {
            cartItemsDiv.innerHTML = "<p>Your cart is empty.</p>";
            cartTotalSpan.textContent = "0.00";
            updateModalTotals();
            confirmOrderBtn.disabled = true;
            return;
        }

        confirmOrderBtn.disabled = false;

        // Re-render select-all checkbox and delivery fee element
        const selectAllDiv = document.createElement("div");
        selectAllDiv.innerHTML = `<label style="font-weight: bold; display: block; margin-bottom: 10px;"><input type="checkbox" id="select-all-checkbox"> Select All</label>`;
        cartItemsDiv.appendChild(selectAllDiv);
        const selectAllCheckbox = document.getElementById("select-all-checkbox");
        
        const cartItemsContainer = document.createElement("div");
        cartItemsContainer.id = "cart-items-list";
        cartItemsDiv.appendChild(cartItemsContainer);
        
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
            renderCartItems(true); // Re-render with new selection state
            updateCartTotal();
            updateModalTotals();
        });
        
        async function renderCartItems(skipStockUpdate = false) {
            cartItemsContainer.innerHTML = ""; // Clear list, keep select-all and delivery fee

            let updatedCartItems = cartItems;
            if (!skipStockUpdate) {
                const stockPromises = cartItems.map(item => fetchCartItemStock(item).then(stock => ({ ...item, stock })));
                updatedCartItems = await Promise.all(stockPromises);
                cartItems = updatedCartItems;
            }

            // Update 'Select All' state based on available stock
            const selectableItems = cartItems.filter(i => i.stock > 0);
            selectAllCheckbox.checked = selectableItems.length > 0 && selectedCartItems.size === selectableItems.length;


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

                // Display quantity: limit to stock if stock is low
                let displayQty = Math.min(item.quantity, stock > 0 ? stock : 1);
                
                // If the item is out of stock, ensure it's not selected
                if (stock <= 0) {
                    displayQty = 0; // Display 0 quantity for out of stock items
                    selectedCartItems.delete(item.id);
                }

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
                            <label>Qty: <input type="number" min="1" max="${stock}" value="${displayQty}" class="qty-input" data-id="${item.id}" style="width:60px;" ${disabledAttr}></label><br>
                            <small>Unit Price: ₱${Number(item.unitPrice).toFixed(2)} | Total: ₱${Number(item.totalPrice).toFixed(2)}</small>
                        </div>
                    </div>
                    <button class="remove-btn" data-id="${item.id}" style="background:none; border:none; font-size:18px; cursor:pointer;">❌</button>
                `;

                const checkbox = itemDiv.querySelector(".cart-checkbox");
                checkbox.addEventListener("change", e => {
                    if (e.target.checked) selectedCartItems.add(item.id);
                    else selectedCartItems.delete(item.id);
                    // Recalculate select all state
                    const selectable = cartItems.filter(i => i.stock > 0);
                    selectAllCheckbox.checked = selectedCartItems.size === selectable.length;
                    
                    updateCartTotal();
                    updateModalTotals();
                });

                const qtyInput = itemDiv.querySelector(".qty-input");
                if (qtyInput) {
                    qtyInput.addEventListener("change", async e => {
                        let newQty = parseInt(e.target.value) || 1;
                        if (newQty > stock) {
                            newQty = stock;
                            showToast(`Quantity limited to stock (${stock}).`, 2000, "orange", true);
                        }
                        if (newQty < 1) newQty = 1;

                        e.target.value = newQty;
                        const newUnit = Number(item.basePrice) + Number(item.sizePrice) + Number(item.addonsPrice);
                        await updateDoc(doc(cartRef, item.id), {
                            quantity: newQty,
                            // unitPrice is constant for an item, no need to update
                            totalPrice: newUnit * newQty
                        });
                        // Firestore listener handles the final update, but setting value immediately feels snappier
                        
                        // If the item is selected, immediately update the total view
                        if(selectedCartItems.has(item.id)) {
                             updateCartTotal();
                             updateModalTotals();
                        }
                    });
                }

                const removeBtn = itemDiv.querySelector(".remove-btn");
                removeBtn.addEventListener("click", async () => {
                    await deleteDoc(doc(cartRef, item.id));
                    selectedCartItems.delete(item.id); // Ensure it's removed from the set
                    showToast("Item removed from cart.", 2000, "red", true);
                });

                cartItemsContainer.appendChild(itemDiv);
            }

            deliveryDiv.innerHTML = `<strong>Delivery Fee: ₱${selectedCartItems.size > 0 ? userDeliveryFee.toFixed(2) : "0.00"}</strong>`;
            updateCartTotal();
            updateModalTotals();
        }

        renderCartItems();
    }, err => {
        console.error("Error loading cart:", err);
        cartItemsDiv.innerHTML = "<p>Failed to load cart.</p>";
        cartTotalSpan.textContent = "0.00";
        updateModalTotals();
        confirmOrderBtn.disabled = true;
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
    
    // Check if any selected item has quantity > stock
    const overstocked = cartItems.filter(i => selectedCartItems.has(i.id) && i.quantity > i.stock);
    if (overstocked.length > 0) {
        showToast("Adjust quantity for items that exceed stock, or unselect them.", 4000, "orange");
        // Optionally prevent modal open, but letting the user see the problem is better
        // return; 
    }
    
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
                // Prioritize fee from userDoc, fallback to deliveryFees map
                const fee = Number((userDoc.deliveryFee ?? deliveryFees[userDoc.barangay]) || 0);
                cartAddresses.push({ fullAddress: defaultAddr, deliveryFee: fee });

                const div = document.createElement("div");
                div.classList.add("delivery-address");
                // Check the default address by default
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
// --- INVENTORY DEDUCTION (ONLY FOR CASH ORDERS) ---
// ==========================
async function deductInventory(order) {
    const deductItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        // NOTE: Using Firebase server increment is better for concurrency (see webhook-listener.js)
        // This is a simplified client-side deduction for cash orders.
        try {
            await updateDoc(invRef, { 
                 quantity: serverTimestamp.FieldValue.increment(-Math.abs(amount)) // Better approach for concurrency 
            });
        } catch (error) {
            // Fallback for client-side which might not have FieldValue.increment import
             const invSnap = await getDoc(invRef);
             const invQty = invSnap.exists() ? Number(invSnap.data().quantity || 0) : 0;
             await updateDoc(invRef, { quantity: Math.max(invQty - amount, 0) });
        }
    };
    
    // Convert to proper number of items to deduct
    const deductionPromises = [];
    for (const item of order) {
        const itemQty = Number(item.qty || 1);
        // Deduct size variant
        if (item.sizeId) deductionPromises.push(deductItem(item.sizeId, itemQty));
        // Deduct ingredients
        for (const ing of item.ingredients || []) deductionPromises.push(deductItem(ing.id, (ing.qty || 1) * itemQty));
        // Deduct others
        for (const other of item.others || []) deductionPromises.push(deductItem(other.id, (other.qty || 1) * itemQty));
        // Deduct addons
        for (const addon of item.addons || []) deductionPromises.push(deductItem(addon.id, itemQty));
    }
    await Promise.all(deductionPromises);
}


// ==========================
// --- QUEUE NUMBER ---
// ==========================
async function getNextQueueNumber(paymentMethod) {
    // Check both DeliveryOrders and InStoreOrders to prevent duplicate queue numbers
    const deliveryRef = collection(db, "DeliveryOrders");
    const instoreRef = collection(db, "InStoreOrders");
    
    const [deliverySnap, instoreSnap] = await Promise.all([
        getDocs(query(deliveryRef, orderBy("queueNumberNumeric", "desc"), limit(1))),
        getDocs(query(instoreRef, orderBy("queueNumberNumeric", "desc"), limit(1)))
    ]);

    let lastNumeric = 0;

    if (!deliverySnap.empty) {
        lastNumeric = Math.max(lastNumeric, Number(deliverySnap.docs[0].data().queueNumberNumeric || 0));
    }
    if (!instoreSnap.empty) {
        lastNumeric = Math.max(lastNumeric, Number(instoreSnap.docs[0].data().queueNumberNumeric || 0));
    }

    let nextNumeric = lastNumeric + 1;
    
    const prefix = paymentMethod === 'Cash' ? 'C' : 'G'; 
    const formattedQueueNumber = `${prefix}${nextNumeric.toString().padStart(4, '0')}`;

    return {
        formatted: formattedQueueNumber,
        numeric: nextNumeric
    };
}

// ==========================
// --- FINAL CONFIRM ORDER (UPDATED FOR DRAFT ORDERS) ---
// ==========================
finalConfirmBtn?.addEventListener("click", async () => {
    if (!currentUser) return showToast("Log in first.", 3000, "red");
    if (selectedCartItems.size === 0) return showToast("Select at least one item.", 3000, "red");
    if (!selectedAddress) return showToast("Select an address.", 3000, "red");

    const paymentMethod = document.querySelector("input[name='payment']:checked")?.value || "Cash";

    // 1. Prepare Order Data
    const { formatted: queueNumber, numeric: queueNumberNumeric } = await getNextQueueNumber(paymentMethod);

    const selectedItems = cartItems.filter(item => selectedCartItems.has(item.id));
    const selectedItemIds = Array.from(selectedCartItems);

    // Final check for stock before placing order
    const outOfStockItems = selectedItems.filter(item => item.quantity > item.stock || item.stock === 0);
    if (outOfStockItems.length > 0) {
        showToast("One or more selected items exceed available stock. Please adjust quantities or unselect them.", 5000, "red");
        // Re-render the cart to highlight the issue
        loadCartRealtime(); 
        modal.style.display = "none";
        return;
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

    const baseOrderData = {
        userId: currentUser.uid,
        customerName: currentUser.displayName || defaultUserDocData?.customerName || "Customer",
        address: selectedAddress,
        queueNumber, 
        queueNumberNumeric, 
        orderType: "Delivery",
        orderItems: orderItems, // Renamed to orderItems for consistency
        deliveryFee: userDeliveryFee,
        orderTotal: orderTotal, // Renamed to orderTotal for consistency
        cartItemIds: selectedItemIds,
        createdAt: serverTimestamp()
    };

    try {
        if (paymentMethod === "Cash") {
            // 2A. CASH: Place order directly, deduct inventory, and clear cart
            await addDoc(collection(db, "DeliveryOrders"), {
                ...baseOrderData,
                total: orderTotal, // Keep 'total' for legacy if needed
                items: orderItems, // Keep 'items' for legacy if needed
                paymentMethod,
                status: "Pending",
            });

            // Perform Inventory Deduction immediately for COD
            await deductInventory(orderItems); 
            // Clear cart immediately for COD
            const cartRef = collection(db, "users", currentUser.uid, "cart");
            for (const itemId of selectedItemIds) await deleteDoc(doc(cartRef, itemId));

            showToast(`Order placed! Queue #${queueNumber}. (Payment: Cash)`, 3000, "green", true);
            modal.style.display = "none";
            // Navigate to confirmation page
            window.location.href = `order-confirmation.html?order=${queueNumber}`; 

        } else if (paymentMethod === "E-Payment") {
            // 2B. E-PAYMENT: Create Draft Order
            showToast("Preparing payment...", 3000, "blue", true);
            
            const draftRef = await addDoc(collection(db, "DraftOrders"), {
                ...baseOrderData,
                status: "Draft",
                paymentMethod: "E-Payment",
            });

            // 3. Initiate PayMongo Checkout using the Draft ID in metadata
            const response = await fetch("/.netlify/functions/create-checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    amount: orderTotalInCentavos,
                    currency: "PHP",
                    description: `Order #${queueNumber} (Draft: ${draftRef.id})`,
                    // CRITICAL: Only pass the Draft ID and other simple data
                    metadata: { 
                        draftOrderId: draftRef.id, // <-- This is the key
                        userId: currentUser.uid, 
                        queueNumber, 
                        orderTotal: orderTotal, // Send total for quick reference
                    }
                }),
            });

            const data = await response.json();

            if (response.ok && data?.checkout_url) {
                // 4. Redirect to PayMongo
                showToast("Redirecting to GCash payment page...", 3000, "green", true);
                modal.style.display = "none";
                window.location.href = data.checkout_url;
                
                // Inventory deduction and cart clearing happen on the server-side webhook
            } else {
                // 5. Handle PayMongo failure: Delete Draft Order
                await deleteDoc(draftRef);
                showToast(`Failed to create GCash payment: ${data.error || 'Unknown error'}.`, 4000, "red", true);
                console.error("PayMongo Checkout Error:", data.error || data);
            }
        }
    } catch (err) {
        console.error(err);
        showToast("Order failed. Try again.", 4000, "red", true);
    }
});
