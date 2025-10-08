// --- imports ---
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, updateDoc, doc,
  serverTimestamp, onSnapshot, query, orderBy, limit, getDoc,
  increment // <--- CRITICAL FOR DEDUCTION & RETURN
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// --- DOM Elements ---
const auth = getAuth();
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

// ----------------------------------------------------
// ✅ AUTHENTICATION AND INITIALIZATION BLOCK
// ----------------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // No user logged in -> redirect to login immediately
    window.location.replace("login.html");
    return;
  }

  // User is logged in -> initialize app
  loadProducts();
  // ✅ NEW: Start listening for order status changes to handle cancellations
  setupOrderListener(); 
});

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

// ----------------------------------------------------
// ✅ ORDER STATUS LISTENER (MONITORS FOR CANCELLATION)
// ----------------------------------------------------
function setupOrderListener() {
    // Listens for any changes across all orders
    const q = query(collection(db, "InStoreOrders")); 

    onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const order = change.doc.data();
            const orderId = change.doc.id;

            // Check if a document was modified and the status is now Canceled
            if (change.type === "modified" && order.status === "Canceled") {
                console.log(`Order ${orderId} was CANCELED. Returning inventory...`);
                
                // Trigger the stock return logic
                returnInventory(order.items)
                    .then(() => {
                        showMessage(`Inventory returned for order #${order.queueNumber}.`, "success");
                        // Update the status to prevent running the return logic again
                        updateDoc(doc(db, "InStoreOrders", orderId), {
                            status: "StockReturned"
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
// ----------------------------------------------------

// ----------------------------------------------------
// ✅ CORRECTED LOAD PRODUCTS LOGIC (FIXED STOCK CALCULATION AND SAVING SIZE STOCK)
// ----------------------------------------------------
function loadProducts() {
  onSnapshot(collection(db, "Inventory"), invSnap => {
    const inventoryData = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Helper function to quickly look up inventory data by ID
    const getInv = (id) => inventoryData.find(d => d.id === id);

    onSnapshot(collection(db, "products"), snapshot => {
      productList.innerHTML = "";

      snapshot.forEach(docSnap => {
        const product = docSnap.data();
        // Ensure ID is part of the product object for later reference
        product.id = docSnap.id; 
        const displayName = product.name || product.flavor;
        if (!displayName) return;

        // --- Stock Calculation Variables ---
        let available = true;
        let baseMinStock = Infinity; // To hold the minimum possible stock from product-level ingredients

        // 1. Check product-level flag
        if (product.available === false) available = false;

        // 2. Check base ingredients/others
        if (available) {
          const rawMaterials = [...(product.ingredients || []), ...(product.others || [])];
          for (const mat of rawMaterials) {
            const inv = getInv(mat.id);
            
            // Check if item is missing or explicitly unavailable
            if (!inv || inv.available === false) { 
              available = false;
              baseMinStock = 0;
              break;
            }
            
            // Update baseMinStock based on raw materials
            const requiredQty = mat.qty || 1;
            const maxPossible = Math.floor(inv.quantity / requiredQty);
            baseMinStock = Math.min(baseMinStock, maxPossible);
            if (baseMinStock <= 0) { available = false; break; }
          }
        }
        
        // 3. Check and determine the overall product stock (minStock)
        let productMinStock = 0; // The FINAL stock number displayed
        
        if (available && product.sizes?.length) {
            let hasAvailableSize = false;
            let maxCapacityAcrossSizes = 0; // Max stock of any available size

            // Map over sizes to calculate stock for each and store it
            product.sizes = product.sizes.map(s => {
                let sizeAvailable = true;
                // Start the size limit with the base product ingredients limit
                let currentSizeStock = baseMinStock; 
                
                const sizeInv = getInv(s.id);
                
                // A. Check Size item itself (e.g., the cup/container)
                if (!sizeInv || sizeInv.available === false) {
                    sizeAvailable = false;
                    currentSizeStock = 0;
                } else {
                    // NOTE: We assume the size container itself is consumed 1:1 (qty of 1)
                    const requiredQty = s.qty || 1; 
                    const maxPossible = Math.floor(sizeInv.quantity / requiredQty);
                    currentSizeStock = Math.min(currentSizeStock, maxPossible);
                }
                
                // B. Check Size's nested ingredients/others (materials required *per size item*)
                if (sizeAvailable && sizeInv) {
                    // Get the size's nested materials from the product object's size array
                    const materials = [...(s.ingredients || []), ...(s.others || [])]; 
                    for (const mat of materials) {
                        const matInv = getInv(mat.id);
                        
                        if (!matInv || matInv.available === false) {
                            sizeAvailable = false;
                            currentSizeStock = 0; 
                            break;
                        }
                        
                        const requiredQty = mat.qty || 1;
                        const maxPossible = Math.floor(matInv.quantity / requiredQty);
                        currentSizeStock = Math.min(currentSizeStock, maxPossible);
                    }
                }
                
                // Final check for size availability
                if (currentSizeStock <= 0 || !sizeAvailable) {
                  sizeAvailable = false;
                  currentSizeStock = 0;
                }

                // ✅ Store the calculated stock and availability for use in the popup
                s.stock = currentSizeStock;
                s.available = sizeAvailable;

                if (sizeAvailable) {
                    hasAvailableSize = true;
                    // Take the highest capacity size as the overall product stock.
                    maxCapacityAcrossSizes = Math.max(maxCapacityAcrossSizes, currentSizeStock);
                }

                return s; // Return the size object with new stock data
            });
            
            if (!hasAvailableSize) {
              available = false;
              productMinStock = 0;
            } else {
              // Use the calculated max capacity of available sizes
              productMinStock = maxCapacityAcrossSizes; 
            }
        } else if (available) {
          // For products without sizes, the baseMinStock is the final stock.
          productMinStock = baseMinStock === Infinity ? 0 : baseMinStock;
          if (productMinStock <= 0) available = false;
        } else {
          productMinStock = 0;
        }

        // 4. Final product box creation and display
        const div = document.createElement("div");
        div.classList.add("product-box");

        // Determine the stock display
        const stockToDisplay = productMinStock === Infinity ? '✅' : Math.max(0, productMinStock);
        const stockText = productMinStock === Infinity ? 'In Stock' : `Stock: ${stockToDisplay}`;
        
        // Color-code the stock text
        let stockColor = '#28a745'; // Green for high stock (or infinite)
        if (productMinStock > 0 && productMinStock <= 5) {
          stockColor = '#ffc107'; // Yellow for low stock
        } else if (productMinStock <= 0) {
          stockColor = '#dc3545'; // Red for out of stock
          available = false; // Ensure product is marked unavailable if stock is 0
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

        // 👇 Attach listener to ALL product boxes
        div.addEventListener("click", () => {
         // 🛑 Check if the product box is disabled
          if (div.classList.contains('disabled')) {
              showMessage(`${displayName} is currently out of stock.`, "error");
              return; // Stop the function immediately
          }
          openProductPopup(product, displayName);
        });

        productList.appendChild(div);
      });
    });
  });
}
// ----------------------------------------------------

// --- Open product popup ---
function openProductPopup(product, displayName) {
  selectedProduct = product;
  popupProductName.textContent = displayName;

  // Sizes
  sizeContainer.innerHTML = "";
  (product.sizes || []).forEach((s, i) => {
    // Determine stock display for the size
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
    // ⭐ NEW: Store the calculated stock on the radio button
    radio.dataset.stock = s.stock === Infinity ? Number.MAX_SAFE_INTEGER : s.stock;
    radio.id = `size_${i}`;

    // Disable the radio button if the size is not available
    if (!s.available) {
        radio.disabled = true;
        wrapper.classList.add('disabled-size');
    }

    const label = document.createElement("label");
    label.htmlFor = radio.id;
    // ✅ Updated label to include the stock information (renamed 'Stock' to 'Available')
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

// --- Close popup ---
cancelPopupBtn.addEventListener("click", () => {
  productPopup.style.display = "none";
  selectedProduct = null;
});

// --- Add to order ---
addToOrderBtn.addEventListener("click", () => {
  if (!selectedProduct) return;

  const qty = parseInt(quantityInput.value) || 1;
  let basePrice = 0, sizeName = null, sizeId = null, availableStock = 0;

  if (selectedProduct.sizes?.length) {
    const sizeInput = document.querySelector("input[name='size']:checked");
    if (!sizeInput) return showMessage("Please select a size.", "error");

    // ⭐ NEW: Get the stock limit for the selected size
    availableStock = parseInt(sizeInput.dataset.stock);

    // ⭐ NEW: Validate the quantity against the stock limit
    if (qty > availableStock) {
        return showMessage(`You can only order a maximum of ${availableStock} item(s) of this size.`, "error");
    }

    basePrice = parseFloat(sizeInput.value) || 0;
    sizeName = sizeInput.dataset.name || null;
    sizeId = sizeInput.dataset.id || null;
  } else {
    // For products without sizes, a more complex stock check would be needed, 
    // but for simplicity, we assume the initial 'disabled' check is enough here.
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
    // Pass the base ingredients/others from the product to the order item for deduction
    ingredients: selectedProduct.ingredients || [],
    others: selectedProduct.others || [],
    // ✅ FIX: Save the entire sizes array for later deduction/return lookup
    productSizes: selectedProduct.sizes || [], 
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

// ----------------------------------------------------
// ✅ DEDUCT INVENTORY LOGIC (CRITICAL FOR STOCK CONTROL)
// ----------------------------------------------------
async function deductInventory(order) {
    // Helper function to safely deduct from inventory using the imported increment
    const deductItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        try {
            // Use the imported increment() function for atomic update
            await updateDoc(invRef, { quantity: increment(-Math.abs(amount)) });
        } catch (e) {
            console.error(`Failed to deduct ${amount} from ID: ${id}. Ensure the Inventory doc exists.`, e);
        }
    };
    
    for (const item of order) {
        // 1. Deduct all BASE ingredients/others required for the product (passed in the order item)
        for (const ing of item.ingredients || []) {
            await deductItem(ing.id, (ing.qty || 1) * item.qty);
        }
        for (const other of item.others || []) {
            await deductItem(other.id, (other.qty || 1) * item.qty);
        }
        
        // 2. Deduct the SIZE item itself (e.g., the cup) and its associated raw materials
        if (item.sizeId) {
            // A. Deduct the inventory item representing the size (e.g., 1 cup for 1 product)
            // For simplicity, we deduct item.qty based on the item's purchase quantity
            await deductItem(item.sizeId, item.qty); 
            
            // B. Look up the size item's NESTED raw material requirements from the saved productSizes
            const productSizeData = (item.productSizes || []).find(s => s.id === item.sizeId);

            if (productSizeData) {
                // Deduct ingredients/others associated with the SIZE
                for (const ing of productSizeData.ingredients || []) {
                    await deductItem(ing.id, (ing.qty || 1) * item.qty);
                }
                for (const other of productSizeData.others || []) {
                    await deductItem(other.id, (other.qty || 1) * item.qty);
                }
            }
        }
        
        // 3. Deduct ADD-ONS
        for (const addon of item.addons || []) {
            // A. Deduct the inventory item representing the addon itself
            await deductItem(addon.id, item.qty); 

            // B. Look up the add-on item's NESTED raw material requirements from Inventory
            const addonSnap = await getDoc(doc(db, "Inventory", addon.id));
            const addonData = addonSnap.data();

            if (addonData) {
                // Deduct ingredients/others associated with the ADDON
                for (const ing of addonData.ingredients || []) {
                    await deductItem(ing.id, (ing.qty || 1) * item.qty);
                }
                for (const other of addonData.others || []) {
                    await deductItem(other.id, (other.qty || 1) * item.qty);
                }
            }
        }
    }
}
// ----------------------------------------------------

// ----------------------------------------------------
// ✅ NEW: RETURN INVENTORY LOGIC (REVERSE OF DEDUCT)
// ----------------------------------------------------
async function returnInventory(order) {
    // Helper function to safely return to inventory using the imported increment
    const returnItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        try {
            // Use the imported increment() function to add stock back
            await updateDoc(invRef, { quantity: increment(Math.abs(amount)) });
        } catch (e) {
            console.error(`Failed to return ${amount} to ID: ${id}.`, e);
        }
    };
    
    for (const item of order) {
        // 1. Return all BASE ingredients/others
        for (const ing of item.ingredients || []) {
            await returnItem(ing.id, (ing.qty || 1) * item.qty);
        }
        for (const other of item.others || []) {
            await returnItem(other.id, (other.qty || 1) * item.qty);
        }
        
        // 2. Return the SIZE item itself and its associated raw materials
        if (item.sizeId) {
            // A. Return the inventory item representing the size (e.g., the cup)
            await returnItem(item.sizeId, item.qty); 
            
            // B. Look up the size item's NESTED raw material requirements from the saved productSizes
            const productSizeData = (item.productSizes || []).find(s => s.id === item.sizeId);

            if (productSizeData) {
                // Return ingredients/others associated with the SIZE
                for (const ing of productSizeData.ingredients || []) {
                    await returnItem(ing.id, (ing.qty || 1) * item.qty);
                }
                for (const other of productSizeData.others || []) {
                    await returnItem(other.id, (other.qty || 1) * item.qty);
                }
            }
        }
        
        // 3. Return ADD-ONS
        for (const addon of item.addons || []) {
            // A. Return the inventory item representing the addon itself
            await returnItem(addon.id, item.qty); 

            // B. Look up the add-on item's NESTED raw material requirements from Inventory
            const addonSnap = await getDoc(doc(db, "Inventory", addon.id));
            const addonData = addonSnap.data();

            if (addonData) {
                // Return ingredients/others associated with the ADDON
                for (const ing of addonData.ingredients || []) {
                    await returnItem(ing.id, (ing.qty || 1) * item.qty);
                }
                for (const other of addonData.others || []) {
                    await returnItem(other.id, (other.qty || 1) * item.qty);
                }
            }
        }
    }
}
// ----------------------------------------------------

// --- Save order ---
async function saveOrder(paymentMethod, cash = 0) {
  try {
    if (!currentOrder.length) return showMessage("No items in order.", "error");
    if (totalPrice <= 0) return showMessage("Invalid order total.", "error");

    // Deduction happens here, so status should be Pending
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
      // The ingredients/others are saved for historical record of what was required
      ingredients: item.ingredients || [],
      others: item.others || [],
      // ✅ Included productSizes for historical record and future return logic
      productSizes: item.productSizes || [], 
      total: item.total
    }));

    await addDoc(collection(db, "InStoreOrders"), {
      items: sanitizedOrder,
      total: totalPrice,
      paymentMethod,
      cashGiven: cash,
      change: cash - totalPrice,
      status: "Pending", // Status is Pending after deduction
      queueNumber,
      createdAt: serverTimestamp()
    });

    showMessage("Order saved successfully! Stock deducted.", "success");

    currentOrder = [];
    renderOrder();
    closeAllPopups();

    // Force a product list refresh to show updated stock immediately after order is saved
    loadProducts();

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
