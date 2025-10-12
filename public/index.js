import { db } from './firebase-config.js';
import { 
  collection, getDocs, doc, setDoc, getDoc, deleteDoc, 
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addToCart } from './cart.js';

// ===================================
// 🔥 CRITICAL CHANGE: Global Inventory Map
// ===================================
let inventoryMap = {};

// ==========================
// Toast Notification
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
// DOM Elements (UPDATED for Tab HTML)
// ==========================
// Select the main section containers based on their data-category attribute
const drinksSection = document.querySelector('.category-section[data-category="Drinks"]');
const drinksContainer = document.querySelector('.category-list[data-main="Drinks"]');
const foodSection = document.querySelector('.category-section[data-category="Food"]');
const foodContainer = document.querySelector('.category-list[data-main="Food"]');
const othersSection = document.querySelector('.category-section[data-category="Others"]');
const othersContainer = document.querySelector('.category-list[data-main="Others"]');

const loginPopup = document.getElementById('loginPopup');
const loginRedirect = document.getElementById('loginRedirect');
const termsPopup = document.getElementById('termsPopup');
const profileNameEl = document.querySelector('.profile-name');
const welcomeHeader = document.querySelector('.main-content header h1');

// Create the cartPopup element if it doesn't exist
const cartPopup = document.getElementById('cartPopup') || document.createElement('div');
cartPopup.id = 'cartPopup';
cartPopup.className = 'popup';

// ==========================
// Popup System
// ==========================

if (loginRedirect) {
  loginRedirect.addEventListener('click', () => {
    window.location.href = 'login.html'; // replace with your actual login page URL
  });
}


function openPopup(popupEl) {
  if (!popupEl) return;
  popupEl.style.display = 'flex';

  const outsideClickHandler = (e) => {
    if (e.target === popupEl) closePopup(popupEl);
  };
  popupEl.addEventListener('click', outsideClickHandler);

  const closeBtn = popupEl.querySelector('.close, .close-cart, .close-terms, .close-reviews, .close-btn');
  if (closeBtn) {
    closeBtn.onclick = () => closePopup(popupEl);
  }

  popupEl._outsideClickHandler = outsideClickHandler;
}

function closePopup(popupEl) {
  if (!popupEl) return;
  popupEl.style.display = 'none';
  if (popupEl._outsideClickHandler) {
    popupEl.removeEventListener('click', popupEl._outsideClickHandler);
    popupEl._outsideClickHandler = null;
  }
}

// ==========================
// Cart Popup (dynamic)
// ==========================
cartPopup.innerHTML = `
  <div class="popup-content cart-popup">
    <h2 class="product-name"></h2>
    <p class="product-desc"></p>
    <div class="sizes-container"></div>
    <div class="addons-container"></div>

    <div class="quantity-wrapper">
      <button type="button" class="decrease-qty">−</button>
      <input type="number" class="quantity-input" value="1" min="1">
      <button type="button" class="increase-qty">+</button>
    </div>

    <button class="confirm-add-cart">Add to Cart</button>
    <button class="close-cart">Close</button>
  </div>
`;
document.body.appendChild(cartPopup);

// Quantity button functionality
document.addEventListener("click", (e) => {
  const qtyInput = cartPopup.querySelector(".quantity-input");
  if (!qtyInput) return;

  if (e.target.classList.contains("decrease-qty")) {
    let val = parseInt(qtyInput.value) || 1;
    if (val > 1) qtyInput.value = val - 1;
  }

  if (e.target.classList.contains("increase-qty")) {
    let val = parseInt(qtyInput.value) || 1;
    qtyInput.value = val + 1;
  }
});


