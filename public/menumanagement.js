// ===============================
// menumanagement.js - SHORTENED & MODIFIED
// ===============================

// --- Firebase Imports Consolidation ---
import { db } from './firebase-config.js';
import * as firestore from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp } = firestore;

// --- DOM Selectors Consolidation ---
const D = {
    auth: getAuth(),
    popup: document.getElementById("popup"),
    popupTitle: document.getElementById("popupTitle"),
    popupForm: document.getElementById("popupForm"),
    productName: document.getElementById("productName"),
    productSubCategory: document.getElementById("productSubCategory"),
    productDescription: document.getElementById("productDescription"),
    productImage: document.getElementById("productImage"),
    previewImage: document.getElementById("previewImage"),
    cropperModal: document.getElementById("cropperModal"),
    imageToCrop: document.getElementById("imageToCrop"),
    cropAndSaveBtn: document.getElementById("cropAndSaveBtn"),
    closeCropperBtn: document.getElementById("closeCropperBtn"),
    ingredientsList: document.getElementById("ingredientsList"),
    sizesList: document.getElementById("sizesList"),
    addonsList: document.getElementById("addonsList"),
    othersList: document.getElementById("othersList"),
    drinksTable: document.getElementById("drinksTable"),
    foodTable: document.getElementById("foodTable"),
    othersTable: document.getElementById("othersTable"),
    filterButtons: document.querySelectorAll(".filterBtn"),
    drinksFilter: document.getElementById("drinksFilter"),
    foodFilter: document.getElementById("foodFilter"),
    othersFilter: document.getElementById("othersFilter"),
    deletePopup: document.getElementById("deletePopup"),
    confirmDeleteBtn: document.getElementById("confirmDeleteBtn"),
    cancelDeleteBtn: document.getElementById("cancelDeleteBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
};

// --- Per Size Container Setup ---
const perSizeContainer = document.getElementById("perSizeContainer") || document.createElement("div");
perSizeContainer.id = "perSizeContainer";
const formScroll = D.popupForm.querySelector(".form-scroll");
(formScroll || D.popupForm).appendChild(perSizeContainer);

// --- State ---
let editingProductId = null;
let currentMainCategory = null;
let currentSubCategory = null;
let inventoryMap = {};
let selectedIngredients = [];
let selectedAddons = [];
let selectedOthers = [];
let base64Image = "";
let perSizeData = {};
let globalAddonsData = {};
let cropper = null;
let activeFilter = null;
let productToDelete = null;
let unsubscribeProducts = null;

// --- Utility Functions ---

/** Creates and displays a temporary popup message. */
const showPopupMessage = (function() {
    const el = document.createElement("div");
    el.id = "messagePopup";
    el.style.cssText = `position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #f44336; color: #fff; padding: 10px 20px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 9999; display: none;`;
    document.body.appendChild(el);
    return (message, duration = 3000) => {
        el.textContent = message;
        el.style.display = "block";
        setTimeout(() => { el.style.display = "none"; }, duration);
    };
})();

/** Normalizes a category string. */
function normalizeCategory(cat) {
    if (!cat) return { main: "Others", sub: "Others" };
    const c = cat.toLowerCase();
    const drinks = ["coffee", "espresso", "tea", "drink", "juice"];
    const food = ["sandwich", "burger", "wrap", "snack"];

    if (drinks.some(k => c.includes(k))) {
        if (c.includes("ice espresso")) return { main: "Drinks", sub: "Ice Espresso" };
        if (c.includes("non coffee")) return { main: "Drinks", sub: "Non Coffee" };
        if (c.includes("iced cold brew")) return { main: "Drinks", sub: "Iced Cold Brew" };
        if (c.includes("hot coffee")) return { main: "Drinks", sub: "Hot Coffee" };
        return { main: "Drinks", sub: "Others" };
    }
    if (food.some(k => c.includes(k))) {
        if (c.includes("sandwich")) return { main: "Food", sub: "Sandwiches" };
        if (c.includes("burger")) return { main: "Food", sub: "Burger" };
        if (c.includes("snack")) return { main: "Food", sub: "Snack" };
        return { main: "Food", sub: "Others" };
    }
    return { main: "Others", sub: "Others" };
}

// --- Popup Management ---
const openPopup = () => D.popup.classList.add("show");
const closePopup = () => D.popup.classList.remove("show");
D.cancelBtn.addEventListener("click", closePopup);
window.addEventListener("click", e => { if (e.target === D.popup) closePopup(); });
D.productSubCategory.addEventListener("change", () => { currentSubCategory = D.productSubCategory.value; });


// --- Cropper Logic ---
function initCropper() {
    if (cropper) cropper.destroy();
    cropper = new Cropper(D.imageToCrop, {
        aspectRatio: 9 / 16, resizable: false, movable: true, zoomable: true,
        viewMode: 1, autoCropArea: 1.0, minCropBoxWidth: 90, minCropBoxHeight: 160,
    });
}
D.productImage.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => { D.imageToCrop.src = reader.result; D.cropperModal.classList.add("show"); initCropper(); };
        reader.readAsDataURL(file);
    }
});
D.cropAndSaveBtn.addEventListener("click", () => {
    if (cropper) {
        const OUTPUT_WIDTH = 450;
        const OUTPUT_HEIGHT = 800;
        base64Image = cropper.getCroppedCanvas({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, fillColor: '#fff', }).toDataURL('image/jpeg');
        D.previewImage.src = base64Image;
        D.previewImage.style.display = "block";
        D.productImage.value = null;
        D.cropperModal.classList.remove("show");
        cropper.destroy(); cropper = null;
    }
});
[D.closeCropperBtn, D.cropperModal].forEach(el => el.addEventListener("click", e => {
    if (e.target === D.closeCropperBtn || e.target === D.cropperModal) {
        D.cropperModal.classList.remove("show");
        if (cropper) { cropper.destroy(); cropper = null; }
        D.productImage.value = null;
    }
}));

