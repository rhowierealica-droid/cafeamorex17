import { db } from './firebase-config.js';
import * as firestore from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
const { collection, addDoc, updateDoc, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp } = firestore;

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
    cancelCropperBtn: document.getElementById("cancelCropperBtn"), 
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
    
    viewIngredientsBtn: document.getElementById("viewIngredientsBtn"), 
    ingredientsImagePopup: document.getElementById("ingredientsImagePopup"), 
    closeIngredientsPopupBtn: document.getElementById("closeIngredientsPopupBtn"), 

    isSeasonal: document.getElementById("isSeasonal"),
    seasonalDatesContainer: document.getElementById("seasonalDatesContainer"),
    seasonStartDate: document.getElementById("seasonStartDate"),
    seasonEndDate: document.getElementById("seasonEndDate"),
};

const perSizeContainer = document.getElementById("perSizeContainer");

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
let globalSizePricesAndQtys = {};
let cropper = null;
let activeFilter = null;
let productToDelete = null;
let unsubscribeProducts = null;

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

const openPopup = () => D.popup.classList.add("show");
const closePopup = () => D.popup.classList.remove("show");

const openIngredientsPopup = () => D.ingredientsImagePopup.classList.add("show");
const closeIngredientsPopup = () => D.ingredientsImagePopup.classList.remove("show");

D.cancelBtn?.addEventListener("click", closePopup);
window.addEventListener("click", e => { 
    if (e.target === D.popup) closePopup(); 
    if (e.target === D.ingredientsImagePopup) closeIngredientsPopup(); 
});
D.productSubCategory?.addEventListener("change", () => { currentSubCategory = D.productSubCategory.value; });

D.viewIngredientsBtn?.addEventListener("click", openIngredientsPopup);
D.closeIngredientsPopupBtn?.addEventListener("click", closeIngredientsPopup);

D.isSeasonal?.addEventListener('change', () => {
    if (D.seasonalDatesContainer) {
        D.seasonalDatesContainer.style.display = D.isSeasonal.checked ? 'block' : 'none';
    }
});


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

D.cancelCropperBtn?.addEventListener("click", () => {
    D.cropperModal.classList.remove("show");
    if (cropper) { cropper.destroy(); cropper = null; }
    D.productImage.value = null; 
});

D.cropperModal?.addEventListener("click", e => {
    if (e.target === D.cropperModal) {
        D.cropperModal.classList.remove("show");
        if (cropper) { cropper.destroy(); cropper = null; }
        D.productImage.value = null; 
    }
});


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

    const handleCheckboxChange = () => {
        const checked = checkbox.checked;
        let stateArray = [];

        if (item.category === "Ingredients") stateArray = selectedIngredients;
        else if (item.category === "Adds-on") stateArray = selectedAddons;
        else if (item.category === "Others") stateArray = selectedOthers;
        else if (item.category === "Sizes") stateArray = selectedSizesIds;

        if (checked) {
            if (!stateArray.includes(id)) {
                stateArray.push(id);
            }
        } else {
            const index = stateArray.indexOf(id);
            if (index > -1) {
                stateArray.splice(index, 1);
            }
        }

        if (item.category === "Ingredients") selectedIngredients = stateArray;
        else if (item.category === "Adds-on") selectedAddons = stateArray;
        else if (item.category === "Others") selectedOthers = stateArray;
        else if (item.category === "Sizes") selectedSizesIds = stateArray;


        if (qtyInput) qtyInput.disabled = !checked;
        if (priceInput) priceInput.disabled = !checked;

        updateStateData();

        if (item.category !== "Adds-on") generatePerSizeSections();
    };

    checkbox.addEventListener("change", handleCheckboxChange);

    if (qtyInput) qtyInput.addEventListener("input", updateStateData);
    if (priceInput) priceInput.addEventListener("input", updateStateData);
}

