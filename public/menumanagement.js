// ===============================
// menumanagement.js - COMPLETE WORKING FILE
// ===============================

// --- Firebase Imports Consolidation ---
// NOTE: Assumes firebase-config.js exports 'db' and Firebase is initialized there.
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
    addDrinkBtn: document.getElementById("addDrinkBtn"),
    addFoodBtn: document.getElementById("addFoodBtn"),
    addOthersBtn: document.getElementById("addOthersBtn"),
};

// --- Per Size Container Setup ---
const perSizeContainer = document.getElementById("perSizeContainer");

// --- State Variables ---
let editingProductId = null;
let currentMainCategory = null;
let currentSubCategory = null;
let inventoryMap = {};
let selectedIngredients = [];
let selectedAddons = [];
let selectedOthers = [];
let selectedSizesIds = [];
let base64Image = "";
let perSizeData = {};
let globalAddonsData = {};
let globalSizePricesAndQtys = {}; // Stores Qty/Price per size
let cropper = null;
let activeFilter = null;
let productToDelete = null;
let unsubscribeProducts = null;

// --- Utility Functions ---

/** Creates and displays a temporary popup message. */
const showPopupMessage = (function() {
    const el = document.getElementById("messagePopup") || document.createElement("div");
    if (!document.getElementById("messagePopup")) {
        el.id = "messagePopup";
        el.style.cssText = `position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #f44336; color: #fff; padding: 10px 20px; border-radius: 5px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 9999; display: none;`;
        document.body.appendChild(el);
    }
    return (message, isError = true, duration = 5000) => {
        el.textContent = message;
        el.style.background = isError ? "#f44336" : "#4CAF50";
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
D.cancelBtn?.addEventListener("click", closePopup);
window.addEventListener("click", e => { if (e.target === D.popup) closePopup(); });
D.productSubCategory?.addEventListener("change", () => { currentSubCategory = D.productSubCategory.value; });

// --- Cropper Logic (4:3) ---
function initCropper() {
    if (cropper) cropper.destroy();
    cropper = new Cropper(D.imageToCrop, {
        aspectRatio: 4 / 3,
        resizable: true,
        movable: true,
        zoomable: true,
        viewMode: 1,
        autoCropArea: 1.0,
    });
}
D.productImage?.addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => { D.imageToCrop.src = reader.result; D.cropperModal.classList.add("show"); initCropper(); };
        reader.readAsDataURL(file);
    }
});
D.cropAndSaveBtn?.addEventListener("click", () => {
    if (cropper) {
        const OUTPUT_WIDTH = 600;
        const OUTPUT_HEIGHT = 450;
        base64Image = cropper.getCroppedCanvas({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, fillColor: '#fff' }).toDataURL('image/jpeg');
        D.previewImage.src = base64Image;
        D.previewImage.style.display = "block";
        D.productImage.value = null;
        D.cropperModal.classList.remove("show");
        cropper.destroy(); cropper = null;
    }
});
[D.closeCropperBtn, D.cropperModal].forEach(el => el?.addEventListener("click", e => {
    if (e.target === D.closeCropperBtn || e.target === D.cropperModal) {
        D.cropperModal.classList.remove("show");
        if (cropper) { cropper.destroy(); cropper = null; }
        D.productImage.value = null;
    }
}));

