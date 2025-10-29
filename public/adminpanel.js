import { auth, db } from './firebase-config.js';
import { collection, onSnapshot, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const ordersTodayEl = document.getElementById("ordersToday");
const salesTodayEl = document.getElementById("salesToday");
const lowInventoryEl = document.getElementById("lowInventory");
const menuCountEl = document.getElementById("menuCount");
const bestSellersTable = document.querySelector("#bestSellersTable tbody");
const salesChartEl = document.getElementById("salesChart");
    

let salesChart;

const formatCurrency = (amount) => {
    return Number(amount).toLocaleString('en-PH', {
        style: 'currency',
        currency: 'PHP',
    });
};

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "login.html";
        return;
    }
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "Admin") {
        alert("Access denied. Admins only.");
        window.location.href = "login.html";
        return;
    }
    initDashboard();
});

function initDashboard() {
    updateInventory();
    updateMenu();
    setupRealtimeOrdersListener();
}

function getTodayRange() {
    const start = new Date();
    start.setHours(0,0,0,0);
    const end = new Date();
    end.setHours(23,59,59,999);
    return { start, end };
}

function setupRealtimeOrdersListener() {
    const { start, end } = getTodayRange();
    const orderCollections = ["InStoreOrders", "DeliveryOrders"];
    let allOrdersData = []; 
    
    const processAllData = () => {
        let totalOrdersToday = 0;
        let totalSalesToday = 0;
        const hourlyData = {};
        const allTimeProductSales = {}; 
        
        allOrdersData.forEach(data => {
            if (!data.createdAt) return;
            
            const createdAt = data.createdAt.toDate ? data.createdAt.toDate() : data.createdAt;
            
            if (data.status && data.status.toLowerCase().includes("completed")) {
                
                if (createdAt >= start && createdAt <= end) {
                    totalOrdersToday++;
                    totalSalesToday += data.total || 0;
                    
                    const hour = createdAt.getHours();
                    if (!hourlyData[hour]) hourlyData[hour] = { inStore: 0, delivery: 0 };
                    const collectionType = data.collection === "InStoreOrders" ? "inStore" : "delivery";
                    hourlyData[hour][collectionType] += data.total || 0;
                }
                
                const items = data.items || data.products || [];
                items.forEach(p => {
                    const name = p.product;
                    const lineTotal = p.total || ((p.qty || 1) * (p.basePrice || 0));
                    if (!allTimeProductSales[name]) allTimeProductSales[name] = 0;
                    allTimeProductSales[name] += lineTotal;
                });
            }
         });
         
        ordersTodayEl.textContent = `${totalOrdersToday} Today`;
        salesTodayEl.textContent = formatCurrency(totalSalesToday); 
        
        renderSalesChart(hourlyData);
        renderTopSellers(allTimeProductSales); 
    };
    
    orderCollections.forEach(col => {
        onSnapshot(collection(db, col), (snapshot) => {
            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                data.id = change.doc.id; 
                data.collection = col; 
                
                const index = allOrdersData.findIndex(d => d.id === data.id && d.collection === col);
                
                if (change.type === 'added') {
                    allOrdersData.push(data);
                } else if (change.type === 'modified') {
                    if (index !== -1) {
                        allOrdersData[index] = data;
                    }
                 } else if (change.type === 'removed') {
                     if (index !== -1) {
                        allOrdersData.splice(index, 1);
                    }
                }
            });

            processAllData(); 
         });
         });
}


function renderSalesChart(hourlyData) {
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
                y:{title:{display:true,text:'Revenue (₱)'}, beginAtZero:true,
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

function renderTopSellers(productSales) {
    const topProducts = Object.entries(productSales)
    .sort((a,b) => b[1] - a[1])
    .slice(0,5);

    bestSellersTable.innerHTML = "";
    topProducts.forEach(([name, total]) => {
        const tr = document.createElement("tr");

        tr.innerHTML = `<td>${name}</td><td>${formatCurrency(total)}</td>`; 
        bestSellersTable.appendChild(tr);
    });
}

// Stocks
function getStockStatus(item){
    const qty = Number(item.quantity) || 0;
    
    if(["Ingredients","Adds-on","Others"].includes(item.category)){
        if(["g","ml"].includes(item.unit)) return qty===0?"Out of Stock":qty<50?"Low Stock":"In Stock";
        if(["slice","squeeze","Piece"].includes(item.unit)) return qty===0?"Out of Stock":qty<10?"Low Stock":"In Stock";
        if(item.unit==="scoop") return qty===0?"Out of Stock":qty<5?"Low Stock":"In Stock";
    }if(item.category==="Sizes" && item.unit==="pieces") return qty===0?"Out of Stock":qty<30?"Low Stock":"In Stock";
    return qty===0?"Out of Stock":qty<=5?"Low Stock":"In Stock";
}


async function updateInventory() {
    const inventoryRef = collection(db, "Inventory");
    onSnapshot(inventoryRef, (snapshot) => {

        const lowItems = snapshot.docs.filter(d => {
            const status = getStockStatus(d.data());
            return status === "Low Stock" || status === "Out of Stock";
        });
        lowInventoryEl.textContent = `${lowItems.length} Items Low`;
    });
}

async function updateMenu() {
    const productsRef = collection(db, "products");
    onSnapshot(productsRef, (snapshot) => {
        menuCountEl.textContent = `${snapshot.docs.length} Available`;
    });
}