// --- Delete Product Logic ---
const openDeletePopup = id => { productToDelete = id; D.deletePopup.classList.add("show"); };
const closeDeletePopup = () => { productToDelete = null; D.deletePopup.classList.remove("show"); };
D.cancelDeleteBtn.addEventListener("click", closeDeletePopup);
window.addEventListener("click", e => { if (e.target === D.deletePopup) closeDeletePopup(); });
D.confirmDeleteBtn.addEventListener("click", async () => {
    if (!productToDelete) return;
    try {
        await deleteDoc(doc(db, "products", productToDelete));
        showPopupMessage("Product deleted successfully.");
    } catch (err) {
        showPopupMessage("Error: " + err.message);
    } finally {
        closeDeletePopup();
    }
});

// --- Inventory & Per-Size Logic Refactored ---

function addInventoryHeader(container, type) {
    const header = document.createElement("div");
    header.classList.add("inventory-header");
    header.innerHTML = (type === "Sizes" || type === "Adds-on")
        ? `<span></span><span>Name</span><span>Qty</span><span>Unit</span><span>Price</span>`
        : `<span></span><span>Name</span>`;
    container.appendChild(header);
}

function setupInventoryRowListeners(id, item, checkbox, qtyInput, priceInput) {
    if (!checkbox) return;

    checkbox.addEventListener("change", () => {
        const checked = checkbox.checked;
        const stateArray = item.category === "Ingredients" ? selectedIngredients : item.category === "Adds-on" ? selectedAddons : selectedOthers;

        if (checked) {
            if (!stateArray.includes(id)) stateArray.push(id);
        } else {
            const index = stateArray.indexOf(id);
            if (index > -1) stateArray.splice(index, 1);
        }

        if (qtyInput) qtyInput.disabled = !checked;
        if (priceInput) priceInput.disabled = !checked;
        generatePerSizeSections();
    });

    if (item.category === "Adds-on") {
        const updateAddonData = () => {
            globalAddonsData[id] = globalAddonsData[id] || {};
            if (qtyInput) globalAddonsData[id].qty = parseFloat(qtyInput.value) || 0; // Starts at 0
            if (priceInput) globalAddonsData[id].price = parseFloat(priceInput.value) || 0; // Starts at 0
            generatePerSizeSections();
        };
        if (qtyInput) qtyInput.addEventListener("input", updateAddonData);
        if (priceInput) priceInput.addEventListener("input", updateAddonData);
    }
}

