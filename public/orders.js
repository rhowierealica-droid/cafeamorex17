import { db } from './firebase-config.js';
import {
    collection, 
    addDoc,
    getDocs, 
    updateDoc, 
    doc,
    serverTimestamp, 
    onSnapshot, 
    query, 
    where, 
    orderBy, 
    limit,
    getDoc,
    increment 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

let currentOrder = [];
let selectedProduct = null;
let totalPrice = 0;
const CATEGORIES = ["all", "Drinks", "Food", "Others"]; 
let activeCategory = "all";
let globalGetInv = null; 

function showMessage(msg, type = "success") {
    messagePopup.textContent = msg;
    messagePopup.style.backgroundColor = (type === "error") ? "#e53935" : "#4caf50";
    messagePopup.classList.add("show");
    setTimeout(() => messagePopup.classList.remove("show"), 2500);
}

function closeAllPopups() {
    [productPopup, paymentPopup, cashPopup, epaymentPopup, cancelConfirmPopup].forEach(p => {
        if (p) p.style.display = "none";
    });
}

async function getNextQueueNumber() {
    const q = query(collection(db, "InStoreOrders"), orderBy("queueNumber", "desc"), limit(1));
    const snapshot = await getDocs(q);
    return !snapshot.empty ? (snapshot.docs[0].data().queueNumber || 0) + 1 : 1;
}

onAuthStateChanged(auth, (user) => {
    if (!user) return window.location.replace("login.html");
    initProductTabs();
    setupOrderListener();
});

function initProductTabs() {
    if (!productTabs) return;
    productTabs.innerHTML = '';
    
    CATEGORIES.forEach(category => {
        const button = document.createElement('button');
        const categoryName = category === "all" ? "All" : category;
        button.textContent = categoryName;
        button.classList.add('tab-button');
        button.dataset.category = categoryName;
        
        if (category === activeCategory) {
            button.classList.add('active');
            loadProducts(category); 
        }

        productTabs.appendChild(button);
    });

    productTabs.addEventListener("click", (e) => {
      const target = e.target;
      if (target.classList.contains("tab-button")) {
        const category = target.dataset.category;

        productTabs.querySelectorAll(".tab-button").forEach(btn => btn.classList.remove("active"));
        target.classList.add("active");
        loadProducts(category.toLowerCase()); 
      }
    });
}

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

/**
 * @param {Object} product 
 * @returns {boolean} 
 */
function checkSeasonalAvailability(product) {
    if (!product.is_seasonal || !product.season_start_date || !product.season_end_date) {
        return true; 
    }

    const now = new Date();
    const startDate = new Date(product.season_start_date);
    const endDate = new Date(product.season_end_date);
    
    startDate.setHours(0, 0, 0, 0); 
    endDate.setHours(23, 59, 59, 999); 

    return now >= startDate && now <= endDate;
}

/**
 * @param {object} component 
 * @param {function} getInv 
 * @returns {number}
 */
function calculateComponentLimit(component, getInv) {
    if (!component || !component.id) return Number.MAX_SAFE_INTEGER; 
    const inv = getInv(component.id);
    if (!inv || inv.available === false || Number(inv.quantity || 0) <= 0) return 0;
    
    const requiredQtyPerProduct = Math.max(Number(component.qty || 1), 1);
    
    let componentLimit = Math.floor(Number(inv.quantity || 0) / requiredQtyPerProduct);

    const internalMaterials = [...(inv.ingredients || []), ...(inv.others || [])]; 
    for (const mat of internalMaterials) {
        const matInv = getInv(mat.id);
        if (!matInv || matInv.available === false) return 0;

        const matRequiredQty = Math.max(Number(mat.qty || 1), 1);
        const matLimit = Math.floor(Number(matInv.quantity || 0) / matRequiredQty);
        componentLimit = Math.min(componentLimit, matLimit);

        if (componentLimit === 0) return 0;
    }

    return componentLimit;
}

function loadProducts(category = activeCategory) {
    activeCategory = category;

    let productQuery;
    const productsRef = collection(db, "products");
    const categoryFilterValue = activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1);

    if (activeCategory === "all") {
        productQuery = query(productsRef); 
    } else {
        productQuery = query(productsRef, where("categoryMain", "==", categoryFilterValue));
    }

    onSnapshot(collection(db, "Inventory"), invSnap => {
        const inventoryData = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Inventory ID
        const getInv = (id) => inventoryData.find(d => d.id === id);
        globalGetInv = getInv; 

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
                
                // Check seasonal availability first
                const isSeasonallyAvailable = checkSeasonalAvailability(product);
                
                // If the product is seasonal but currently inactive
                if (product.is_seasonal && !isSeasonallyAvailable) {
                    return; 
                }

                let available = true;
                let baseMinStock = Number.MAX_SAFE_INTEGER;
                let productMinStock = 0;
                
                if (product.available === false) available = false;

                // Check ingredient/other stock
                if (available) {
                    const rawMaterials = [...(product.ingredients || []), ...(product.others || [])];
                    for (const mat of rawMaterials) {
                        const limit = calculateComponentLimit(mat, getInv);
                        baseMinStock = Math.min(baseMinStock, limit);
                        if (baseMinStock === 0) {
                            available = false;
                            break;
                        }
                    }
                }
                
                if (available && product.sizes?.length) {
                    let hasAvailableSize = false;
                    let maxCapacityAcrossSizes = 0;

                    product.sizes = product.sizes.map(s => {
                        let sizeAvailable = true;
                        let currentSizeStock = baseMinStock; 
                        
                        if (s.id) {
                            const sizeInvItem = getInv(s.id);
                            if (sizeInvItem) {
                                const sizeLimit = calculateComponentLimit({id: s.id, qty: s.qty || 1}, getInv);
                                currentSizeStock = Math.min(currentSizeStock, sizeLimit);
                            }
                        }

                        const materials = [...(s.ingredients || []), ...(s.others || [])]; 
                        for (const mat of materials) {
                            const limit = calculateComponentLimit(mat, getInv);
                            currentSizeStock = Math.min(currentSizeStock, limit);
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
                    productMinStock = baseMinStock === Number.MAX_SAFE_INTEGER ? 0 : baseMinStock;
                    if (productMinStock <= 0) available = false;
                } else {
                    productMinStock = 0;
                }
                
                if (!available) {
                }

                const div = document.createElement("div");
                div.classList.add("product-box");

                const stockToDisplay = productMinStock === Number.MAX_SAFE_INTEGER ? '✅' : Math.max(0, productMinStock);
                const stockText = productMinStock === Number.MAX_SAFE_INTEGER ? 'In Stock' : ``;
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
                    openProductPopup(product, displayName, getInv); 
                });

                productList.appendChild(div);
            });
        });
    });
}

