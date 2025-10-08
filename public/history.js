import { db } from './firebase-config.js';
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const historyContainer = document.querySelector('.history-container');
const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');

loginRedirect.addEventListener('click', () => window.location.href = 'login.html');

const auth = getAuth();
let currentUser = null;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!currentUser) {
    loginPopup.style.display = 'flex';
    return;
  }
  await loadHistory();
});

async function loadHistory() {
  const ordersSnapshot = await getDocs(collection(db, "DeliveryOrders"));

  const userOrders = ordersSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(order => 
      order.userId === currentUser.uid &&
      (order.status?.includes("Completed") || order.status?.includes("Canceled"))
    );

  if (userOrders.length === 0) {
    historyContainer.innerHTML = '<p class="no-orders">You have no completed or cancelled orders yet.</p>';
    return;
  }

  userOrders.forEach(order => {
    if (document.getElementById(`order-${order.id}`)) return;

    const card = document.createElement('div');
    card.className = 'order-card';
    card.id = `order-${order.id}`;

    const date = order.createdAt?.toDate?.()?.toLocaleString() || "Unknown date";

    card.innerHTML = `
      <h3>Order #${order.queueNumber || order.id}</h3>
      <p class="order-date"><strong>Date:</strong> ${date}</p>
      <p class="status ${order.status}">Status: ${order.status}</p>
      <div class="order-items"></div>
      <p><strong>Delivery Fee:</strong> ₱${Number(order.deliveryFee || 0).toFixed(2)}</p>
      <p><strong>Total:</strong> ₱${Number(order.total || 0).toFixed(2)}</p>
    `;

    const itemsContainer = card.querySelector('.order-items');
    const items = order.items || [];

    if (items[0]) {
      const item = items[0];

      // Create image container
      const imgContainer = document.createElement('div');
      imgContainer.className = 'order-item';
      const img = document.createElement('img');
      img.src = item.image || 'placeholder.png';
      img.alt = item.product || 'Product Image';
      imgContainer.appendChild(img);
      itemsContainer.appendChild(imgContainer);

      // Product info stays in order-card
      const nameP = document.createElement('p');
      nameP.className = 'item-name';
      nameP.textContent = `Product: ${item.product || 'Unnamed Item'}`;
      const sizeP = document.createElement('p');
      sizeP.className = 'item-size';
      sizeP.textContent = `Size: ${item.size || 'N/A'} - ₱${Number(item.sizePrice || 0).toFixed(2)}`;
      const addonsP = document.createElement('p');
      addonsP.className = 'item-addons';
      if (item.addons && item.addons.length) {
        addonsP.innerHTML = `Add-ons:<br>${item.addons.map(a => `${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>")}`;
      } else addonsP.textContent = 'Add-ons: None';
      const qtyP = document.createElement('p');
      qtyP.className = 'item-qty';
      qtyP.textContent = `Quantity: ${item.qty || item.quantity || 1}`;
      const totalP = document.createElement('p');
      totalP.className = 'item-total';
      totalP.textContent = `Total: ₱${Number(item.total || item.totalPrice || 0).toFixed(2)}`;

      itemsContainer.appendChild(nameP);
      itemsContainer.appendChild(sizeP);
      itemsContainer.appendChild(addonsP);
      itemsContainer.appendChild(qtyP);
      itemsContainer.appendChild(totalP);
    }

    // Show All Button
    if (items.length > 1) {
      const showBtn = document.createElement('button');
      showBtn.textContent = `Show All (${items.length})`;
      showBtn.className = 'show-all-btn';
      showBtn.addEventListener('click', () => openOrderModal(items, order.id, order.deliveryFee));
      itemsContainer.appendChild(showBtn);
    }

    historyContainer.appendChild(card);
  });
}

// Modal creation function
function openOrderModal(items, orderId, deliveryFee = 0) {
  const modal = document.createElement('div');
  modal.className = 'order-modal';
  modal.id = `modal-${orderId}`;
  modal.style.display = 'flex';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.zIndex = '1000';

  const modalContent = document.createElement('div');
  modalContent.className = 'order-modal-content';
  modalContent.style.backgroundColor = '#fff';
  modalContent.style.padding = '20px';
  modalContent.style.borderRadius = '10px';
  modalContent.style.maxHeight = '80vh';
  modalContent.style.overflowY = 'auto';
  modalContent.style.width = '90%';
  modalContent.innerHTML = `<h2>All Products</h2>`;

  let grandTotal = 0;

  items.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'order-item';
    itemDiv.style.display = 'flex';
    itemDiv.style.marginBottom = '12px';

    const img = document.createElement('img');
    img.src = item.image || 'placeholder.png';
    img.alt = item.product || 'Product Image';
    img.style.width = '60px';
    img.style.height = '60px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    itemDiv.appendChild(img);

    const infoDiv = document.createElement('div');
    infoDiv.style.marginLeft = '10px';

    const nameP = document.createElement('p');
    nameP.textContent = `Product: ${item.product || 'Unnamed Item'}`;
    const sizeP = document.createElement('p');
    sizeP.textContent = `Size: ${item.size || 'N/A'} - ₱${Number(item.sizePrice || 0).toFixed(2)}`;
    const addonsP = document.createElement('p');
    if (item.addons && item.addons.length) {
      addonsP.innerHTML = `Add-ons:<br>${item.addons.map(a => `${a.name} - ₱${Number(a.price).toFixed(2)}`).join("<br>")}`;
    } else addonsP.textContent = 'Add-ons: None';
    const qtyP = document.createElement('p');
    qtyP.textContent = `Quantity: ${item.qty || item.quantity || 1}`;
    const totalP = document.createElement('p');
    const itemTotal = Number(item.total || item.totalPrice || 0);
    totalP.textContent = `Total: ₱${itemTotal.toFixed(2)}`;
    grandTotal += itemTotal;

    infoDiv.appendChild(nameP);
    infoDiv.appendChild(sizeP);
    infoDiv.appendChild(addonsP);
    infoDiv.appendChild(qtyP);
    infoDiv.appendChild(totalP);
    itemDiv.appendChild(infoDiv);
    modalContent.appendChild(itemDiv);
  });

  const deliveryP = document.createElement('p');
  deliveryP.innerHTML = `<strong>Delivery Fee:</strong> ₱${Number(deliveryFee).toFixed(2)}`;
  const grandTotalP = document.createElement('p');
  grandTotalP.innerHTML = `<strong>Grand Total:</strong> ₱${(grandTotal + Number(deliveryFee)).toFixed(2)}`;
  modalContent.appendChild(deliveryP);
  modalContent.appendChild(grandTotalP);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.className = 'modal-close-btn';
  closeBtn.style.marginTop = '15px';
  closeBtn.addEventListener('click', () => modal.remove());

  modalContent.appendChild(closeBtn);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });
}

// Close login popup
window.addEventListener('click', e => {
  if (e.target === loginPopup) loginPopup.style.display = 'none';
});