function createInventoryRow(id, item) {
    const isDisabled = !item.active || Number(item.quantity) <= 0;
    const div = document.createElement("div");
    div.classList.add("inventory-row", item.category.toLowerCase().replace('-', '') + "-row");
    if (isDisabled) { div.style.opacity = "0.5"; div.title = "Out of Stock"; }

    let checkboxHTML = "";
    let savedQty = 0; // Starts at 0
    let savedPrice = 0; // Starts at 0

    switch (item.category) {
        case "Ingredients":
        case "Others":
            const cls = item.category === "Ingredients" ? "ingredient-checkbox" : "other-checkbox";
            checkboxHTML = `<input type="checkbox" class="${cls}" value="${id}" ${isDisabled ? "disabled" : ""}>${item.name}`;
            break;
        case "Sizes":
            // For sizes, use values from product data or default to 0
            checkboxHTML = `
                <input type="checkbox" class="size-checkbox" data-id="${id}" ${isDisabled ? "disabled" : ""}>${item.name}
                <input type="number" class="size-qty" value="${savedQty}" min="0" ${isDisabled ? "disabled" : ""}>
                <span class="size-unit">${item.unit || ''}</span>
                <input type="number" class="size-price" step="0.01" value="${savedPrice}" placeholder="Price" min="0" ${isDisabled ? "disabled" : ""}>
            `;
            break;
        case "Adds-on":
            // Use globalAddonsData for addons or default to 0
            savedQty = globalAddonsData[id]?.qty ?? 0;
            savedPrice = globalAddonsData[id]?.price ?? 0;
            checkboxHTML = `
                <input type="checkbox" class="addon-checkbox" data-id="${id}" ${isDisabled ? "disabled" : ""}>${item.name}
                <input type="number" class="addon-qty" value="${savedQty}" min="0" ${isDisabled ? "disabled" : ""}>
                <span class="addon-unit">${item.unit || ''}</span>
                <input type="number" class="addon-price" step="0.01" value="${savedPrice}" min="0" ${isDisabled ? "disabled" : ""}>
            `;
            break;
    }

    div.innerHTML = checkboxHTML;
    setupInventoryRowListeners(id, item, div.querySelector("input[type='checkbox']"), div.querySelector(".size-qty, .addon-qty"), div.querySelector(".size-price, .addon-price"));
    return div;
}

async function loadInventory() {
    [D.ingredientsList, D.sizesList, D.addonsList, D.othersList].forEach(l => l.innerHTML = "");
    perSizeContainer.innerHTML = "";

    addInventoryHeader(D.ingredientsList, "Ingredients");
    addInventoryHeader(D.sizesList, "Sizes");
    addInventoryHeader(D.addonsList, "Adds-on");
    addInventoryHeader(D.othersList, "Others");

    inventoryMap = {};
    const snapshot = await getDocs(collection(db, "Inventory"));
    snapshot.forEach(docSnap => {
        const item = docSnap.data();
        const id = docSnap.id;
        inventoryMap[id] = item;
        const row = createInventoryRow(id, item);

        switch (item.category) {
            case "Ingredients": D.ingredientsList.appendChild(row); break;
            case "Sizes": D.sizesList.appendChild(row); break;
            case "Adds-on": D.addonsList.appendChild(row); break;
            default: D.othersList.appendChild(row);
        }
    });

    const checkSaved = (arr, selector) => arr.forEach(id => {
        const cb = document.querySelector(selector.replace('ID', id));
        if (cb) {
            cb.checked = true;
            const row = cb.closest(".inventory-row");
            if (row) {
                const qtyInput = row.querySelector(".size-qty, .addon-qty");
                const priceInput = row.querySelector(".size-price, .addon-price");
                if (qtyInput) qtyInput.disabled = false;
                if (priceInput) priceInput.disabled = false;
            }
        }
    });

    checkSaved(selectedIngredients, `.ingredient-checkbox[value='ID']`);
    checkSaved(selectedOthers, `.other-checkbox[value='ID']`);
    checkSaved(selectedAddons, `.addon-checkbox[data-id='ID']`);

    generatePerSizeSections();
}