// --- Inventory & Per-Size Logic ---
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

    const updateStateData = () => {
        const checked = checkbox.checked;
        if (item.category === "Sizes") {
            globalSizePricesAndQtys[id] = globalSizePricesAndQtys[id] || {};
            globalSizePricesAndQtys[id].qty = checked ? (parseInt(qtyInput.value) || 0) : 0;
            globalSizePricesAndQtys[id].price = checked ? (parseFloat(priceInput.value) || 0) : 0;
        }
        if (item.category === "Adds-on") {
            globalAddonsData[id] = globalAddonsData[id] || {};
            globalAddonsData[id].qty = checked ? (parseFloat(qtyInput.value) || 0) : 0;
            globalAddonsData[id].price = checked ? (parseFloat(priceInput.value) || 0) : 0;
        }
    };

    checkbox.addEventListener("change", () => {
        const checked = checkbox.checked;
        let stateArray = [];

        if (item.category === "Ingredients") stateArray = selectedIngredients;
        else if (item.category === "Adds-on") stateArray = selectedAddons;
        else if (item.category === "Others") stateArray = selectedOthers;
        else if (item.category === "Sizes") stateArray = selectedSizesIds;

        if (checked) {
            if (!stateArray.includes(id)) stateArray.push(id);
        } else {
            const index = stateArray.indexOf(id);
            if (index > -1) stateArray.splice(index, 1);
        }

        if (qtyInput) qtyInput.disabled = !checked;
        if (priceInput) priceInput.disabled = !checked;

        updateStateData();

        if (item.category !== "Adds-on") generatePerSizeSections();
    });

    if (qtyInput) qtyInput.addEventListener("input", updateStateData);
    if (priceInput) priceInput.addEventListener("input", updateStateData);

    if (checkbox.checked) updateStateData();
}

function createInventoryRow(id, item) {
    const isDisabled = item.active === false || Number(item.quantity || 0) <= 0;
    const div = document.createElement("div");
    div.classList.add("inventory-row", (item.category || '').toLowerCase().replace('-', '') + "-row");
    if (isDisabled) { div.style.opacity = "0.5"; div.title = "Out of Stock"; }

    let checkboxHTML = "";
    let isChecked = false;

    if (item.category === "Ingredients") isChecked = selectedIngredients.includes(id);
    else if (item.category === "Others") isChecked = selectedOthers.includes(id);
    else if (item.category === "Sizes") isChecked = selectedSizesIds.includes(id);
    else if (item.category === "Adds-on") isChecked = selectedAddons.includes(id);

    const sizeQty = globalSizePricesAndQtys[id]?.qty ?? 0;
    const sizePrice = globalSizePricesAndQtys[id]?.price ?? 0;
    const addonQty = globalAddonsData[id]?.qty ?? 0;
    const addonPrice = globalAddonsData[id]?.price ?? 0;

    switch (item.category) {
        case "Ingredients":
        case "Others":
            const cls = item.category === "Ingredients" ? "ingredient-checkbox" : "other-checkbox";
            checkboxHTML = `<input type="checkbox" class="${cls}" value="${id}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}> ${item.name}`;
            break;
        case "Sizes":
            checkboxHTML = `
                <input type="checkbox" class="size-checkbox" data-id="${id}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}> ${item.name}
                <input type="number" class="size-qty" value="${sizeQty}" min="0" placeholder="Qty" ${isChecked ? "" : "disabled"}>
                <span class="size-unit">${item.unit || ''}</span>
                <input type="number" class="size-price" step="0.01" value="${sizePrice}" placeholder="Price" min="0" ${isChecked ? "" : "disabled"}>
            `;
            break;
        case "Adds-on":
            checkboxHTML = `
                <input type="checkbox" class="addon-checkbox" data-id="${id}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}> ${item.name}
                <input type="number" class="addon-qty" value="${addonQty}" min="0" placeholder="Qty" ${isChecked ? "" : "disabled"}>
                <span class="addon-unit">${item.unit || ''}</span>
                <input type="number" class="addon-price" step="0.01" value="${addonPrice}" placeholder="Price" min="0" ${isChecked ? "" : "disabled"}>
            `;
            break;
    }

    div.innerHTML = checkboxHTML;

    const checkbox = div.querySelector("input[type='checkbox']");
    const qtyInput = div.querySelector(".size-qty, .addon-qty");
    const priceInput = div.querySelector(".size-price, .addon-price");

    if (qtyInput) qtyInput.disabled = !isChecked;
    if (priceInput) priceInput.disabled = !isChecked;

    setupInventoryRowListeners(id, item, checkbox, qtyInput, priceInput);
    return div;
}

