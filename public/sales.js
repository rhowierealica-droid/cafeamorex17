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


    const getNetTotal = (order) => {
        const total = order.total || 0;
        const deliveryFee = order.deliveryFee || 0;

       
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
        // Calculate the ratio of product excluding delivery fee
        const orderTotal = o.total || 0;
        const deliveryFee = o.deliveryFee || 0;
        let orderNetTotal = orderTotal;
        if (o.collection === "DeliveryOrders" && deliveryFee > 0) {
            orderNetTotal = orderTotal - deliveryFee;
        }
        
        const totalProductValueInOrder = (o.products || o.items || []).reduce(
            (sum, p) => sum + (p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0)),
            0
        );
        
        const salesAdjustmentRatio = totalProductValueInOrder > 0 ? orderNetTotal / totalProductValueInOrder : 0;


        (o.products || o.items || []).forEach((p) => {
            const name = p.product || "Unnamed Product";
            const qty = p.qty || 1;
            
            const lineTotal =
                p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0);
            
         
            const netLineTotal = lineTotal * salesAdjustmentRatio;


            if (!productSales[name]) productSales[name] = { qty: 0, total: 0 };
            productSales[name].qty += qty;
            productSales[name].total += netLineTotal; 
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

/**
 * @param {Date} date 
 * @returns {string} 
 */
function getMonthYear(date) {
    const month = date.toLocaleString('default', { month: 'long' });
    const year = date.getFullYear();
    return `${month} ${year}`;
}

/**
 
 * @param {object} order 
 * @returns {number} 
 */
const getNetTotal = (order) => {
    const total = order.total || 0;
    const deliveryFee = order.deliveryFee || 0;
    if (order.collection === "DeliveryOrders" && deliveryFee > 0) {
        return total - deliveryFee;
    }
    return total;
};


function generateSalesPdf() {
    if (typeof jsPDF === "undefined") return;

    const doc = new jsPDF({ orientation: "portrait" });
    const today = new Date().toLocaleDateString();

    const orders = currentFilteredOrders.filter(
        (o) => o.status && o.status.toLowerCase().includes("completed")
    );
    if (orders.length === 0) return;


    const now = new Date();
    const currentYear = now.getFullYear();
    const yearlyCompletedOrders = allOrders.filter(
        (o) => o.status && o.status.toLowerCase().includes("completed") && 
               (o.createdAt.toDate ? o.createdAt.toDate().getFullYear() : o.createdAt.getFullYear()) === currentYear
    );
    
    let totalSalesYear = 0;
    let totalItemsSoldYear = 0;
    let monthlySales = {}; 
    let allProductsSet = new Set();
    let productYearlySales = {}; 

    yearlyCompletedOrders.forEach(o => {
        const netTotal = getNetTotal(o);
        totalSalesYear += netTotal;

        const createdAt = o.createdAt.toDate ? o.createdAt.toDate() : o.createdAt;
        const monthYear = getMonthYear(createdAt);
        
        if (!monthlySales[monthYear]) {
            monthlySales[monthYear] = { sales: 0, items: 0 };
        }
        monthlySales[monthYear].sales += netTotal;
        
        const totalProductValueInOrder = (o.products || o.items || []).reduce(
            (sum, p) => sum + (p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0)),
            0
        );
        const salesAdjustmentRatio = totalProductValueInOrder > 0 ? netTotal / totalProductValueInOrder : 0;

        (o.products || o.items || []).forEach(p => {
            const productName = p.product || "Unnamed Product";
            const sizeName = p.size && typeof p.size === "string" ? ` [${p.size}]` : "";
            const productDisplay = productName + sizeName;
            
            allProductsSet.add(productDisplay);
            
            const qty = p.qty || 1;
            totalItemsSoldYear += qty;
            monthlySales[monthYear].items += qty;
            
            const lineTotal = p.total || (p.qty || 1) * (p.basePrice || 0) + (p.addonsPrice || 0);
            const netLineTotal = lineTotal * salesAdjustmentRatio;

            if (!productYearlySales[productDisplay]) {
                productYearlySales[productDisplay] = { qty: 0, sales: 0 };
            }
            productYearlySales[productDisplay].qty += qty;
            productYearlySales[productDisplay].sales += netLineTotal;
        });
    });
    
    // Find highest month
    let highestSalesMonth = null;
    let highestItemsMonth = null;
    Object.entries(monthlySales).forEach(([month, data]) => {
        if (!highestSalesMonth || data.sales > highestSalesMonth.sales) {
            highestSalesMonth = { month, ...data };
        }
        if (!highestItemsMonth || data.items > highestItemsMonth.items) {
            highestItemsMonth = { month, ...data };
        }
    });

    // Find most sold product
    const sortedProductsYearly = Object.entries(productYearlySales)
        .sort((a, b) => b[1].qty - a[1].qty);
    const mostSoldProduct = sortedProductsYearly.length > 0 ? sortedProductsYearly[0] : null;

    let cashTotalFilter = 0;
    let ePayTotalFilter = 0;
    orders.forEach((o) => {
        const netTotal = getNetTotal(o);
        if (o.paymentMethod === "Cash") cashTotalFilter += netTotal;
        if (o.paymentMethod === "E-Payment") ePayTotalFilter += netTotal;
    });

    const grandTotalSalesFilter = cashTotalFilter + ePayTotalFilter;
    let currentY = 20; 


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
    
    
    currentY += 5; 
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Financial Summary (Current Year Focus)", 14, currentY);
    currentY += 5;

    const summaryHead = [["Metric", "Value"]]; 
    const summaryBody = [
        ["Total Products", allProductsSet.size.toLocaleString()],
        ["Cash Payment ", (cashTotalFilter)],
        ["E-Payment ", (ePayTotalFilter)],
        ["Total Sales for the Year", (totalSalesYear)], 
        ["Total Items Sold for the Year", totalItemsSoldYear.toLocaleString()],
        ["Month with Highest Total Sales", highestSalesMonth ? `${highestSalesMonth.month} (${(highestSalesMonth.sales)})` : 'N/A'],
        ["Month with Highest Item Sold", highestItemsMonth ? `${highestItemsMonth.month} (${highestItemsMonth.items.toLocaleString()} items)` : 'N/A'],
        ["Most Sold Product ", mostSoldProduct ? `${mostSoldProduct[0]} (${mostSoldProduct[1].qty.toLocaleString()} Sold)` : 'N/A'],
    ];
    
    doc.autoTable({
        startY: currentY,
        head: summaryHead,
        body: summaryBody,
        theme: "plain", 
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
            1: { halign: "right" }, 
        },
    });

    currentY = doc.lastAutoTable.finalY + 10;
    
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(`Monthly Sales Breakdown (${currentYear})`, 14, currentY);
    currentY += 5;

    const monthlyHead = [["Month", "Total Sales (₱)", "Total Items Sold"]];
    const monthlyBody = Object.entries(monthlySales)
        .sort((a, b) => {
            const dateA = new Date(a[0]);
            const dateB = new Date(b[0]);
            return dateA - dateB;
        })
        .map(([month, data]) => [
            month,
            formatNumber(data.sales),
            data.items.toLocaleString()
        ]);

    doc.autoTable({
        startY: currentY,
        head: monthlyHead,
        body: monthlyBody, 
        theme: "striped",
        styles: {
            fontSize: 9,
            cellPadding: 3,
        },
        headStyles: {
            fillColor: [75, 54, 33],
            textColor: 255,
        },
        alternateRowStyles: { fillColor: [250, 245, 235] },
        columnStyles: {
            0: { halign: "left" }, 
            1: { halign: "right" }, 
            2: { halign: "right" }, 
        },
    });
    
    currentY = doc.lastAutoTable.finalY + 10;
    

    if (currentY > 260) {
        doc.addPage();
        currentY = 20;
    }


    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Detailed Product Sales Breakdown (Filtered Range)", 14, currentY);
    currentY += 5;

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
            
            const key = productDisplay; 
            const qty = item.qty || 1;
            const basePrice = item.basePrice || 0; 
            
            const lineTotal =
                item.total ||
                (item.qty || 1) * (item.basePrice || 0) + (item.addonsPrice || 0);
            const netLineTotal = lineTotal * salesAdjustmentRatio;

            if (!simpleProductSales[key]) {
                simpleProductSales[key] = {
                    product: productDisplay,
                    qty: 0,
                    sales: 0,
                    price: basePrice, 
                };
            }
            simpleProductSales[key].qty += qty;
            simpleProductSales[key].sales += netLineTotal;
        });
    });

    const head = [["Product", "Qty", "Price", "Net Sales"]]; 

    const detailedBody = Object.values(simpleProductSales)
        .sort((a, b) => b.sales - a.sales) 
        .map((item) => [
            item.product,
            item.qty, 
            formatNumber(item.price), 
            formatNumber(item.sales), 
        ]);


    const foot = [
        [
            {
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
                //  Price column 
                content: "", 
                styles: {
                    fillColor: [240, 240, 240],
                },
            },
            {
                //  Sales value column
                content: formatNumber(grandTotalSalesFilter),
                styles: {
                    fontStyle: "bold",
                    halign: "right", 
                    fillColor: [240, 240, 240],
                    textColor: [75, 54, 33],
                },
            },
        ],
    ];

    doc.autoTable({
        startY: currentY,
        head: head,
        body: detailedBody, 
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
            0: { cellWidth: 80, halign: "left" }, // Product 
            1: { cellWidth: 20, halign: "center" }, // Qty
            2: { cellWidth: 40, halign: "right" }, // Price
            3: { cellWidth: 50, halign: "right" }, // Sales 
        },
    });

    currentY = doc.lastAutoTable.finalY + 10;
    
    
    const sortedFilteredSales = Object.values(simpleProductSales).sort((a, b) => a.sales - b.sales);
    const highestSalesItem = sortedFilteredSales.length > 0 ? sortedFilteredSales[sortedFilteredSales.length - 1] : null;
    const inStoreOrdersCount = orders.filter(o => o.channel === 'In-store').length;
    const deliveryOrdersCount = orders.filter(o => o.channel === 'Online').length;
    
    if (currentY > 260) {
        doc.addPage();
        currentY = 20;
    }
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Sales Overview (Filtered Range)", 14, currentY);
    currentY += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    const totalOrdersText = orders.length.toLocaleString();
    const totalSalesText = (grandTotalSalesFilter);
    const dateRangeText = rangeText;

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

    let productHighlight = "";
    if (highestSalesItem) {
        productHighlight = `The top-selling product was the ${highestSalesItem.product}, which generated a substantial net sales revenue of ${(highestSalesItem.sales)}.`;
    } else {
        productHighlight = `Product-specific data for the best seller was unavailable for detailed analysis.`;
    }
    
    const summaryParagraph = `This Sales Performance Summary covers the period: ${dateRangeText}. The business earned a total net revenue of about ${totalSalesText} from ${totalOrdersText} completed orders. ${channelSummary} ${productHighlight} This overall performance confirms strong customer engagement and consistent demand for core menu items.`;

    const splitSummaryText = doc.splitTextToSize(summaryParagraph, 180); 
    
    doc.text(splitSummaryText, 14, currentY);
    currentY += (splitSummaryText.length * 6) + 10; 
    
    
    const filename = `Sales_Report_${rangeText.replace(
        /\s/g,
        "_"
    )}_filtered_by_filter.pdf`;
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
