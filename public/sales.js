import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Dashboard card elements
const salesLabelEl = document.getElementById("salesLabel");
const completedLabelEl = document.getElementById("completedLabel");
const cancelledLabelEl = document.getElementById("cancelledLabel");

const salesValueEl = document.getElementById("salesToday");
const completedValueEl = document.getElementById("completedToday");
const cancelledValueEl = document.getElementById("cancelledToday");

// Payment cards
const cashTotalEl = document.getElementById("cashTotal");
const ePayTotalEl = document.getElementById("ePayTotal");

const bestSellersTable = document.getElementById("bestSellersTable");
const salesChartEl = document.getElementById("salesChart");
const salesFilter = document.getElementById("salesFilter");

let salesChart;
let allOrders = [];

// Load orders from both collections
async function loadOrders() {
  const orderCollections = ["InStoreOrders", "DeliveryOrders"];
  let orders = [];
  for (const col of orderCollections) {
    const snapshot = await getDocs(collection(db, col));
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      data.collection = col;
      orders.push(data);
    });
  }
  allOrders = orders;
  renderDashboard();
}

// Filter orders based on selected filter
function filterOrders() {
  const filter = salesFilter.value;
  const now = new Date();
  return allOrders.filter(order => {
    if (!order.createdAt) return false;
    const createdAt = order.createdAt.toDate ? order.createdAt.toDate() : order.createdAt;
    switch(filter) {
      case "today": return sameDay(createdAt, now);
      case "week": return weekDiff(createdAt, now) === 0;
      case "month": return createdAt.getMonth() === now.getMonth() && createdAt.getFullYear() === now.getFullYear();
      case "3months": return monthDiff(createdAt, now) <= 3;
      case "6months": return monthDiff(createdAt, now) <= 6;
      case "year": return createdAt.getFullYear() === now.getFullYear();
      case "all": return true;
    }
  });
}

// Render dashboard
function renderDashboard() {
  const orders = filterOrders();
  const completedOrders = orders.filter(o => o.status === "Completed");
  const cancelledOrders = orders.filter(o => o.status === "Canceled");

  const totalSales = completedOrders.reduce((sum, o) => sum + (o.total || 0), 0);

  // Payment totals
  let cashTotal = 0;
  let ePayTotal = 0;
  orders.forEach(order => {
    const total = order.total || 0;
    if(order.paymentType === "Cash") cashTotal += total;
    if(order.paymentType === "E-Payment") ePayTotal += total;
  });

  // Update card labels dynamically
  const filterText = salesFilter.options[salesFilter.selectedIndex].text;
  salesLabelEl.textContent = `Sales ${filterText}`;
  completedLabelEl.textContent = `Completed Orders ${filterText}`;
  cancelledLabelEl.textContent = `Cancelled Orders ${filterText}`;

  // Update card values
  salesValueEl.textContent = `₱${totalSales.toFixed(2)}`;
  completedValueEl.textContent = completedOrders.length;
  cancelledValueEl.textContent = cancelledOrders.length;

  // Update payment cards
  cashTotalEl.textContent = `₱${cashTotal.toFixed(2)}`;
  ePayTotalEl.textContent = `₱${ePayTotal.toFixed(2)}`;

  renderHourlyChart(completedOrders);
  renderTopSellers(completedOrders);
}

// Render hourly-based sales chart
function renderHourlyChart(orders) {
  const hours = Array.from({length:24}, (_,i)=>i);
  const hourlyData = Array(24).fill(0);

  orders.forEach(order => {
    const createdAt = order.createdAt.toDate ? order.createdAt.toDate() : order.createdAt;
    const hour = createdAt.getHours();
    hourlyData[hour] += order.total || 0;
  });

  if (salesChart) salesChart.destroy();
  salesChart = new Chart(salesChartEl, {
    type: 'line',
    data: {
      labels: hours.map(h => `${h}:00`),
      datasets: [{
        label: 'Sales (₱)',
        data: hourlyData,
        borderColor: '#4b3621',
        backgroundColor: 'rgba(75,54,33,0.2)',
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } },
      scales: {
        x: { title: { display: true, text: 'Hour of Day' } },
        y: { title: { display: true, text: 'Sales (₱)' }, beginAtZero: true }
      }
    }
  });
}

// Top 5 Best Sellers
function renderTopSellers(orders) {
  const productSales = {};
  orders.forEach(order => {
    (order.products || order.items || []).forEach(p => {
      const name = p.product;
      const qty = p.qty || 1;
      const lineTotal = p.total || ((p.qty || 1) * (p.basePrice || 0));
      if (!productSales[name]) productSales[name] = { qty:0, total:0 };
      productSales[name].qty += qty;
      productSales[name].total += lineTotal;
    });
  });

  const topProducts = Object.entries(productSales)
    .sort((a,b) => b[1].total - a[1].total)
    .slice(0,5);

  bestSellersTable.innerHTML = "";
  topProducts.forEach(([name, data]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>${data.qty}</td><td>₱${data.total.toFixed(2)}</td>`;
    bestSellersTable.appendChild(tr);
  });
}

// Helpers
function sameDay(d1,d2) { return d1.toDateString() === d2.toDateString(); }
function weekDiff(d1,d2) { 
  const oneJan = new Date(d2.getFullYear(),0,1);
  const week = Math.floor(((d2 - oneJan) / 86400000 + oneJan.getDay()+1)/7);
  const week1 = Math.floor(((d1 - oneJan)/86400000 + oneJan.getDay()+1)/7);
  return week - week1;
}
function monthDiff(d1,d2) { return (d2.getFullYear()-d1.getFullYear())*12 + (d2.getMonth()-d1.getMonth()); }

// Event
salesFilter.addEventListener("change", renderDashboard);

// Initial load
loadOrders();