async function loadInventory() {
    [D.ingredientsList, D.sizesList, D.addonsList, D.othersList].forEach(l => {
        if (l) l.innerHTML = "";
    });
    perSizeContainer.innerHTML = "";

    D.ingredientsList && addInventoryHeader(D.ingredientsList, "Ingredients");
    D.sizesList && addInventoryHeader(D.sizesList, "Sizes");
    D.addonsList && addInventoryHeader(D.addonsList, "Adds-on");
    D.othersList && addInventoryHeader(D.othersList, "Others");

    inventoryMap = {};
    try {
        const snapshot = await getDocs(collection(db, "Inventory"));
        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const id = docSnap.id;
            inventoryMap[id] = item;
            const row = createInventoryRow(id, item);
            switch (item.category) {
                case "Ingredients": D.ingredientsList?.appendChild(row); break;
                case "Sizes": D.sizesList?.appendChild(row); break;
                case "Adds-on": D.addonsList?.appendChild(row); break;
                default: D.othersList?.appendChild(row);
            }
        });
    } catch (err) {
        console.error("Failed to load Inventory:", err);
        showPopupMessage("Failed to load inventory: " + err.message);
    }
}

function generatePerSizeSections() {
    const selectedSizes = selectedSizesIds
        .map(id => document.querySelector(`.size-checkbox[data-id='${id}']`))
        .filter(cb => cb && cb.checked);

    perSizeContainer.innerHTML = "";

    selectedSizes.forEach(cb => {
        const sizeId = cb.dataset.id;
        if (!inventoryMap[sizeId]) return;

        const section = document.createElement("div");
        section.classList.add("per-size-section");
        section.dataset.sizeId = sizeId;
        section.innerHTML = `<h4>Per Size Configuration: ${inventoryMap[sizeId].name}</h4>`;

        const createGroup = (items, type) => {
            if (!items.length) return null;
            const groupType = type.toLowerCase().slice(0, -1);
            const div = document.createElement("div");
            div.classList.add("type-group");
            div.innerHTML = `<strong>${type}:</strong>`;

            items.forEach(id => {
                const inv = inventoryMap[id];
                if (!inv) return;
                const key = groupType + '_' + id;
                const savedValue = perSizeData[sizeId]?.[key] ?? 0;

                const wrapper = document.createElement("div");
                wrapper.classList.add("item-wrapper");
                wrapper.innerHTML = `
                    <label>${inv.name}</label>
                    <span>Qty:</span>
                    <input type="number" min="0" data-item-id="${id}" data-type="${groupType}" value="${savedValue}">
                    ${type === "Ingredients" ? `<span>${inv.unit || ''}</span>` : ''}
                `;

                const input = wrapper.querySelector('input');

                input.addEventListener('input', () => {
                    perSizeData[sizeId] = perSizeData[sizeId] || {};
                    perSizeData[sizeId][key] = parseFloat(input.value) || 0;
                });

                div.appendChild(wrapper);
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

// --- Edit & Add Product Logic ---
async function preparePopup(product = null) {
    editingProductId = product?.id || null;

    const mainCat = product ? (product.categoryMain || normalizeCategory(product.category).main) : (currentMainCategory || "Others");
    currentMainCategory = mainCat;

    let subOptions = [];
    if (currentMainCategory === "Drinks") subOptions = ["Hot Coffee", "Ice Espresso", "Non Coffee", "Iced Cold Brew", "Others"];
    else if (currentMainCategory === "Food") subOptions = ["Sandwiches", "Burger", "Snack", "Others"];
    else subOptions = ["Others"];

    D.productSubCategory.innerHTML = subOptions.map(s =>
        `<option value="${s}" ${product?.categorySub === s ? "selected" : ""}>${s}</option>`
    ).join('');

    currentSubCategory = D.productSubCategory.value;

    D.popupForm.reset();
    D.popupTitle.textContent = product ? `Edit Product: ${product.name}` : `Add New ${currentMainCategory} Product`;

    selectedIngredients = [];
    selectedAddons = [];
    selectedOthers = [];
    selectedSizesIds = [];
    perSizeData = {};
    globalAddonsData = {};
    globalSizePricesAndQtys = {};

    base64Image = product?.image || "";
    D.previewImage.src = base64Image;
    D.previewImage.style.display = base64Image ? "block" : "none";
    D.productImage.value = null;

    if (product) {
        D.productName.value = product.name;
        D.productDescription.value = product.description;

        if (Array.isArray(product.sizes)) {
            product.sizes.forEach(s => {
                const sizeId = s.id;
                selectedSizesIds.push(sizeId);
                globalSizePricesAndQtys[sizeId] = { qty: s.qty ?? 0, price: s.price ?? 0 };

                s.ingredients?.forEach(i => {
                    if (!selectedIngredients.includes(i.id)) selectedIngredients.push(i.id);
                    perSizeData[sizeId] = perSizeData[sizeId] || {};
                    perSizeData[sizeId]['ingredient_' + i.id] = i.qty ?? 0;
                });
                s.others?.forEach(o => {
                    if (!selectedOthers.includes(o.id)) selectedOthers.push(o.id);
                    perSizeData[sizeId] = perSizeData[sizeId] || {};
                    perSizeData[sizeId]['other_' + o.id] = o.qty ?? 0;
                });

                s.addons?.forEach(a => {
                    if (!selectedAddons.includes(a.id)) selectedAddons.push(a.id);
                    globalAddonsData[a.id] = { qty: a.qty ?? 0, price: a.price ?? 0 };
                });
            });
        }
    }

    await loadInventory();
    generatePerSizeSections();
    openPopup();
}

const editProduct = (product) => {
    preparePopup(product);
};

// Handler for Add buttons
document.querySelectorAll('[id^="add"][data-main-category]').forEach(btn => {
    btn.addEventListener("click", e => {
        e.preventDefault();
        currentMainCategory = btn.dataset.mainCategory;
        preparePopup(null);
    });
});

// --- Form Submission (SAVE) ---
D.popupForm?.addEventListener("submit", async e => {
    e.preventDefault();

    const name = D.productName.value.trim();
    const categoryMain = currentMainCategory || "Others";
    const categorySub = currentSubCategory || D.productSubCategory?.value || "Others";
    const description = D.productDescription.value.trim();

    if (!name) return showPopupMessage("Product name is required.");
    if (!description) return showPopupMessage("Product description is required.");

    // Collect selected sizes from current DOM state (size checkbox -> inventory-row)
    const sizeCheckboxes = Array.from(document.querySelectorAll(".size-checkbox")).filter(cb => cb.checked);
    if (sizeCheckboxes.length === 0) return showPopupMessage("At least 1 size is required. Check a size and fill in its quantity/price.");

    // Build sizes array with validation
    const sizes = [];
    try {
        sizeCheckboxes.forEach(cb => {
            const id = cb.dataset.id;
            const sizeInfo = inventoryMap[id];
            if (!sizeInfo) throw new Error("Selected size not found in inventory.");

            // Robust row selection: find the inventory-row containing this checkbox
            const row = cb.closest(".inventory-row") || cb.parentElement || document.querySelector(`.size-checkbox[data-id="${id}"]`)?.parentElement;
            // find qty and price associated with that checkbox (prefer nearest inputs)
            const qtyInput = row?.querySelector(".size-qty") || document.querySelector(`.size-checkbox[data-id="${id}"]`)?.closest('div')?.querySelector('.size-qty');
            const priceInput = row?.querySelector(".size-price") || document.querySelector(`.size-checkbox[data-id="${id}"]`)?.closest('div')?.querySelector('.size-price');

            const qty = qtyInput ? (parseInt(qtyInput.value) || 0) : (globalSizePricesAndQtys[id]?.qty ?? 0);
            const price = priceInput ? (parseFloat(priceInput.value) || 0) : (globalSizePricesAndQtys[id]?.price ?? 0);

            if (isNaN(price) || price <= 0) throw new Error(`Price for size "${sizeInfo.name}" is required and must be greater than 0.`);
            if (isNaN(qty) || qty <= 0) throw new Error(`Quantity for size "${sizeInfo.name}" is required and must be greater than 0.`);

            const data = {
                id,
                name: sizeInfo.name,
                unit: sizeInfo.unit || "",
                qty: qty,
                price: price,
                ingredients: [],
                addons: [],
                others: []
            };

            // Add per-size ingredients / others from perSizeData DOM if present
            const perSection = document.querySelector(`.per-size-section[data-size-id='${id}']`);
            perSection?.querySelectorAll("input[data-item-id]").forEach(inp => {
                const val = parseFloat(inp.value) || 0;
                if (val > 0) {
                    const itemId = inp.dataset.itemId;
                    const itemType = inp.dataset.type;
                    if (itemType === "ingredient") {
                        data.ingredients.push({ id: itemId, name: inventoryMap[itemId]?.name || "", qty: val });
                    } else if (itemType === "other") {
                        data.others.push({ id: itemId, name: inventoryMap[itemId]?.name || "", qty: val });
                    }
                }
            });

            // Add global addons if selected
            Object.entries(globalAddonsData).forEach(([addonId, addonData]) => {
                if (selectedAddons.includes(addonId) && addonData.qty > 0 && addonData.price > 0) {
                    data.addons.push({ id: addonId, name: inventoryMap[addonId]?.name || "", qty: addonData.qty, price: addonData.price });
                }
            });

            sizes.push(data);
        });
    } catch (err) {
        return showPopupMessage(err.message);
    }

    // Prepare product data
    const productData = { name, categoryMain, categorySub, description, sizes, image: base64Image, available: true };

    try {
        if (editingProductId) {
            await updateDoc(doc(db, "products", editingProductId), productData);
        } else {
            await addDoc(collection(db, "products"), { ...productData, createdAt: serverTimestamp() });
        }
        closePopup();
        showPopupMessage("Product saved successfully.", false, 3000);
        // refresh/listen to products will pick this up
    } catch (err) {
        console.error("Save product error:", err);
        showPopupMessage("Error saving product: " + (err.message || err));
    }
});

// --- Delete Product Logic ---
const openDeletePopup = (productId) => {
    productToDelete = productId;
    D.deletePopup.classList.add("show");
};

const closeDeletePopup = () => {
    productToDelete = null;
    D.deletePopup.classList.remove("show");
};
D.cancelDeleteBtn?.addEventListener("click", closeDeletePopup);

D.confirmDeleteBtn?.addEventListener("click", async () => {
    if (!productToDelete) return;
    try {
        await deleteDoc(doc(db, "products", productToDelete));
        closeDeletePopup();
        showPopupMessage("Product deleted successfully.", false, 3000);
    } catch (err) {
        console.error("Delete error:", err);
        showPopupMessage("Error deleting product: " + err.message);
    }
});

// --- Rendering / Filters / Listeners ---
function listenProductChanges() {
    if (unsubscribeProducts) unsubscribeProducts();
    const productsRef = collection(db, "products");
    unsubscribeProducts = onSnapshot(productsRef, snapshot => renderProducts(snapshot), err => {
        console.error("Products snapshot error:", err);
        showPopupMessage("Failed to load products: " + (err.message || err));
    });
}

function renderProducts(snapshot) {
    const products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    document.querySelectorAll(".product-list").forEach(pl => pl.innerHTML = "");

    ["Drinks", "Food", "Others"].forEach(cat => {
        const container = document.querySelector(`.product-list[data-category="${cat}"]`);
        if (!container) return;

        const currentSubFilter = getSubCategoryFilter(cat);

        const filtered = products.filter(p => {
            const catData = {
                main: p.categoryMain || normalizeCategory(p.category).main,
                sub: p.categorySub || normalizeCategory(p.category).sub
            };

            if (catData.main !== cat) return false;
            if (currentSubFilter && currentSubFilter !== "All" && currentSubFilter !== catData.sub) return false;
            return true;
        });

        if (filtered.length === 0) {
            const msg = document.createElement("div");
            msg.classList.add("no-product-msg");
            msg.textContent = `No products for ${cat}${currentSubFilter !== "All" ? ' - ' + currentSubFilter : ''}`;
            container.appendChild(msg);
        } else {
            filtered.forEach(product => {
                const isOutOfStock = false; // Optionally implement stock logic
                const div = document.createElement("div");
                div.classList.add("product-item");
                div.classList.toggle("disabled-product", !product.available || isOutOfStock);

                const catData = { main: product.categoryMain || normalizeCategory(product.category).main, sub: product.categorySub || normalizeCategory(product.category).sub };

                div.innerHTML = `
                    <img src="${product.image || 'https://placehold.co/100x150/EEEEEE/333333?text=No+Image'}" alt="${product.name}" />
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

                div.querySelector(".editBtn")?.addEventListener("click", () => editProduct(product));
                div.querySelector(".deleteBtn")?.addEventListener("click", () => openDeletePopup(product.id));
                div.querySelector(".toggleBtn")?.addEventListener("click", async () => {
                    try {
                        await updateDoc(doc(db, "products", product.id), { available: !product.available });
                    } catch (err) {
                        console.error("Toggle availability error:", err);
                        showPopupMessage("Failed to toggle availability: " + (err.message || err));
                    }
                });

                container.appendChild(div);
            });
        }
    });
}

function getSubCategoryFilter(mainCategory) {
    if (mainCategory === "Drinks" && D.drinksFilter) return D.drinksFilter.value;
    if (mainCategory === "Food" && D.foodFilter) return D.foodFilter.value;
    if (mainCategory === "Others" && D.othersFilter) return D.othersFilter.value;
    return "All";
}

function updateTableVisibility() {
    [D.drinksTable, D.foodTable, D.othersTable].forEach(t => { if (t) t.style.display = 'none'; });
    if (activeFilter === "Drinks" && D.drinksTable) D.drinksTable.style.display = 'block';
    else if (activeFilter === "Food" && D.foodTable) D.foodTable.style.display = 'block';
    else if (activeFilter === "Others" && D.othersTable) D.othersTable.style.display = 'block';
    else if (activeFilter === "All" || activeFilter === null) {
        if (D.drinksTable) D.drinksTable.style.display = 'block';
        if (D.foodTable) D.foodTable.style.display = 'block';
        if (D.othersTable) D.othersTable.style.display = 'block';
    }
}

const handleFilterChange = (category) => {
    activeFilter = category;
    D.filterButtons.forEach(b => b.classList.remove("active"));
    document.querySelector(`.filterBtn[data-category="${activeFilter}"]`)?.classList.add("active");
    listenProductChanges();
    updateTableVisibility();
};

D.filterButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        const category = btn.dataset.category;
        handleFilterChange(category);
    });
});

[D.drinksFilter, D.foodFilter, D.othersFilter].forEach(filter => {
    if (filter) {
        filter.addEventListener("change", () => {
            listenProductChanges();
        });
    }
});

// --- Auth and Init ---
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

// --- Ensure Add Buttons (backup hookup) ---
D.addDrinkBtn?.addEventListener("click", () => { currentMainCategory = "Drinks"; preparePopup(null); });
D.addFoodBtn?.addEventListener("click", () => { currentMainCategory = "Food"; preparePopup(null); });
D.addOthersBtn?.addEventListener("click", () => { currentMainCategory = "Others"; preparePopup(null); });

// ===============================
// END OF FILE
// ===============================
