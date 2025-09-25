// --- imports ---
import { db } from './firebase-config.js';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- DOM Elements ---
const popup = document.getElementById("popup");
const popupTitle = document.getElementById("popupTitle");
const popupForm = document.getElementById("popupForm");
const productName = document.getElementById("productName");
const productCategory = document.getElementById("productCategory");
const productDescription = document.getElementById("productDescription");
const productImage = document.getElementById("productImage");
const previewImage = document.getElementById("previewImage");
const ingredientsList = document.getElementById("ingredientsList");
const sizesList = document.getElementById("sizesList");
const addonsList = document.getElementById("addonsList");
const othersList = document.getElementById("othersList");

let editingProductId = null;
let currentMainCategory = null;
let inventoryMap = {};
let base64Image = "";

// --- Image Upload (Base64) ---
productImage.addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      base64Image = reader.result;
      previewImage.src = base64Image;
      previewImage.style.display = "block";
    };
    reader.readAsDataURL(file);
  }
});

// --- Custom Popup Message ---
const messagePopup = document.createElement("div");
messagePopup.id = "messagePopup";
messagePopup.style.cssText = `
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #f44336;
  color: #fff;
  padding: 10px 20px;
  border-radius: 5px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.2);
  z-index: 9999;
  display: none;
`;
document.body.appendChild(messagePopup);

function showPopupMessage(message, duration = 3000) {
  messagePopup.textContent = message;
  messagePopup.style.display = "block";
  setTimeout(() => { messagePopup.style.display = "none"; }, duration);
}

// --- Delete Confirmation Popup ---
const deletePopup = document.createElement("div");
deletePopup.id = "deletePopup";
deletePopup.classList.add("popup");
deletePopup.style.cssText = `
  display: none;
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.4);
  justify-content: center;
  align-items: center;
  z-index: 10000;
`;
deletePopup.innerHTML = `
  <div class="popup-content" style="max-width: 400px; background:#fff; padding:20px; border-radius:8px; text-align:center;">
    <h3>Confirm Delete</h3>
    <p>Are you sure you want to delete this product?</p>
    <div style="margin-top:15px;">
      <button id="confirmDeleteBtn" style="background-color: #f44336; color: white; margin-right:10px;">Delete</button>
      <button id="cancelDeleteBtn" type="button">Cancel</button>
    </div>
  </div>
`;
document.body.appendChild(deletePopup);

let productToDelete = null;
const confirmDeleteBtn = deletePopup.querySelector("#confirmDeleteBtn");
const cancelDeleteBtn = deletePopup.querySelector("#cancelDeleteBtn");

function openDeletePopup(id) {
  productToDelete = id;
  deletePopup.style.display = "flex";
}

function closeDeletePopup() {
  productToDelete = null;
  deletePopup.style.display = "none";
}

cancelDeleteBtn.addEventListener("click", closeDeletePopup);
window.addEventListener("click", e => { if (e.target === deletePopup) closeDeletePopup(); });

confirmDeleteBtn.addEventListener("click", async () => {
  if (productToDelete) {
    try {
      await deleteDoc(doc(db, "products", productToDelete));
      showPopupMessage("Product deleted successfully.");
    } catch (err) {
      showPopupMessage("Error: " + err.message);
    } finally {
      closeDeletePopup();
    }
  }
});

// --- Inventory Header ---
function addInventoryHeader(container) {
  const header = document.createElement("div");
  header.classList.add("inventory-header");
  header.innerHTML = `<span></span><span>Name</span><span>Qty</span><span>Unit</span><span>Price</span>`;
  container.appendChild(header);
}

