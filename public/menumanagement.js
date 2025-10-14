// ===============================
// menumanagement.js - UPDATED with "No products for (filter)"
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
    try { await deleteDoc(doc(db, "products", productToDelete)); showPopupMessage("Product deleted successfully."); } 
    catch (err) { showPopupMessage("Error: " + err.message); } 
    finally { closeDeletePopup(); }
});

// --- Inventory Logic ---
function addInventoryHeader(container, type) {
    const header = document.createElement("div");
    header.classList.add("inventory-header");
    header.innerHTML = (type === "Sizes" || type === "Adds-on") ? `<span></span><span>Name</span><span>Qty</span><span>Unit</span><span>Price</span>` : `<span></span><span>Name</span>`;
    container.appendChild(header);
}
function setupInventoryRowListeners(id, item, checkbox, qtyInput, priceInput) {
    if (!checkbox) return;
    checkbox.addEventListener("change", () => {
        const checked = checkbox.checked;
        const stateArray = item.category === "Ingredients" ? selectedIngredients : item.category === "Adds-on" ? selectedAddons : selectedOthers;
        if (checked) { if (!stateArray.includes(id)) stateArray.push(id); } 
        else { const index = stateArray.indexOf(id); if (index > -1) stateArray.splice(index, 1); }
        if (qtyInput) qtyInput.disabled = !checked;
        if (priceInput) priceInput.disabled = !checked;
        generatePerSizeSections();
    });
    if (item.category === "Adds-on") {
        const updateAddonData = () => { globalAddonsData[id] = globalAddonsData[id] || {}; if (qtyInput) globalAddonsData[id].qty = parseFloat(qtyInput.value) || 0; if (priceInput) globalAddonsData[id].price = parseFloat(priceInput.value) || 0; generatePerSizeSections(); };
        if (qtyInput) qtyInput.addEventListener("input", updateAddonData);
        if (priceInput) priceInput.addEventListener("input", updateAddonData);
    }
}
function createInventoryRow(id, item) {
    const isDisabled = !item.active || Number(item.quantity) <= 0;
    const div = document.createElement("div");
    div.classList.add("inventory-row", item.category.toLowerCase().replace('-', '') + "-row");
    if (isDisabled) { div.style.opacity = "0.5"; div.title = "Out of Stock"; }
    let checkboxHTML = ""; let savedQty = 0; let savedPrice = 0;
    switch (item.category) {
        case "Ingredients":
        case "Others": checkboxHTML = `<input type="checkbox" class="${item.category==='Ingredients'?'ingredient-checkbox':'other-checkbox'}" value="${id}" ${isDisabled?'disabled':''}>${item.name}`; break;
        case "Sizes": checkboxHTML = `<input type="checkbox" class="size-checkbox" data-id="${id}" ${isDisabled?'disabled':''}>${item.name}<input type="number" class="size-qty" value="${savedQty}" min="0" ${isDisabled?'disabled':''}><span class="size-unit">${item.unit||''}</span><input type="number" class="size-price" step="0.01" value="${savedPrice}" placeholder="Price" min="0" ${isDisabled?'disabled':''}>`; break;
        case "Adds-on": savedQty = globalAddonsData[id]?.qty??0; savedPrice = globalAddonsData[id]?.price??0; checkboxHTML = `<input type="checkbox" class="addon-checkbox" data-id="${id}" ${isDisabled?'disabled':''}>${item.name}<input type="number" class="addon-qty" value="${savedQty}" min="0" ${isDisabled?'disabled':''}><span class="addon-unit">${item.unit||''}</span><input type="number" class="addon-price" step="0.01" value="${savedPrice}" min="0" ${isDisabled?'disabled':''}>`; break;
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
        const item = docSnap.data(); const id = docSnap.id;
        inventoryMap[id] = item;
        const row = createInventoryRow(id, item);
        switch(item.category){ case "Ingredients": D.ingredientsList.appendChild(row); break; case "Sizes": D.sizesList.appendChild(row); break; case "Adds-on": D.addonsList.appendChild(row); break; default: D.othersList.appendChild(row); }
    });
    generatePerSizeSections();
}

function generatePerSizeSections() {
    const selectedSizes = Array.from(document.querySelectorAll(".size-checkbox:checked"));
    perSizeContainer.innerHTML = "";
    selectedSizes.forEach(cb => {
        const sizeId = cb.dataset.id;
        if (!perSizeData[sizeId]) perSizeData[sizeId]={};
        const section = document.createElement("div"); section.classList.add("per-size-section"); section.dataset.sizeId=sizeId; section.style.marginBottom="10px";
        const sizeInfo = inventoryMap[sizeId]; if (!sizeInfo) return;
        section.innerHTML=`<h4>Size: ${sizeInfo.name}</h4>`;
        perSizeContainer.appendChild(section);
    });
}

