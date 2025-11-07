import { db } from './firebase-config.js';
import { 
  collection, getDocs, doc, setDoc, getDoc, deleteDoc, 
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { addToCart, showLoginPopup } from './cart.js'; 
let inventoryMap = {};

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

const cartPopup = document.getElementById('cartPopup') || document.createElement('div');
cartPopup.id = 'cartPopup';
cartPopup.className = 'popup';




if (loginRedirect) {
  loginRedirect.addEventListener('click', () => {
    window.location.href = 'login.html';
  });
}


document.getElementById('emailLink').addEventListener('click', function (e) {
    e.preventDefault();
    const email = 'cafeamorex17s@gmail.com';
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${email}`;
    const newTab = window.open(gmailUrl, '_blank');


    if (!newTab || newTab.closed || typeof newTab.closed === 'undefined') {
      window.location.href = `mailto:${email}`;
    }
  });

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

const storedName = localStorage.getItem("currentUserName");
if (storedName) {
  if (profileNameEl) profileNameEl.textContent = storedName;
  if (welcomeHeader) welcomeHeader.textContent = `Welcome, ${storedName}`;
}

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

  const initialCategory = firstCategoryWithProducts || 'Drinks';
  showTab(initialCategory);
}

// Stars ng bohai ko
function getStarHtml(rating) {
  const maxStars = 5;
  let starsHtml = '';
  for (let i = 1; i <= maxStars; i++) {
    starsHtml += i <= rating ? '★' : '☆';
  }
  return `<span class="rating-stars">${starsHtml}</span>`;
}


function loadProductsRealtime() {
  if (!drinksContainer && !foodContainer && !othersContainer) return;
  
  onSnapshot(collection(db, "Inventory"), inventorySnapshot => {
    inventoryMap = {};
    inventorySnapshot.forEach(docSnap => {
      inventoryMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
    });

    onSnapshot(collection(db, "products"), productSnapshot => {
      const products = productSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if(drinksContainer) drinksContainer.innerHTML = "";
      if(foodContainer) foodContainer.innerHTML = "";
      if(othersContainer) othersContainer.innerHTML = "";

      const grouped = {};
      for (const product of products) {
        const mainCategory = product.categoryMain || "Others";
        const subCategory = product.categorySub || "General";
        
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
        if (!container) return; 
        container.innerHTML = "";
        let mainCatHasProducts = false;

        if (grouped[name]) {
          let orderedSubCats = [];
          if (name === "Drinks") orderedSubCats = ["Hot Coffee", "Ice Espresso", "Ice Cold Brew", "Non Coffee", "Others"]; 
          else if (name === "Food") orderedSubCats = ["Sandwiches", "Burger", "Snack", "Others"];
          else if (name === "Others") orderedSubCats = ["General"];

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
                const productFeedbacks = []; 

                orderSnapshot.forEach(docSnap => {
                  const order = docSnap.data();
                  order.feedback?.forEach(f => {
                    if (f.productId === product.id || f.productName === product.name) {
                      totalRating += f.rating || 0;
                      count++;
                        productFeedbacks.push(f);
                    }
                  });
                });
                let avgRating = count ? totalRating / count : 0;
                starsInner.style.width = `${(avgRating / 5) * 100}%`;
                ratingNumber.textContent = count ? `(${avgRating.toFixed(1)})` : '';
                card.dataset.feedbacks = JSON.stringify(productFeedbacks);

              })();

              horizontalContainer.appendChild(card);

              const addBtn = card.querySelector('.add-cart-btn');
              if (!isUnavailable && addBtn) {
                addBtn.addEventListener('click', () => {
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
                const storedFeedbacks = card.dataset.feedbacks;
                const feedbacks = storedFeedbacks ? JSON.parse(storedFeedbacks) : [];
                showReviewsPopup(product.name, feedbacks);
              });
            }
          }
        }

        if (mainCatHasProducts && !firstCategoryWithProducts) {
          firstCategoryWithProducts = name;
        }
      });

      setupTabs(firstCategoryWithProducts); 
    });
  });
}

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

      label.textContent = `${size.name} - ₱${(size.price || 0).toFixed(2)}`;
      
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
    selectedAddons = []; 
    if (!size?.addons?.length) return;
    const heading = document.createElement('p'); heading.textContent = 'Add-ons:'; addonsContainer.appendChild(heading);

    size.addons.forEach(addon => {
      const inventoryItem = inventoryMap[addon.id];
      const stock = inventoryItem ? Math.floor(inventoryItem.quantity / (addon.qty || 1)) : 0;
      
      const label = document.createElement('label'); 
      label.classList.add('addon-btn'); 

      label.textContent = `${addon.name} - ₱${(addon.price || 0).toFixed(2)}`;
      
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
    
    for (const addon of selectedAddons) {
      const inventoryItem = inventoryMap[addon.id];
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

function showReviewsPopup(productName, feedbacks) {
  const popup = document.createElement('div'); 
  popup.className = 'popup reviews-popup'; 
  popup.style.display = 'flex';
  Object.assign(popup.style, { justifyContent: 'center', alignItems: 'center' });

  const popupContent = document.createElement('div'); 
  popupContent.className = 'popup-content';
  Object.assign(popupContent.style, {
    position: 'relative',
    backgroundColor: '#fff8f0', 
    padding: '30px 25px', 
    borderRadius: '14px', 
    maxWidth: '520px',
    width: '100%',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 12px 30px rgba(0,0,0,0.2)'
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-reviews';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = () => popup.remove();

  const title = document.createElement('h3'); 
  title.textContent = `Reviews for ${productName}`;
  title.style.marginTop = '0';
  title.style.marginBottom = '15px';
  title.style.color = '#4b3621'; 

  const list = document.createElement('div'); 
  list.className = 'feedback-list';
  
  if (feedbacks.length) {
    feedbacks.forEach(f => {
      
      let emailMasked = f.customerEmail || "Anonymous";
      
      if (emailMasked !== "Anonymous" && emailMasked.includes('@')) { 
        const [name, domain] = emailMasked.split('@'); 
        // Mask the name '
        emailMasked = `${name.slice(0,3)}****@${domain}`; 
      }

      const ratingHtml = getStarHtml(f.rating);
      
      const reviewItem = document.createElement('div');
      reviewItem.className = 'review-item'; 
      
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '5px';
      
      const customerEl = document.createElement('span');
      customerEl.textContent = emailMasked;
      customerEl.style.fontWeight = 'bold';
      customerEl.style.color = '#704225'; 

      const ratingEl = document.createElement('span');
      ratingEl.innerHTML = ratingHtml;

      header.appendChild(customerEl);
      header.appendChild(ratingEl);
      
      const feedbackTextEl = document.createElement('p');
      feedbackTextEl.textContent = f.comment;

      reviewItem.appendChild(header);
      reviewItem.appendChild(feedbackTextEl);
      
      list.appendChild(reviewItem);
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

if (termsPopup) {
  const closeTerms = termsPopup.querySelector('.close-terms');
  if (closeTerms) closeTerms.addEventListener('click', () => closePopup(termsPopup));
}

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

loadProductsRealtime();
