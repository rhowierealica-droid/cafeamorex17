import { db } from "./firebase-config.js";
import {
    collection,
    onSnapshot,
    query,
    where,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth,
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { jsPDF } = window.jspdf;

const auth = getAuth();
const salesLabelEl = document.getElementById("salesLabel");
const completedLabelEl = document.getElementById("completedLabel");
const cancelledLabelEl = document.getElementById("cancelledLabel");
const refundedLabelEl = document.getElementById("refundedLabel");
const refundedValueEl = document.getElementById("refundedToday");

const salesValueEl = document.getElementById("salesToday");
const completedValueEl = document.getElementById("completedToday");
const cancelledValueEl = document.getElementById("cancelledToday");
const cashTotalEl = document.getElementById("cashTotal");
const ePayTotalEl = document.getElementById("ePayTotal");
const bestSellersTable = document.getElementById("bestSellersTable");
const salesChartEl = document.getElementById("salesChart");

const salesFilter = document.getElementById("salesFilter");
const paymentFilter = document.getElementById("paymentFilter");
const channelFilter = document.getElementById("channelFilter");
const productFilter = document.getElementById("productFilter");
const customRangeEl = document.getElementById("customRange");

const generatePdfBtn = document.getElementById("generatePdfBtn");

let allOrders = [];
let salesChart;
let customRangePicker;
let currentFilteredOrders = [];

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace("login.html");
        return;
    }
    await loadOrdersRealtime();
});

function initCustomRange() {
    if (typeof flatpickr !== "undefined" && !customRangePicker) {
        customRangePicker = flatpickr(customRangeEl, {
            mode: "range",
            dateFormat: "Y-m-d",
            onClose: renderDashboard,
        });
    }
}

salesFilter.addEventListener("change", () => {
    if (salesFilter.value === "custom") {
        customRangeEl.style.display = "inline-block";
        initCustomRange();
    } else {
        customRangeEl.style.display = "none";
        if (customRangePicker) customRangePicker.clear();
        renderDashboard();
    }
});

if (generatePdfBtn) {
    generatePdfBtn.addEventListener("click", generateSalesPdf);
}

let unsubscribeListeners = [];

async function loadOrdersRealtime() {
    unsubscribeListeners.forEach((unsub) => unsub());
    unsubscribeListeners = [];

    const collections = ["InStoreOrders", "DeliveryOrders"];
    allOrders = [];

    for (const col of collections) {
        const colRef = collection(db, col);
        const unsubscribe = onSnapshot(colRef, (snapshot) => {
            allOrders = allOrders.filter((o) => o.collection !== col);
            snapshot.docs.forEach((docSnap) => {
                const data = docSnap.data();
                data.collection = col;
                data.channel = col === "InStoreOrders" ? "In-store" : "Online";
                allOrders.push(data);
            });
            renderDashboard();
        });
        unsubscribeListeners.push(unsubscribe);
    }
}

function filterOrders() {
    const timeVal = salesFilter.value;
    const paymentVal = paymentFilter.value;
    const channelVal = channelFilter.value;
    const productVal = productFilter.value.toLowerCase();

    const now = new Date();
    let startDate = null,
        endDate = null;

    if (timeVal === "custom" && customRangeEl.value) {
        const dates = customRangeEl.value.split(" to ");
        startDate = new Date(dates[0] + "T00:00:00");
        const endDateStr = dates.length > 1 ? dates[1] : dates[0];
        endDate = new Date(endDateStr + "T23:59:59");
    }

    return allOrders.filter((order) => {
        if (!order.createdAt) return false;
        const createdAt = order.createdAt.toDate
            ? order.createdAt.toDate()
            : order.createdAt;

        let timePass = false;
        if (timeVal === "custom" && startDate && endDate) {
            timePass =
                createdAt.getTime() >= startDate.getTime() &&
                createdAt.getTime() <= endDate.getTime();
        } else {
            switch (timeVal) {
                case "today":
                    timePass = sameDay(createdAt, now);
                    break;
                case "week":
                    timePass = weekDiff(createdAt, now) === 0;
                    break;
                case "month":
                    timePass =
                        createdAt.getMonth() === now.getMonth() &&
                        createdAt.getFullYear() === now.getFullYear();
                    break;
                case "year":
                    timePass = createdAt.getFullYear() === now.getFullYear();
                    break;
                case "all":
                    timePass = true;
                    break;
                default:
                    timePass = false;
            }
        }

        const paymentPass =
            paymentVal === "all" || order.paymentMethod === paymentVal;
        const channelPass = channelVal === "all" || order.channel === channelVal;
        const productPass =
            productVal === "" ||
            (order.products || order.items || []).some((p) =>
                (p.product || "").toLowerCase().includes(productVal)
            );

        return timePass && paymentPass && channelPass && productPass;
    });
}


