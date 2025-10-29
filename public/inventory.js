import { db } from './firebase-config.js';
import { 
    collection, addDoc, onSnapshot, updateDoc, doc, deleteDoc,
    writeBatch, getDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentCategory = "";
let editingItemId = null;

const auth = getAuth();
const popupForm = document.getElementById("popupForm");
const popupTitle = document.getElementById("popupTitle");
const itemNameInput = document.getElementById("itemName");
const itemQuantityInput = document.getElementById("itemQuantity");
const itemUnitSelect = document.getElementById("itemUnit");

const messagePopup = document.getElementById("messagePopup");
const messageTitle = document.getElementById("messageTitle");
const messageText = document.getElementById("messageText");
const messageActions = document.getElementById("messageActions");

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace("login.html"); 
        return;
    }
});


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

window.showMessage = ({ title = "", text = "", buttons = [] }) => {
    messageTitle.textContent = title;
    messageText.textContent = text;
    messageActions.innerHTML = "";

    buttons.forEach(btn => {
        const button = document.createElement("button");
        button.textContent = btn.text;
        button.style.background = btn.background || "#6f4e37";
        button.style.color = btn.color || "white";
        button.classList.add("action-btn");
        button.onclick = () => {
            btn.onClick?.();
            messagePopup.style.display = "none";
        };
        messageActions.appendChild(button);
    });

    messagePopup.style.display = "flex";
};

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
                <button class="updateBtn">Add Stock</button>
                <button class="deleteBtn">Delete</button>
                <button class="toggleBtn">${item.active?"Disable":"Enable"}</button>
            </td>
        `;

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

    tr.querySelector(".updateBtn").addEventListener("click", () => {
        const addStockPopup = document.createElement("div");
        addStockPopup.classList.add("popup");
        addStockPopup.style.display = "flex";

        addStockPopup.innerHTML = `
            <div class="popup-content">
                <h3 style="color:#6f4e37;">Add Stock for ${item.name}</h3>
                <input type="number" id="addQtyInput" min="1" placeholder="Enter quantity to add" style="margin:10px 0; padding:6px;">
                <div class="popup-actions">
                    <button id="confirmAddStock">Add</button>
                    <button id="cancelAddStock">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(addStockPopup);

        document.getElementById("confirmAddStock").addEventListener("click", async () => {
            const addQtyInput = document.getElementById("addQtyInput");
            const addQty = parseFloat(addQtyInput.value);
            if (!isNaN(addQty) && addQty > 0) {
                const newQuantity = Number(item.quantity) + addQty;
                await updateDoc(doc(db, "Inventory", docSnap.id), { quantity: newQuantity });
                document.body.removeChild(addStockPopup);
                console.log(`✅ Added ${addQty} to ${item.name}.`);
            } else {
                showMessage({
                    title: "Invalid Quantity",
                    text: "Please enter a valid quantity greater than zero to add stock.",
                    buttons: [{ text: "OK" }]
                });
            }
        });

        document.getElementById("cancelAddStock").addEventListener("click", () => {
            document.body.removeChild(addStockPopup);
        });
    });


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

        tr.querySelector(".toggleBtn").addEventListener("click", async () => {
            await updateDoc(doc(db,"Inventory",docSnap.id), { active: !item.active });
        });

        if(item.active === false) tr.style.opacity = "0.5";
        tbody.appendChild(tr);
    });
});


export async function deductInventoryForOrder(orderItems) {
    if (!orderItems || !Array.isArray(orderItems)) return;
    const batch = writeBatch(db);

    for (const item of orderItems) {
        const productId = item.productId || item.id;
        const qtyOrdered = Number(item.quantity) || 0;
        if (!productId || qtyOrdered <= 0) continue;

        const invRef = doc(db, "Inventory", productId);
        const invSnap = await getDoc(invRef);
        if (!invSnap.exists()) continue;

        const invData = invSnap.data();
        const currentQty = Number(invData.quantity) || 0;

        const newQty = Math.max(0, currentQty - qtyOrdered);

        batch.update(invRef, { quantity: newQty });
    }

    await batch.commit();
    console.log("✅ Inventory automatically deducted for order (no outgoing).");
}

window.generateLowStockPDF = async () => {
    showMessage({
        title: "Generating Report...",
        text: "Fetching latest inventory data to create the PDF report.",
        buttons: []
    });

    try {
        const snapshot = await getDocs(collection(db, "Inventory"));
        const lowStockItems = [];

        snapshot.forEach(docSnap => {
            const item = docSnap.data();
            const status = getStockStatus(item);
            if (status === "Low Stock" || status === "Out of Stock") {
                lowStockItems.push({
                    ...item,
                    status: status,
                    id: docSnap.id
                });
            }
        });

        if (lowStockItems.length === 0) {
            return showMessage({
                title: "Report Empty",
                text: "All tracked items are currently In Stock. No low stock report generated.",
                buttons: [{ text: "OK" }]
            });
        }

        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            return showMessage({
                title: "PDF Error",
                text: "PDF generation libraries (jspdf/autotable) are not loaded. Please ensure they are included in your HTML file.",
                buttons: [{ text: "OK" }]
            });
        }
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "portrait" });
        const today = new Date().toLocaleDateString();

        doc.setFont("helvetica", "bold");
        doc.setFontSize(22);
        doc.text("Café Amore Low Stock Report", 14, 20); 

        doc.setFont("helvetica", "normal");
        doc.setFontSize(12);
        doc.text(`Report Generated: ${today}`, 14, 28);

        const tableData = lowStockItems.map(item => [
            item.name,
            item.category,
            item.quantity,
            item.unit,
            item.status
        ]);

       doc.autoTable({
    head: [['Item Name', 'Category', 'Current Quantity', 'Unit', 'Status']],
    body: tableData,
    startY: 45,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 3, lineColor: [230, 230, 230], lineWidth: 0.1 },
    headStyles: { fillColor: [75, 54, 33], textColor: 255, fontSize: 10, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 245, 235] },
    columnStyles: {
        0: { cellWidth: 60, halign: 'left' },      
        1: { cellWidth: 35, halign: 'center' },    
        2: { cellWidth: 40, halign: 'right' },     
        3: { cellWidth: 30, halign: 'center' },    
        4: { cellWidth: 30, halign: 'center' },    
    },
    
    didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
            
            const status = data.cell.raw;

            if (status === "Out of Stock") {
                data.cell.styles.fillColor = [240, 150, 150]; 
                data.cell.styles.textColor = [150, 0, 0];   
                data.cell.styles.fontStyle = 'bold';
            } else if (status === "Low Stock") {
                data.cell.styles.fillColor = [255, 230, 150]; 
                data.cell.styles.textColor = [150, 80, 0];   
                data.cell.styles.fontStyle = 'bold';
            }
            
        }
    }
});

        doc.save(`Low_Stock_Report_${new Date().toLocaleDateString().replace(/\//g, '-')}.pdf`);
        
        showMessage({
            title: "Report Generated",
            text: `Successfully created a PDF report with ${lowStockItems.length} items needing restock.`,
            buttons: [{ text: "OK" }]
        });

    } catch (error) {
        console.error("PDF Generation Error:", error);
        showMessage({
            title: "Report Error",
            text: `Failed to generate PDF. Check console for details. Error: ${error.message}`,
            buttons: [{ text: "OK" }]
        });
    }
};