// --- Load Inventory ---
async function loadInventory() {
  [ingredientsList, sizesList, addonsList, othersList].forEach(l => l.innerHTML = "");
  addInventoryHeader(ingredientsList);
  addInventoryHeader(sizesList);
  addInventoryHeader(addonsList);
  addInventoryHeader(othersList);

  const snapshot = await getDocs(collection(db, "Inventory"));

  snapshot.forEach(docSnap => {
    const item = docSnap.data();
    const id = docSnap.id;
    inventoryMap[id] = item;

    const div = document.createElement("div");
    div.classList.add("inventory-row");

    const commonHTML = `<input type="checkbox" value="${id}">${item.name}<input type="number" value="1" min="1" disabled><span>${item.unit || ""}</span>`;
    switch (item.category) {
      case "Ingredients":
        div.classList.add("ingredient-row");
        div.innerHTML = commonHTML + `<span>-</span>`;
        div.querySelector("input[type='checkbox']").classList.add("ingredient-checkbox");
        div.querySelector("input[type='number']").classList.add("ingredient-qty");
        break;
      case "Sizes":
        div.classList.add("size-row");
        div.innerHTML = `<input type="checkbox" class="size-checkbox" data-id="${id}">${item.name}<input type="number" class="size-qty" value="1" min="1" disabled><span>${item.unit || ""}</span><input type="number" class="size-price" step="0.01" placeholder="Price" disabled>`;
        break;
      case "Adds-on":
        div.classList.add("addon-row");
        div.innerHTML = `<input type="checkbox" class="addon-checkbox" value="${id}">${item.name}<input type="number" class="addon-qty" value="1" min="1" disabled><span>${item.unit || ""}</span><input type="number" class="addon-price" step="0.01" placeholder="Price" disabled>`;
        break;
      default:
        div.classList.add("other-row");
        div.innerHTML = `<input type="checkbox" class="other-checkbox" value="${id}">${item.name}<input type="number" class="other-qty" value="1" min="1" disabled><span>${item.unit || ""}</span><span>-</span>`;
    }

    const checkbox = div.querySelector("input[type='checkbox']");
    const qtyInput = div.querySelector("input[type='number']:not([placeholder])");
    const priceInput = div.querySelector("input[type='number'][placeholder='Price']");
    const isDisabled = !item.active || Number(item.quantity) <= 0;

    if (checkbox) {
      checkbox.disabled = isDisabled;
      if (qtyInput) qtyInput.disabled = !checkbox.checked || isDisabled;
      if (priceInput) priceInput.disabled = !checkbox.checked || isDisabled;
      if (isDisabled) {
        div.style.opacity = "0.5";
        div.title = "Out of Stock";
      }
      checkbox.addEventListener("change", () => {
        if (qtyInput) qtyInput.disabled = !checkbox.checked;
        if (priceInput) priceInput.disabled = !checkbox.checked;
      });
    }

    switch (item.category) {
      case "Ingredients": ingredientsList.appendChild(div); break;
      case "Sizes": sizesList.appendChild(div); break;
      case "Adds-on": addonsList.appendChild(div); break;
      default: othersList.appendChild(div);
    }
  });
}

// --- Real-time Inventory Listener ---
function listenInventoryChanges() {
  const inventoryRef = collection(db, "Inventory");
  onSnapshot(inventoryRef, async snapshot => {
    let inventoryChanged = false;
    snapshot.docChanges().forEach(change => {
      const id = change.doc.id;
      const item = change.doc.data();
      const prevItem = inventoryMap[id];

      if (!prevItem || prevItem.quantity !== item.quantity || prevItem.active !== item.active) {
        inventoryChanged = true;
      }

      inventoryMap[id] = item;

      const row = document.querySelector(
        `.ingredient-checkbox[value="${id}"], .size-checkbox[data-id="${id}"], .addon-checkbox[value="${id}"], .other-checkbox[value="${id}"]`
      )?.closest(".inventory-row");

      if (row) {
        const checkbox = row.querySelector("input[type='checkbox']");
        const qtyInput = row.querySelector("input[type='number']:not([placeholder])");
        const priceInput = row.querySelector("input[type='number'][placeholder='Price']");
        const isDisabled = !item.active || Number(item.quantity) <= 0;

        checkbox.disabled = isDisabled;
        if (qtyInput) qtyInput.disabled = !checkbox.checked || isDisabled;
        if (priceInput) priceInput.disabled = !checkbox.checked || isDisabled;
        row.style.opacity = isDisabled ? "0.5" : "1";
        row.title = isDisabled ? "Out of Stock" : "";
      }
    });

    if (inventoryChanged) {
      const productSnapshot = await getDocs(collection(db, "products"));
      renderProducts({ docs: productSnapshot.docs });
    }
  });
}