function generatePerSizeSections() {
    const selectedSizes = Array.from(document.querySelectorAll(".size-checkbox:checked"));
    perSizeContainer.innerHTML = "";

    // Update globalAddonsData from inputs
    selectedAddons.forEach(id => {
        const row = document.querySelector(`.addon-checkbox[data-id='${id}']`)?.closest(".addon-row");
        if (!row) return;
        const qtyInput = row.querySelector(".addon-qty");
        const priceInput = row.querySelector(".addon-price");
        globalAddonsData[id] = {
            qty: qtyInput ? parseFloat(qtyInput.value) || 0 : 0,
            price: priceInput ? parseFloat(priceInput.value) || 0 : 0
        };
    });

    selectedSizes.forEach(cb => {
        const sizeId = cb.dataset.id;
        if (!perSizeData[sizeId]) perSizeData[sizeId] = {};
        const section = document.createElement("div");
        section.classList.add("per-size-section");
        section.dataset.sizeId = sizeId;
        section.style.marginBottom = "10px";

        const sizeInfo = inventoryMap[sizeId];
        if (!sizeInfo) return;
        section.innerHTML = `<h4>Size: ${sizeInfo.name}</h4>`;

        const createGroup = (items, type) => {
            if (!items.length) return null;
            const div = document.createElement("div");
            div.classList.add("type-group");
            div.innerHTML = `<strong>${type}:</strong>`;
            items.forEach(id => {
                const inv = inventoryMap[id];
                if (!inv) return;
                const wrapper = document.createElement("div");
                const input = document.createElement("input");
                input.type = "number";
                input.min = 0; // Per-size input starts at 0, min 1 required for submission
                input.dataset.itemId = id;
                input.dataset.type = type.toLowerCase().slice(0, -1);
                const key = input.dataset.type + '_' + id;
                input.value = (perSizeData[sizeId]?.[key]) ?? 0;

                const label = document.createElement("label");
                label.textContent = inv.name;
                const unitSpan = document.createElement("span");
                unitSpan.textContent = inv.unit || '';
                wrapper.classList.add("item-wrapper");
                wrapper.appendChild(label);
                wrapper.appendChild(document.createTextNode(" Qty: "));
                wrapper.appendChild(input);
                if (type === "Ingredients") wrapper.appendChild(unitSpan);
                div.appendChild(wrapper);

                input.addEventListener('input', () => {
                    perSizeData[sizeId] = perSizeData[sizeId] || {};
                    perSizeData[sizeId][key] = parseFloat(input.value) || 0;
                });
            });
            return div;
        };

        const ingredientsGroup = createGroup(selectedIngredients, "Ingredients");
        const othersGroup = createGroup(selectedOthers, "Others");

        if (ingredientsGroup) section.appendChild(ingredientsGroup);
        if (othersGroup) section.appendChild(othersGroup);

        perSizeContainer.appendChild(section);
    });
}

// --- Edit & Add Product Logic Unified ---

async function preparePopup(product = null) {
    editingProductId = product?.id || null;
    currentMainCategory = product?.categoryMain || D.addDrinkBtn?.dataset.mainCategory || "Others";

    let subOptions = [];
    if (currentMainCategory === "Drinks") subOptions = ["Hot Coffee", "Ice Espresso", "Non Coffee", "Iced Cold Brew", "Others"];
    else if (currentMainCategory === "Food") subOptions = ["Sandwiches", "Burger", "Snack", "Others"];
    else subOptions = ["Others"];

    D.productSubCategory.innerHTML = subOptions.map((s, i) =>
        `<option value="${s}" ${product?.categorySub === s ? "selected" : i === 0 && !product ? "selected" : ""}>${s}</option>`
    ).join('');

    currentSubCategory = D.productSubCategory.value;

    D.popupForm.reset();
    D.popupTitle.textContent = product ? `Edit ${currentMainCategory} - ${currentSubCategory}` : `Add ${currentMainCategory} - ${currentSubCategory}`;
    D.previewImage.style.display = "none";
    base64Image = "";
    selectedIngredients = []; selectedAddons = []; selectedOthers = []; perSizeData = {}; globalAddonsData = {};

    if (product) {
        D.productName.value = product.name;
        D.productDescription.value = product.description;
        base64Image = product.image || "";
        D.previewImage.src = base64Image;
        D.previewImage.style.display = base64Image ? "block" : "none";

        if (Array.isArray(product.sizes)) {
            product.sizes.forEach(s => {
                s.ingredients?.forEach(i => selectedIngredients.push(i.id));
                s.others?.forEach(o => selectedOthers.push(o.id));
                s.addons?.forEach(a => { selectedAddons.push(a.id); globalAddonsData[a.id] = { qty: a.qty ?? 0, price: a.price ?? 0 }; });
                perSizeData[s.id] = {};
                s.ingredients?.forEach(i => perSizeData[s.id]['ingredient_' + i.id] = i.qty ?? 0);
                s.others?.forEach(o => perSizeData[s.id]['other_' + o.id] = o.qty ?? 0);
            });
            selectedIngredients = [...new Set(selectedIngredients)];
            selectedAddons = [...new Set(selectedAddons)];
            selectedOthers = [...new Set(selectedOthers)];
        }
    }

    await loadInventory();

    // Set size/addon inputs based on loaded data
    if (product?.sizes) {
        product.sizes.forEach(s => {
            const row = document.querySelector(`.size-checkbox[data-id='${s.id}']`)?.closest(".size-row");
            if (row) {
                row.querySelector(".size-checkbox").checked = true;
                row.querySelector(".size-qty").value = s.qty ?? 0;
                row.querySelector(".size-price").value = s.price ?? 0;
            }
        });
        document.querySelectorAll(".size-checkbox:checked").forEach(cb => {
            const row = cb.closest(".size-row");
            if (row) { row.querySelector(".size-qty").disabled = false; row.querySelector(".size-price").disabled = false; }
        });
    }

    openPopup();
}