/**
 * @param {string} sizeName 
 * @param {function} getInv 
 */
function renderAddonsForSelectedSize(sizeName, getInv) {
    addonContainer.innerHTML = "";
    if (!selectedProduct || !getInv) return;

    const selectedSize = selectedProduct.sizes.find(s => s.name === sizeName);
    if (!selectedSize) return;

    const addons = selectedSize.addons || [];
    
    if (addons.length) {
        const h4 = document.createElement("h4");
        h4.textContent = "Add-ons (optional):";
        addonContainer.appendChild(h4);

        addons.forEach((a, i) => {
            const addonInv = getInv(a.id);
            let addonAvailable = true;
            // Adds on stock calculation 
            let addonStock = Number.MAX_SAFE_INTEGER; 

            if (!addonInv || addonInv.available === false) {
                addonAvailable = false;
                addonStock = 0;
            } else {
                addonStock = calculateComponentLimit(a, getInv); 
            }

            if (addonStock <= 0 || !addonAvailable) {
                addonAvailable = false;
                addonStock = 0;
            }

            const stockToDisplay = Math.max(0, addonStock);
            const stockColor = (addonStock > 5) ? 'green' : (addonStock > 0 ? 'orange' : 'red');
            const stockText = addonAvailable ? 
                `(Stock: <span style="font-weight: bold; color: ${stockColor};">${stockToDisplay}</span>)` : 
                '(Out of Stock)';

            const wrapper = document.createElement("div");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = a.price || 0;
            checkbox.dataset.name = a.name || null;
            checkbox.dataset.id = a.id || null;
            checkbox.dataset.stock = stockToDisplay; 
            checkbox.dataset.qty = a.qty || 1; 
            checkbox.id = `addon_${sizeName}_${i}`;
            
            if (!addonAvailable) {
                checkbox.disabled = true;
                wrapper.classList.add('disabled-addon');
            }

            const label = document.createElement("label");
            label.htmlFor = checkbox.id;
            // Display the stock
            label.innerHTML = `${a.name || "Addon"} (₱${a.price || 0}) ${stockText}`;
            wrapper.append(checkbox, label);
            addonContainer.appendChild(wrapper);
        });
    }
}

