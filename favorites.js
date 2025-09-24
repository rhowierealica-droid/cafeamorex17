import { db } from './firebase-config.js';
import { collection, getDocs, doc, getDoc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addToCart } from './cart.js';

// DOM Elements
const favoritesContainer = document.querySelector('.favorites-container');
const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');

favoritesContainer.style.display = "flex";
favoritesContainer.style.flexWrap = "wrap";
favoritesContainer.style.gap = "20px";
favoritesContainer.style.justifyContent = "center";
favoritesContainer.style.maxWidth = "1200px";
favoritesContainer.style.margin = "0 auto";

loginRedirect.addEventListener('click', () => window.location.href = 'login.html');

const auth = getAuth();
let currentUser = null;

// ==========================
// Cart Popup
// ==========================
const cartPopup = document.createElement('div');
cartPopup.className = 'popup cart-popup';
cartPopup.innerHTML = `
  <div class="popup-content">
    <span class="close-cart">&times;</span>
    <h2 class="product-name"></h2>
    <p class="product-desc"></p>
    <div class="sizes-container"></div>
    <div class="addons-container"></div>
    <label>Quantity: <input type="number" class="quantity-input" value="1" min="1"></label>
    <button class="confirm-add-cart">Add to Cart</button>
  </div>
`;
document.body.appendChild(cartPopup);
cartPopup.querySelector('.close-cart').addEventListener('click', () => { cartPopup.style.display = 'none'; });

// ==========================
// Stock Calculation
// ==========================
function calculateProductStock(product, inventoryMap) {
  let stockPerSize = [];
  if (product.sizes?.length) {
    for (const size of product.sizes) {
      let possible = Infinity;
      const sizeItem = inventoryMap[size.id];
      if (sizeItem) possible = Math.min(possible, Math.floor(sizeItem.quantity / (size.qty || 1)));

      if (product.ingredients?.length) {
        for (const ing of product.ingredients) {
          const invItem = inventoryMap[ing.id];
          if (invItem) possible = Math.min(possible, Math.floor(invItem.quantity / (ing.qty || 1)));
        }
      }

      if (product.others?.length) {
        for (const other of product.others) {
          const invItem = inventoryMap[other.id];
          if (invItem) possible = Math.min(possible, Math.floor(invItem.quantity / (other.qty || 1)));
        }
      }

      stockPerSize.push({ ...size, stock: possible === Infinity ? 0 : possible });
    }
  }
  return stockPerSize;
}

// ==========================
// Open Cart Popup
// ==========================
function openCartPopup(product, stockInfo = []) {
  cartPopup.style.display = 'flex';
  cartPopup.querySelector('.product-name').textContent = product.name || 'Unnamed Product';
  cartPopup.querySelector('.product-desc').textContent = product.description || '';

  const sizesContainer = cartPopup.querySelector('.sizes-container');
  sizesContainer.innerHTML = '';
  let selectedSize = null;

  if (Array.isArray(stockInfo) && stockInfo.length) {
    const heading = document.createElement('p'); heading.textContent = 'Sizes:'; sizesContainer.appendChild(heading);
    stockInfo.forEach(size => {
      const label = document.createElement('label'); label.classList.add('size-btn');
      label.textContent = `${size.name} - ₱${size.price.toFixed(2)} (Stock: ${size.stock})`;
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'size';
      if (size.stock <= 0) { input.disabled = true; label.classList.add('unavailable'); }
      else if (!selectedSize) { input.checked = true; label.classList.add('selected'); selectedSize = { ...size }; }
      input.addEventListener('change', () => {
        sizesContainer.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected'); selectedSize = { ...size };
        quantityInput.max = selectedSize.stock;
        if (parseInt(quantityInput.value) > selectedSize.stock) quantityInput.value = selectedSize.stock;
      });
      label.prepend(input); sizesContainer.appendChild(label);
    });
  }

  const addonsContainer = cartPopup.querySelector('.addons-container');
  addonsContainer.innerHTML = '';
  let selectedAddons = [];
  if (Array.isArray(product.addons) && product.addons.length) {
    const heading = document.createElement('p'); heading.textContent = 'Add-ons:'; addonsContainer.appendChild(heading);
    product.addons.forEach(addon => {
      const label = document.createElement('label'); label.classList.add('addon-btn'); label.textContent = `${addon.name} - ₱${addon.price.toFixed(2)}`;
      const input = document.createElement('input'); input.type = 'checkbox';
      input.addEventListener('change', () => {
        if (input.checked) selectedAddons.push(addon);
        else selectedAddons = selectedAddons.filter(a => a.id !== addon.id);
      });
      label.prepend(input); addonsContainer.appendChild(label);
    });
  }

  const quantityInput = cartPopup.querySelector('.quantity-input');
  quantityInput.value = 1; 
  quantityInput.min = 1; 
  quantityInput.max = selectedSize?.stock || 1;

  const confirmBtn = cartPopup.querySelector('.confirm-add-cart');
  confirmBtn.onclick = () => {
    const quantity = parseInt(quantityInput.value) || 1;
    if (!selectedSize) return alert("Please select a size first!");
    if (quantity > selectedSize.stock) return alert(`Only ${selectedSize.stock} left in stock!`);
    addToCart(product, selectedSize, selectedAddons, quantity);
    cartPopup.style.display = 'none';
  };
}