function formatCurrency(amount) {
    const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
    return `₱${formatted.replace(/[^\d,.,-]/g, "")}`;
}

function formatNumber(amount) {
    const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
    return formatted.replace(/[^\d,.,-]/g, "");
}

function renderDashboard() {
    const orders = filterOrders();
    currentFilteredOrders = orders;

    const completedOrders = orders.filter(
        (o) => o.status && o.status.toLowerCase().includes("completed")
    );

    const strictlyCancelledOrders = orders.filter(
        (o) =>
            o.status &&
            o.status.toLowerCase().includes("cancel") &&
            !o.status.toLowerCase().includes("refund")
    );

    const strictlyRefundedOrders = orders.filter(
        (o) =>
            o.status &&
            (o.status.toLowerCase().includes("refunded") ||
                o.status.toLowerCase().includes("stockreturned"))
    );

    // Helper to get the total *excluding* the delivery fee, if present.
    // Assumes deliveryFee is stored in the order object for DeliveryOrders
    const getNetTotal = (order) => {
        const total = order.total || 0;
        const deliveryFee = order.deliveryFee || 0;

        // Only deduct deliveryFee if the order came from the DeliveryOrders collection
        // and a deliveryFee is actually present.
        if (order.collection === "DeliveryOrders" && deliveryFee > 0) {
            return total - deliveryFee;
        }
        return total;
    };


    const totalSales = completedOrders.reduce(
        (sum, o) => sum + getNetTotal(o),
        0
    );
    let cashTotal = 0,
        ePayTotal = 0;

    completedOrders.forEach((o) => {
        const netTotal = getNetTotal(o);
        if (o.paymentMethod === "Cash") cashTotal += netTotal;
        if (o.paymentMethod === "E-Payment") ePayTotal += netTotal;
    });

    const filterText = salesFilter.options[
        salesFilter.selectedIndex
    ].text.replace(/[^\w\s]/g, "");
    salesLabelEl.textContent = `Sales ${filterText}`;
    completedLabelEl.textContent = `Completed Orders ${filterText}`;
    cancelledLabelEl.textContent = `Cancelled Orders ${filterText}`;
    if (refundedLabelEl) {
        refundedLabelEl.textContent = `Refunded Orders ${filterText}`;
    }

    salesValueEl.textContent = formatCurrency(totalSales);
    completedValueEl.textContent = completedOrders.length;
    cancelledValueEl.textContent = strictlyCancelledOrders.length;
    if (refundedValueEl) {
        refundedValueEl.textContent = strictlyRefundedOrders.length;
    }

    cashTotalEl.textContent = formatCurrency(cashTotal);
    ePayTotalEl.textContent = formatCurrency(ePayTotal);

    renderHourlyChart(completedOrders);
    renderTopSellers(completedOrders);
}

function renderHourlyChart(orders) {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const data = Array(24).fill(0);
    orders.forEach((o) => {
        const createdAt = o.createdAt.toDate ? o.createdAt.toDate() : o.createdAt;
        const total = o.total || 0;
        const deliveryFee = o.deliveryFee || 0;
        let netTotal = total;
        
        // Deduct delivery fee for chart data
        if (o.collection === "DeliveryOrders" && deliveryFee > 0) {
            netTotal = total - deliveryFee;
        }

        data[createdAt.getHours()] += netTotal;
    });

    if (salesChart) salesChart.destroy();
    salesChart = new Chart(salesChartEl, {
        type: "line",
        data: {
            labels: hours.map((h) => `${h}:00`),
            datasets: [
                {
                    label: "Sales (₱)",
                    data,
                    borderColor: "#4b3621",
                    backgroundColor: "rgba(75,54,33,0.2)",
                    fill: true,
                    tension: 0.3,
                },
            ],
        },
        options: {
            responsive: true,
            plugins: { legend: { position: "top" } },
            scales: {
                x: { title: { display: true, text: "Hour of Day (Local Time)" } },
                y: { title: { display: true, text: "Sales (₱)" }, beginAtZero: true },
            },
        },
    });
}