// --- Popup Controls ---
function openPopup() { popup.classList.add("show"); }
function closePopup() { popup.classList.remove("show"); }
document.getElementById("cancelBtn").addEventListener("click", closePopup);
window.addEventListener("click", e => { if (e.target === popup) closePopup(); });

// --- Add Product Buttons ---
["addDrinkBtn", "addSandwichBtn"].forEach(id => {
  document.getElementById(id).addEventListener("click", async () => {
    currentMainCategory = document.getElementById(id).closest(".category-table").dataset.category;
    popupTitle.textContent = `Add ${currentMainCategory}`;
    popupForm.reset();
    previewImage.style.display = "none";
    base64Image = "";
    editingProductId = null;
    await loadInventory();
    openPopup();
  });
});

// --- Real-time Product Listener ---
function listenProductChanges() {
  const productsRef = collection(db, "products");
  onSnapshot(productsRef, snapshot => {
    renderProducts(snapshot);
  });
}

// --- Render Products ---
function renderProducts(snapshot) {
  const productLists = document.querySelectorAll(".product-list");
  productLists.forEach(list => list.innerHTML = "");

  const products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

  const grouped = {};
  products.forEach(p => {
    const mainCat = ["Sandwich"].includes(p.category) ? "Sandwich" : "Drink";
    if (!grouped[mainCat]) grouped[mainCat] = {};
    if (!grouped[mainCat][p.category]) grouped[mainCat][p.category] = [];
    grouped[mainCat][p.category].push(p);
  });

  productLists.forEach(container => {
    const mainCat = container.closest(".category-table").dataset.category;
    if (!grouped[mainCat]) return;

    Object.keys(grouped[mainCat]).forEach(subCat => {
      const subHeader = document.createElement("div");
      subHeader.classList.add("subcategory-header");
      subHeader.textContent = subCat;
      container.appendChild(subHeader);

      grouped[mainCat][subCat].forEach(product => {
        const div = document.createElement("div");
        div.classList.add("product-item");

        let isOutOfStock = false;
        const outItems = [];
        [...(product.ingredients || []), ...(product.others || [])].forEach(item => {
          const inv = inventoryMap[item.id];
          if (!inv || !inv.active || Number(inv.quantity) < Number(item.qty)) {
            isOutOfStock = true;
            outItems.push(item.name);
          }
        });
        if (!product.available || isOutOfStock) div.classList.add("disabled-product");

        let summaryHTML = "";
        if (product.ingredients?.length) summaryHTML += `<p><strong>Ingredients:</strong> ${product.ingredients.map(i => i.name).join(", ")}</p>`;
        if (product.others?.length) summaryHTML += `<p><strong>Others:</strong> ${product.others.map(o => o.name).join(", ")}</p>`;
        if (outItems.length) summaryHTML += `<p style="color:red;"><strong>Out of stock:</strong> ${outItems.join(", ")}</p>`;

        div.innerHTML = `
          ${product.image ? `<img src="${product.image}" style="max-width:80px; display:block; margin-bottom:5px;">` : ""}
          <strong>${product.name}</strong><br>
          ${product.description || ""}
          <div class="product-summary" style="margin:5px 0; font-size:0.9em;">${summaryHTML}</div>
          <div class="product-actions" style="margin-top:5px;">
            <button class="edit-btn" data-id="${product.id}">Edit</button>
            <button class="delete-btn" data-id="${product.id}">Delete</button>
            <button class="toggle-btn" data-id="${product.id}" ${isOutOfStock ? "disabled" : ""}>${product.available ? "Disable" : "Enable"}</button>
          </div>
        `;

        container.appendChild(div);

        div.querySelector(".edit-btn").addEventListener("click", async () => editProduct(product));
        div.querySelector(".delete-btn").addEventListener("click", () => openDeletePopup(product.id));
        div.querySelector(".toggle-btn").addEventListener("click", async () => toggleProductAvailability(product));
      });
    });
  });
}

