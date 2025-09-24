import { db } from './firebase-config.js';
import { 
  collection, getDocs, doc, setDoc, getDoc, deleteDoc, 
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addToCart } from './cart.js';

// ==========================
// Modular Toast Notification
// ==========================
function showToast(message = "Item added!", duration = 2000, type = "success") {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);

    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      color: '#fff',
      padding: '12px 20px',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      fontWeight: '500',
      zIndex: 9999,
      opacity: 0,
      transition: 'opacity 0.3s, transform 0.3s',
    });
  }

  toast.style.backgroundColor = type === "error" ? "#dc2626" : "#16a34a";
  toast.textContent = message;
  toast.style.opacity = 1;
  toast.style.transform = 'translateX(-50%) translateY(0)';

  setTimeout(() => {
    toast.style.opacity = 0;
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, duration);
}

// ==========================
// DOM Elements
// ==========================
const drinksContainer = document.querySelector('.category-list[data-main="Drink"]');
const sandwichContainer = document.querySelector('.category-list[data-main="Sandwich"]');
const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');

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

// ==========================
// Auth
// ==========================
const auth = getAuth();
let currentUser = null;
onAuthStateChanged(auth, user => currentUser = user);

loginRedirect?.addEventListener('click', () => window.location.href = 'login.html');

