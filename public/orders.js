// ===============================
// pos.js - STREAMLINED & FIXED
// ===============================

// --- imports ---
import { db } from './firebase-config.js';
import {
    collection, addDoc, getDocs, updateDoc, doc,
    serverTimestamp, onSnapshot, query, where, orderBy, limit, getDoc,
    increment 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// --- DOM Elements ---
const auth = getAuth(); 
const productTabs = document.getElementById("productTabs");
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
const messagePopup = document.getElementById("messagePopup");


// --- State Variables ---
let currentOrder = [];
let selectedProduct = null;
let totalPrice = 0;
// Note: These categories MUST match the 'category' field in your 'products' Firestore documents.
const CATEGORIES = ["all", "Drinks", "Food", "Others"]; 
let activeCategory = "all";


// ====================================================
// ✅ HELPER FUNCTIONS
// ====================================================

// --- Helper: Show toast message ---
function showMessage(msg, type = "success") {
    messagePopup.textContent = msg;
    messagePopup.style.backgroundColor = (type === "error") ? "#e53935" : "#4caf50";
    messagePopup.classList.add("show");
    setTimeout(() => messagePopup.classList.remove("show"), 2500);
}

// --- Helper: Close all popups ---
function closeAllPopups() {
    [productPopup, paymentPopup, cashPopup, epaymentPopup, cancelConfirmPopup].forEach(p => {
        if (p) p.style.display = "none";
    });
}

// --- Helper: Get next queue number ---
async function getNextQueueNumber() {
    const q = query(collection(db, "InStoreOrders"), orderBy("queueNumber", "desc"), limit(1));
    const snapshot = await getDocs(q);
    return !snapshot.empty ? (snapshot.docs[0].data().queueNumber || 0) + 1 : 1;
}

// ====================================================
// ✅ AUTHENTICATION AND INITIALIZATION BLOCK
// ====================================================
onAuthStateChanged(auth, (user) => {
    if (!user) return window.location.replace("login.html");
    initProductTabs();
    setupOrderListener();
});


// ====================================================
// ✅ TAB INITIALIZATION & SWITCHING LOGIC (FIXED)
// ====================================================
function initProductTabs() {
    if (!productTabs) return;
    productTabs.innerHTML = '';
    
    // Create tab buttons
    CATEGORIES.forEach(category => {
        const button = document.createElement('button');
        // Use categoryMain for filtering if necessary, but 'category' is simpler for POS.
        // We'll use the capitalized category name for the button text.
        const categoryName = category === "all" ? "All" : category;
        button.textContent = categoryName;
        button.classList.add('tab-button');
        button.dataset.category = categoryName; // Store the category name
        
        if (category === activeCategory) {
            button.classList.add('active');
            // Load products for the initial 'all' category
            loadProducts(category); 
        }

        productTabs.appendChild(button);
    });

    // Tab Switching Listener
    productTabs.addEventListener("click", (e) => {
      const target = e.target;
      if (target.classList.contains("tab-button")) {
        const category = target.dataset.category; // e.g., "All", "Drinks", "Food"

        productTabs.querySelectorAll(".tab-button").forEach(btn => btn.classList.remove("active"));
        target.classList.add("active");

        // Use category.toLowerCase() to match the 'activeCategory' state format
        loadProducts(category.toLowerCase()); 
      }
    });
}


// ====================================================
// ✅ ORDER STATUS LISTENER (MONITORS FOR CANCELLATION)
// ====================================================
function setupOrderListener() {
    const q = query(collection(db, "InStoreOrders")); 

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const order = change.doc.data();
            const orderId = change.doc.id;

            if (change.type === "modified" && order.status === "Canceled") {
                returnInventory(order.items)
                    .then(() => {
                        showMessage(`Inventory returned for order #${order.queueNumber}.`, "success");
                        // Use a new final status to prevent re-running this logic
                        updateDoc(doc(db, "InStoreOrders", orderId), {
                            status: "Canceled-Stock-Returned" 
                        });
                    })
                    .catch(e => {
                        console.error("Error returning inventory:", e);
                        showMessage("Failed to return stock for Canceled order.", "error");
                    });
            }
        });
    });
}