function createInventoryRow(id, item, isChecked, qtyValue, priceValue) {
    const isDisabled = item.active === false || Number(item.quantity || 0) <= 0;
    const div = document.createElement("div");
    div.classList.add("inventory-row", (item.category || '').toLowerCase().replace('-', '') + "-row");
    if (isDisabled) { div.style.opacity = "0.5"; div.title = "Out of Stock"; }

    let checkboxHTML = "";

    const finalQty = qtyValue || 0;
    const finalPrice = priceValue || 0;

    switch (item.category) {
        case "Ingredients":
        case "Others":
            const cls = item.category === "Ingredients" ? "ingredient-checkbox" : "other-checkbox";
            checkboxHTML = `<input type="checkbox" class="${cls}" value="${id}" data-id="${id}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}> ${item.name}`;
            break;
        case "Sizes":
            checkboxHTML = `
                <input type="checkbox" class="size-checkbox" data-id="${id}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}> ${item.name}
                <input type="number" class="size-qty" value="${finalQty}" min="0" placeholder="Qty" ${isChecked ? "" : "disabled"}>
                <span class="size-unit">${item.unit || ''}</span>
                <input type="number" class="size-price" step="0.01" value="${finalPrice}" placeholder="Price" min="0" ${isChecked ? "" : "disabled"}>
            `;
            break;
        case "Adds-on":
            checkboxHTML = `
                <input type="checkbox" class="addon-checkbox" data-id="${id}" ${isChecked ? "checked" : ""} ${isDisabled ? "disabled" : ""}> ${item.name}
                <input type="number" class="addon-qty" value="${finalQty}" min="0" placeholder="Qty" ${isChecked ? "" : "disabled"}>
                <span class="addon-unit">${item.unit || ''}</span>
                <input type="number" class="addon-price" step="0.01" value="${finalPrice}" placeholder="Price" min="0" ${isChecked ? "" : "disabled"}>
            `;
            break;
    }

    div.innerHTML = checkboxHTML;
    return div;
}

async function loadInventory() {
    if (Object.keys(inventoryMap).length > 0) return inventoryMap;

    inventoryMap = {};
    try {
        const snapshot = await getDocs(collection(db, "Inventory"));
        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const id = docSnap.id;
            inventoryMap[id] = item;
        });

        renderInventoryLists();

        return inventoryMap;
    } catch (err) {return {};}
}

function renderInventoryLists() {
    [D.ingredientsList, D.sizesList, D.addonsList, D.othersList].forEach(l => {
        if (l) l.innerHTML = "";
    });
    perSizeContainer.innerHTML = "";

    D.ingredientsList && addInventoryHeader(D.ingredientsList, "Ingredients");
    D.sizesList && addInventoryHeader(D.sizesList, "Sizes");
    D.addonsList && addInventoryHeader(D.addonsList, "Adds-on");
    D.othersList && addInventoryHeader(D.othersList, "Others");

    Object.entries(inventoryMap).forEach(([id, item]) => {
        let isChecked = false;
        let qty = 0;
        let price = 0;
        let container = null;

        switch (item.category) {
            case "Ingredients":
                isChecked = selectedIngredients.includes(id);
                container = D.ingredientsList;
                break;
            case "Sizes":
                isChecked = selectedSizesIds.includes(id);
                qty = globalSizePricesAndQtys[id]?.qty ?? 0;
                price = globalSizePricesAndQtys[id]?.price ?? 0;
                container = D.sizesList;
                break;
            case "Adds-on":
                isChecked = selectedAddons.includes(id);
                qty = globalAddonsData[id]?.qty ?? 0;
                price = globalAddonsData[id]?.price ?? 0;
                container = D.addonsList;
                break;
            default:
                isChecked = selectedOthers.includes(id);
                container = D.othersList;
        }

        if (container) {
            const row = createInventoryRow(id, item, isChecked, qty, price);
            const checkbox = row.querySelector("input[type='checkbox']");
            const qtyInput = row.querySelector(".size-qty, .addon-qty");
            const priceInput = row.querySelector(".size-price, .addon-price");

            setupInventoryRowListeners(id, item, checkbox, qtyInput, priceInput);
            
            container.appendChild(row);
        }
    });

    if (selectedSizesIds.length > 0) {
        generatePerSizeSections();
    }
}

