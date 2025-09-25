import { db } from './firebase-config.js';
import { collection, addDoc, onSnapshot, updateDoc, doc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let currentCategory = "";
let editingItemId = null;

// --- DOM Elements ---
const popupForm = document.getElementById("popupForm");
const popupTitle = document.getElementById("popupTitle");
const itemNameInput = document.getElementById("itemName");
const itemQuantityInput = document.getElementById("itemQuantity");
const itemUnitSelect = document.getElementById("itemUnit");

const messagePopup = document.getElementById("messagePopup");
const messageTitle = document.getElementById("messageTitle");
const messageText = document.getElementById("messageText");
const messageActions = document.getElementById("messageActions");

const tables = {
  "Ingredients": document.querySelector("#ingredientsTable tbody"),
  "Adds-on": document.querySelector("#addonsTable tbody"),
  "Sizes": document.querySelector("#sizesTable tbody"),
  "Others": document.querySelector("#othersTable tbody")
};

const units = {
  "Ingredients": ["g","ml","slice","squeeze","scoop","Piece"],
  "Sizes": ["pieces"],
  "Adds-on": ["g","ml","slice","squeeze","scoop","Piece"],
  "Others": ["g","ml","slice","squeeze","scoop","Piece"]
};

// --- Popup functions ---
window.showPopup = (category) => {
  currentCategory = category;
  editingItemId = null;
  popupTitle.textContent = "Add " + category.slice(0,-1);
  itemNameInput.value = "";
  itemQuantityInput.value = "";
  itemUnitSelect.innerHTML = "";
  units[category].forEach(u => {
    const option = document.createElement("option");
    option.value = u;
    option.textContent = u;
    itemUnitSelect.appendChild(option);
  });
  popupForm.style.display = "flex";
};
window.closePopup = () => popupForm.style.display = "none";

// --- Message popup helper ---
window.showMessage = ({ title = "", text = "", buttons = [] }) => {
  messageTitle.textContent = title;
  messageText.textContent = text;
  messageActions.innerHTML = "";

  buttons.forEach(btn => {
    const button = document.createElement("button");
    button.textContent = btn.text;
    button.style.background = btn.background || "#6f4e37";
    button.style.color = btn.color || "white";
    button.onclick = () => {
      btn.onClick?.();
      messagePopup.style.display = "none";
    };
    messageActions.appendChild(button);
  });

  messagePopup.style.display = "flex";
};

// --- Save item ---
window.saveItem = async () => {
  const name = itemNameInput.value.trim();
  const quantity = Math.max(0, parseFloat(itemQuantityInput.value));
  const unit = itemUnitSelect.value;

  if(!name || isNaN(quantity)) {
    return showMessage({
      title: "Invalid Data",
      text: "Please enter valid data",
      buttons: [{ text: "OK" }]
    });
  }

  try {
    if(editingItemId) {
      await updateDoc(doc(db,"Inventory",editingItemId), { name, quantity, unit, category: currentCategory, active:true });
    } else {
      await addDoc(collection(db,"Inventory"), { name, quantity, unit, category: currentCategory, active:true });
    }
    closePopup();
  } catch(err) {
    showMessage({
      title: "Error",
      text: err.message,
      buttons: [{ text: "OK" }]
    });
  }
};

// --- Stock helpers ---
function getStockStatus(item){
  const qty = Number(item.quantity) || 0;
  if(["Ingredients","Adds-on","Others"].includes(item.category)){
    if(["g","ml"].includes(item.unit)) return qty===0?"Out of Stock":qty<50?"Low Stock":"In Stock";
    if(["slice","piece","squeeze"].includes(item.unit)) return qty===0?"Out of Stock":qty<10?"Low Stock":"In Stock";
    if(item.unit==="scoop") return qty===0?"Out of Stock":qty<5?"Low Stock":"In Stock";
  }
  if(item.category==="Sizes") return qty===0?"Out of Stock":qty<30?"Low Stock":"In Stock";
  return qty===0?"Out of Stock":qty<=5?"Low Stock":"In Stock";
}
function getStatusColor(status){
  if(status==="In Stock") return "green";
  if(status==="Low Stock") return "orange";
  if(status==="Out of Stock") return "red";
  return "black";
}

// --- Load inventory ---
onSnapshot(collection(db,"Inventory"), snapshot => {
  Object.values(tables).forEach(tbody => tbody.innerHTML = "");
  snapshot.forEach(docSnap => {
    const item = docSnap.data();
    const tbody = tables[item.category];
    if(!tbody) return;

    if(item.active === undefined) item.active = true;
    if(item.quantity === undefined) item.quantity = 0;

    const tr = document.createElement("tr");
    const status = getStockStatus(item);
    const color = getStatusColor(status);

    tr.innerHTML = `
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${item.unit}</td>
      <td style="font-weight:bold;color:${color}">${status}</td>
      <td>
        <button class="editBtn">Edit</button>
        <button class="deleteBtn">Delete</button>
        <button class="toggleBtn">${item.active?"Disable":"Enable"}</button>
      </td>
    `;

    // --- Edit item ---
    tr.querySelector(".editBtn").addEventListener("click", () => {
      currentCategory = item.category;
      editingItemId = docSnap.id;
      popupTitle.textContent = "Edit " + item.category.slice(0,-1);
      itemNameInput.value = item.name;
      itemQuantityInput.value = item.quantity;
      itemUnitSelect.innerHTML = "";
      units[item.category].forEach(u => {
        const option = document.createElement("option");
        option.value = u;
        option.textContent = u;
        if(u === item.unit) option.selected = true;
        itemUnitSelect.appendChild(option);
      });
      popupForm.style.display = "flex";
    });

    // --- Delete item ---
    tr.querySelector(".deleteBtn").addEventListener("click", () => {
      showMessage({
        title: "Delete Item",
        text: "Are you sure you want to delete this item?",
        buttons: [
          {
            text: "Yes",
            background: "#c0392b",
            onClick: async () => await deleteDoc(doc(db,"Inventory",docSnap.id))
          },
          { text: "No" }
        ]
      });
    });

    // --- Toggle active ---
    tr.querySelector(".toggleBtn").addEventListener("click", async () => {
      await updateDoc(doc(db,"Inventory",docSnap.id), { active: !item.active });
    });

    if(item.active === false) tr.style.opacity = "0.5";
    tbody.appendChild(tr);
  });
});