// --- Edit, Delete, Toggle Functions ---
async function editProduct(product) {
  editingProductId = product.id;
  popupTitle.textContent = `Edit ${product.category}`;
  productName.value = product.name;
  productCategory.value = product.category;
  productDescription.value = product.description;
  if (product.image) {
    base64Image = product.image;
    previewImage.src = base64Image;
    previewImage.style.display = "block";
  }
  await loadInventory();

  ["ingredients", "sizes", "addons", "others"].forEach(type => {
    product[type]?.forEach(i => {
      const selector = {
        "ingredients": `.ingredient-checkbox[value="${i.id}"]`,
        "sizes": `.size-checkbox[data-id="${i.id}"]`,
        "addons": `.addon-checkbox[value="${i.id}"]`,
        "others": `.other-checkbox[value="${i.id}"]`
      }[type];
      const cb = document.querySelector(selector);
      if (cb) {
        cb.checked = true;
        const row = cb.closest(".inventory-row");
        const qtyInput = row.querySelector("input[type='number']:not([placeholder])");
        if (qtyInput) { qtyInput.value = i.qty; qtyInput.disabled = false; }
        const priceInput = row.querySelector("input[type='number'][placeholder='Price']");
        if (priceInput && i.price !== undefined) priceInput.value = i.price;
      }
    });
  });

  openPopup();
}

async function toggleProductAvailability(product) {
  await updateDoc(doc(db, "products", product.id), { available: !product.available });
}

// --- Form Submission ---
popupForm.addEventListener("submit", async e => {
  e.preventDefault();
  const name = productName.value.trim();
  const category = productCategory.value || currentMainCategory;
  const description = productDescription.value.trim();

  const ingredients = Array.from(document.querySelectorAll(".ingredient-checkbox:checked")).map(cb => {
    const row = cb.closest(".ingredient-row");
    return { id: cb.value, name: inventoryMap[cb.value].name, unit: inventoryMap[cb.value].unit || "", qty: parseInt(row.querySelector(".ingredient-qty").value) };
  });

  const sizes = Array.from(document.querySelectorAll(".size-checkbox:checked")).map(cb => {
    const row = cb.closest(".size-row");
    return { id: cb.dataset.id, name: inventoryMap[cb.dataset.id].name, unit: inventoryMap[cb.dataset.id].unit || "", qty: parseInt(row.querySelector(".size-qty").value), price: parseFloat(row.querySelector(".size-price").value) };
  });

  const addons = Array.from(document.querySelectorAll(".addon-checkbox:checked")).map(cb => {
    const row = cb.closest(".addon-row");
    return { id: cb.value, name: inventoryMap[cb.value].name, unit: inventoryMap[cb.value].unit || "", qty: parseInt(row.querySelector(".addon-qty").value), price: parseFloat(row.querySelector(".addon-price").value) };
  });

  const others = Array.from(document.querySelectorAll(".other-checkbox:checked")).map(cb => {
    const row = cb.closest(".other-row");
    return { id: cb.value, name: inventoryMap[cb.value].name, unit: inventoryMap[cb.value].unit || "", qty: parseInt(row.querySelector(".other-qty").value) };
  });

  // --- Validation ---
  if (!name) return showPopupMessage("Product name is required.");
  if (ingredients.length === 0) return showPopupMessage("At least 1 ingredient is required.");
  if (sizes.length === 0) return showPopupMessage("At least 1 size is required.");
  for (const size of sizes) {
    if (!size.price || size.price <= 0) return showPopupMessage(`Price for size "${size.name}" is required and must be greater than 0.`);
    if (!size.qty || size.qty <= 0) return showPopupMessage(`Quantity for size "${size.name}" is required and must be greater than 0.`);
  }

  try {
    if (editingProductId) {
      await updateDoc(doc(db, "products", editingProductId), { name, category, description, ingredients, sizes, addons, others, image: base64Image });
    } else {
      await addDoc(collection(db, "products"), { name, category, description, ingredients, sizes, addons, others, image: base64Image, available: true, createdAt: serverTimestamp() });
    }
    closePopup();
  } catch (err) {
    showPopupMessage("Error: " + err.message);
  }
});

// --- Initial Load ---
async function init() {
  await loadInventory();
  listenInventoryChanges();
  listenProductChanges(); // <-- Real-time product listener
}

init();