function generatePerSizeSections() {
    const selectedSizes = selectedSizesIds
        .map(id => ({ id, ...inventoryMap[id] }))
        .filter(s => s.id && inventoryMap[s.id]);

    perSizeContainer.innerHTML = "";

    selectedSizes.forEach(sizeItem => {
        const sizeId = sizeItem.id;
        const section = document.createElement("div");
        section.classList.add("per-size-section");
        section.dataset.sizeId = sizeId;
        section.innerHTML = `<h4>Per Size Configuration: ${sizeItem.name}</h4>`;

        const createGroup = (ids, type) => {
            if (!ids.length) return null;
            const groupType = type.toLowerCase().slice(0, -1);
            const div = document.createElement("div");
            div.classList.add("type-group");
            div.innerHTML = `<strong>${type}:</strong>`;

            ids.forEach(id => {
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

    const isSeasonal = product?.is_seasonal || false;
    if (D.isSeasonal) D.isSeasonal.checked = isSeasonal;
    if (D.seasonalDatesContainer) D.seasonalDatesContainer.style.display = isSeasonal ? 'block' : 'none';
    if (D.seasonStartDate) D.seasonStartDate.value = product?.season_start_date || '';
    if (D.seasonEndDate) D.seasonEndDate.value = product?.season_end_date || '';
    // ----------------------------

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

            selectedIngredients = [...new Set(selectedIngredients)];
            selectedOthers = [...new Set(selectedOthers)];
            selectedAddons = [...new Set(selectedAddons)];
        }
    }

    renderInventoryLists();
    openPopup();
}

const editProduct = (product) => {
    preparePopup(product);
};

document.querySelectorAll('[id^="add"][data-main-category]').forEach(btn => {
    btn.addEventListener("click", e => {
        e.preventDefault();
        currentMainCategory = btn.dataset.mainCategory;
        preparePopup(null);
    });
});

D.popupForm?.addEventListener("submit", async e => {
    e.preventDefault();

    const name = D.productName.value.trim();
    const categoryMain = currentMainCategory || "Others";
    const categorySub = currentSubCategory || D.productSubCategory?.value || "Others";
    const description = D.productDescription.value.trim();

    //  Get seasonal data from form
    const isSeasonal = D.isSeasonal?.checked || false;
    const seasonStartDate = D.seasonStartDate?.value || null;
    const seasonEndDate = D.seasonEndDate?.value || null;

    if (!name) return showPopupMessage("Product name is required.");
    if (!description) return showPopupMessage("Product description is required.");

    //  seasonal dates
    if (isSeasonal) {
        if (!seasonStartDate || !seasonEndDate) {
            return showPopupMessage("Seasonal product requires both start and end dates.");
        }
        if (new Date(seasonStartDate) >= new Date(seasonEndDate)) {
            return showPopupMessage("Start date must be strictly before end date.");
        }
    }
    // ----------------------------
    
    const sizeCheckboxes = Array.from(document.querySelectorAll(".size-checkbox")).filter(cb => cb.checked);
    if (sizeCheckboxes.length === 0) return showPopupMessage("At least 1 size is required. Check a size and fill in its quantity/price.");

    const sizes = [];
    try {
        sizeCheckboxes.forEach(cb => {
            const id = cb.dataset.id;
            const sizeInfo = inventoryMap[id];
            if (!sizeInfo) throw new Error("Selected size not found in inventory.");

            const qty = globalSizePricesAndQtys[id]?.qty ?? 0;
            const price = globalSizePricesAndQtys[id]?.price ?? 0;

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

            // Size wtih Ingredients and Others
            const sizePerData = perSizeData[id];
            if (sizePerData) {
                Object.entries(sizePerData).forEach(([key, val]) => {
                    const parts = key.split('_');
                    if (parts.length !== 2) return;
                    const [itemType, itemId] = parts;
                    if (val > 0) {
                        if (itemType === "ingredient") {
                            data.ingredients.push({ id: itemId, name: inventoryMap[itemId]?.name || "", qty: val });
                        } else if (itemType === "other") {
                            data.others.push({ id: itemId, name: inventoryMap[itemId]?.name || "", qty: val });
                        }
                    }
                });
            }

            // Global Add-ons
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

    const productData = { 
        name, 
        categoryMain, 
        categorySub, 
        description, 
        sizes, 
        image: base64Image, 
        available: true, 

        // SEASONAL FIELDS
        is_seasonal: isSeasonal,
        season_start_date: isSeasonal ? seasonStartDate : null,
        season_end_date: isSeasonal ? seasonEndDate : null,
        // -------------------------

        updatedAt: serverTimestamp() 
    };

    try {
        if (editingProductId) {
            await updateDoc(doc(db, "products", editingProductId), productData);
        } else {
            await addDoc(collection(db, "products"), { ...productData, createdAt: serverTimestamp() });
        }
        closePopup();
        showPopupMessage("Product saved successfully.", false, 3000);
    } catch (err) {
        console.error("Save product error:", err);
        showPopupMessage("Error saving product: " + (err.message || err));
    }
});

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

function listenProductChanges() {
    if (unsubscribeProducts) unsubscribeProducts();
    const productsRef = collection(db, "products");
    unsubscribeProducts = onSnapshot(productsRef, snapshot => renderProducts(snapshot), err => {
        console.error("Products snapshot error:", err);
        showPopupMessage("Failed to load products: " + (err.message || err));
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
                const isOutOfStock = false; 
                
                const isSeasonallyAvailable = checkSeasonalAvailability(product);
                const isProductAvailable = product.available && isSeasonallyAvailable;

                const disableToggleDueToSeason = product.is_seasonal && !isSeasonallyAvailable;
                const toggleTitle = disableToggleDueToSeason 
                    ? "Cannot manually enable/disable. Product season has ended." 
                    : (product.available ? "Disable manually" : "Enable manually");

                const div = document.createElement("div");
                div.classList.add("product-item");
                div.classList.toggle("disabled-product", !isProductAvailable || isOutOfStock);

                const catData = { main: product.categoryMain || normalizeCategory(product.category).main, sub: product.categorySub || normalizeCategory(product.category).sub };

                let badge = '';
                if (product.is_seasonal && !isSeasonallyAvailable) {
                    badge = `<span class="product-badge seasonal-inactive">Seasonal (Inactive)</span>`;
                } else if (product.is_seasonal && isSeasonallyAvailable) {
                    badge = `<span class="product-badge seasonal-active">Seasonal (Active)</span>`;
                } else if (!product.available) {
                    badge = `<span class="product-badge manually-disabled">Disabled</span>`;
                }

                div.innerHTML = `
                    <img src="${product.image || 'https://placehold.co/100x150/EEEEEE/333333?text=No+Image'}" alt="${product.name}" />
                    ${badge}
                    <h4>${product.name}</h4>
                    <p>${product.description || ''}</p>
                    <div class="product-subcategory">${catData.sub}</div>
                    <div class="product-actions">
                        <button type="button" class="editBtn" data-id="${product.id}">Edit</button>
                        <button type="button" class="deleteBtn" data-id="${product.id}">Delete</button>
                        <button type="button" class="toggleBtn" data-id="${product.id}" 
                                ${isOutOfStock || disableToggleDueToSeason ? "disabled" : ""} 
                                title="${toggleTitle}">
                            ${product.available ? "Disable" : "Enable"}
                        </button>
                    </div>
                `;

                div.querySelector(".editBtn")?.addEventListener("click", () => editProduct(product));
                div.querySelector(".deleteBtn")?.addEventListener("click", () => openDeletePopup(product.id));
                
                const toggleButton = div.querySelector(".toggleBtn");
                if (toggleButton) {
                    toggleButton.addEventListener("click", async () => {
                        if (disableToggleDueToSeason) {
                            showPopupMessage(toggleTitle); 
                            return;
                        }
                        try {
                            await updateDoc(doc(db, "products", product.id), { available: !product.available });
                        } catch (err) {
                            console.error("Toggle availability error:", err);
                            showPopupMessage("Failed to toggle availability: " + (err.message || err));
                        }
                    });
                }

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

D.addDrinkBtn?.addEventListener("click", () => { currentMainCategory = "Drinks"; preparePopup(null); });
D.addFoodBtn?.addEventListener("click", () => { currentMainCategory = "Food"; preparePopup(null); });
D.addOthersBtn?.addEventListener("click", () => { currentMainCategory = "Others"; preparePopup(null); });