// Handler for 'Edit' button
const editProduct = (product) => {
    const catData = normalizeCategory(product.category);
    product.categoryMain = product.categoryMain || catData.main;
    product.categorySub = product.categorySub || catData.sub;
    preparePopup(product);
};

// Handler for 'Add' buttons
document.querySelectorAll('[id^="add"][data-main-category]').forEach(btn => {
    btn.addEventListener("click", e => {
        e.preventDefault();
        currentMainCategory = btn.dataset.mainCategory;
        preparePopup(null);
    });
});

// --- Form Submission (Validation enforces minimum 1) ---
D.popupForm.addEventListener("submit", async e => {
    e.preventDefault();
    const name = D.productName.value.trim();
    const categoryMain = currentMainCategory || "Others";
    const categorySub = currentSubCategory || "Others";
    const description = D.productDescription.value.trim();

    const sizes = Array.from(document.querySelectorAll(".size-checkbox:checked")).map(cb => {
        const id = cb.dataset.id;
        const row = cb.closest(".size-row");
        const sizeInfo = inventoryMap[id];
        const data = {
            id, name: sizeInfo.name, unit: sizeInfo.unit || "",
            qty: parseInt(row.querySelector(".size-qty").value),
            price: parseFloat(row.querySelector(".size-price").value),
            ingredients: [], addons: [], others: []
        };

        // Add size-specific ingredients/others
        document.querySelector(`.per-size-section[data-size-id='${id}']`)?.querySelectorAll("input").forEach(inp => {
            const val = parseFloat(inp.value);
            if (val > 0) { // Only save items with quantity > 0
                if (inp.dataset.type === "ingredient") data.ingredients.push({ id: inp.dataset.itemId, name: inventoryMap[inp.dataset.itemId].name, qty: val });
                else if (inp.dataset.type === "other") data.others.push({ id: inp.dataset.itemId, name: inventoryMap[inp.dataset.itemId].name, qty: val });
            }
        });

        // Add global addons
        Object.entries(globalAddonsData).forEach(([addonId, addonData]) => {
            if (selectedAddons.includes(addonId) && addonData.qty > 0 && addonData.price >= 0) { // Check for Qty > 0
                data.addons.push({ id: addonId, name: inventoryMap[addonId].name, qty: addonData.qty, price: addonData.price });
            }
        });
        return data;
    });

    if (!name) return showPopupMessage("Product name is required.");
    if (sizes.length === 0) return showPopupMessage("At least 1 size is required.");
    for (const s of sizes) {
        if (!s.price || s.price <= 0) return showPopupMessage(`Price for size "${s.name}" is required and must be >${0}.`);
        if (!s.qty || s.qty <= 0) return showPopupMessage(`Quantity for size "${s.name}" is required and must be >${0}.`);
    }

    try {
        const productData = { name, categoryMain, categorySub, description, sizes, image: base64Image };
        if (editingProductId) {
            await updateDoc(doc(db, "products", editingProductId), productData);
        } else {
            await addDoc(collection(db, "products"), { ...productData, available: true, createdAt: serverTimestamp() });
        }
        closePopup();
        showPopupMessage("Product saved successfully.");
    } catch (err) {
        showPopupMessage("Error: " + err.message);
    }
});

