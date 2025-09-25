const ordersContainer = document.getElementById('ordersContainer');

// Example orders data
const orders = [
  {
    customer: "John Doe",
    address: "123 Main St",
    items: [
      { product: "Coffee", quantity: 2 },
      { product: "Croissant", quantity: 1 }
    ]
  },
  {
    customer: "Jane Smith",
    address: "456 Oak Ave",
    items: [
      { product: "Latte", quantity: 1 },
      { product: "Bagel", quantity: 3 }
    ]
  }
];

// Render orders
orders.forEach(order => {
  const card = document.createElement('div');
  card.className = 'order-card';

  card.innerHTML = `
    <div class="order-header">
      <p>Customer: ${order.customer}</p>
      <p>Address: ${order.address}</p>
    </div>
    <div class="order-products">
      ${order.items.map(i => `<p>${i.product} x${i.quantity}</p>`).join('')}
    </div>
  `;

  ordersContainer.appendChild(card);
});