// ====================================================
// ✅ LOAD PRODUCTS LOGIC (FIXED CATEGORY FILTER & STOCK CALCULATION)
// ====================================================
function loadProducts(category = activeCategory) {
    activeCategory = category;

    // 1. Setup the main product query with Firestore's 'where' clause (THE FIX)
    let productQuery;
    const productsRef = collection(db, "products");
    
    // The category value must be capitalized to match the stored 'category' field
    const categoryFilterValue = activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1);

    if (activeCategory === "all") {
        productQuery = query(productsRef); // Query all for 'all' tab
    } else {
        // ⭐ THIS IS THE CRUCIAL PART FOR TAB FILTERING TO WORK ⭐
        // It filters products on the server using the capitalized category name.
        productQuery = query(productsRef, where("categoryMain", "==", categoryFilterValue));
    }

    // 2. Listen to Inventory changes (Outer OnSnapshot)
    onSnapshot(collection(db, "Inventory"), invSnap => {
        const inventoryData = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const getInv = (id) => inventoryData.find(d => d.id === id);

        // 3. Listen to Products changes based on the filtered query (Inner OnSnapshot)
        onSnapshot(productQuery, snapshot => {
            productList.innerHTML = "";

            if (snapshot.empty) {
                productList.innerHTML = `<p style="padding: 20px; color: #777;">No products found in the "${categoryFilterValue}" category.</p>`;
                return;
            }

            snapshot.forEach(docSnap => {
                const product = docSnap.data();
                product.id = docSnap.id; 
                const displayName = product.name || product.flavor;
                if (!displayName) return;
                
                // --- START STOCK LOGIC ---
                let available = true;
                let baseMinStock = Infinity;
                let productMinStock = 0;
                
                // 1. Check product-level flag
                if (product.available === false) available = false;

                // 2. Check base ingredients/others
                if (available) {
                  const rawMaterials = [...(product.ingredients || []), ...(product.others || [])];
                  for (const mat of rawMaterials) {
                    const inv = getInv(mat.id);
                    if (!inv || inv.available === false || (inv.quantity / (mat.qty || 1)) <= 0) { 
                      available = false;
                      baseMinStock = 0;
                      break;
                    }
                    baseMinStock = Math.min(baseMinStock, Math.floor(inv.quantity / (mat.qty || 1)));
                  }
                }
                
                // 3. Check sizes
                if (available && product.sizes?.length) {
                    let hasAvailableSize = false;
                    let maxCapacityAcrossSizes = 0;

                    product.sizes = product.sizes.map(s => {
                        let sizeAvailable = true;
                        let currentSizeStock = baseMinStock; 
                        const sizeInv = getInv(s.id);
                        
                        // A. Check Size item itself
                        if (!sizeInv || sizeInv.available === false || (sizeInv.quantity / (s.qty || 1)) <= 0) {
                            sizeAvailable = false;
                            currentSizeStock = 0;
                        } else {
                            currentSizeStock = Math.min(currentSizeStock, Math.floor(sizeInv.quantity / (s.qty || 1)));
                        }
                        
                        // B. Check Size's nested ingredients/others
                        if (sizeAvailable && sizeInv) {
                            const materials = [...(s.ingredients || []), ...(s.others || [])]; 
                            for (const mat of materials) {
                                const matInv = getInv(mat.id);
                                
                                if (!matInv || matInv.available === false || (matInv.quantity / (mat.qty || 1)) <= 0) {
                                    sizeAvailable = false;
                                    currentSizeStock = 0; 
                                    break;
                                }
                                currentSizeStock = Math.min(currentSizeStock, Math.floor(matInv.quantity / (mat.qty || 1)));
                            }
                        }
                        
                        if (currentSizeStock <= 0 || !sizeAvailable) {
                            sizeAvailable = false;
                            currentSizeStock = 0;
                        }

                        s.stock = currentSizeStock;
                        s.available = sizeAvailable;

                        if (sizeAvailable) {
                            hasAvailableSize = true;
                            maxCapacityAcrossSizes = Math.max(maxCapacityAcrossSizes, currentSizeStock);
                        }
                        return s;
                    });
                    
                    if (!hasAvailableSize) {
                      available = false;
                      productMinStock = 0;
                    } else {
                      productMinStock = maxCapacityAcrossSizes; 
                    }
                } else if (available) {
                  productMinStock = baseMinStock === Infinity ? 0 : baseMinStock;
                  if (productMinStock <= 0) available = false;
                } else {
                  productMinStock = 0;
                }

                // 4. Final product box creation and display
                const div = document.createElement("div");
                div.classList.add("product-box");

                const stockToDisplay = productMinStock === Infinity ? '✅' : Math.max(0, productMinStock);
                const stockText = productMinStock === Infinity ? 'In Stock' : `Stock: ${stockToDisplay}`;
                let stockColor = '#28a745';
                if (productMinStock > 0 && productMinStock <= 5) {
                  stockColor = '#ffc107';
                } else if (productMinStock <= 0) {
                  stockColor = '#dc3545';
                  available = false;
                }

                div.innerHTML = `
                  <div>${displayName}</div>
                  <small style="font-size: 0.8em; color: ${stockColor}; font-weight: bold; margin-top: 5px;">
                    ${available ? stockText : 'Out of Stock'}
                  </small>
                `;

                if (!available) {
                  div.classList.add("disabled");
                }

                div.addEventListener("click", () => {
                  if (div.classList.contains('disabled')) {
                      showMessage(`${displayName} is currently out of stock.`, "error");
                      return;
                  }
                  openProductPopup(product, displayName);
                });

                productList.appendChild(div);
            });
        });
    });
}
// --- END STOCK LOGIC ---


