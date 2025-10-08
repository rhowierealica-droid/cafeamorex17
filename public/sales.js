import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// =========================
// DOM Elements
// =========================
const auth = getAuth();
const salesLabelEl = document.getElementById("salesLabel");
const completedLabelEl = document.getElementById("completedLabel");
const cancelledLabelEl = document.getElementById("cancelledLabel");
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

let allOrders = [];
let salesChart;
let customRangePicker;

// =========================
// Auth Redirect
// =========================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  await loadOrders();
});

// =========================
// Initialize Flatpickr for custom range
// =========================
function initCustomRange() {
  if (!customRangePicker) {
    customRangePicker = flatpickr(customRangeEl, {
      mode: "range",
      dateFormat: "Y-m-d",
      onClose: renderDashboard
    });
  }
}

// Show/hide custom range input
salesFilter.addEventListener("change", () => {
  if (salesFilter.value === "custom") {
    customRangeEl.style.display = "inline-block";
    initCustomRange();
  } else {
    customRangeEl.style.display = "none";
    renderDashboard();
  }
});

// =========================
// Load orders from Firestore
// =========================
async function loadOrders() {
  const collections = ["InStoreOrders", "DeliveryOrders"];
  let orders = [];

  for (const col of collections) {
    const snapshot = await getDocs(collection(db, col));
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      data.collection = col;
      data.channel = col === "InStoreOrders" ? "In-store" : "Online";
      orders.push(data);
    });
  }

  allOrders = orders;
  console.log("Loaded Orders:", orders); // ✅ Debugging
  renderDashboard();
}

// =========================
// Filter orders
// =========================
function filterOrders() {
  const timeVal = salesFilter.value;
  const paymentVal = paymentFilter.value;
  const channelVal = channelFilter.value;
  const productVal = productFilter.value.toLowerCase();

  const now = new Date();
  let startDate = null, endDate = null;

  if (timeVal === "custom" && customRangeEl.value) {
    const dates = customRangeEl.value.split(" to ");
    startDate = new Date(dates[0]);
    endDate = new Date(dates[1] ? dates[1] : dates[0]);
    endDate.setHours(23, 59, 59, 999);
  }

  return allOrders.filter(order => {
    if (!order.createdAt) return false;
    const createdAt = order.createdAt.toDate ? order.createdAt.toDate() : order.createdAt;

    // Time filter
    let timePass = false;
    if (timeVal === "custom" && startDate && endDate) {
      timePass = createdAt >= startDate && createdAt <= endDate;
    } else {
      switch (timeVal) {
        case "today": timePass = sameDay(createdAt, now); break;
        case "week": timePass = weekDiff(createdAt, now) === 0; break;
        case "month": timePass = createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear(); break;
        case "year": timePass = createdAt.getFullYear() === now.getFullYear(); break;
        case "all": timePass = true; break;
      }
    }

    // Payment filter
    const paymentPass = paymentVal === "all" || order.paymentMethod === paymentVal;
    // Channel filter
    const channelPass = channelVal === "all" || order.channel === channelVal;
    // Product filter
    const productPass = productVal === "" || (order.products || order.items || []).some(p =>
      (p.product || "").toLowerCase().includes(productVal)
    );

    return timePass && paymentPass && channelPass && productPass;
  });
}

// =========================
// Render dashboard
// =========================
function renderDashboard() {
  const orders = filterOrders();

  // Match "Completed by Customer", "Completed by Admin", etc.
  const completedOrders = orders.filter(o =>
    o.status && o.status.toLowerCase().includes("completed")
  );

  // Match "Canceled", "Cancelled", etc.
  const cancelledOrders = orders.filter(o =>
    o.status && o.status.toLowerCase().includes("cancel")
  );

  const totalSales = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Payment totals
  let cashTotal = 0, ePayTotal = 0;
  completedOrders.forEach(o => {
    if (o.paymentMethod === "Cash") cashTotal += o.total || 0;
    if (o.paymentMethod === "E-Payment") ePayTotal += o.total || 0;
  });

  // Update labels
  const filterText = salesFilter.options[salesFilter.selectedIndex].text;
  salesLabelEl.textContent = `Sales ${filterText}`;
  completedLabelEl.textContent = `Completed Orders ${filterText}`;
  cancelledLabelEl.textContent = `Cancelled Orders ${filterText}`;

  // Update values
  salesValueEl.textContent = `₱${totalSales.toFixed(2)}`;
  completedValueEl.textContent = completedOrders.length;
  cancelledValueEl.textContent = cancelledOrders.length;
  cashTotalEl.textContent = `₱${cashTotal.toFixed(2)}`;
  ePayTotalEl.textContent = `₱${ePayTotal.toFixed(2)}`;

  renderHourlyChart(completedOrders);
  renderTopSellers(completedOrders);
}

// =========================
// Render hourly chart
// =========================
function renderHourlyChart(orders) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const data = Array(24).fill(0);

  orders.forEach(o => {
    const createdAt = o.createdAt.toDate ? o.createdAt.toDate() : o.createdAt;
    data[createdAt.getHours()] += o.total || 0;
  });

  if (salesChart) salesChart.destroy();
  salesChart = new Chart(salesChartEl, {
    type: 'line',
    data: {
      labels: hours.map(h => `${h}:00`),
      datasets: [{
        label: 'Sales (₱)',
        data,
        borderColor: '#4b3621',
        backgroundColor: 'rgba(75,54,33,0.2)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { title: { display: true, text: 'Hour of Day' } },
        y: { title: { display: true, text: 'Sales (₱)' }, beginAtZero: true }
      }
    }
  });
}

// =========================
// Render top 5 sellers
// =========================
function renderTopSellers(orders) {
  const productSales = {};
  orders.forEach(o => {
    (o.products || o.items || []).forEach(p => {
      const name = p.product || "Unnamed Product";
      const qty = p.qty || 1;
      const lineTotal = p.total || ((p.qty || 1) * (p.basePrice || 0));
      if (!productSales[name]) productSales[name] = { qty: 0, total: 0 };
      productSales[name].qty += qty;
      productSales[name].total += lineTotal;
    });
  });

  const topProducts = Object.entries(productSales)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5);

  bestSellersTable.innerHTML = "";
  topProducts.forEach(([name, data]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${data.qty}</td><td>₱${data.total.toFixed(2)}</td>`;
    bestSellersTable.appendChild(tr);
  });
}

// =========================
// Helpers
// =========================
function sameDay(d1, d2) { return d1.toDateString() === d2.toDateString(); }
function weekDiff(d1, d2) {
  const oneJan = new Date(d2.getFullYear(), 0, 1);
  return Math.floor(((d2 - oneJan) / 86400000 + oneJan.getDay() + 1) / 7) -
         Math.floor(((d1 - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
}

// =========================
// Event listeners
// =========================
[salesFilter, paymentFilter, channelFilter, productFilter].forEach(el =>
  el.addEventListener("input", renderDashboard)
);