// ==========================
// Load Favorites
// ==========================
async function loadFavorites() {
  favoritesContainer.innerHTML = '';

  const favSnapshot = await getDocs(collection(db, "favorites"));
  const userFavs = favSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(f => f.userId === currentUser.uid);

  if (userFavs.length === 0) {
    favoritesContainer.innerHTML = '<p>You have no favorite products yet.</p>';
    return;
  }

  const inventorySnapshot = await getDocs(collection(db, "Inventory"));
  const inventoryMap = {};
  inventorySnapshot.forEach(docSnap => { inventoryMap[docSnap.id] = docSnap.data(); });

  for (const fav of userFavs) {
    const productDoc = await getDoc(doc(db, "products", fav.productId));
    if (!productDoc.exists()) continue;
    const product = { id: productDoc.id, ...productDoc.data() };

    const stockInfo = calculateProductStock(product, inventoryMap);
    const isUnavailable = !product.available || stockInfo.every(s => s.stock <= 0);

    const card = document.createElement('div'); 
    card.className = 'product-card';
    if (isUnavailable) card.classList.add('unavailable');
    card.style.minWidth = '200px'; 
    card.style.maxWidth = '220px';
    card.style.display = 'flex'; 
    card.style.flexDirection = 'column'; 
    card.style.alignItems = 'center';

    card.innerHTML = `
      <img src="${product.image || 'placeholder.png'}" alt="${product.name}" class="product-image">
      <h3>${product.name || 'Unnamed Product'}</h3>
      <p>${product.description || ''}</p>
      <div class="stars-outer"><div class="stars-inner"></div></div>
      <span class="rating-number"></span>
      <div class="card-actions"></div>
    `;

    const actionsDiv = card.querySelector('.card-actions');

    const favIcon = document.createElement('i'); 
    favIcon.className = 'fa-regular fa-heart favorite-icon';
    actionsDiv.appendChild(favIcon);

    const favRef = doc(db, "favorites", `${currentUser.uid}_${productDoc.id}`);
    const favSnapCheck = await getDoc(favRef);
    if (favSnapCheck.exists()) { 
      favIcon.classList.replace('fa-regular', 'fa-solid'); 
      favIcon.classList.add('favorited'); 
    }

    favIcon.addEventListener('click', async () => {
      if (!currentUser) { loginPopup.style.display = 'flex'; return; }
      const favSnap = await getDoc(favRef);
      if (favSnap.exists()) { 
        await deleteDoc(favRef); 
        favIcon.classList.replace('fa-solid','fa-regular'); 
        card.remove(); 
      } else { 
        await setDoc(favRef, { userId: currentUser.uid, productId: productDoc.id, addedAt: new Date() }); 
        favIcon.classList.replace('fa-regular','fa-solid'); 
      }
    });

    const reviewBtn = document.createElement('button'); 
    reviewBtn.textContent = "Reviews"; 
    reviewBtn.className = "reviews-btn";
    actionsDiv.appendChild(reviewBtn);
    reviewBtn.addEventListener('click', async () => {
      if (!currentUser) { loginPopup.style.display = 'flex'; return; }
      const orderSnapshot = await getDocs(collection(db, "DeliveryOrders"));
      const feedbacks = [];
      orderSnapshot.forEach(docSnap => {
        const order = docSnap.data();
        order.items?.forEach((item, index) => {
          if (item.product === product.name && order.feedback?.[index]) {
            feedbacks.push({ text: order.feedback[index], customerEmail: order.customerName || "" });
          }
        });
      });
      showReviewsPopup(product.name, feedbacks);
    });

    const addCartBtn = document.createElement('button'); 
    addCartBtn.textContent = "Add to Cart"; 
    addCartBtn.className = "add-cart-btn";
    if (!isUnavailable) addCartBtn.addEventListener('click', () => openCartPopup(product, stockInfo));
    actionsDiv.appendChild(addCartBtn);

    favoritesContainer.appendChild(card);

    // Ratings
    const starsInner = card.querySelector('.stars-inner');
    const ratingNumber = card.querySelector('.rating-number');
    let totalRating = 0, count = 0;
    const orderSnapshot = await getDocs(collection(db, "DeliveryOrders"));
    orderSnapshot.forEach(docSnap => {
      const order = docSnap.data();
      order.items?.forEach((item, index) => {
        if (item.product === product.name && order.feedbackRating?.[index] != null) {
          totalRating += order.feedbackRating[index];
          count++;
        }
      });
    });
    const avgRating = count ? totalRating / count : 0;
    starsInner.style.width = `${(avgRating / 5) * 100}%`;
    ratingNumber.textContent = count ? `(${avgRating.toFixed(1)})` : '';
  }
}