function openProductPopup(product, displayName, getInv) {
    selectedProduct = product;
    popupProductName.textContent = displayName;

    sizeContainer.innerHTML = "";
    
    (product.sizes || []).forEach((s, i) => {
      const stock = s.stock === Number.MAX_SAFE_INTEGER ? '✅' : Math.max(0, s.stock || 0);
      const stockColor = (s.stock === Number.MAX_SAFE_INTEGER || s.stock > 5) ? 'green' : (s.stock > 0 ? 'orange' : 'red');
      const stockText = s.available ? `` : '(Out of Stock)';

      const wrapper = document.createElement("div");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "size";
      radio.value = s.price || 0;
      radio.dataset.name = s.name || null;
      radio.dataset.id = s.id || null;
      radio.dataset.qty = s.qty || 1;
      radio.dataset.stock = s.stock === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : s.stock;
      radio.id = `size_${i}`;

      if (!s.available) {
          radio.disabled = true;
          wrapper.classList.add('disabled-size');
      }

      radio.addEventListener('change', (e) => {
        renderAddonsForSelectedSize(e.target.dataset.name, getInv);
      });

      const label = document.createElement("label");
      label.htmlFor = radio.id;
      label.innerHTML = `${s.name || "Size"} (₱${s.price || 0}) ${stockText}`;  
      wrapper.append(radio, label);
      sizeContainer.appendChild(wrapper);
    });

    addonContainer.innerHTML = "";

    const sizeRadios = sizeContainer.querySelectorAll("input[name='size']");
    let firstAvailableSizeName = null;

    for (const radio of sizeRadios) {
        if (!radio.disabled) {
            radio.checked = true; 
            firstAvailableSizeName = radio.dataset.name;
            break; 
        }
    }

    if (firstAvailableSizeName) {
        renderAddonsForSelectedSize(firstAvailableSizeName, getInv);
    }

    quantityInput.value = 1;
    productPopup.style.display = "flex";
}

