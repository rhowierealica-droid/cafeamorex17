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
    "Ingredients": ["g", "ml", "slice", "squeeze", "scoop", "Piece"],
    "Sizes": ["pieces"],
    "Adds-on": ["g", "ml", "slice", "squeeze", "scoop", "Piece"],
    "Others": ["g", "ml", "slice", "squeeze", "scoop", "Piece"]
};

window.showPopup = (category) => {
    currentCategory = category;
    editingItemId = null;
    popupTitle.textContent = "Add " + category.slice(0, -1);
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

    if (!name || isNaN(quantity)) {
        return showMessage({
            title: "Invalid Data",
            text: "Please enter valid data",
            buttons: [{ text: "OK" }]
        });
    }

    try {
        if (editingItemId) {
            await updateDoc(doc(db, "Inventory", editingItemId), { name, quantity, unit, category: currentCategory, active: true });
        } else {
            await addDoc(collection(db, "Inventory"), { name, quantity, unit, category: currentCategory, active: true });
        }
        closePopup();
    } catch (err) {
        showMessage({
            title: "Error",
            text: err.message,
            buttons: [{ text: "OK" }]
        });
    }
};

function getStockStatus(item) {
    const qty = Number(item.quantity) || 0;
    if (["Ingredients", "Adds-on", "Others"].includes(item.category)) {
        if (["g", "ml"].includes(item.unit))
            return qty === 0 ? "Out of Stock" : qty < 50 ? "Low Stock" : "In Stock";
        if (["slice", "piece", "squeeze"].includes(item.unit))
            return qty === 0 ? "Out of Stock" : qty < 10 ? "Low Stock" : "In Stock";
        if (item.unit === "scoop") return qty === 0 ? "Out of Stock" : qty < 5 ? "Low Stock" : "In Stock";
    }
    if (item.category === "Sizes") return qty === 0 ? "Out of Stock" : qty < 30 ? "Low Stock" : "In Stock";
    return qty === 0 ? "Out of Stock" : qty <= 5 ? "Low Stock" : "In Stock";
}

function getStockSortOrder(status) {
    if (status === "Out of Stock") return 1;
    if (status === "Low Stock") return 2;
    if (status === "In Stock") return 3;
    return 4; 
}

function getStatusColor(status) {
    if (status === "In Stock") return "green";
    if (status === "Low Stock") return "orange";
    if (status === "Out of Stock") return "red";
    return "black";
}