function renderTopSellers(orders) {
    const productSales = {};
    const completedOrders = orders.filter(
        (o) => o.status && o.status.toLowerCase().includes("completed")
    );
    completedOrders.forEach((o) => {
        // Calculate the ratio of product cost to total order cost (excluding delivery fee)
        const orderTotal = o.total || 0;
        const deliveryFee = o.deliveryFee || 0;
        let orderNetTotal = orderTotal;
        if (o.collection === "DeliveryOrders" && deliveryFee > 0) {
            orderNetTotal = orderTotal - deliveryFee;
        }
        
        // This is the total value of all products in the order, potentially excluding tip/discount
        // A better approach would be to ensure `lineTotal` in the item is the product price.
        const totalProductValueInOrder = (o.products || o.items || []).reduce(
            (sum, p) => sum + (p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0)),
            0
        );
        
        // This ratio helps to proportionally adjust the product sales if the order's total 
        // includes a discount/markup that's not per-item, but is now excluding delivery fee.
        // If orderNetTotal is 0, ratio is 0 to avoid division by zero.
        const salesAdjustmentRatio = totalProductValueInOrder > 0 ? orderNetTotal / totalProductValueInOrder : 0;


        (o.products || o.items || []).forEach((p) => {
            const name = p.product || "Unnamed Product";
            const qty = p.qty || 1;
            
            // This is the line total for the item as stored in the order
            const lineTotal =
                p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0);
            
            // Adjust the line total based on the ratio calculated above, effectively
            // distributing the net sales (excluding delivery fee) across products.
            const netLineTotal = lineTotal * salesAdjustmentRatio;


            if (!productSales[name]) productSales[name] = { qty: 0, total: 0 };
            productSales[name].qty += qty;
            productSales[name].total += netLineTotal; // Use netLineTotal
        });
    });

    const topProducts = Object.entries(productSales)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5);

    bestSellersTable.innerHTML = "";
    topProducts.forEach(([name, data]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${name}</td>
        <td style="text-align:center;">${data.qty}</td>
        <td style="text-align:right;">${formatCurrency(data.total)}</td>
        `;
        bestSellersTable.appendChild(tr);
    });
}


function generateSalesPdf() {
    if (typeof jsPDF === "undefined") return;

    const doc = new jsPDF({ orientation: "portrait" });
    const today = new Date().toLocaleDateString();

    const orders = currentFilteredOrders.filter(
        (o) => o.status && o.status.toLowerCase().includes("completed")
    );
    if (orders.length === 0) return;

    // --- 1. Calculate Summary Metrics ---

    // Helper to get the total *excluding* the delivery fee, if present.
    const getNetTotal = (order) => {
        const total = order.total || 0;
        const deliveryFee = order.deliveryFee || 0;
        if (order.collection === "DeliveryOrders" && deliveryFee > 0) {
            return total - deliveryFee;
        }
        return total;
    };
    
    let cashTotal = 0;
    let ePayTotal = 0;
    const completedOrdersCount = orders.length;

    orders.forEach((o) => {
        const netTotal = getNetTotal(o);
        if (o.paymentMethod === "Cash") cashTotal += netTotal;
        if (o.paymentMethod === "E-Payment") ePayTotal += netTotal;
    });

    const grandTotalSales = cashTotal + ePayTotal;
    let currentY = 20; // Starting Y position

    // --- 2. Report Header and Filters ---

    const filterText = salesFilter.options[
        salesFilter.selectedIndex
    ].text.replace(/[^\w\s]/g, "");
    let rangeText = filterText;
    if (salesFilter.value === "custom" && customRangeEl.value)
        rangeText = customRangeEl.value;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Café Amore Sales Report", 14, currentY);
    currentY += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Report Generated: ${today}`, 14, currentY);
    currentY += 6;

    doc.setFontSize(10);
    doc.text(
        `Filters: ${rangeText} | Payment: ${paymentFilter.value} | Channel: ${channelFilter.value}`,
        14,
        currentY
    );
    currentY += 10;
    
    // --- 3. Sales Summary Table ---
    
    currentY += 5; // Extra space before summary
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Financial Summary", 14, currentY);
    currentY += 5;

    // ALIGNMENT FIX 1: Added currency hint to header
    const summaryHead = [["Metric", "Value (₱)"]]; 
    const summaryBody = [
        ["Completed Orders", completedOrdersCount.toLocaleString()],
        ["Total Net Sales", formatCurrency(grandTotalSales)], 
        ["Cash Payments", formatCurrency(cashTotal)],
        ["E-Payments", formatCurrency(ePayTotal)],
    ];
    
    doc.autoTable({
        startY: currentY,
        head: summaryHead,
        body: summaryBody,
        theme: "plain", // Use plain theme for a clean look
        styles: {
            fontSize: 10,
            cellPadding: 2,
        },
        headStyles: {
            fillColor: [220, 220, 220],
            textColor: [75, 54, 33],
            fontStyle: "bold",

        },
        columnStyles: {
            0: { cellWidth: 80, fontStyle: "bold" },
            1: { halign: "right", fontStyle: "bold" }, 
        },
    });

    // Update Y position after the Summary Table
    currentY = doc.lastAutoTable.finalY + 10;
    
    // --- 4. High-Level Sales Narrative Summary (NEW SECTION) ---

    // Calculate High/Low sales for narrative
    const productSalesData = {};
    orders.forEach((order) => {
        const orderTotal = order.total || 0;
        const deliveryFee = order.deliveryFee || 0;
        let orderNetTotal = orderTotal;
        if (order.collection === "DeliveryOrders" && deliveryFee > 0) {
            orderNetTotal = orderTotal - deliveryFee;
        }
        const totalProductValueInOrder = (order.products || order.items || []).reduce(
            (sum, p) => sum + (p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0)),
            0
        );
        const salesAdjustmentRatio = totalProductValueInOrder > 0 ? orderNetTotal / totalProductValueInOrder : 0;
        
        (order.products || order.items || []).forEach((item) => {
            const productName = item.product || "Unnamed Product";
            const sizeName =
                item.size && typeof item.size === "string" ? ` [${item.size}]` : "";
            const key = `${productName}${sizeName} | ${order.channel} | ${order.paymentMethod}`;
            const qty = item.qty || 1; 
            const lineTotal =
                item.total ||
                (item.qty || 1) * (item.basePrice || 0) + (item.addonsPrice || 0);
            const netLineTotal = lineTotal * salesAdjustmentRatio;

            if (!productSalesData[key]) {
                productSalesData[key] = { product: productName + sizeName, sales: 0 };
            }
            productSalesData[key].sales += netLineTotal; 
        });
    });

    const sortedSales = Object.values(productSalesData).sort((a, b) => a.sales - b.sales);
    const highestSalesItem = sortedSales.length > 0 ? sortedSales[sortedSales.length - 1] : null;
    const inStoreOrdersCount = orders.filter(o => o.channel === 'In-store').length;
    const deliveryOrdersCount = orders.filter(o => o.channel === 'Online').length;
    
    
    // Generate Narrative Summary
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("High-Level Sales Overview", 14, currentY);
    currentY += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const totalOrdersText = completedOrdersCount.toLocaleString();
    const totalSalesText = formatCurrency(grandTotalSales);
    const dateRangeText = rangeText;

    // 4.1 Channel Comparison Narrative
    let channelSummary = "";
    const totalOrders = inStoreOrdersCount + deliveryOrdersCount;
    if (inStoreOrdersCount > totalOrders * 0.6) {
        channelSummary = `In-store orders (${inStoreOrdersCount.toLocaleString()} transactions) were the dominant channel, securing the majority of sales.`;
    } else if (deliveryOrdersCount > totalOrders * 0.4) {
        channelSummary = `The online channel (${deliveryOrdersCount.toLocaleString()} transactions) shows a significant and growing contribution to overall revenue.`;
    } else if (totalOrders > 0) {
        channelSummary = `Channel performance is well-balanced across both in-store and online operations.`;
    } else {
        channelSummary = `No completed orders were found for channel analysis.`;
    }

    // 4.2 Product Highlight Narrative
    let productHighlight = "";
    if (highestSalesItem) {
        productHighlight = `The top-selling product was the ${highestSalesItem.product}, which generated a substantial net sales revenue of ${formatCurrency(highestSalesItem.sales)}.`;
    } else {
        productHighlight = `Product-specific data for the best seller was unavailable for detailed analysis.`;
    }

    const summaryParagraph = `This Sales Performance Summary covers the period: ${dateRangeText}. The business achieved a robust total net revenue of ${totalSalesText} from ${totalOrdersText} completed orders. ${channelSummary} ${productHighlight} This overall performance confirms strong customer engagement and consistent demand for core menu items.`;

    const splitSummaryText = doc.splitTextToSize(summaryParagraph, 182); 
    doc.text(splitSummaryText, 14, currentY);
    currentY += (splitSummaryText.length * 4) + 8; // Update Y position for the paragraph height
    
    // --- 5. Product Sales Breakdown Table (Original Step 4) ---

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Detailed Product Sales Breakdown", 14, currentY);
    currentY += 5;

    // ALIGNMENT FIX 2: Removed trailing space from "Net Sales "
    const head = [["Product", "Qty", "Net Sales", "Channel", "Payment"]]; 
    
    // Re-use productSalesData calculated in step 4
    const simpleProductSales = {};
    orders.forEach((order) => {
        const orderTotal = order.total || 0;
        const deliveryFee = order.deliveryFee || 0;
        let orderNetTotal = orderTotal;
        if (order.collection === "DeliveryOrders" && deliveryFee > 0) {
            orderNetTotal = orderTotal - deliveryFee;
        }

        const totalProductValueInOrder = (order.products || order.items || []).reduce(
            (sum, p) => sum + (p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0)),
            0
        );
        const salesAdjustmentRatio = totalProductValueInOrder > 0 ? orderNetTotal / totalProductValueInOrder : 0;
        
        (order.products || order.items || []).forEach((item) => {
            const productName = item.product || "Unnamed Product";
            const sizeName = item.size && typeof item.size === "string" ? ` [${item.size}]` : "";
            const productDisplay = productName + sizeName;
            
            const key = `${productDisplay} | ${order.channel} | ${order.paymentMethod}`;
            const qty = item.qty || 1;
            const lineTotal =
                item.total ||
                (item.qty || 1) * (item.basePrice || 0) + (item.addonsPrice || 0);
            const netLineTotal = lineTotal * salesAdjustmentRatio;

            if (!simpleProductSales[key]) {
                simpleProductSales[key] = {
                    product: productDisplay,
                    qty: 0,
                    sales: 0,
                    channel: order.channel,
                    payment: order.paymentMethod,
                };
            }
            simpleProductSales[key].qty += qty;
            simpleProductSales[key].sales += netLineTotal;
        });
    });

    const detailedBody = Object.values(simpleProductSales)
        .sort((a, b) => b.sales - a.sales)
        .map((item) => [
            item.product,
            item.qty, 
            formatNumber(item.sales),
            item.channel,
            item.payment,
        ]);


    // ALIGNMENT FIX 3: Prepend currency symbol to the Grand Total for clear presentation.
    const foot = [
        [
            {
                // This cell spans 2 columns: Product, Qty (Label)
                content: "GRAND TOTAL (NET SALES)",
                colSpan: 2, 
                styles: {
                    fontStyle: "bold",
                    halign: "left", 
                    fillColor: [240, 240, 240],
                    textColor: [75, 54, 33],
                },
            },
            {
                // This is the Sales value column (Column 2) - Prepended currency symbol
                content: '₱' + formatNumber(grandTotalSales),
                styles: {
                    fontStyle: "bold",
                    halign: "right", 
                    fillColor: [240, 240, 240],
                    textColor: [75, 54, 33],
                },
            },
            {
                // This cell spans 2 columns: Channel and Payment (Empty)
                content: "", 
                colSpan: 2,
                styles: {
                    fillColor: [240, 240, 240],
                },
            },
        ],
    ];

    doc.autoTable({
        startY: currentY,
        head: head,
        body: detailedBody, // Use the correctly formatted body
        foot: foot,
        theme: "striped",
        styles: {
            fontSize: 9,
            cellPadding: 3,
            lineColor: [230, 230, 230],
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: [75, 54, 33],
            textColor: 255,
            fontSize: 10,
            fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [250, 245, 235] },
        columnStyles: {
            0: { cellWidth: 70, halign: "left" }, // Product
            1: { cellWidth: 15, halign: "center" }, // Qty
            2: { cellWidth: 35, halign: "right" }, // Sales (Currency aligned right)
            3: { cellWidth: 30, halign: "center" }, // Channel
            4: { cellWidth: 35, halign: "center" }, // Payment
        },
    });

    const filename = `Sales_Report_${rangeText.replace(
        /\s/g,
        "_"
    )}_${today.replace(/\//g, "-")}.pdf`;
    doc.save(filename);
}

function sameDay(d1, d2) {
    return d1.toDateString() === d2.toDateString();
}

function weekDiff(d1, d2) {
    const oneJan = new Date(d2.getFullYear(), 0, 1);
    return (
        Math.floor(((d2 - oneJan) / 86400000 + oneJan.getDay() + 1) / 7) -
        Math.floor(((d1 - oneJan) / 86400000 + oneJan.getDay() + 1) / 7)
    );
}

[salesFilter, paymentFilter, channelFilter, productFilter].forEach((el) =>
    el.addEventListener("input", renderDashboard)
);

if (document.readyState === "complete") {
    initCustomRange();
} else {
    window.addEventListener("load", initCustomRange);
}