addToOrderBtn.addEventListener("click", () => {
    if (!selectedProduct) return;

    const qty = parseInt(quantityInput.value) || 1;
    let basePrice = 0, sizeName = null, sizeId = null, availableStock = Number.MAX_SAFE_INTEGER;
    let selectedSizeObj = null; 
    let sizeQty = 1;

    if (selectedProduct.sizes?.length) {
      const sizeInput = document.querySelector("input[name='size']:checked");
      if (!sizeInput) return showMessage("Please select a size.", "error");

      availableStock = parseInt(sizeInput.dataset.stock);
      sizeQty = parseInt(sizeInput.dataset.qty);

      if (qty > availableStock) {
        return showMessage(`You can only order a maximum of ${availableStock} item(s) of this size due to ingredient or container stock.`, "error");
      }

      basePrice = parseFloat(sizeInput.value) || 0;
      sizeName = sizeInput.dataset.name || null;
      sizeId = sizeInput.dataset.id || null;
      selectedSizeObj = selectedProduct.sizes.find(s => s.name === sizeName); 
    }

    const addons = [];
    let addonsPrice = 0;
    
    // Adds on stock
    const checkedAddons = addonContainer.querySelectorAll("input[type='checkbox']:checked");
    
    for (const cb of checkedAddons) {
        const addonStock = parseInt(cb.dataset.stock);
        const addonQty = parseInt(cb.dataset.qty);

        if (qty > addonStock) { 
            return showMessage(`You can only order a maximum of ${addonStock} item(s) because of the '${cb.dataset.name}' add-on's stock limitation.`, "error");
        }
        
        const price = parseFloat(cb.value) || 0;
        addons.push({ 
            name: cb.dataset.name || null, 
            price, 
            id: cb.dataset.id || null, 
            qty: addonQty || 1 
        }); 
        addonsPrice += price;
    }

    const itemTotal = (basePrice + addonsPrice) * qty;
    currentOrder.push({
      product: selectedProduct.name || selectedProduct.flavor || "Unknown",
      productId: selectedProduct.id || null,
      size: sizeName,
      sizeId,
      sizeQty,
      qty,
      basePrice,
      addons,
      ingredients: selectedSizeObj?.ingredients || selectedProduct.ingredients || [],
      others: selectedSizeObj?.others || selectedProduct.others || [],
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

/**
 * @param {Array<object>} order 
 * @param {'deduct'|'return'} type 
 */
async function manageInventory(order, type = 'deduct') {
    const action = type === 'deduct' ? -1 : 1; 
    const getInv = globalGetInv; 
    
    const updateInventoryItem = async (id, amount) => {
        if (!id) return;
        const invRef = doc(db, "Inventory", id);
        try {
            await updateDoc(invRef, { quantity: increment(action * Math.abs(amount)) });
        } catch (e) {
            console.error(`Failed to ${type} ${amount} from ID: ${id}.`, e);
            throw new Error(`Inventory update failed for item ID: ${id}.`); 
        }
    };

    for (const item of order) {
        const itemQty = item.qty; // Quantity of the product ordered 
        
        const processInternalMaterials = async (componentId, itemQty) => {
            const componentInv = getInv(componentId);
            if (!componentInv) return;

            const materials = [...(componentInv.ingredients || []), ...(componentInv.others || [])]; 
            for (const mat of materials) {
                const totalConsumption = (mat.qty || 1) * itemQty;
                await updateInventoryItem(mat.id, totalConsumption);
            }
        };

        const processMaterials = async (materials, itemQty) => {
            for (const mat of materials || []) {
                const totalConsumption = (mat.qty || 1) * itemQty;
                await updateInventoryItem(mat.id, totalConsumption);
            }
        };

        await processMaterials(item.ingredients, itemQty);
        await processMaterials(item.others, itemQty);
        
        if (item.sizeId) {
            const sizeQtyConsumed = item.sizeQty || 1; 
            // Deduct the size 
            await updateInventoryItem(item.sizeId, itemQty * sizeQtyConsumed); 
            // Deduct the ingredients/others 
            await processInternalMaterials(item.sizeId, itemQty);
        }
        
        for (const addon of item.addons || []) {
            const addonQtyConsumed = addon.qty || 1; 
            // Deduct the addon
            await updateInventoryItem(addon.id, itemQty * addonQtyConsumed); 
            // Deduct the ingredients/others 
            await processInternalMaterials(addon.id, itemQty);
        }
    }
}

const deductInventory = (order) => manageInventory(order, 'deduct');
const returnInventory = (order) => manageInventory(order, 'return');

async function saveOrder(paymentMethod, cash = 0) {
    try {
      if (!currentOrder.length) return showMessage("No items in order.", "error");
      if (totalPrice <= 0) return showMessage("Invalid order total.", "error");

      await deductInventory(currentOrder);
        
      // Order History
      const queueNumber = await getNextQueueNumber();
      const sanitizedOrder = currentOrder.map(item => ({
        product: item.product,
        productId: item.productId || null,
        size: item.size || null,
        sizeId: item.sizeId || null,
        qty: item.qty,
        basePrice: item.basePrice,
        addons: item.addons.map(a => ({ name: a.name || null, price: a.price || 0, id: a.id || null, qty: a.qty || 1 })),
        sizeQty: item.sizeQty || 1,
        ingredients: item.ingredients || [],
        others: item.others || [],
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

      showMessage(`Order #${queueNumber} successfully!`, "success");

      currentOrder = [];
      renderOrder();
      closeAllPopups();

      loadProducts(activeCategory);

    } catch (err) {
      console.error(err);
      // Return Stock
      showMessage("Attempting to revert stock...", "error");
      await returnInventory(currentOrder)
          .then(() => showMessage("Failed to save order. Stock reverted successfully.", "error"))
          .catch(e => console.error("CRITICAL: Failed to return stock after failed save:", e));
          
      loadProducts(activeCategory);
    }
}

doneOrderBtn.addEventListener("click", () => {
    if (!currentOrder.length) return showMessage("No items in order.", "error");
    paymentPopup.style.display = "flex";
});

cancelOrderBtn.addEventListener("click", () => {
    if (!currentOrder.length) return showMessage("No items to cancel.", "error");
    cancelConfirmPopup.style.display = "flex";
});

cancelYesBtn.addEventListener("click", () => {
    currentOrder = [];
    renderOrder();
    closeAllPopups();
    showMessage("Order cancelled.", "success");
});

cancelNoBtn.addEventListener("click", () => cancelConfirmPopup.style.display = "none");

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


epaymentBtn.addEventListener("click", () => {
    paymentPopup.style.display = "none";
    epaymentPopup.style.display = "flex";
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
