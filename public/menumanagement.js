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

import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


// --- DOM Elements ---
const auth = getAuth();
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

const perSizeContainer = document.getElementById("perSizeContainer") || document.createElement("div");
perSizeContainer.id = "perSizeContainer";
popupForm.appendChild(perSizeContainer);

// --- State ---
let editingProductId = null;
let currentMainCategory = null;
let inventoryMap = {};
let selectedIngredients = [];
let selectedAddons = [];
let selectedOthers = [];
let base64Image = "";
let perSizeData = {}; // { sizeId: { ingredient_id: qty, other_id: qty } }
let globalAddonsData = {}; // { addon_id: {qty, price} }

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // No user logged in -> redirect to login immediately
    window.location.replace("login.html"); // replace() avoids back button going back here
    return;
  }

  // User is logged in -> initialize app
  await init();
});
// --- Image Upload ---
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

// --- Popup Message ---
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

// --- Delete Confirmation ---
const deletePopup = document.createElement("div");
deletePopup.id = "deletePopup";
deletePopup.style.cssText = `
  display: none;
  position: fixed;
  top:0; left:0;
  width:100%; height:100%;
  background: rgba(0,0,0,0.5);
  justify-content:center;
  align-items:center;
  z-index:10000;
`;
deletePopup.innerHTML = `
  <div style="
    max-width:400px; width:90%; background:#fff; padding:25px; border-radius:10px; text-align:center; box-shadow:0 4px 15px rgba(0,0,0,0.3);
  ">
    <h3 style="margin-bottom:15px;">Confirm Delete</h3>
    <p style="margin-bottom:25px;">Are you sure you want to delete this product?</p>
    <div>
      <button id="confirmDeleteBtn" type="button" style="
        background-color:#f44336; color:white; border:none; padding:10px 20px; border-radius:5px; margin-right:10px; cursor:pointer;
      ">Delete</button>
      <button id="cancelDeleteBtn" type="button" style="
        background-color:#ccc; color:#000; border:none; padding:10px 20px; border-radius:5px; cursor:pointer;
      ">Cancel</button>
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
window.addEventListener("click", e => { if(e.target===deletePopup) closeDeletePopup(); });

confirmDeleteBtn.addEventListener("click", async () => {
  if (productToDelete) {
    try { 
      await deleteDoc(doc(db, "products", productToDelete));
      showPopupMessage("Product deleted successfully."); 
    } catch(err){ 
      showPopupMessage("Error: " + err.message); 
    } finally { 
      closeDeletePopup(); 
    }
  }
});

// --- Inventory Header ---
function addInventoryHeader(container, type){
  const header = document.createElement("div");
  header.classList.add("inventory-header");
  header.innerHTML = type === "Sizes" || type==="Adds-on"
    ? `<span></span><span>Name</span><span>Qty</span><span>Unit</span><span>Price</span>`
    : `<span></span><span>Name</span>`;
  container.appendChild(header);
}

// --- Load Inventory ---
async function loadInventory(){
  [ingredientsList, sizesList, addonsList, othersList].forEach(l => l.innerHTML="");
  perSizeContainer.innerHTML = "";

  addInventoryHeader(ingredientsList,"Ingredients");
  addInventoryHeader(sizesList,"Sizes");
  addInventoryHeader(addonsList,"Adds-on");
  addInventoryHeader(othersList,"Others");

  const snapshot = await getDocs(collection(db,"Inventory"));
  snapshot.forEach(docSnap=>{
    const item = docSnap.data(); 
    const id = docSnap.id; 
    inventoryMap[id] = item;

    const div = document.createElement("div"); 
    div.classList.add("inventory-row");
    const isDisabled = !item.active || Number(item.quantity)<=0;

    let checkboxHTML="";
    switch(item.category){
      case "Ingredients":
        div.classList.add("ingredient-row"); 
        checkboxHTML=`<input type="checkbox" class="ingredient-checkbox" value="${id}" ${isDisabled?"disabled":""}>${item.name}`; 
        break;
      case "Sizes":
        div.classList.add("size-row"); 
        checkboxHTML=`
          <input type="checkbox" class="size-checkbox" data-id="${id}" ${isDisabled?"disabled":""}>${item.name}
          <input type="number" class="size-qty" value="1" min="1" ${isDisabled?"disabled":""}>
          <span class="size-unit">${item.unit||''}</span>
          <input type="number" class="size-price" step="0.01" placeholder="Price" ${isDisabled?"disabled":""}>
        `; 
        break;
      case "Adds-on":
        div.classList.add("addon-row"); 
        const savedQty = globalAddonsData[id]?.qty || item.qty || 1;
        const savedPrice = globalAddonsData[id]?.price || item.price || 0;
        checkboxHTML=`
          <input type="checkbox" class="addon-checkbox" data-id="${id}" ${isDisabled?"disabled":""}>
          ${item.name}
          <input type="number" class="addon-qty" value="${savedQty}" min="0" ${isDisabled?"disabled":""}>
          <span class="addon-unit">${item.unit||''}</span>
          <input type="number" class="addon-price" step="0.01" value="${savedPrice}" ${isDisabled?"disabled":""}>
        `;
        break;
      default:
        div.classList.add("other-row"); 
        checkboxHTML=`<input type="checkbox" class="other-checkbox" value="${id}" ${isDisabled?"disabled":""}>${item.name}`;
    }
    div.innerHTML = checkboxHTML;
    if(isDisabled){ div.style.opacity="0.5"; div.title="Out of Stock"; }

    const checkbox = div.querySelector("input[type='checkbox']");
    const qtyInput = div.querySelector(".size-qty, .addon-qty");
    const priceInput = div.querySelector(".size-price, .addon-price");

    if(checkbox){
      checkbox.addEventListener("change", e=>{
        if(item.category==="Ingredients"){
          checkbox.checked ? selectedIngredients.push(id) : selectedIngredients = selectedIngredients.filter(i=>i!==id);
        } else if(item.category==="Adds-on"){
          checkbox.checked ? selectedAddons.push(id) : selectedAddons = selectedAddons.filter(i=>i!==id);
        } else if(item.category==="Others"){
          checkbox.checked ? selectedOthers.push(id) : selectedOthers = selectedOthers.filter(i=>i!==id);
        }

        if(qtyInput) qtyInput.disabled = !checkbox.checked; 
        if(priceInput) priceInput.disabled = !checkbox.checked;

        // --- Live update addon qty/price ---
        if(item.category==="Adds-on" && qtyInput){
          qtyInput.addEventListener("input", ()=>{ 
            globalAddonsData[id] = globalAddonsData[id]||{};
            globalAddonsData[id].qty=parseFloat(qtyInput.value) || 1; 
            generatePerSizeSections(); 
          });
        }
        if(item.category==="Adds-on" && priceInput){
          priceInput.addEventListener("input", ()=>{ 
            globalAddonsData[id] = globalAddonsData[id]||{};
            globalAddonsData[id].price=parseFloat(priceInput.value) || 0; 
            generatePerSizeSections(); 
          });
        }

        generatePerSizeSections();
      });
    }

    switch(item.category){
      case "Ingredients": ingredientsList.appendChild(div); break;
      case "Sizes": sizesList.appendChild(div); break;
      case "Adds-on": addonsList.appendChild(div); break;
      default: othersList.appendChild(div);
    }
  });

  // --- Mark checkboxes for editing ---
  selectedIngredients.forEach(id=>{
    const cb = document.querySelector(`.ingredient-checkbox[value='${id}']`);
    if(cb) cb.checked=true;
  });
  selectedAddons.forEach(id=>{
    const cb = document.querySelector(`.addon-checkbox[data-id='${id}']`);
    if(cb) cb.checked=true;
  });
  selectedOthers.forEach(id=>{
    const cb = document.querySelector(`.other-checkbox[value='${id}']`);
    if(cb) cb.checked=true;
  });

  generatePerSizeSections();
}

// --- Generate Per-Size Sections ---
function generatePerSizeSections(){
  const selectedSizes = Array.from(document.querySelectorAll(".size-checkbox:checked"));
  perSizeContainer.innerHTML="";

  // Capture add-ons values internally only
  selectedAddons.forEach(addonId=>{
    const row = document.querySelector(`.addon-checkbox[data-id='${addonId}']`)?.closest(".addon-row");
    if(!row) return;
    const qtyInput = row.querySelector(".addon-qty");
    const priceInput = row.querySelector(".addon-price");
    globalAddonsData[addonId] = {
      qty: qtyInput ? parseFloat(qtyInput.value) : 1,
      price: priceInput ? parseFloat(priceInput.value) : 0
    };
  });

  selectedSizes.forEach(cb=>{
    const sizeId = cb.dataset.id;
    if(!perSizeData[sizeId]) perSizeData[sizeId]={};
    const section = document.createElement("div");
    section.classList.add("per-size-section");
    section.dataset.sizeId = sizeId;
    section.style.marginBottom="10px";

    const sizeInfo = inventoryMap[sizeId]; if(!sizeInfo) return;
    section.innerHTML=`<h4>Size: ${sizeInfo.name}</h4>`;

    // Ingredients per size
    if(selectedIngredients.length){
      const div = document.createElement("div"); div.classList.add("type-group"); 
      div.innerHTML=`<strong>Ingredients:</strong>`;
      selectedIngredients.forEach(id=>{
        const inv = inventoryMap[id]; if(!inv) return;
        const wrapper = document.createElement("div");
        const input = document.createElement("input"); input.type="number"; input.min=1;
        input.dataset.itemId=id; input.dataset.type="ingredient";
        const key = 'ingredient_'+id;
        input.value = (perSizeData[sizeId] && perSizeData[sizeId][key]) ? perSizeData[sizeId][key] : 1;
        const label = document.createElement("label"); label.textContent = inv.name;
        const unitSpan = document.createElement("span"); unitSpan.textContent = inv.unit||'';
        wrapper.appendChild(label); wrapper.appendChild(document.createTextNode(" Qty: ")); wrapper.appendChild(input); wrapper.appendChild(unitSpan);
        div.appendChild(wrapper);
      });
      section.appendChild(div);
    }

    // Others per size
    if(selectedOthers.length){
      const div = document.createElement("div"); div.classList.add("type-group"); 
      div.innerHTML=`<strong>Others:</strong>`;
      selectedOthers.forEach(id=>{
        const inv = inventoryMap[id]; if(!inv) return;
        const wrapper = document.createElement("div");
        const input = document.createElement("input"); input.type="number"; input.min=1;
        input.dataset.itemId=id; input.dataset.type="other";
        const key = 'other_'+id;
        input.value = (perSizeData[sizeId] && perSizeData[sizeId][key]) ? perSizeData[sizeId][key] : 1;
        const label = document.createElement("label"); label.textContent = inv.name;
        wrapper.appendChild(label); wrapper.appendChild(document.createTextNode(" Qty: ")); wrapper.appendChild(input);
        div.appendChild(wrapper);
      });
      section.appendChild(div);
    }

    perSizeContainer.appendChild(section);
  });
}

// --- Normalize Category ---
function normalizeCategory(cat){
  if(!cat) return "Others";
  const c = cat.toLowerCase();
  if(["coffee","espresso","tea","drink","juice"].some(k=>c.includes(k))) return "Drink";
  if(["sandwich","burger","wrap"].some(k=>c.includes(k))) return "Food";
  return "Others";
}

// --- Edit Product ---
async function editProduct(product){
  editingProductId=product.id;
  currentMainCategory = normalizeCategory(product.category);
  popupTitle.textContent = `Edit ${currentMainCategory}`;
  productName.value = product.name;
  productCategory.value = currentMainCategory;
  productDescription.value = product.description;
  base64Image = product.image||"";
  previewImage.src = base64Image;
  previewImage.style.display = base64Image?"block":"none";

  selectedIngredients=[]; selectedAddons=[]; selectedOthers=[]; perSizeData={}; globalAddonsData={};

  // Populate selected arrays BEFORE loadInventory to mark checkboxes
  if(Array.isArray(product.sizes)){
    product.sizes.forEach(s=>{
      s.ingredients?.forEach(i=>selectedIngredients.push(i.id));
      s.others?.forEach(o=>selectedOthers.push(o.id));
      s.addons?.forEach(a=>{
        selectedAddons.push(a.id);
        globalAddonsData[a.id]={qty:a.qty||1, price:a.price||0};
      });

      perSizeData[s.id]={};
      s.ingredients?.forEach(i=>perSizeData[s.id]['ingredient_'+i.id]=i.qty||1);
      s.others?.forEach(o=>perSizeData[s.id]['other_'+o.id]=o.qty||1);
    });

    selectedIngredients=[...new Set(selectedIngredients)];
    selectedAddons=[...new Set(selectedAddons)];
    selectedOthers=[...new Set(selectedOthers)];
  }

  await loadInventory();

  // Mark sizes checkbox + restore qty/price
  if(Array.isArray(product.sizes)){
    product.sizes.forEach(s=>{
      const cb = document.querySelector(`.size-checkbox[data-id='${s.id}']`);
      if(cb){ 
        cb.checked = true;
        const row = cb.closest(".size-row");
        if(row){
          const qtyInput = row.querySelector(".size-qty");
          const priceInput = row.querySelector(".size-price");
          if(qtyInput) qtyInput.value = s.qty||1;
          if(priceInput) priceInput.value = s.price||0;
        }
      }
    });
  }

  // Restore add-ons price/qty inputs
  selectedAddons.forEach(id=>{
    const row = document.querySelector(`.addon-checkbox[data-id='${id}']`)?.closest(".addon-row");
    if(row){
      const qtyInput = row.querySelector(".addon-qty");
      const priceInput = row.querySelector(".addon-price");
      if(qtyInput) qtyInput.value = globalAddonsData[id].qty || 1;
      if(priceInput) priceInput.value = globalAddonsData[id].price || 0;

      // Live update addon price/qty
      qtyInput.addEventListener("input", ()=>{ globalAddonsData[id].qty=parseFloat(qtyInput.value)||1; generatePerSizeSections(); });
      priceInput.addEventListener("input", ()=>{ globalAddonsData[id].price=parseFloat(priceInput.value)||0; generatePerSizeSections(); });
    }
  });

  generatePerSizeSections();
  openPopup();
}

// --- Render Products ---
function renderProducts(snapshot){
  const products = snapshot.docs.map(d=>({id:d.id,...d.data()}));
  document.querySelectorAll(".product-list").forEach(pl=>pl.innerHTML="");

  products.forEach(product=>{
    const normalizedCategory = normalizeCategory(product.category);
    const container = document.querySelector(`.product-list[data-category="${normalizedCategory}"]`);
    if(!container) return;

    const div = document.createElement("div");
    div.classList.add("product-item");

    let isOutOfStock = false;
    product.sizes?.forEach(s=>{
      s.ingredients?.forEach(i=>{ 
        const inv = inventoryMap[i.id]; 
        if(!inv || !inv.active || inv.quantity<i.qty) isOutOfStock=true; 
      });
      s.addons?.forEach(a=>{
        const inv = inventoryMap[a.id];
        if(!inv || !inv.active || inv.quantity<a.qty) isOutOfStock=true;
      });
    });

    div.classList.toggle("disabled-product", !product.available || isOutOfStock);

    div.innerHTML=`
      <img src="${product.image||''}" alt="${product.name}" />
      <h4>${product.name}</h4>
      <p>${product.description||''}</p>
      <div class="product-actions">
        <button type="button" class="editBtn" data-id="${product.id}">Edit</button>
        <button type="button" class="deleteBtn" data-id="${product.id}">Delete</button>
        <button type="button" class="toggleBtn" data-id="${product.id}" ${isOutOfStock?"disabled":""}>
          ${product.available?"Disable":"Enable"}
        </button>
      </div>
    `;

    div.querySelector(".editBtn").addEventListener("click", ()=>editProduct(product));
    div.querySelector(".deleteBtn").addEventListener("click", ()=>openDeletePopup(product.id));
    div.querySelector(".toggleBtn").addEventListener("click", async ()=>{
      await updateDoc(doc(db,"products",product.id),{available:!product.available});
    });

    container.appendChild(div);
  });
}

// --- Real-time Product Listener ---
function listenProductChanges(){ 
  onSnapshot(collection(db,"products"), snapshot => renderProducts(snapshot)); 
}

// --- Popup Controls ---
function openPopup(){ popup.classList.add("show"); }
function closePopup(){ popup.classList.remove("show"); }
document.getElementById("cancelBtn").addEventListener("click",closePopup);
window.addEventListener("click", e=>{ if(e.target===popup) closePopup(); });

// --- Add Product Buttons ---
["addDrinkBtn","addSandwichBtn"].forEach(id=>{
  const btn = document.getElementById(id); if(!btn) return;
  btn.addEventListener("click", async e=>{
    e.preventDefault();
    currentMainCategory = normalizeCategory(btn.closest(".category-table").dataset.category);
    popupTitle.textContent = `Add ${currentMainCategory}`;
    popupForm.reset();
    previewImage.style.display="none"; base64Image="";
    editingProductId=null; selectedIngredients=[]; selectedAddons=[]; selectedOthers=[]; perSizeData={}; globalAddonsData={};
    await loadInventory();
    openPopup();
  });
});

// --- Form Submission ---
popupForm.addEventListener("submit", async e=>{
  e.preventDefault(); 
  const name = productName.value.trim(); 
  let category = normalizeCategory(productCategory.value||currentMainCategory);
  const description = productDescription.value.trim();

  const sizes = Array.from(document.querySelectorAll(".size-checkbox:checked")).map(cb=>{
    const row = cb.closest(".size-row");
    return {
      id: cb.dataset.id,
      name: inventoryMap[cb.dataset.id].name,
      unit: inventoryMap[cb.dataset.id].unit||"",
      qty: parseInt(row.querySelector(".size-qty").value),
      price: parseFloat(row.querySelector(".size-price").value),
      ingredients:[], addons:[], others:[]
    };
  });

  document.querySelectorAll(".per-size-section").forEach(section=>{
    const size = sizes.find(s=>s.id===section.dataset.sizeId);
    if(!size) return;
    section.querySelectorAll("input").forEach(inp=>{
      const val=parseFloat(inp.value);
      if(inp.dataset.type==="ingredient") size.ingredients.push({id:inp.dataset.itemId,name:inventoryMap[inp.dataset.itemId].name,qty:val});
      else if(inp.dataset.type==="other") size.others.push({id:inp.dataset.itemId,name:inventoryMap[inp.dataset.itemId].name,qty:val});
    });
  });

  // Apply global add-ons internally
  sizes.forEach(s=>{
    Object.entries(globalAddonsData).forEach(([id,data])=>{
      s.addons.push({id, name: inventoryMap[id].name, qty: data.qty, price: data.price});
    });
  });

  if(!name) return showPopupMessage("Product name is required.");
  if(sizes.length===0) return showPopupMessage("At least 1 size is required.");
  for(const s of sizes){
    if(!s.price||s.price<=0) return showPopupMessage(`Price for size "${s.name}" is required and must be >0.`);
    if(!s.qty||s.qty<=0) return showPopupMessage(`Quantity for size "${s.name}" is required and must be >0.`);
  }

  try{
    if(editingProductId) await updateDoc(doc(db,"products",editingProductId),{name,category,description,sizes,image:base64Image});
    else await addDoc(collection(db,"products"),{name,category,description,sizes,image:base64Image,available:true,createdAt:serverTimestamp()});
    closePopup();
  }catch(err){ showPopupMessage("Error: "+err.message);}
});

// --- Init ---
async function init(){ 
  await loadInventory(); 
  listenProductChanges(); 
}
init();
