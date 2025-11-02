import { db } from './firebase-config.js';
import {
  collection,
  query,
  onSnapshot,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const historyContainer = document.querySelector('.history-container');
const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');
const filterContainer = document.getElementById('filterContainer'); 

loginRedirect.addEventListener('click', () => {
  window.location.href = 'login.html';
});

const auth = getAuth();
let currentUser = null;
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const itemsPerPage = 10;
let selectedStatus = "All";

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    loginPopup.style.display = 'none';
    createFilterDropdown();
    listenToHistory();
  } else {
    currentUser = null;
    loginPopup.style.display = 'flex';
    historyContainer.innerHTML = '';
    if (filterContainer) filterContainer.innerHTML = '';
  }
});


function listenToHistory() {
  const ordersRef = collection(db, "DeliveryOrders");
  const q = query(ordersRef, orderBy("createdAt", "desc"));

  onSnapshot(q, (snapshot) => {
    const userOrders = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(order =>
        order.userId === currentUser?.uid &&
        (
          order.status?.includes("Completed") ||
          order.status?.includes("Canceled") ||
          order.status?.includes("Refunded") ||
          order.status?.includes("Completed by Customer")
        )
      );

    allOrders = userOrders;
    applyFilter();
  });
}

function createFilterDropdown() {
  if (!filterContainer) return;

  filterContainer.innerHTML = `
    <label for="statusFilter" class="filter-label">Filter by Status:</label>
    <select id="statusFilter" class="status-filter">
      <option value="All">All</option>
      <option value="Completed">Completed</option>
      <option value="Canceled">Canceled</option>
      <option value="Refunded">Refunded</option>
    </select>
  `;

  const statusFilter = document.getElementById('statusFilter');
  statusFilter.addEventListener('change', (e) => {
    selectedStatus = e.target.value;
    applyFilter();
  });
}

function applyFilter() {
  if (selectedStatus === "All") {
    filteredOrders = allOrders;
  } else if (selectedStatus === "Completed") {
    filteredOrders = allOrders.filter(order =>
      order.status === "Completed" || order.status === "Completed by Customer"
    );
  } else {
    filteredOrders = allOrders.filter(order => order.status === selectedStatus);
  }

  currentPage = 1;
  renderPaginatedHistory();
}

function renderPaginatedHistory() {
  historyContainer.innerHTML = '';

  if (filteredOrders.length === 0) {
    historyContainer.innerHTML = '<p class="no-orders">No orders found for this status.</p>';
    return;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  renderHistory(paginatedOrders);
  renderPaginationControls();
}

function renderHistory(orders) {
  orders.forEach(order => {
    const date = order.createdAt?.toDate?.()?.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    }) || "Unknown Date";

    const card = document.createElement('div');
    card.className = 'order-card';

    const header = `
      <div class="order-header">
        <span>Queue #: ${order.queueNumber || "N/A"}</span>
        <span>${date}</span>
      </div>
      <div class="order-status ${order.status}">
        Status: ${order.status || "Unknown"}
      </div>
      <div class="order-divider"></div>
    `;


    let itemsHTML = '';
    const items = order.items || [];
    items.forEach(item => {
      itemsHTML += `
        <div class="order-item-row">
          <div class="order-item-name">${item.product || 'Unnamed'}</div>
          <div class="order-item-qty">${item.qty || item.quantity || 1}pc</div>
          <div class="order-item-price">₱${Number(item.total || item.totalPrice || 0).toFixed(2)}</div>
        </div>
      `;
    });

    const summary = `
      <div class="order-divider"></div>
      <div class="order-summary">
        <div class="order-summary-row">
          <span>Delivery Fee</span>
          <span>₱${Number(order.deliveryFee || 0).toFixed(2)}</span>
        </div>
        <div class="order-address">Address: ${order.address || 'No address provided'}</div>
        <div class="order-total">
          <span>Total</span>
          <span>₱${Number(order.total || 0).toFixed(2)}</span>
        </div>
      </div>
      <div class="order-divider"></div>
    `;

    card.innerHTML = header + itemsHTML + summary;
    historyContainer.appendChild(card);
  });
}

function renderPaginationControls() {
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  if (totalPages <= 1) return;

  const paginationDiv = document.createElement('div');
  paginationDiv.className = 'pagination-controls';

  const prevButton = document.createElement('button');
  prevButton.textContent = 'Previous';
  prevButton.disabled = currentPage === 1;
  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderPaginatedHistory();
    }
  });

  const pageInfo = document.createElement('span');
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;

  const nextButton = document.createElement('button');
  nextButton.textContent = 'Next';
  nextButton.disabled = currentPage === totalPages;
  nextButton.addEventListener('click', () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderPaginatedHistory();
    }
  });

  paginationDiv.appendChild(prevButton);
  paginationDiv.appendChild(pageInfo);
  paginationDiv.appendChild(nextButton);

  historyContainer.appendChild(paginationDiv);
}

window.addEventListener('click', e => {
  if (e.target === loginPopup) {
    loginPopup.style.display = 'none';
  }
});