// --- Rendering and Filtering Logic ---
function updateTableVisibility() {
    [D.drinksTable, D.foodTable, D.othersTable].forEach(t => t.style.display = 'none');
    
    if (activeFilter === "Drinks" && D.drinksTable) D.drinksTable.style.display = 'block';
    else if (activeFilter === "Food" && D.foodTable) D.foodTable.style.display = 'block';
    else if (activeFilter === "Others" && D.othersTable) D.othersTable.style.display = 'block';
    else if (activeFilter === "All" || activeFilter === null) { 
        if (D.drinksTable) D.drinksTable.style.display = 'block';
        if (D.foodTable) D.foodTable.style.display = 'block';
        if (D.othersTable) D.othersTable.style.display = 'block';
    }
}

function renderProducts(snapshot) {
    const products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    document.querySelectorAll(".product-list").forEach(pl => pl.innerHTML = "");

    products.forEach(product => {
        const catData = { main: product.categoryMain || normalizeCategory(product.category).main, sub: product.categorySub || normalizeCategory(product.category).sub };
        if (activeFilter && activeFilter !== "All" && activeFilter !== catData.main) return;

        const currentSubFilter = activeFilter === "Drinks" ? D.drinksFilter?.value :
                                 activeFilter === "Food" ? D.foodFilter?.value :
                                 activeFilter === "Others" ? D.othersFilter?.value : "All";
        if (currentSubFilter !== "All" && currentSubFilter !== catData.sub) return;

        const container = document.querySelector(`.product-list[data-category="${catData.main}"]`);
        if (!container) return;

        let isOutOfStock = product.sizes?.some(s =>
            s.ingredients?.some(i => inventoryMap[i.id]?.quantity < i.qty) ||
            s.addons?.some(a => inventoryMap[a.id]?.quantity < a.qty)
        ) || false;

        const div = document.createElement("div");
        div.classList.add("product-item");
        div.classList.toggle("disabled-product", !product.available || isOutOfStock);

        div.innerHTML = `
            <img src="${product.image || ''}" alt="${product.name}" />
            <h4>${product.name}</h4>
            <p>${product.description || ''}</p>
            <div class="product-subcategory">${catData.sub}</div>
            <div class="product-actions">
                <button type="button" class="editBtn" data-id="${product.id}">Edit</button>
                <button type="button" class="deleteBtn" data-id="${product.id}">Delete</button>
                <button type="button" class="toggleBtn" data-id="${product.id}" ${isOutOfStock ? "disabled" : ""}>
                    ${product.available ? "Disable" : "Enable"}
                </button>
            </div>
        `;

        div.querySelector(".editBtn").addEventListener("click", () => editProduct(product));
        div.querySelector(".deleteBtn").addEventListener("click", () => openDeletePopup(product.id));
        div.querySelector(".toggleBtn").addEventListener("click", async () => {
            await updateDoc(doc(db, "products", product.id), { available: !product.available });
        });

        container.appendChild(div);
    });
}

// --- Filter Event Listeners ---
const handleFilterChange = (category) => {
    activeFilter = category;
    D.filterButtons.forEach(b => b.classList.remove("active"));
    document.querySelector(`.filterBtn[data-category="${activeFilter}"]`)?.classList.add("active");
    updateTableVisibility();
    listenProductChanges();
}

D.filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const category = btn.dataset.category;
        activeFilter = (activeFilter === category && category !== "All") ? null : category;
        if (activeFilter === null) activeFilter = "All";
        handleFilterChange(activeFilter);
    });
});

[D.drinksFilter, D.foodFilter, D.othersFilter].forEach(filter => {
    if (filter) {
        filter.addEventListener("change", () => {
            const category = filter.id.replace('Filter', '');
            handleFilterChange(category);
        });
    }
});


// --- Real-time Product Listener & Init ---
function listenProductChanges() {
    if (unsubscribeProducts) unsubscribeProducts();
    unsubscribeProducts = onSnapshot(collection(db, "products"), snapshot => renderProducts(snapshot));
}

onAuthStateChanged(D.auth, async (user) => {
    if (!user) return window.location.replace("login.html");
    await init();
});

async function init() {
    await loadInventory();
    activeFilter = "All";
    document.querySelector('.filterBtn[data-category="All"]')?.classList.add("active");
    updateTableVisibility();
    listenProductChanges();
}
