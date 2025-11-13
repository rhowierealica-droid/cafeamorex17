import { db } from "./firebase-config.js";
import {
    collection,
    onSnapshot,
    query,
    where,
    Timestamp,
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
    getAuth,
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { jsPDF } = window.jspdf;

let productsCache = {}; 
let allOrders = [];
let salesChart;
let customRangePicker;
let currentFilteredOrders = [];
let unsubscribeListeners = [];

/**
 * @param {*} val
 * @returns {Date|null}
 */
function parseSeasonDate(val) {
    if (!val && val !== 0) return null;
    if (typeof val === "object" && val !== null && typeof val.toDate === "function") {
        try {
            return val.toDate();
        } catch (e) {
            return null;
        }
    }
    if (val instanceof Date) {
        if (!isNaN(val.getTime())) return val;
        return null;
    }
    if (typeof val === "string") {
        const trimmed = val.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            const [y, m, d] = trimmed.split("-").map(Number);
            return new Date(y, m - 1, d);
        }
        const parsed = new Date(trimmed);
        if (!isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

/**
 * @param {*} val
 * @returns {boolean|null} 
 */
function parseSeasonalFlag(val) {
    if (val === true || val === false) return val;
    if (typeof val === "string") {
        const low = val.trim().toLowerCase();
        if (low === "true" || low === "1" || low === "yes") return true;
        if (low === "false" || low === "0" || low === "no") return false;
    }
    if (typeof val === "number") {
        if (val === 1) return true;
        if (val === 0) return false;
    }
    return null; 
}

function checkSeasonalAvailability(productData) {
    if (!productData) return false;

    const start = parseSeasonDate(productData.season_start_date);
    const end = parseSeasonDate(productData.season_end_date);
    if (!start || !end) return false;

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const now = new Date();
    return now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
}

function formatSeasonRange(start_date_raw, end_date_raw) {
    if (!start_date_raw || !end_date_raw) return '';

    const start = parseSeasonDate(start_date_raw);
    const end = parseSeasonDate(end_date_raw);
    if (!start || !end) return '';

    try {
        const startMonth = start.toLocaleString('default', { month: 'short' });
        const endMonth = end.toLocaleString('default', { month: 'short' });

        const startDateString = `${startMonth} ${start.getDate()}`;
        const endDateString = startMonth === endMonth ? `${end.getDate()}` : `${endMonth} ${end.getDate()}`;

        return `${startDateString} - ${endDateString}`;
    } catch (e) {
        console.error("Error formatting season range:", e);
        return '';
    }
}

function isAvailableInMonth(start_date_raw, end_date_raw, targetMonth) {
    if (targetMonth === 'ALL' || !start_date_raw || !end_date_raw) return true;

    const targetM = parseInt(targetMonth);
    if (isNaN(targetM)) return true;

    const start = parseSeasonDate(start_date_raw);
    const end = parseSeasonDate(end_date_raw);
    if (!start || !end) return false;

    // Normalize to full day end
    end.setHours(23, 59, 59, 999);

    const startMonthNum = start.getMonth() + 1;
    const endMonthNum = end.getMonth() + 1;

    if (startMonthNum <= endMonthNum) {
        return targetM >= startMonthNum && targetM <= endMonthNum;
    } else {
        // Cross-year range
        return (targetM >= startMonthNum && targetM <= 12) || (targetM >= 1 && targetM <= endMonthNum);
    }
}

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
const seasonalSellersTable = document.getElementById("seasonalSellersTable");
const seasonalProductsContainer = document.getElementById("seasonalProductsContainer");
const salesChartEl = document.getElementById("salesChart");

const salesFilter = document.getElementById("salesFilter");
const paymentFilter = document.getElementById("paymentFilter");
const channelFilter = document.getElementById("channelFilter");
const productFilter = document.getElementById("productFilter");
const customRangeEl = document.getElementById("customRange");
const seasonalMonthFilter = document.getElementById("seasonalMonthFilter");

const generatePdfBtn = document.getElementById("generatePdfBtn");



function sameDay(d1, d2) {
    const date1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const date2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    return date1.getTime() === date2.getTime();
}

/**
 * @param {Date} d1 
 * @param {Date} d2 
 * @returns {boolean} 
 */
function inLastSevenDays(d1, d2) {
    const end = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate(), 23, 59, 59, 999);
    const start = new Date(d2);
    start.setDate(d2.getDate() - 7);
    start.setHours(0, 0, 0, 0);

    return d1.getTime() >= start.getTime() && d1.getTime() <= end.getTime();
}


function getMonthYear(date) {
    const month = date.toLocaleString('default', { month: 'long' });
    const year = date.getFullYear();
    return `${month} ${year}`;
}

function formatCurrency(amount) {
    const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount || 0);
    return `₱${formatted.replace(/[^\d,.,-]/g, "")}`;
}

function formatNumber(amount) {
    const formatted = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount || 0);
    return formatted.replace(/[^\d,.,-]/g, "");
}

