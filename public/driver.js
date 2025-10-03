import { db } from './firebase-config.js';
import { collection, onSnapshot, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ordersContainer = document.getElementById('ordersContainer');
const tabButtons = document.querySelectorAll(".tab-btn");
let selectedStatus = "Delivery";
let allOrders = [];

// ---------------------
// Tab switching
// ---------------------
tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedStatus = btn.dataset.status;
        renderOrders();
    });
});

// ---------------------
// Listen to DeliveryOrders
// ---------------------
onSnapshot(collection(db, "DeliveryOrders"), snapshot => {
    allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (a.queueNumberNumeric || 0) - (b.queueNumberNumeric || 0));
    renderOrders();
});

// ---------------------
// Render orders
// ---------------------
function renderOrders() {
    ordersContainer.innerHTML = "";

    const filteredOrders = allOrders.filter(o => o.status === selectedStatus);

    if (!filteredOrders.length) {
        ordersContainer.innerHTML = `<p>No ${selectedStatus.toLowerCase()} orders.</p>`;
        return;
    }

    filteredOrders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'order-card';

        const itemsHtml = Array.isArray(order.items) && order.items.length > 0
            ? order.items.map(i => `<p>${i.qty || 1} x ${i.product}${i.size ? ` (${i.size})` : ""}</p>`).join('')
            : "<p>No items listed.</p>";

        card.innerHTML = `
            <div class="order-header">
                <div class="header-info">
                    <p>Queue #: ${order.queueNumber || 'N/A'}</p>
                    <p>Customer: ${order.customerName || 'N/A'}</p>
                    <p>Address: ${order.address || 'N/A'}</p>
                    <p>Phone: <a href="tel:${order.customerPhone || ''}">${order.customerPhone || 'N/A'}</a></p>
                    <p>Payment: ${order.paymentMethod || 'N/A'}</p>
                </div>
                <span class="expand-arrow">&#9654;</span>
            </div>
            <div class="order-products">
                ${itemsHtml}
            </div>
            <div class="order-actions">
                ${order.status === "Delivery" ? `<button class="complete-btn" onclick="markCompleted('${order.id}')">Mark Completed</button>` : ''}
                ${order.customerPhone ? `<button class="call-btn" onclick="window.location.href='tel:${order.customerPhone}'">Call Customer</button>` : ''}
            </div>
        `;

        card.querySelector('.order-header').addEventListener('click', () => {
            card.classList.toggle('expanded');
        });

        ordersContainer.appendChild(card);
    });
}

// ---------------------
// Mark Delivery as Completed
// ---------------------
window.markCompleted = async function(orderId) {
    try {
        await updateDoc(doc(db, "DeliveryOrders", orderId), { status: "Completed" });
    } catch (err) {
        console.error("Failed to update status:", err);
    }
};
