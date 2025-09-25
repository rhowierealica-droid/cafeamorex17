import { auth, db } from './firebase-config.js';
import { collection, getDocs, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ordersTodayEl = document.getElementById("ordersToday");
const salesTodayEl = document.getElementById("salesToday");
const lowInventoryEl = document.getElementById("lowInventory");
const menuCountEl = document.getElementById("menuCount");
const bestSellersTable = document.querySelector("#bestSellersTable tbody");
const salesChartEl = document.getElementById("salesChart");

let salesChart;

// ✅ Check if user is logged in and admin
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login first.");
    window.location.href = "login.html";
    return;
  }

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists() || userDoc.data().role !== "Admin") {
    alert("Access denied. Admins only.");
    window.location.href = "login.html";
    return;
  }

  // Initialize dashboard
  initDashboard();
});

function initDashboard() {
  updateInventory();
  updateMenu();
  updateDashboard();
  updateTopSellers();

  // Real-time updates for orders
  const orderCollections = ["InStoreOrders", "DeliveryOrders"];
  orderCollections.forEach(col => {
    onSnapshot(collection(db, col), () => {
      updateDashboard(); // Refresh dashboard metrics and sales chart
      updateTopSellers(); // Refresh top sellers
    });
  });
}

// Helper: Get today's date range
function getTodayRange() {
  const start = new Date();
  start.setHours(0,0,0,0);
  const end = new Date();
  end.setHours(23,59,59,999);
  return { start, end };
}

// Update dashboard metrics
async function updateDashboard() {
  const { start, end } = getTodayRange();
  const orderCollections = ["InStoreOrders", "DeliveryOrders"];
  let totalOrders = 0;
  let totalSales = 0;
  const hourlyData = {};

  for (const col of orderCollections) {
    const snapshot = await getDocs(collection(db, col));
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (!data.createdAt) return;
      const createdAt = data.createdAt.toDate ? data.createdAt.toDate() : data.createdAt;
      if (createdAt < start || createdAt > end) return;

      if (data.status === "Completed") {
        totalOrders++;
        totalSales += data.total || 0;

        const hour = createdAt.getHours();
        if (!hourlyData[hour]) hourlyData[hour] = { inStore: 0, delivery: 0 };
        if (col === "InStoreOrders") hourlyData[hour].inStore += data.total || 0;
        else hourlyData[hour].delivery += data.total || 0;
      }
    });
  }

  // Update cards
  ordersTodayEl.textContent = `${totalOrders} Today`;
  salesTodayEl.textContent = `₱${totalSales.toFixed(2)}`;

  // Sales chart
  const hours = Array.from({length:24}, (_,i)=>i);
  const labels = hours.map(h => `${h}:00`);
  const inStoreData = hours.map(h => hourlyData[h]?.inStore || 0);
  const deliveryData = hours.map(h => hourlyData[h]?.delivery || 0);
  const combinedData = inStoreData.map((v,i) => v + deliveryData[i]);

  if (salesChart) salesChart.destroy();
  salesChart = new Chart(salesChartEl, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {label:'In-Store Sales', data:inStoreData, borderColor:'#4b3621', backgroundColor:'rgba(75,54,33,0.2)', fill:true, tension:0.3},
        {label:'Delivery Sales', data:deliveryData, borderColor:'#ff7f50', backgroundColor:'rgba(255,127,80,0.2)', fill:true, tension:0.3},
        {label:'Combined Sales', data:combinedData, borderColor:'#228B22', backgroundColor:'rgba(34,139,34,0.2)', fill:true, tension:0.3}
      ]
    },
    options:{
      responsive:true,
      plugins:{legend:{position:'top'}, tooltip:{mode:'index', intersect:false}},
      scales:{
        x:{title:{display:true,text:'Hour of Day'}},
        y:{title:{display:true,text:'Revenue (₱)'}, beginAtZero:true}
      }
    }
  });
}

// Inventory
async function updateInventory() {
  const snapshot = await getDocs(collection(db, "Inventory"));
  const lowItems = snapshot.docs.filter(d => (d.data().quantity || 0) <= 5);
  lowInventoryEl.textContent = `${lowItems.length} Items Low`;
}

// Menu count
async function updateMenu() {
  const snapshot = await getDocs(collection(db, "products"));
  menuCountEl.textContent = `${snapshot.docs.length} Available`;
}

// Top 5 Best Sellers
async function updateTopSellers() {
  const orderCollections = ["InStoreOrders", "DeliveryOrders"];
  const productSales = {};

  for (const col of orderCollections) {
    const snapshot = await getDocs(collection(db, col));
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (data.status !== "Completed") return;
      const items = data.items || data.products || [];
      items.forEach(p => {
        const name = p.product;
        const lineTotal = p.total || ((p.qty || 1) * (p.basePrice || 0));
        if (!productSales[name]) productSales[name] = 0;
        productSales[name] += lineTotal;
      });
    });
  }

  const topProducts = Object.entries(productSales)
    .sort((a,b) => b[1] - a[1])
    .slice(0,5);

  bestSellersTable.innerHTML = "";
  topProducts.forEach(([name, total]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${name}</td><td>₱${total.toFixed(2)}</td>`;
    bestSellersTable.appendChild(tr);
  });
}