// --- Render & Filter Logic ---
function updateTableVisibility() {
    [D.drinksTable,D.foodTable,D.othersTable].forEach(t=>t.style.display='none');
    if(activeFilter==="Drinks"&&D.drinksTable)D.drinksTable.style.display='block';
    else if(activeFilter==="Food"&&D.foodTable)D.foodTable.style.display='block';
    else if(activeFilter==="Others"&&D.othersTable)D.othersTable.style.display='block';
    else if(activeFilter==="All"||activeFilter===null){
        if(D.drinksTable)D.drinksTable.style.display='block';
        if(D.foodTable)D.foodTable.style.display='block';
        if(D.othersTable)D.othersTable.style.display='block';
    }
}

function getSubCategoryFilter(mainCategory){
    if(mainCategory==="Drinks"&&D.drinksFilter)return D.drinksFilter.value;
    if(mainCategory==="Food"&&D.foodFilter)return D.foodFilter.value;
    if(mainCategory==="Others"&&D.othersFilter)return D.othersFilter.value;
    return "All";
}

function renderProducts(snapshot){
    const products = snapshot.docs.map(d=>({id:d.id,...d.data()}));
    document.querySelectorAll(".product-list").forEach(pl=>pl.innerHTML="");
    ["Drinks","Food","Others"].forEach(cat=>{
        const container=document.querySelector(`.product-list[data-category="${cat}"]`);
        if(!container)return;
        const currentSubFilter=getSubCategoryFilter(cat);
        const filtered = products.filter(p=>{
            const catData={main:p.categoryMain||normalizeCategory(p.category).main,sub:p.categorySub||normalizeCategory(p.category).sub};
            if(activeFilter&&activeFilter!=="All"&&activeFilter!==catData.main)return false;
            if(currentSubFilter!=="All"&&currentSubFilter!==catData.sub)return false;
            return catData.main===cat;
        });
        if(filtered.length===0){
            const msg=document.createElement("div"); msg.classList.add("no-product-msg");
            msg.textContent=`No products for ${cat}${currentSubFilter!=="All"?' - '+currentSubFilter:''}`;
            container.appendChild(msg);
        } else {
            filtered.forEach(product=>{
                let isOutOfStock=product.sizes?.some(s=>s.ingredients?.some(i=>inventoryMap[i.id]?.quantity<i.qty)||s.addons?.some(a=>inventoryMap[a.id]?.quantity<a.qty))||false;
                const div=document.createElement("div"); div.classList.add("product-item"); div.classList.toggle("disabled-product",!product.available||isOutOfStock);
                div.innerHTML=`<img src="${product.image||''}" alt="${product.name}"/><h4>${product.name}</h4><p>${product.description||''}</p><div class="product-subcategory">${product.categorySub||''}</div><div class="product-actions"><button type="button" class="editBtn" data-id="${product.id}">Edit</button><button type="button" class="deleteBtn" data-id="${product.id}">Delete</button><button type="button" class="toggleBtn" data-id="${product.id}" ${isOutOfStock?"disabled":""}>${product.available?"Disable":"Enable"}</button></div>`;
                div.querySelector(".editBtn").addEventListener("click",()=>editProduct(product));
                div.querySelector(".deleteBtn").addEventListener("click",()=>openDeletePopup(product.id));
                div.querySelector(".toggleBtn").addEventListener("click",async()=>{await updateDoc(doc(db,"products",product.id),{available:!product.available});});
                container.appendChild(div);
            });
        }
    });
}

const handleFilterChange=(category)=>{activeFilter=category; D.filterButtons.forEach(b=>b.classList.remove("active")); document.querySelector(`.filterBtn[data-category="${activeFilter}"]`)?.classList.add("active"); updateTableVisibility(); listenProductChanges();};

D.filterButtons.forEach(btn=>{btn.addEventListener("click",()=>{
    const category=btn.dataset.category;
    activeFilter=(activeFilter===category&&category!=="All")?null:category;
    if(activeFilter===null)activeFilter="All";
    handleFilterChange(activeFilter);
})});

[D.drinksFilter,D.foodFilter,D.othersFilter].forEach(filter=>{if(filter)filter.addEventListener("change",()=>listenProductChanges());});

function listenProductChanges(){if(unsubscribeProducts)unsubscribeProducts(); unsubscribeProducts=onSnapshot(collection(db,"products"),snapshot=>renderProducts(snapshot));}

onAuthStateChanged(D.auth,async(user)=>{if(!user)return window.location.replace("login.html"); await init();});
async function init(){await loadInventory(); activeFilter="All"; document.querySelector('.filterBtn[data-category="All"]')?.classList.add("active"); updateTableVisibility(); listenProductChanges();}