// ==========================
// Show Reviews Popup
// ==========================
function showReviewsPopup(productName, feedbacks) {
  const popup = document.createElement('div'); popup.className = 'popup reviews-popup'; popup.style.display = 'flex';
  const popupContent = document.createElement('div'); popupContent.className = 'popup-content';
  const closeBtn = document.createElement('span'); closeBtn.className = 'close-btn'; closeBtn.innerHTML = "&times;"; closeBtn.onclick = () => popup.remove();
  const title = document.createElement('h3'); title.textContent = `Reviews for ${productName}`;
  const list = document.createElement('div'); list.className = 'feedback-list';
  if (feedbacks.length) {
    feedbacks.forEach(f => {
      let emailMasked = f.customerEmail;
      if (emailMasked) { const [name, domain] = emailMasked.split('@'); emailMasked = `${name.slice(0,3)}****@${domain}`; }
      const p = document.createElement('p'); p.textContent = `${emailMasked}: ${f.text}`; list.appendChild(p);
    });
  } else list.textContent = "No reviews yet.";
  popupContent.append(closeBtn, title, list); popup.appendChild(popupContent); document.body.appendChild(popup);
  popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
}

// ⭐ Stars CSS
const style = document.createElement('style');
style.textContent = `
.stars-outer { position: relative; display: inline-block; color: #ccc; font-size: 16px; font-family: Arial, sans-serif; margin-bottom: 5px; }
.stars-inner { position: absolute; top: 0; left: 0; white-space: nowrap; overflow: hidden; width: 0; color: #f8ce0b; }
.stars-outer::before { content: "★★★★★"; }
.stars-inner::before { content: "★★★★★"; }
`;
document.head.appendChild(style);

// ==========================
// Auth state
// ==========================
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!currentUser) loginPopup.style.display = 'flex';
  else await loadFavorites();
});

// Close login popup
window.addEventListener('click', e => { if (e.target === loginPopup) loginPopup.style.display = 'none'; });