onSnapshot(collection(db, "Inventory"), snapshot => {
    Object.values(tables).forEach(tbody => (tbody.innerHTML = ""));

    const groupedItems = {
        "Ingredients": [],
        "Adds-on": [],
        "Sizes": [],
        "Others": []
    };

    snapshot.forEach(docSnap => {
        const item = docSnap.data();
        if (!tables[item.category]) return;

        if (item.active === undefined) item.active = true;
        if (item.quantity === undefined) item.quantity = 0;

        groupedItems[item.category].push({
            id: docSnap.id,
            ...item
        });
    });

    Object.entries(groupedItems).forEach(([category, items]) => {
        const tbody = tables[category];

        items.sort((a, b) => {
            const statusA = getStockStatus(a);
            const statusB = getStockStatus(b);
            const orderA = getStockSortOrder(statusA);
            const orderB = getStockSortOrder(statusB);

            const quantityA = Number(a.quantity) || 0;
            const quantityB = Number(b.quantity) || 0;

            if (orderA !== orderB) return orderA - orderB;
            if (quantityA !== quantityB) return quantityA - quantityB;
            return a.name.localeCompare(b.name);
        });

        items.forEach(item => {
            const docSnapId = item.id;
            const status = getStockStatus(item);
            const color = getStatusColor(status);

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${item.name}</td>
                <td>${item.quantity}</td>
                <td>${item.unit}</td>
                <td style="font-weight:bold;color:${color}">${status}</td>
                <td>
                    <button class="editBtn">Edit</button>
                    <button class="updateBtn">Add Stock</button>
                    <button class="deleteBtn">Delete</button>
                    <button class="toggleBtn">${item.active ? "Disable" : "Enable"}</button>
                </td>
            `;

            tr.querySelector(".editBtn").addEventListener("click", () => {
                currentCategory = item.category;
                editingItemId = docSnapId;
                popupTitle.textContent = "Edit " + item.category.slice(0, -1);
                itemNameInput.value = item.name;
                itemQuantityInput.value = item.quantity;
                itemUnitSelect.innerHTML = "";
                units[item.category].forEach(u => {
                    const option = document.createElement("option");
                    option.value = u;
                    option.textContent = u;
                    if (u === item.unit) option.selected = true;
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
                        await updateDoc(doc(db, "Inventory", docSnapId), { quantity: newQuantity });
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
                            onClick: async () => await deleteDoc(doc(db, "Inventory", docSnapId))
                        },
                        { text: "No" }
                    ]
                });
            });

            tr.querySelector(".toggleBtn").addEventListener("click", async () => {
                await updateDoc(doc(db, "Inventory", docSnapId), { active: !item.active });
            });

            if (item.active === false) tr.style.opacity = "0.5";
            tbody.appendChild(tr);
        });
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
                const recipeItems = [
                    ...(Array.isArray(size.ingredients) ? size.ingredients : []),
                    ...(Array.isArray(size.others) ? size.others : [])
                ];
                recipeItems.forEach(item => {
                    if (item.id) {
                        if (!usageMap.has(item.id)) usageMap.set(item.id, new Set());
                        usageMap.get(item.id).add(productName);
                    }
                });
                if (size.id) {
                    if (!usageMap.has(size.id)) usageMap.set(size.id, new Set());
                    usageMap.get(size.id).add(productName);
                }
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
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
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

    const allSortedSales = Object.values(productSales).sort((a, b) => b.total - a.total);

    const rankedSales = allSortedSales.map((product, index) => ({
        ...product,
        rank: index + 1
    }));

    return rankedSales.slice(0, 5);
}

function formatCurrency(amount) {
    const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
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

        const allInventoryItems = [];
        const lowStockItems = [];
        const affectedProductNames = new Set();

        inventorySnapshot.forEach(docSnap => {
            const item = docSnap.data();
            const status = getStockStatus(item);

            const itemData = {
                ...item,
                quantity: Number(item.quantity) || 0,
                status: status,
                id: docSnap.id,
                usedIn: productUsageMap[docSnap.id] || []
            };

            allInventoryItems.push(itemData);

            if (status === "Low Stock" || status === "Out of Stock") {
                lowStockItems.push(itemData);
                itemData.usedIn.forEach(name => affectedProductNames.add(name));
            }
        });

        lowStockItems.sort((a, b) => getStockSortOrder(a.status) - getStockSortOrder(b.status));

        if (lowStockItems.length === 0 && topSellers.length === 0) {
            return showMessage({
                title: "Report Empty",
                text: "All tracked items are currently In Stock and no recent sales data is available. No low stock report generated.",
                buttons: [{ text: "OK" }]
            });
        }

        const affectedTopSellers = topSellers
            .filter(seller => affectedProductNames.has(seller.name))
            .slice(0, 5);

        const { jsPDF } = window.jspdf;

        if (typeof jsPDF === "undefined") {
            return showMessage({
                title: "PDF Error",
                text: "PDF generation library (jspdf) is not loaded. Please ensure it is included in your HTML file.",
                buttons: [{ text: "OK" }]
            });
        }

        const doc = new jsPDF({ orientation: "portrait" });

        if (typeof doc.autoTable !== "function") {
            return showMessage({
                title: "PDF Error",
                text: "PDF autoTable plugin is not loaded. Please ensure jspdf-autotable is included in your HTML file.",
                buttons: [{ text: "OK" }]
            });
        }

        const today = new Date().toLocaleDateString();
        let finalY = 20;

        // Title
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.setTextColor(75, 54, 33);
        doc.text("Café Amore Low Stock Report", doc.internal.pageSize.width / 2, finalY, { align: 'center' });
        finalY += 8;

        // Date
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Report Generated: ${today}`, 14, finalY);
        finalY += 10;

        doc.setFontSize(14);
        doc.setTextColor(75, 54, 33);
        doc.text("Full Inventory Status", 14, finalY);
        finalY += 6;

        // Description
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text("This table shows the current stock of all inventoried items.", 14, finalY);
        finalY += 4;

        const fullInventoryTableData = allInventoryItems.map(item => [
            item.name,
            item.category,
            `${item.quantity} ${item.unit}`,
            item.status
        ]);

        fullInventoryTableData.sort((a, b) => {
            const statusA = a[3];
            const statusB = b[3];
            const orderA = getStockSortOrder(statusA);
            const orderB = getStockSortOrder(statusB);
            const quantityA = parseFloat(a[2].split(' ')[0]) || 0;
            const quantityB = parseFloat(b[2].split(' ')[0]) || 0;
            if (orderA !== orderB) return orderA - orderB;
            if (quantityA !== quantityB) return quantityA - quantityB;
            return a[0].localeCompare(b[0]);
        });

        doc.autoTable({
            head: [['Item Name', 'Category', 'Current Stock', 'Status']],
            body: fullInventoryTableData,
            startY: finalY,
            theme: 'striped',
            styles: { fontSize: 8, cellPadding: 1.5, lineColor: [230, 230, 230], lineWidth: 0.1 },
            headStyles: { fillColor: [75, 54, 33], textColor: 255, fontSize: 9, fontStyle: 'bold' },
            alternateRowStyles: { fillColor: [250, 245, 235] },
            columnStyles: {
                0: { cellWidth: 70, halign: 'left' },
                1: { cellWidth: 40, halign: 'center' },
                2: { cellWidth: 35, halign: 'right' },
                3: { cellWidth: 35, halign: 'center', fontStyle: 'bold' },
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 3) {
                    const status = data.cell.raw;
                    if (status === "Out of Stock") {
                        data.cell.styles.fillColor = [240, 150, 150];
                        data.cell.styles.textColor = [150, 0, 0];
                    } else if (status === "Low Stock") {
                        data.cell.styles.fillColor = [255, 230, 150];
                        data.cell.styles.textColor = [150, 80, 0];
                    } else if (status === "In Stock") {
                        data.cell.styles.fillColor = [180, 240, 180];
                        data.cell.styles.textColor = [0, 100, 0];
                    }
                }
            }
        });

        finalY = doc.autoTable.previous.finalY + 10;

        // Low Stock & Out of Stock Items
        if (lowStockItems.length > 0) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            doc.setTextColor(192, 57, 43);
            doc.text("Action Required: Low Stock & Out of Stock Items", 14, finalY);
            finalY += 6;

            // Description
            doc.setFontSize(9);
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "normal");
            doc.text("The following items require immediate attention for restocking.", 14, finalY);
            finalY += 4;

            // Low stock table data
            const lowStockTableData = lowStockItems.map(item => [
                item.name,
                item.category,
                `${item.quantity} ${item.unit}`,
                item.status,
                item.usedIn.length > 0 ? item.usedIn.join(', ') : 'N/A'
            ]);

            // Low stock table
            doc.autoTable({
                head: [['Item Name', 'Category', 'Current Stock', 'Status', 'Used In Products']],
                body: lowStockTableData,
                startY: finalY,
                theme: 'striped',
                styles: { fontSize: 8, cellPadding: 1.5, lineColor: [230, 230, 230], lineWidth: 0.1 },
                headStyles: { fillColor: [192, 57, 43], textColor: 255, fontSize: 9, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [250, 245, 235] },
                columnStyles: {
                    0: { cellWidth: 40, halign: 'left' },
                    1: { cellWidth: 20, halign: 'center' },
                    2: { cellWidth: 25, halign: 'right' },
                    3: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
                    4: { cellWidth: 75, halign: 'left' }
                },
                didParseCell: (data) => {
                    if (data.section === 'body' && data.column.index === 3) {
                        const status = data.cell.raw;
                        if (status === "Out of Stock") {
                            data.cell.styles.fillColor = [240, 150, 150];
                            data.cell.styles.textColor = [150, 0, 0];
                        } else if (status === "Low Stock") {
                            data.cell.styles.fillColor = [255, 230, 150];
                            data.cell.styles.textColor = [150, 80, 0];
                        }
                    }
                }
            });
            finalY = doc.autoTable.previous.finalY + 10;
        }

        const allImpactMap = new Map();

        lowStockItems.forEach(item => {
            if (item.usedIn.length > 0) {
                const ingredientName = item.name;
                const affectedProductsList = item.usedIn;
                const mapKey = `${ingredientName} (${item.status})`;

                if (!allImpactMap.has(mapKey)) {
                    allImpactMap.set(mapKey, new Set());
                }
                affectedProductsList.forEach(productName => {
                    allImpactMap.get(mapKey).add(productName);
                });
            }
        });

        if (allImpactMap.size > 0) {
            if (finalY > 260) {
                doc.addPage();
                finalY = 20;
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(75, 54, 33);
            doc.text("Product Impact Analysis", 14, finalY);
            finalY += 8;

            doc.setTextColor(0, 0, 0);
            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");

            const sortedImpactKeys = Array.from(allImpactMap.keys()).sort((a, b) => {
                const isAOut = a.includes("Out of Stock");
                const isBOut = b.includes("Out of Stock");
                if (isAOut && !isBOut) return -1;
                if (!isAOut && isBOut) return 1;
                return a.localeCompare(b);
            });

            let essayText = "Immediate action is required as several inventory items are critically low or out of stock, directly impacting product availability. ";
            let outOfStockItems = [];
            let lowStockItemsList = [];

            sortedImpactKeys.forEach(mapKey => {
                const productNames = Array.from(allImpactMap.get(mapKey)).sort();
                const [ingredientName, status] = mapKey.match(/^(.*) \((.*)\)$/).slice(1);

                const productListString = productNames.length > 2
                    ? productNames.slice(0, -1).join(', ') + `, and ${productNames[productNames.length - 1]}`
                    : productNames.join(' and ');

                if (status.includes("Out of Stock")) {
                    outOfStockItems.push(`**${ingredientName}** (Out of Stock), which prevents the sale of: ${productListString}`);
                } else if (status.includes("Low Stock")) {
                    lowStockItemsList.push(`**${ingredientName}** (Low Stock), which impacts: ${productListString}`);
                }
            });

            if (outOfStockItems.length > 0) {
                essayText += "The most critical shortages involve items that are **Out of Stock**: ";
                essayText += outOfStockItems.join('. ');
                essayText += ". ";
            }

            if (lowStockItemsList.length > 0) {
                if (outOfStockItems.length > 0) {
                    essayText += "Additionally, supplies for several ingredients are **Low Stock**: ";
                } else {
                    essayText += "Supplies for several ingredients are currently **Low Stock**: ";
                }
                essayText += lowStockItemsList.join('. ');
                essayText += ". ";
            }

            const boldMarkers = [];
            essayText = essayText.replace(/\*\*(.*?)\*\*/g, (match, p1) => {
                const marker = `__BOLD_MARKER_${boldMarkers.length}__`;
                boldMarkers.push(p1);
                return marker;
            });

            const lines = doc.splitTextToSize(essayText, 180);
            const lineYStart = finalY;

            lines.forEach((line, lineIndex) => {
                let currentX = 14;
                let lineParts = [line];

                boldMarkers.forEach((text, index) => {
                    const marker = `__BOLD_MARKER_${index}__`;
                    lineParts = lineParts.flatMap(part => {
                        if (typeof part === 'string' && part.includes(marker)) {
                            const split = part.split(marker);
                            return [split[0], { text: text, bold: true }, split[1]].filter(p => p !== '');
                        }
                        return part;
                    });
                });

                lineParts.forEach(part => {
                    const text = typeof part === 'string' ? part : part.text;
                    const isBold = typeof part === 'object' && part.bold;

                    doc.setFont("helvetica", isBold ? "bold" : "normal");
                    doc.setTextColor(isBold ? 75 : 0, isBold ? 54 : 0, isBold ? 33 : 0);
                    const textWidth = doc.getStringUnitWidth(text) * doc.internal.getFontSize() / doc.internal.scaleFactor;
                    doc.text(text, currentX, finalY + 4);
                    currentX += textWidth;
                });
                finalY += 5; 
            });

            finalY += 5; 
        }

        // High Priority Products
        if (affectedTopSellers.length > 0) {
            if (finalY > 260) {
                doc.addPage();
                finalY = 20;
            }

            // Header
            doc.setFont("helvetica", "bold");
            doc.setFontSize(16);
            doc.setTextColor(75, 54, 33);
            doc.text(`High-Priority Products Affected (Top 5 Last 7 Days)`, 14, finalY);
            finalY += 8;

            doc.setFontSize(9);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(0, 0, 0);
            affectedTopSellers.forEach(seller => {
                const formattedSales = (seller.total);
                const text = `Top ${seller.rank}. ${seller.name} (${seller.qty} sold) - ${formattedSales} Sales`;
                doc.text(text, 14, finalY);
                finalY += 4.5;
            });
            finalY += 2;
        }

        // Save the PDF
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

