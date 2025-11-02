import { db } from './firebase-config.js';
import { 
    collection, addDoc, onSnapshot, updateDoc, doc, deleteDoc,
    writeBatch, getDoc, getDocs, query, where, Timestamp 
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

/**
 * @returns {Promise<Map<string, string[]>>} 
 */
async function getInventoryProductUsageMap() {
    const productsSnapshot = await getDocs(collection(db, "products"));
    const usageMap = new Map();

    productsSnapshot.forEach(docSnap => {
        const product = docSnap.data();
        const productName = product.name;

        if (Array.isArray(product.sizes)) {
            product.sizes.forEach(size => {
                // Inventory used in a product (Ingredients/Others)
                const recipeItems = [
                    ...(Array.isArray(size.ingredients) ? size.ingredients : []),
                    ...(Array.isArray(size.others) ? size.others : []),
                ];
                recipeItems.forEach(item => {
                    if (item.id) {
                        if (!usageMap.has(item.id)) usageMap.set(item.id, new Set());
                        usageMap.get(item.id).add(productName);
                    }
                });
                
                if (size.id) { // Check if size has a inventory ID
                    if (!usageMap.has(size.id)) usageMap.set(size.id, new Set());
                    usageMap.get(size.id).add(productName);
                }
                
                // Inventory items that are available as Add-ons
                if (Array.isArray(size.addons)) {
                    size.addons.forEach(addon => {
                        if (addon.id) {
                            if (!usageMap.has(addon.id)) usageMap.set(addon.id, new Set());
                            usageMap.get(addon.id).add(productName);
                        }
                    });
                }
            });
        }
    });
    
    const finalMap = {};
    for (const [key, value] of usageMap.entries()) {
        finalMap[key] = Array.from(value);
    }

    return finalMap;
}

/**
 * @returns {Promise<Array<{name: string, qty: number, total: number}>>} 
 */
async function getTop5BestsellersLast7Days() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); 
    const sevenDaysAgoTimestamp = Timestamp.fromDate(sevenDaysAgo);
    
    const collections = ["InStoreOrders", "DeliveryOrders"];
    const productSales = {};

    const getNetTotal = (order) => {
        const total = order.total || 0;
        const deliveryFee = order.deliveryFee || 0;


        if (order.collection === "DeliveryOrders" && deliveryFee > 0) {
            return total - deliveryFee;
        }
        return total;
    };
    
    const formatCurrency = (amount) => {
        const formatted = new Intl.NumberFormat("en-PH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
        return `₱${formatted.replace(/[^\d,.,-]/g, "")}`;
    };


    for (const col of collections) {
        const q = query(
            collection(db, col),
            where("status", "==", "Completed"), 
            where("createdAt", ">=", sevenDaysAgoTimestamp)
        );
        const snapshot = await getDocs(q);

        snapshot.forEach(docSnap => {
            const order = docSnap.data();
            order.collection = col; 

            const orderTotal = order.total || 0;
            const orderNetTotal = getNetTotal(order);
            
            const totalProductValueInOrder = (order.products || order.items || []).reduce(
                (sum, p) => sum + (p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0)),
                0
            );
            const salesAdjustmentRatio = totalProductValueInOrder > 0 ? orderNetTotal / totalProductValueInOrder : 0;


            (order.products || order.items || []).forEach(p => {
                const name = p.product || "Unnamed Product"; 
                const qty = p.qty || 1;
                
                const lineTotal =
                    p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0);
                const netLineTotal = lineTotal * salesAdjustmentRatio;

                if (!productSales[name]) productSales[name] = { name: name, qty: 0, total: 0 };
                productSales[name].qty += qty;
                productSales[name].total += netLineTotal; 
            });
        });
    }

    return Object.values(productSales)
        .sort((a, b) => b.total - a.total) 
        .slice(0, 5);
}