// ====================================================
// ✅ PRODUCT POPUP LOGIC 
// ====================================================
function openProductPopup(product, displayName) {
    selectedProduct = product;
    popupProductName.textContent = displayName;

    // Sizes
    sizeContainer.innerHTML = "";
    (product.sizes || []).forEach((s, i) => {
      const stock = s.stock === Infinity ? '✅' : Math.max(0, s.stock || 0);
      const stockColor = (s.stock === Infinity || s.stock > 5) ? 'green' : (s.stock > 0 ? 'orange' : 'red');
      const stockText = s.available ? `(Available: <span style="font-weight: bold; color: ${stockColor};">${stock}</span>)` : '(Out of Stock)';

      const wrapper = document.createElement("div");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "size";
      radio.value = s.price || 0;
      radio.dataset.name = s.name || null;
      radio.dataset.id = s.id || null;
      radio.dataset.stock = s.stock === Infinity ? Number.MAX_SAFE_INTEGER : s.stock;
      radio.id = `size_${i}`;

      if (!s.available) {
          radio.disabled = true;
          wrapper.classList.add('disabled-size');
      }

      const label = document.createElement("label");
      label.htmlFor = radio.id;
      label.innerHTML = `${s.name || "Size"} (₱${s.price || 0}) ${stockText}`;  
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

// ====================================================
// ✅ ADD TO ORDER LOGIC
// ====================================================
addToOrderBtn.addEventListener("click", () => {
    if (!selectedProduct) return;

    const qty = parseInt(quantityInput.value) || 1;
    let basePrice = 0, sizeName = null, sizeId = null, availableStock = Number.MAX_SAFE_INTEGER;

    if (selectedProduct.sizes?.length) {
      const sizeInput = document.querySelector("input[name='size']:checked");
      if (!sizeInput) return showMessage("Please select a size.", "error");

      availableStock = parseInt(sizeInput.dataset.stock);

      if (qty > availableStock) {
        return showMessage(`You can only order a maximum of ${availableStock} item(s) of this size.`, "error");
      }

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
      // Store all necessary data for inventory deduction
      ingredients: selectedProduct.ingredients || [],
      others: selectedProduct.others || [],
      productSizes: selectedProduct.sizes || [], 
      total: itemTotal
    });

    renderOrder();
    productPopup.style.display = "none";
    selectedProduct = null;
});

cancelPopupBtn.addEventListener("click", () => {
    productPopup.style.display = "none";
    selectedProduct = null;
});


// ====================================================
// ✅ ORDER RECEIPT RENDERING (CART ITEMS REMAIN VISIBLE)
// ====================================================
function renderOrder() {
    currentOrderList.innerHTML = "";
    totalPrice = 0;

    currentOrder.forEach((o, idx) => {
        const itemPrice = o.basePrice + o.addons.reduce((sum, a) => sum + a.price, 0);
        const totalItemCost = itemPrice * o.qty;

        const baseLine = `<div style="margin-left:20px;">${o.qty} × ₱${itemPrice.toFixed(2)} = ₱${totalItemCost.toFixed(2)}</div>`;
        const addonLines = o.addons.map(a => `<div style="margin-left:20px; font-size: 0.9em; color: #555;">+ ${a.name} (₱${a.price.toFixed(2)})</div>`).join("");
        
        const div = document.createElement("div");
        div.classList.add("order-item");
        
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <strong>${o.product}${o.size ? ` (${o.size})` : ""}</strong>
                    ${baseLine}
                    ${addonLines}
                </div>
                <button class="remove-btn" data-index="${idx}" style="cursor:pointer; background:none; border:none; font-size:1.2em;">❌</button>
            </div>
        `;
        currentOrderList.appendChild(div);
        totalPrice += totalItemCost; 
    });

    orderTotal.textContent = `Total: ₱${totalPrice.toFixed(2)}`;

    currentOrderList.querySelectorAll(".remove-btn").forEach(btn =>
      btn.addEventListener("click", e => {
        const itemElement = e.target.closest('.order-item');
        const indexToRemove = Array.from(currentOrderList.children).indexOf(itemElement);
        if (indexToRemove > -1) {
            currentOrder.splice(indexToRemove, 1);
            renderOrder();
        }
      })
    );
}


// ====================================================
// ✅ INVENTORY DEDUCTION & RETURN LOGIC
// ====================================================
async function manageInventory(order, type = 'deduct') {
    const action = type === 'deduct' ? -1 : 1; 
    
    const updateInventoryItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        try {
            await updateDoc(invRef, { quantity: increment(action * Math.abs(amount)) });
        } catch (e) {
            console.error(`Failed to ${type} ${amount} from ID: ${id}.`, e);
        }
    };

    for (const item of order) {
        const processMaterials = async (materials, itemQty) => {
            for (const mat of materials || []) {
                await updateInventoryItem(mat.id, (mat.qty || 1) * itemQty);
            }
        };

        // 1. BASE ingredients/others
        await processMaterials(item.ingredients, item.qty);
        await processMaterials(item.others, item.qty);
        
        // 2. SIZE item and its associated materials
        if (item.sizeId) {
            // Deduct the size item itself
            const sizeData = (item.productSizes || []).find(s => s.id === item.sizeId);
            const sizeQtyConsumed = sizeData?.qty || 1; // Use the size's quantity multiplier if available, otherwise 1
            await updateInventoryItem(item.sizeId, item.qty * sizeQtyConsumed); 
            
            // Deduct materials linked to the size
            if (sizeData) {
                await processMaterials(sizeData.ingredients, item.qty);
                await processMaterials(sizeData.others, item.qty);
            }
        }
        
        // 3. ADD-ONS and their associated raw materials (requires extra lookup)
        for (const addon of item.addons || []) {
            // Deduct the addon item itself
            const addonData = (await getDoc(doc(db, "Inventory", addon.id))).data();
            const addonQtyConsumed = addonData?.qty || 1; // Use the addon's quantity multiplier
            await updateInventoryItem(addon.id, item.qty * addonQtyConsumed); 

            // Deduct materials linked to the addon
            if (addonData) {
                await processMaterials(addonData.ingredients, item.qty);
                await processMaterials(addonData.others, item.qty);
            }
        }
    }
}

const deductInventory = (order) => manageInventory(order, 'deduct');
const returnInventory = (order) => manageInventory(order, 'return');


// ====================================================
// ✅ SAVE ORDER LOGIC
// ====================================================
async function saveOrder(paymentMethod, cash = 0) {
    try {
      if (!currentOrder.length) return showMessage("No items in order.", "error");
      if (totalPrice <= 0) return showMessage("Invalid order total.", "error");

      // Attempt to deduct inventory
      await deductInventory(currentOrder);
        
      const queueNumber = await getNextQueueNumber();
      const sanitizedOrder = currentOrder.map(item => ({
        product: item.product,
        productId: item.productId || null,
        size: item.size || null,
        sizeId: item.sizeId || null,
        qty: item.qty,
        basePrice: item.basePrice,
        addons: item.addons.map(a => ({ name: a.name || null, price: a.price || 0, id: a.id || null })),
        // Include raw material data for Canceled order recovery
        ingredients: item.ingredients || [],
        others: item.others || [],
        productSizes: item.productSizes || [], 
        total: item.total
      }));

      await addDoc(collection(db, "InStoreOrders"), {
        items: sanitizedOrder,
        total: totalPrice,
        paymentMethod,
        cashGiven: cash,
        change: cash - totalPrice,
        status: "Pending",
        queueNumber,
        createdAt: serverTimestamp()
      });

      showMessage(`Order #${queueNumber} saved successfully! Stock deducted.`, "success");

      currentOrder = [];
      renderOrder();
      closeAllPopups();

      // Reload products to reflect new stock levels immediately
      loadProducts(activeCategory);

    } catch (err) {
      console.error(err);
      // Re-run inventory check in case of partial deduction/failure before save
      loadProducts(activeCategory);
      showMessage("Failed to save order: " + err.message, "error");
    }
}

// ====================================================
// ✅ BUTTON HANDLERS
// ====================================================

// --- Main Order Buttons ---
doneOrderBtn.addEventListener("click", () => {
    if (!currentOrder.length) return showMessage("No items in the order.", "error");
    paymentPopup.style.display = "flex";
});

cancelOrderBtn.addEventListener("click", () => {
    if (!currentOrder.length) return showMessage("No items to cancel.", "error");
    cancelConfirmPopup.style.display = "flex";
});

// --- Cancel Confirmation Popup ---
cancelYesBtn.addEventListener("click", () => {
    currentOrder = [];
    renderOrder();
    closeAllPopups();
    showMessage("Order cancelled.", "success");
});

cancelNoBtn.addEventListener("click", () => cancelConfirmPopup.style.display = "none");

// --- Cash Payment Flow ---
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
    const changeAmount = cash - totalPrice;
    if (isNaN(cash) || cash < totalPrice) {
        cashChange.textContent = "Insufficient cash!";
        cashChange.style.color = "red";
        cashDoneBtn.disabled = true;
    } else {
        cashChange.textContent = `Change: ₱${changeAmount.toFixed(2)}`;
        cashChange.style.color = "green";
        cashDoneBtn.disabled = false;
    }
});

cashDoneBtn.addEventListener("click", () => {
    const cash = parseFloat(cashInput.value);
    if (isNaN(cash) || cash < totalPrice) return;
    saveOrder("Cash", cash);
});

// --- E-Payment Flow ---
epaymentBtn.addEventListener("click", () => {
    paymentPopup.style.display = "none";
    epaymentPopup.style.display = "flex";
    // Display total in e-payment popup (optional, but good for user confirmation)
    const epayTotal = epaymentPopup.querySelector("p#epayTotal");
    if(epayTotal) epayTotal.textContent = `Total: ₱${totalPrice.toFixed(2)}`;
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