const getNetTotal = (order) => {
    const total = order.total || 0;
    const deliveryFee = order.deliveryFee || 0;
    if (order.channel === "Online" && deliveryFee > 0) { 
        return total - deliveryFee;
    }
    return total;
};

/**
 * @param {object} item 
 * @returns {object|null} 
 */
function lookupProductMetaFromItem(item) {
    const productId = item.productId || item.prodId || item.id;
    if (productId && productsCache[productId]) {
        return productsCache[productId];
    }
        const name = (item.product || item.name || '').toLowerCase().trim();
    if (name) {
        for (const id in productsCache) {
            const product = productsCache[id];
            const cachedName = (product.name || '').toLowerCase().trim();
            if (cachedName === name) {
                return product;
            }
        }
    }
    return null;
}

async function listenProductsCache() {
    const q = query(collection(db, "products"));
    const unsub = onSnapshot(q, (snapshot) => {
        productsCache = {};
        snapshot.forEach((doc) => {
            productsCache[doc.id] = doc.data();
        });
        renderDashboard();
    }, (error) => {
        console.error("Error loading products cache:", error);
    });
    unsubscribeListeners.push(unsub);
}


async function loadOrdersRealtime() {
    unsubscribeListeners.forEach((unsub) => unsub());
    unsubscribeListeners = [];
    
    listenProductsCache();

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
        }, (error) => {
            console.error(`Error loading orders from ${col}:`, error);
        });
        unsubscribeListeners.push(unsubscribe);
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.replace("login.html");
        return;
    }
    await loadOrdersRealtime();
});

function initCustomRangePicker() {
    if (typeof flatpickr !== "undefined") {
        if (!customRangePicker) {
            customRangePicker = flatpickr(customRangeEl, {
                mode: "range",
                dateFormat: "Y-m-d",
                onClose: renderDashboard, 
            });
        }
    }
}

salesFilter.addEventListener("change", () => {
    if (salesFilter.value === "custom") {
        customRangeEl.style.display = "inline-block";
        initCustomRangePicker();
    } else {
        customRangeEl.style.display = "none";
        if (customRangePicker) customRangePicker.clear(); 
        renderDashboard(); 
    }
});

if (generatePdfBtn) {
    generatePdfBtn.addEventListener("click", generateSalesPdf);
}

[paymentFilter, channelFilter, productFilter].forEach((el) =>
    el.addEventListener("change", renderDashboard)
);

if (seasonalMonthFilter) {
    seasonalMonthFilter.addEventListener("change", renderDashboard);
}