function formatCurrency(amount) {
    const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
    // Use the currency symbol '₱'
    return `₱${formatted.replace(/[^\d,.,-]/g, "")}`;
}


window.generateLowStockPDF = async () => {
    showMessage({
        title: "Generating Report...",
        text: "Fetching inventory, product usage, and recent sales data to create the PDF report.",
        buttons: []
    });

    try {
        const inventorySnapshot = await getDocs(collection(db, "Inventory"));
        const productUsageMap = await getInventoryProductUsageMap(); 
        const topSellers = await getTop5BestsellersLast7Days(); 

        const lowStockItems = [];

        inventorySnapshot.forEach(docSnap => {
            const item = docSnap.data();
            const status = getStockStatus(item);
            // Only include items that are low or out of stock
            if (status === "Low Stock" || status === "Out of Stock") {
                lowStockItems.push({
                    ...item,
                    quantity: Number(item.quantity) || 0,
                    status: status,
                    id: docSnap.id,
                    usedIn: productUsageMap[docSnap.id] || [], 
                });
            }
        });

        if (lowStockItems.length === 0 && topSellers.length === 0) {
            return showMessage({
                title: "Report Empty",
                text: "All tracked items are currently In Stock and no recent sales data is available. No low stock report generated.",
                buttons: [{ text: "OK" }]
            });
        }
        
        // PDF Design
        const { jsPDF } = window.jspdf;
        
        if (typeof jsPDF === 'undefined') {
             return showMessage({
                 title: "PDF Error",
                 text: "PDF generation library (jspdf) is not loaded. Please ensure it is included in your HTML file.",
                 buttons: [{ text: "OK" }]
             });
        }

        const doc = new jsPDF({ orientation: "portrait" }); 
        
        if (typeof doc.autoTable !== 'function') {
             return showMessage({
                 title: "PDF Error",
                 text: "PDF autoTable plugin is not loaded. Please ensure jspdf-autotable is included in your HTML file.",
                 buttons: [{ text: "OK" }]
             });
        }

        const today = new Date().toLocaleDateString();

        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text("Café Amore Low Stock Report", doc.internal.pageSize.width / 2, 20, { align: 'center' }); 

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.text(`Report Generated: ${today}`, 14, 28);
        
        doc.setFontSize(14);
        doc.setTextColor(75, 54, 33); 
        doc.text("Full Low Stock Inventory Details", 14, 38); 
        
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0); 
        doc.text("This table lists all items that are Low Stock or Out of Stock.", 14, 44);


        const tableData = lowStockItems.map(item => [
            item.name,
            item.category,
            `${item.quantity} ${item.unit}`, 
            item.status,
            item.usedIn.length > 0 ? item.usedIn.join(', ') : 'N/A' 
        ]);

        doc.autoTable({
            head: [['Item Name', 'Category', 'Current Stock', 'Status', 'Used In Products']], 
            body: tableData,
            startY: 48, 
            theme: 'striped',
            styles: { fontSize: 7, cellPadding: 1.5, lineColor: [230, 230, 230], lineWidth: 0.1 }, 
            headStyles: { fillColor: [75, 54, 33], textColor: 255, fontSize: 8, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [250, 245, 235] },
            columnStyles: {
                0: { cellWidth: 40, halign: 'left' }, // Item Name
                1: { cellWidth: 20, halign: 'center' }, // Category
                2: { cellWidth: 25, halign: 'right' }, // Current Stock
                3: { cellWidth: 20, halign: 'center' }, // Status
                4: { cellWidth: 75, halign: 'left' }, // Used In Products 
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 3) {
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
        
        let finalY = doc.autoTable.previous.finalY + 10;
        
        if (finalY > 260) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.setTextColor(75, 54, 33); 
        doc.text(" Stock Analysis Summary", 14, finalY);
        finalY += 8;
        
        doc.setTextColor(0, 0, 0); 
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        
        const outOfStock = lowStockItems.filter(item => item.status === "Out of Stock");
        const lowStock = lowStockItems.filter(item => item.status === "Low Stock");

        // Low Stock
        if (lowStock.length > 0) {
            doc.setFont("helvetica", "bold");
            doc.text(`${lowStock.length} item(s) need to be restocked soon:`, 14, finalY);
            finalY += 6;
            doc.setFont("helvetica", "normal");
            lowStock.forEach((item, index) => { 
                const text = `${index + 1}. ${item.name} (only ${item.quantity} ${item.unit} left)`; 
                doc.text(text, 18, finalY);
                finalY += 4.5;
            });
            finalY += 2;
        }

        // Out of Stock
        if (outOfStock.length > 0) {
            doc.setFont("helvetica", "bold");
            doc.text(`${outOfStock.length} item(s) are completely out of stock:`, 14, finalY);
            finalY += 6;
            doc.setFont("helvetica", "normal");
            outOfStock.forEach((item, index) => { 
                doc.text(`${index + 1}. ${item.name}`, 18, finalY);
                finalY += 4.5;
            });
            finalY += 2;
        }

        if (finalY > 260) {
            doc.addPage();
            finalY = 20;
        }

        const ingredientImpactMap = new Map();

        lowStockItems.forEach(item => {
            if (item.status === "Out of Stock" && item.usedIn.length > 0) {
                const ingredientName = item.name;
                const affectedProductsList = item.usedIn;
                
                if (!ingredientImpactMap.has(ingredientName)) {
                    ingredientImpactMap.set(ingredientName, new Set());
                }
                affectedProductsList.forEach(productName => {
                    ingredientImpactMap.get(ingredientName).add(productName);
                });
            }
        });

        if (ingredientImpactMap.size > 0) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(192, 57, 43); // Red/Orange for warning
            doc.text(" Product Impact Analysis (Out of Stock)", 14, finalY);
            finalY += 8;
            
            doc.setTextColor(0, 0, 0); 
            doc.setFontSize(9); 
            doc.setFont("helvetica", "normal");
            
            ingredientImpactMap.forEach((productNames, ingredientName) => {
                
                if (finalY > 260) { 
                    doc.addPage();
                    finalY = 20;
                }
                
                doc.setFont("helvetica", "bold");
                const titleText = `${ingredientName} ${productNames.size > 1 ? 'Affect' : 'can affect'}`;
                doc.text(titleText, 14, finalY);
                doc.setFont("helvetica", "normal");
                finalY += 5;

                const sortedProducts = Array.from(productNames).sort();

                sortedProducts.forEach((productName, index) => {
                    const text = `${index + 1}. ${productName}`;
                    
                    const lines = doc.splitTextToSize(text, 180); 
                    lines.forEach(line => {
                        doc.text(line, 18, finalY); 
                        // ALIGNMENT/SPACING 
                        finalY += 4; 
                    });
                });
                finalY += 2;
            });
        }
        
        if (finalY > 260) {
            doc.addPage();
            finalY = 20;
        }

        //Sales Trend
        if (topSellers.length > 0) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(75, 54, 33); 
            
            doc.text(`Sales Trend Affect the top ${topSellers.length} products (Last 7 Days)`, 14, finalY);
            finalY += 8;
            
            doc.setFontSize(9); 
            doc.setFont("helvetica", "normal");
            
            topSellers.forEach((seller, index) => {
                const formattedSales = formatCurrency(seller.total);
                const text = `${index + 1}. ${seller.name} (${seller.qty} sold) - ${formattedSales} Sales`; 
                
                doc.text(text, 14, finalY);
                finalY += 4.5;
            });
            finalY += 2;
        }
        
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
            text: `Failed to generate PDF. Check console for details. Error: ${error.message}. Ensure jspdf and jspdf-autotable are loaded.`,
            buttons: [{ text: "OK" }]
        });
    }
};