// ==========================
// Stock Calculation Helper
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
// Load Products Realtime
// ==========================
function loadProductsRealtime() {
  if (!drinksContainer && !sandwichContainer) return;

  let inventoryMap = {};

  onSnapshot(collection(db, "Inventory"), inventorySnapshot => {
    inventoryMap = {};
    inventorySnapshot.forEach(docSnap => {
      inventoryMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });

    onSnapshot(collection(db, "products"), productSnapshot => {
      const products = productSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      drinksContainer.innerHTML = "";
      sandwichContainer.innerHTML = "";

      const grouped = {};
      for (const product of products) {
        const mainCategory = ["Ice Espresso", "Non-Coffee", "Iced Cold Brew", "Hot Coffee"].includes(product.category)
          ? "Drink" : "Sandwich";
        const subCategory = product.category || "Others";
        if (!grouped[mainCategory]) grouped[mainCategory] = {};
        if (!grouped[mainCategory][subCategory]) grouped[mainCategory][subCategory] = [];
        grouped[mainCategory][subCategory].push(product);
      }

      for (const mainCat in grouped) {
        const container = mainCat === "Drink" ? drinksContainer : sandwichContainer;

        for (const subCat in grouped[mainCat]) {
          const subCatSection = document.createElement('div');
          subCatSection.className = 'subcategory-section';
          subCatSection.innerHTML = `<h3 class="subcategory-title">${subCat}</h3>`;

          const horizontalContainer = document.createElement('div');
          horizontalContainer.className = 'subcategory-products horizontal-scroll';
          Object.assign(horizontalContainer.style, { display: 'flex', flexWrap: 'nowrap', gap: '15px', overflowX: 'auto' });

          subCatSection.appendChild(horizontalContainer);
          container.appendChild(subCatSection);

          for (const product of grouped[mainCat][subCat]) {
            const stockInfo = calculateProductStock(product, inventoryMap);
            const card = document.createElement('div');
            card.classList.add('product-card');

            let displayPrice = product.price || 0;
            if (stockInfo.length) displayPrice = Math.min(...stockInfo.map(s => s.price || Infinity));
            const isUnavailable = !product.available || stockInfo.every(s => s.stock <= 0);
            if (isUnavailable) card.classList.add('unavailable');

            const imgHTML = product.image ? `<img src="${product.image}" alt="${product.name}" style="width:100%; border-radius:10px; margin-bottom:10px; margin-top:20px;">` : '';
            let stockHTML = stockInfo.length ? stockInfo.map(s => s.stock <= 5 ? `<p>${s.name}: <span style="color:red; font-weight:bold;">Only ${s.stock} left</span></p>` : `<p>${s.name}: ${s.stock} left</p>`).join("") : "";

            card.innerHTML = `
              ${imgHTML}
              <h3>${product.name || 'Unnamed Product'}</h3>
              ${product.description ? `<p class="product-desc-card">${product.description}</p>` : ''}
              <p>₱${displayPrice.toFixed(2)}</p>
              ${stockHTML}
              ${!isUnavailable ? `<button class="add-cart-btn">Add to Cart</button>` : ''}
            `;

            // ⭐ Dynamic Ratings
            const starsContainer = document.createElement('div');
            starsContainer.className = 'stars-outer';
            const starsInner = document.createElement('div');
            starsInner.className = 'stars-inner';
            starsContainer.appendChild(starsInner);
            const ratingNumber = document.createElement('span');
            ratingNumber.className = 'rating-number';
            card.appendChild(starsContainer);
            card.appendChild(ratingNumber);

            (async () => {
              const orderSnapshot = await getDocs(collection(db, "DeliveryOrders"));
              let totalRating = 0, count = 0;
              orderSnapshot.forEach(docSnap => {
                const order = docSnap.data();
                order.items?.forEach((item, index) => {
                  if (item.product === product.name && order.feedbackRating?.[index] != null) {
                    totalRating += order.feedbackRating[index];
                    count++;
                  }
                });
              });
              let avgRating = count ? totalRating / count : 0;
              starsInner.style.width = `${(avgRating / 5) * 100}%`;
              ratingNumber.textContent = count ? `(${avgRating.toFixed(1)})` : '';
            })();

            horizontalContainer.appendChild(card);

            const addBtn = card.querySelector('.add-cart-btn');
            if (!isUnavailable && addBtn) addBtn.addEventListener('click', () => openCartPopup(product, stockInfo));

            // ❤️ Favorite icon
            const favIcon = document.createElement('i');
            favIcon.className = 'fa-regular fa-heart favorite-icon';
            card.appendChild(favIcon);

            if (currentUser) {
              const favRef = doc(db, "favorites", `${currentUser.uid}_${product.id}`);
              getDoc(favRef).then(favDoc => {
                if (favDoc.exists()) {
                  favIcon.classList.replace('fa-regular', 'fa-solid');
                  favIcon.classList.add('favorited');
                }
              });
            }

            favIcon.addEventListener('click', async () => {
              if (!currentUser) { loginPopup.style.display = 'flex'; return; }
              const favRef = doc(db, "favorites", `${currentUser.uid}_${product.id}`);
              const favSnap = await getDoc(favRef);
              try {
                if (favSnap.exists()) {
                  await deleteDoc(favRef);
                  favIcon.classList.replace('fa-solid', 'fa-regular');
                  favIcon.classList.remove('favorited');
                } else {
                  await setDoc(favRef, { userId: currentUser.uid, productId: product.id, addedAt: new Date() });
                  favIcon.classList.replace('fa-regular', 'fa-solid');
                  favIcon.classList.add('favorited');
                }
              } catch (err) { console.error("Error toggling favorite:", err); }
            });

            favIcon.addEventListener('mouseenter', () => {
              if (!favIcon.classList.contains('favorited')) favIcon.classList.add('hovered');
            });
            favIcon.addEventListener('mouseleave', () => favIcon.classList.remove('hovered'));

            // Reviews button
            const reviewBtn = document.createElement('button');
            reviewBtn.textContent = "Reviews";
            reviewBtn.className = "reviews-btn";
            card.appendChild(reviewBtn);

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
          }
        }
      }
    });
  });
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
    stockInfo.forEach((size, index) => {
      const label = document.createElement('label');
      label.classList.add('size-btn');
      const availableQty = size.stock || 0;
      label.textContent = `${size.name} - ₱${size.price.toFixed(2)} (Stock: ${availableQty})`;
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'size';
      if (availableQty <= 0) { input.disabled = true; label.classList.add('unavailable'); }
      else if (!selectedSize) { input.checked = true; label.classList.add('selected'); selectedSize = { ...size }; }
      input.addEventListener('change', () => {
        sizesContainer.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected'); selectedSize = { ...size };
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
      if ((addon.qty || 0) <= 0) { input.disabled = true; label.classList.add('unavailable'); }
      input.addEventListener('change', () => {
        if (input.checked) selectedAddons.push(addon);
        else selectedAddons = selectedAddons.filter(a => a.id !== addon.id);
      });
      label.prepend(input); addonsContainer.appendChild(label);
    });
  }

  const quantityInput = cartPopup.querySelector('.quantity-input');
  quantityInput.value = 1; quantityInput.min = 1; quantityInput.max = selectedSize?.stock || 1;

  const confirmBtn = cartPopup.querySelector('.confirm-add-cart');
  confirmBtn.onclick = () => {
    const quantity = parseInt(quantityInput.value) || 1;
    if (!selectedSize) { showToast("Please select a size first!", 2000, "error"); return; }
    if (quantity > selectedSize.stock) { showToast(`Only ${selectedSize.stock} left in stock!`, 2000, "error"); return; }
    const sizeToPass = { id: selectedSize.id, name: selectedSize.name, price: Number(selectedSize.price || 0) };
    addToCart(product, sizeToPass, selectedAddons, quantity);
    cartPopup.style.display = 'none';
    showToast(`${product.name} added to cart!`, 2000, "success");
  };
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

// ==========================
// Close popups
// ==========================
window.addEventListener('click', e => { 
  if (e.target === loginPopup) loginPopup.style.display = 'none'; 
  if (e.target === cartPopup) cartPopup.style.display = 'none'; 
});
cartPopup.querySelector('.close-cart').addEventListener('click', () => { cartPopup.style.display = 'none'; });

// ==========================
// CSS for stars
// ==========================
const style = document.createElement('style');
style.textContent = `
.stars-outer { position: relative; display: inline-block; color: #ccc; font-size: 16px; font-family: Arial, sans-serif; }
.stars-inner { position: absolute; top: 0; left: 0; white-space: nowrap; overflow: hidden; color: gold; }
.stars-outer::before, .stars-inner::before { content: "★★★★★"; }
.rating-number { margin-left: 5px; font-weight: 500; color: #333; font-size: 14px; }
`;
document.head.appendChild(style);

// ==========================
// INIT
// ==========================
loadProductsRealtime();