if (document.readyState === "complete") {
    initCustomRangePicker();
} else {
    window.addEventListener("load", initCustomRangePicker);
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
            const orderYear = createdAt.getFullYear();
            const currentYear = now.getFullYear();
            const orderMonth = createdAt.getMonth();
            const currentMonth = now.getMonth();

            switch (timeVal) {
                case "today":
                    timePass = sameDay(createdAt, now);
                    break;
                case "week":
                    timePass = inLastSevenDays(createdAt, now); 
                    break;
                case "month":
                    timePass = orderMonth === currentMonth && orderYear === currentYear;
                    break;
                case "year":
                    timePass = orderYear === currentYear;
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

/**
 * @NEW_FUNCTION
 */
function filterOrdersForSeasonal() {
    const paymentVal = paymentFilter.value;
    const channelVal = channelFilter.value;
    const productVal = productFilter.value.toLowerCase(); 

    return allOrders.filter((order) => {
        const paymentPass =
            paymentVal === "all" || order.paymentMethod === paymentVal;
        const channelPass = channelVal === "all" || order.channel === channelVal;
        const productPass =
            productVal === "" ||
            (order.products || order.items || []).some((p) =>
                (p.product || "").toLowerCase().includes(productVal)
            );

        return paymentPass && channelPass && productPass;
    });
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
    renderSeasonalSellers(); 
}

function renderHourlyChart(orders) {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const data = Array(24).fill(0);
    orders.forEach((o) => {
        const createdAt = o.createdAt.toDate ? o.createdAt.toDate() : o.createdAt;
        const netTotal = getNetTotal(o);

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

/**
 * @param {Array<object>} orders 
 * @param {boolean|null} isSeasonalFilter 
 * @returns {object} 
 */
function calculateProductSales(orders, isSeasonalFilter = null) {
    const productSales = {};
    const seasonalFilterMonth = seasonalMonthFilter 
        ? seasonalMonthFilter.value 
        : 'ALL';

    const completedOrders = orders.filter(
        (o) => o.status && o.status.toLowerCase().includes("completed")
    );

    completedOrders.forEach((o) => {
        const orderNetTotal = getNetTotal(o);
        
        const totalProductValueInOrder = (o.products || o.items || []).reduce(
            (sum, p) => sum + (p.total || ((p.qty || 1) * (p.basePrice || 0)) + (p.addonsPrice || 0)),
            0
        );
        
        const salesAdjustmentRatio = totalProductValueInOrder > 0 ? orderNetTotal / totalProductValueInOrder : 0;

        (o.products || o.items || []).forEach((p) => {
            
            let productMeta = p; 
            const cacheMeta = lookupProductMetaFromItem(p);
            if (cacheMeta) {
                productMeta = { ...cacheMeta, ...p };
            }

            const parsedSeasonFlag = parseSeasonalFlag(productMeta.is_seasonal);
            const startRaw = productMeta.season_start_date;
            const endRaw = productMeta.season_end_date;
            const hasSeasonDates = !!(startRaw || endRaw);
            
            const itemIsSeasonal = parsedSeasonFlag === true || (hasSeasonDates && parsedSeasonFlag !== false);
            
            if (isSeasonalFilter !== null) {
                if (isSeasonalFilter === false && itemIsSeasonal) {
                    return; 
                }
                if (isSeasonalFilter === true && !itemIsSeasonal) {
                    return; 
                }
            }

            let monthsAvailable = '';
            let isCurrentlyAvailable = false; 
            
            if (itemIsSeasonal) {
                if (startRaw && endRaw) {
                    monthsAvailable = formatSeasonRange(startRaw, endRaw);
                    isCurrentlyAvailable = checkSeasonalAvailability({ season_start_date: startRaw, season_end_date: endRaw });
                }

                if (isSeasonalFilter === true && seasonalFilterMonth !== 'ALL') {
                    if (!startRaw || !endRaw) {
                        return;
                    }
                    if (!isAvailableInMonth(startRaw, endRaw, seasonalFilterMonth)) {
                        return; 
                    }
                }
            }

            const name = p.product || "Unnamed Product";
            const sizeName = p.size && typeof p.size === "string" ? ` [${p.size}]` : "";
            const productDisplay = name + sizeName;
            const qty = p.qty || 1;
            
            const lineTotal =
                p.total || ((p.qty || 1) * (p.basePrice || 0)) + (p.addonsPrice || 0);
            
            const netLineTotal = lineTotal * salesAdjustmentRatio;

            const unitPrice = qty > 0 ? lineTotal / qty : 0;
            
            
            if (!productSales[productDisplay]) productSales[productDisplay] = { 
                qty: 0, 
                total: 0, 
                priceSum: 0, 
                months: monthsAvailable, 
                isCurrentlyAvailable: isCurrentlyAvailable,
                isSeasonal: itemIsSeasonal,
                addonsData: {}
            };
            productSales[productDisplay].qty += qty;
            productSales[productDisplay].total += netLineTotal;
            productSales[productDisplay].priceSum += unitPrice * qty;
            
            let currentAddOnsText = "None";
            let addOnKey = "None"; 
            if (p.addons && p.addons.length > 0) {
                const sortedAddOns = p.addons
                    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                    .map(addon => 
                        `${addon.name} (${formatNumber(addon.price)})`
                    );
                currentAddOnsText = sortedAddOns.join("\n"); 
                addOnKey = sortedAddOns.join("|"); 
            }
            
            const uniqueAddOnKey = addOnKey;
            
            if (!productSales[productDisplay].addonsData[uniqueAddOnKey]) {
                productSales[productDisplay].addonsData[uniqueAddOnKey] = {
                    addOnsDisplay: currentAddOnsText,
                    qty: 0,
                    sales: 0,
                    priceSum: 0, 
                };
            }
            
            productSales[productDisplay].addonsData[uniqueAddOnKey].qty += qty;
            productSales[productDisplay].addonsData[uniqueAddOnKey].sales += netLineTotal;
            
            if (itemIsSeasonal) {
                 productSales[productDisplay].months = monthsAvailable || productSales[productDisplay].months;
                 if (isCurrentlyAvailable === true) {
                     productSales[productDisplay].isCurrentlyAvailable = true;
                 }
            }
        });
    });
    return productSales;
}

function renderTopSellers(orders) {
    const productSales = calculateProductSales(orders, false); 

    const topProducts = Object.entries(productSales)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5)
        .map(([name, data]) => {
            const averagePrice = data.qty > 0 ? data.priceSum / data.qty : 0;
            return { name, qty: data.qty, total: data.total, price: averagePrice };
        });

    bestSellersTable.innerHTML = "";
    if (topProducts.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="3" style="text-align:center; padding: 20px;">No regular products sold in the current filter range.</td>`;
        bestSellersTable.appendChild(tr);
        return;
    }
    
    topProducts.forEach((data) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td>${data.name}</td>
        <td style="text-align:center;">${data.qty}</td>
        <td style="text-align:right;">${formatCurrency(data.total)}</td>
        `;
        bestSellersTable.appendChild(tr);
    });
}


function renderSeasonalSellers() {
    const ordersForSeasonal = filterOrdersForSeasonal();
    
    const productSales = calculateProductSales(ordersForSeasonal, true);
    
    const container = document.getElementById("seasonalProductsContainer"); 
    if (!container) return; 

    const seasonalFilterMonth = seasonalMonthFilter 
        ? seasonalMonthFilter.value 
        : 'ALL';
    
    const selectedMonthName = seasonalMonthFilter && seasonalMonthFilter.selectedIndex >= 0
        ? seasonalMonthFilter.options[seasonalMonthFilter.selectedIndex].text
        : 'Selected Month';

    const topSeasonalProducts = Object.entries(productSales)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5) // Top 5 Seasonal Sellers
        .map(([name, data]) => {
            const averagePrice = data.qty > 0 ? data.priceSum / data.qty : 0;
            return { 
                name, 
                qty: data.qty, 
                total: data.total, 
                price: averagePrice, 
                months: data.months,
                isCurrentlyAvailable: data.isCurrentlyAvailable
            };
        });

    seasonalSellersTable.innerHTML = "";
    
    if (topSeasonalProducts.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
        <td colspan="3" style="text-align:center; padding: 20px;">
            ${seasonalFilterMonth === 'ALL' 
                ? 'No seasonal products sold in the current filter range.'
                : `No Seasonal Product sold in ${selectedMonthName} based on current product season ranges.`
            }
        </td>
        `;
        seasonalSellersTable.appendChild(tr);
        container.style.display = 'block'; 
        return;
    }
    
    container.style.display = 'block'; 

    topSeasonalProducts.forEach((data) => {
        const tr = document.createElement("tr");
        
        tr.innerHTML = `
        <td>${data.name}${data.months ? ` <small>(${data.months})</small>` : ''}</td>
        <td style="text-align:center;">${data.qty}</td>
        <td style="text-align:right;">${formatCurrency(data.total)}</td>
        `;
        seasonalSellersTable.appendChild(tr);
    });
}


// PDF GENERATI
function generateSalesPdf() {
    if (typeof jsPDF === "undefined") return;

    const pdfFormatNumber = (amount) => formatNumber(amount);
    
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
            (sum, p) => sum + (p.total || ((p.qty || 1) * (p.basePrice || 0)) + (p.addonsPrice || 0)),
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
            
            const lineTotal = p.total || ((p.qty || 1) * (p.basePrice || 0)) + (p.addonsPrice || 0);
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
    let grandTotalSalesFilter = 0;

    orders.forEach((o) => {
        const netTotal = getNetTotal(o);
        grandTotalSalesFilter += netTotal;
        if (o.paymentMethod === "Cash") cashTotalFilter += netTotal;
        if (o.paymentMethod === "E-Payment") ePayTotalFilter += netTotal;
    });

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
        ["Cash Payment (Filtered)", pdfFormatNumber(cashTotalFilter)],
        ["E-Payment (Filtered)", pdfFormatNumber(ePayTotalFilter)],
        ["Total Sales for the Year", pdfFormatNumber(totalSalesYear)], 
        ["Total Items Sold for the Year", totalItemsSoldYear.toLocaleString()],
        ["Month with Highest Total Sales", highestSalesMonth ? `${highestSalesMonth.month} (${pdfFormatNumber(highestSalesMonth.sales)})` : 'N/A'],
        ["Month with Highest Item Sold", highestItemsMonth ? `${highestItemsMonth.month} (${highestItemsMonth.items.toLocaleString()} items)` : 'N/A'],
        ["Most Sold Product (Yearly)", mostSoldProduct ? `${mostSoldProduct[0]} (${mostSoldProduct[1].qty.toLocaleString()} Sold)` : 'N/A'],
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

    const monthlyHead = [["Month", "Total Sales", "Total Items Sold"]];
    const monthlyBody = Object.entries(monthlySales)
        .sort((a, b) => {
            const dateA = new Date(a[0]);
            const dateB = new Date(b[0]);
            return dateA - dateB;
        })
        .map(([month, data]) => [
            month,
            pdfFormatNumber(data.sales),
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
            lineColor: [230, 230, 230], 
            lineWidth: 0.1, 
        },
        headStyles: {
            fillColor: [75, 54, 33], 
            textColor: 255, 
            fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [250, 245, 235] }, 
        columnStyles: {
            0: { cellWidth: 80, halign: "left" }, 
            1: { cellWidth: 50, halign: "right" }, 
            2: { cellWidth: 50, halign: "right" }, 
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
    doc.setFontSize(10);
    doc.text("Seasonal Products are marked with [S]", 14, currentY + 4);
    currentY += 8;

    const productSalesAggregated = calculateProductSales(orders, null);

    const detailedBodyData = [];

    Object.entries(productSalesAggregated).forEach(([productDisplay, productData]) => {
        
        const markedProduct = productData.isSeasonal ? `${productDisplay} [S]` : productDisplay;

        Object.entries(productData.addonsData).forEach(([addOnKey, addOnData]) => {
            
            const itemAveragePrice = productData.qty > 0 ? productData.priceSum / productData.qty : 0;
            
            detailedBodyData.push({
                product: markedProduct,
                averagePrice: itemAveragePrice,
                qty: addOnData.qty, 
                addOnsDisplay: addOnData.addOnsDisplay,
                sales: addOnData.sales, 
                baseSales: productData.total, 
            });
        });
    });

    const head = [["Product", "Price","Qty", "Add-ons & Price", "Net Sales"]]; 

    const detailedBody = detailedBodyData
        .sort((a, b) => b.sales - a.sales) 
        .map((item) => {
            return [
                item.product,
                pdfFormatNumber(item.averagePrice), 
                item.qty, 
                item.addOnsDisplay, 
                pdfFormatNumber(item.sales), 
            ];
        });


    const foot = [
        [
            {
                content: "GRAND TOTAL (NET SALES)",
                colSpan: 4, 
                styles: {
                    fontStyle: "bold",
                    halign: "left", 
                    fillColor: [240, 240, 240],
                    textColor: [75, 54, 33],
                },
            },
            {
                content: pdfFormatNumber(grandTotalSalesFilter),
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
            fontSize: 8, 
            cellPadding: 2,
            lineColor: [230, 230, 230],
            lineWidth: 0.1,
        },
        headStyles: {
            fillColor: [75, 54, 33],
            textColor: 255,
            fontSize: 9,
            fontStyle: "bold",
        },
        alternateRowStyles: { fillColor: [250, 245, 235] },
        columnStyles: {
            0: { cellWidth: 50, halign: "left" }, 
            1: { cellWidth: 25, halign: "right" }, 
            2: { cellWidth: 15, halign: "center" }, 
            3: { cellWidth: 60, halign: "left" }, 
            4: { cellWidth: 30, halign: "right" }, 
        },
    });

    currentY = doc.lastAutoTable.finalY + 10;
    
    const sortedAggregatedSales = Object.values(productSalesAggregated).sort((a, b) => a.total - b.total);
    const highestSalesBaseItem = sortedAggregatedSales.length > 0 ? sortedAggregatedSales[sortedAggregatedSales.length - 1] : null;
    
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
    const totalSalesText = pdfFormatNumber(grandTotalSalesFilter); 
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
    if (highestSalesBaseItem) {
        const highestSalesBaseItemName = Object.keys(productSalesAggregated).find(key => productSalesAggregated[key] === highestSalesBaseItem);

        productHighlight = `The top-selling product was the ${highestSalesBaseItemName.replace(' [S]', '')}, which generated a substantial net sales revenue of ${pdfFormatNumber(highestSalesBaseItem.total)}.`;
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