// ==========================
// Load User Name
// ==========================
const storedName = localStorage.getItem("currentUserName");
if (storedName) {
  if (profileNameEl) profileNameEl.textContent = storedName;
  if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${storedName}`;
}

// ==========================
// Firebase Auth
// ==========================
const auth = getAuth();
let currentUser = null;
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) return;
  if (!storedName) {
    try {
      const userDoc = await getDoc(doc(db, "users", user.uid));
      const data = userDoc.exists() ? userDoc.data() : {};
      const fullName = `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Customer";
      if (profileNameEl) profileNameEl.textContent = fullName;
      if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${fullName}`;
      localStorage.setItem("currentUserName", fullName);
    } catch (err) {
      console.error("Error fetching user data:", err);
    }
  }
});

// ==========================
// Stock Calculation
// ==========================
function calculateProductStock(product, inventoryMap) {
  let stockPerSize = [];
  if (product.sizes?.length) {
    for (const size of product.sizes) {
      let possible = Infinity;

      const sizeItem = inventoryMap[size.id];
      if (sizeItem) {
        const maxFromSize = Math.floor(sizeItem.quantity / (size.qty || 1));
        possible = Math.min(possible, maxFromSize);
      }

      if (size.ingredients?.length) {
        for (const ing of size.ingredients) {
          const invItem = inventoryMap[ing.id];
          if (invItem) {
            const maxFromIng = Math.floor(invItem.quantity / (ing.qty || 1));
            possible = Math.min(possible, maxFromIng);
          }
        }
      }

      if (size.others?.length) {
        for (const other of size.others) {
          const invItem = inventoryMap[other.id];
          if (invItem) {
            const maxFromOther = Math.floor(invItem.quantity / (other.qty || 1));
            possible = Math.min(possible, maxFromOther);
          }
        }
      }

      if (size.addons?.length) {
        for (const addon of size.addons) {
          const invItem = inventoryMap[addon.id];
          if (invItem && (addon.qty || 0) > 0) {
            const maxFromAddon = Math.floor(invItem.quantity / (addon.qty || 1));
            possible = Math.min(possible, maxFromAddon);
          }
        }
      }

      stockPerSize.push({ ...size, stock: possible === Infinity ? 0 : possible });
    }
  }
  return stockPerSize;
}

// ==========================
// Tab Management (NEW)
// ==========================
function setupTabs(firstCategoryWithProducts) {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabSections = document.querySelectorAll('.category-section');

  if (tabButtons.length === 0 || tabSections.length === 0) return;

  const showTab = (categoryName) => {
    tabSections.forEach(section => {
      section.style.display = section.getAttribute('data-category') === categoryName ? 'block' : 'none';
    });
    tabButtons.forEach(button => {
      button.classList.remove('active');
      if (button.getAttribute('data-category') === categoryName) {
        button.classList.add('active');
      }
    });
  };

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const category = button.getAttribute('data-category');
      showTab(category);
    });
  });

  // Initial display: Show the first tab with products, or default to Drinks
  const initialCategory = firstCategoryWithProducts || 'Drinks';
  showTab(initialCategory);
}


// ==========================
// Load Products Realtime (FIXED CATEGORY GROUPING)
// ==========================
function loadProductsRealtime() {
  // Check if at least one container exists before proceeding
  if (!drinksContainer && !foodContainer && !othersContainer) return;
  
  onSnapshot(collection(db, "Inventory"), inventorySnapshot => {
    inventoryMap = {};
    inventorySnapshot.forEach(docSnap => {
      inventoryMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });

    onSnapshot(collection(db, "products"), productSnapshot => {
      const products = productSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Clear containers
      if(drinksContainer) drinksContainer.innerHTML = "";
      if(foodContainer) foodContainer.innerHTML = "";
      if(othersContainer) othersContainer.innerHTML = "";

      const grouped = {};
      for (const product of products) {
        // Use the categoryMain and categorySub properties, defaulting to "Others" if missing
        const mainCategory = product.categoryMain || "Others";
        const subCategory = product.categorySub || "General"; // Default to General for Others
        
        // Use .trim() for clean key lookup.
        const normalizedMainCategory = mainCategory.trim(); 

        if (!grouped[normalizedMainCategory]) grouped[normalizedMainCategory] = {};
        if (!grouped[normalizedMainCategory][subCategory]) grouped[normalizedMainCategory][subCategory] = [];
        grouped[normalizedMainCategory][subCategory].push(product);
      }

      const mainCats = [
        { name: "Drinks", container: drinksContainer, section: drinksSection },
        { name: "Food", container: foodContainer, section: foodSection },
        { name: "Others", container: othersContainer, section: othersSection },
      ];

      let firstCategoryWithProducts = null;

      mainCats.forEach(({ name, container, section }) => {
        if (!container) return; // Skip if container is missing
        container.innerHTML = "";
        let mainCatHasProducts = false;

        // Get and sort sub-categories for stable display order
        if (grouped[name]) {
          // Define a specific order for sub-categories for better UX
          let orderedSubCats = [];
          // Define preferred order based on category
          if (name === "Drinks") orderedSubCats = ["Hot Coffee", "Ice Espresso", "Ice Cold Brew", "Non Coffee", "Others"]; 
          else if (name === "Food") orderedSubCats = ["Sandwiches", "Burger", "Snack", "Others"];
          else if (name === "Others") orderedSubCats = ["General"];

          // Add any sub-categories found in the data but not in the predefined list
          const subCatKeys = Object.keys(grouped[name]);
          subCatKeys.forEach(key => {
            if (!orderedSubCats.includes(key)) {
              orderedSubCats.push(key);
            }
          });


          for (const subCat of orderedSubCats) {
            const productsArray = grouped[name][subCat];
            if (!productsArray || !productsArray.length) continue;

            mainCatHasProducts = true;
            const subCatSection = document.createElement('div');
            subCatSection.className = 'subcategory-section';
            subCatSection.innerHTML = `<h3 class="subcategory-title">${subCat}</h3>`;

            const horizontalContainer = document.createElement('div');
            horizontalContainer.className = 'subcategory-products';
            horizontalContainer.style.display = 'flex';
            horizontalContainer.style.flexWrap = 'wrap';
            horizontalContainer.style.gap = '15px';
            subCatSection.appendChild(horizontalContainer);
            container.appendChild(subCatSection);

            for (const product of productsArray) {
              const stockInfo = calculateProductStock(product, inventoryMap);
              const card = document.createElement('div');
              card.classList.add('product-card');

              let displayPrice = product.price || 0;
              if (stockInfo.length) displayPrice = Math.min(...stockInfo.map(s => s.price || Infinity));
              const isUnavailable = !product.available || stockInfo.every(s => s.stock <= 0);
              if (isUnavailable) card.classList.add('unavailable');

              if (!product.available) {
                card.classList.add('disabled-product');
              }

              const imgHTML = product.image ? `<img src="${product.image}" alt="${product.name}" style="width:100%; border-radius:10px; margin-bottom:10px; margin-top:20px;">` : '';

              card.innerHTML = `
                ${imgHTML}
                <h3>${product.name || 'Unnamed Product'}</h3>
                ${product.description ? `<p class="product-desc-card">${product.description}</p>` : ''}
                <p>₱${displayPrice.toFixed(2)}</p>
                ${!isUnavailable ? `<button class="add-cart-btn">Add to Cart</button>` : ''}
              `;

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
              if (!isUnavailable && addBtn) {
                addBtn.addEventListener('click', () => {
                  if (!currentUser) { openPopup(loginPopup); return; }
                  openCartPopup(product, stockInfo);
                });
              }

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
                if (!currentUser) { openPopup(loginPopup); return; }
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
                } catch (err) { console.error(err); }
              });

              const reviewBtn = document.createElement('button');
              reviewBtn.textContent = "Reviews";
              reviewBtn.className = "reviews-btn";
              card.appendChild(reviewBtn);

              reviewBtn.addEventListener('click', async () => {
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

        // Keep track of the first category that actually has products
        if (mainCatHasProducts && !firstCategoryWithProducts) {
          firstCategoryWithProducts = name;
        }
      });

      // AFTER loading products, set up and display the tabs
      setupTabs(firstCategoryWithProducts); 
    });
  });
}

// ==========================
// Cart Popup 
// ==========================
function openCartPopup(product, stockInfo = []) {
  openPopup(cartPopup);
  cartPopup.querySelector('.product-name').textContent = product.name || 'Unnamed Product';
  cartPopup.querySelector('.product-desc').textContent = product.description || '';

  const sizesContainer = cartPopup.querySelector('.sizes-container');
  sizesContainer.innerHTML = '';
  let selectedSize = null;

  if (Array.isArray(stockInfo) && stockInfo.length) {
    const heading = document.createElement('p'); heading.textContent = 'Sizes:'; sizesContainer.appendChild(heading);
    
    const updateMaxQty = (size) => {
      const quantityInput = cartPopup.querySelector('.quantity-input');
      const maxStock = size ? size.stock : 1;
      quantityInput.max = maxStock;
      if (parseInt(quantityInput.value) > maxStock) {
        quantityInput.value = maxStock > 0 ? maxStock : 1;
      }
      if (maxStock <= 0) {
        cartPopup.querySelector('.confirm-add-cart').disabled = true;
      } else {
        cartPopup.querySelector('.confirm-add-cart').disabled = false;
      }
    };

    stockInfo.forEach(size => {
      const label = document.createElement('label'); label.classList.add('size-btn');
      const availableQty = size.stock || 0;
      
      label.textContent = `${size.name} - ₱${(size.price || 0).toFixed(2)} (Stock: ${availableQty})`;
      
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'size';
      
      if (availableQty <= 0) { 
        input.disabled = true; 
        label.classList.add('unavailable'); 
      }
      else if (!selectedSize) { 
        input.checked = true; 
        label.classList.add('selected'); 
        selectedSize = { ...size }; 
        updateMaxQty(selectedSize);
      }
      
      input.addEventListener('change', () => {
        sizesContainer.querySelectorAll('label').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected'); 
        selectedSize = { ...size };
        updateMaxQty(selectedSize);

        // Reload add-ons for the newly selected size
        loadAddons(selectedSize);
      });
      
      label.prepend(input); 
      sizesContainer.appendChild(label);
    });
  }

  const addonsContainer = cartPopup.querySelector('.addons-container');
  let selectedAddons = [];
  
  function loadAddons(size) {
    addonsContainer.innerHTML = '';
    selectedAddons = []; // Reset selected addons when size changes
    if (!size?.addons?.length) return;
    const heading = document.createElement('p'); heading.textContent = 'Add-ons:'; addonsContainer.appendChild(heading);

    size.addons.forEach(addon => {
      const inventoryItem = inventoryMap[addon.id];
      const stock = inventoryItem ? Math.floor(inventoryItem.quantity / (addon.qty || 1)) : 0;
      
      const label = document.createElement('label'); 
      label.classList.add('addon-btn'); 
      label.textContent = `${addon.name} - ₱${(addon.price || 0).toFixed(2)} (Stock: ${stock})`;
      
      const input = document.createElement('input'); 
      input.type = 'checkbox';
      
      const isOutOfStock = stock <= 0;
      
      if (isOutOfStock) { 
        input.disabled = true; 
        label.classList.add('unavailable'); 
      }
      
      input.addEventListener('change', () => {
        if (input.checked) {
          if (!isOutOfStock) {
            selectedAddons.push(addon);
          } else {
            input.checked = false;
            showToast(`${addon.name} is out of stock!`, 2000, "error");
          }
        }
        else selectedAddons = selectedAddons.filter(a => a.id !== addon.id);
      });
      
      label.prepend(input); 
      addonsContainer.appendChild(label);
    });
  }

  // Initial load for add-ons
  if (selectedSize) loadAddons(selectedSize);

  const quantityInput = cartPopup.querySelector('.quantity-input');
  quantityInput.value = 1; 
  quantityInput.min = 1; 
  
  if (!selectedSize) {
    quantityInput.max = 1;
    cartPopup.querySelector('.confirm-add-cart').disabled = true;
  }

  const confirmBtn = cartPopup.querySelector('.confirm-add-cart');
  confirmBtn.onclick = () => {
    const quantity = parseInt(quantityInput.value) || 1;
    
    if (!selectedSize) { showToast("Please select a size first!", 2000, "error"); return; }
    if (quantity <= 0) { showToast("Quantity must be greater than 0!", 2000, "error"); return; }
    if (quantity > selectedSize.stock) { showToast(`Only ${selectedSize.stock} left in stock for the selected size!`, 2000, "error"); return; }
    
    // Final check for addon stock based on total quantity
    for (const addon of selectedAddons) {
      const inventoryItem = inventoryMap[addon.id];
      // The required stock is the product quantity * the consumption quantity for the addon
      const requiredStock = (addon.qty || 1) * quantity; 
      if (!inventoryItem || inventoryItem.quantity < requiredStock) {
        showToast(`Not enough stock for the selected quantity of ${addon.name}!`, 2000, "error");
        return;
      }
    }

    const sizeToPass = { id: selectedSize.id, name: selectedSize.name, price: Number(selectedSize.price || 0) };
    addToCart(product, sizeToPass, selectedAddons, quantity);
    closePopup(cartPopup);
    showToast(`${product.name} added to cart!`, 2000, "success");
  };
}

// ==========================
// Reviews Popup (modern)
// ==========================
function showReviewsPopup(productName, feedbacks) {
  const popup = document.createElement('div'); 
  popup.className = 'popup reviews-popup'; 
  popup.style.display = 'flex';
  Object.assign(popup.style, { justifyContent: 'center', alignItems: 'center' });

  const popupContent = document.createElement('div'); 
  popupContent.className = 'popup-content';
  Object.assign(popupContent.style, {
    position: 'relative',
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '10px',
    maxWidth: '400px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 8px 20px rgba(0,0,0,0.2)'
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-reviews';
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, { position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#333' });
  closeBtn.onclick = () => popup.remove();

  const title = document.createElement('h3'); 
  title.textContent = `Reviews for ${productName}`;
  title.style.marginTop = '0';
  title.style.marginBottom = '15px';

  const list = document.createElement('div'); 
  list.className = 'feedback-list';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '10px';

  if (feedbacks.length) {
    feedbacks.forEach(f => {
      let emailMasked = f.customerEmail;
      if (emailMasked) { 
        const [name, domain] = emailMasked.split('@'); 
        emailMasked = `${name.slice(0,3)}****@${domain}`; 
      }
      const p = document.createElement('p'); 
      p.textContent = `${emailMasked}: ${f.text}`; 
      list.appendChild(p);
    });
  } else {
    const p = document.createElement('p');
    p.textContent = "No reviews yet.";
    list.appendChild(p);
  }

  popupContent.append(closeBtn, title, list); 
  popup.appendChild(popupContent); 
  document.body.appendChild(popup);

  popup.addEventListener('click', e => { 
    if (e.target === popup) popup.remove(); 
  });
}

// ==========================
// Terms Popup
// ==========================
if (termsPopup) {
  const closeTerms = termsPopup.querySelector('.close-terms');
  if (closeTerms) closeTerms.addEventListener('click', () => closePopup(termsPopup));
}

// ==========================
// Styling (Stars and NEW Tabs CSS)
// ==========================
const style = document.createElement('style');
style.textContent = `
.stars-outer { position: relative; display: inline-block; color: #ccc; font-size: 16px; font-family: Arial, sans-serif; }
.stars-inner { position: absolute; top: 0; left: 0; white-space: nowrap; overflow: hidden; color: gold; }
.stars-outer::before, .stars-inner::before { content: "★★★★★"; }
.rating-number { margin-left: 5px; font-weight: 500; color: #333; font-size: 14px; }

/* NEW CSS for Tabs */
.tab-container {
  display: flex;
  overflow-x: auto; /* Allows scrolling on small screens */
  border-bottom: 2px solid #ccc;
  margin-bottom: 20px;
  background-color: #f7f7f7;
  border-radius: 8px;
  padding: 5px;
}

.tab-button {
  padding: 10px 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  font-weight: 600;
  color: #555;
  transition: color 0.3s, background-color 0.3s, border-bottom 0.3s;
  white-space: nowrap;
}

.tab-button:hover:not(.active) {
  background-color: #eee;
}

.tab-button.active {
  color: #007bff; /* Primary color */
  border-bottom: 3px solid #007bff;
  background-color: #fff;
  border-radius: 5px 5px 0 0;
}

.category-section {
  /* Initially hidden, controlled by JavaScript */
  display: none; 
}
`;
document.head.appendChild(style);

// ==========================
// INIT
// ==========================
loadProductsRealtime();
