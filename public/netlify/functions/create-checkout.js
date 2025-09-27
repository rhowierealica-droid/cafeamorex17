require('dotenv').config();
const axios = require('axios');

// Netlify environment variables
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = 'https://api.paymongo.com/v1';

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { amount, metadata, description } = JSON.parse(event.body);

    if (!PAYMONGO_SECRET_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'PAYMONGO_SECRET_KEY is not set in Netlify Environment Variables.'
        })
      };
    }

    // Validate required metadata fields
    const requiredFields = [
      'userId', 'queueNumber', 'customerName',
      'address', 'orderItems', 'deliveryFee',
      'orderTotal', 'cartItemIds'
    ];
    const missingFields = requiredFields.filter(f => !(metadata && metadata[f] !== undefined));

    if (!amount || amount < 1 || missingFields.length > 0) {
      console.warn("Missing required metadata fields:", missingFields);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid order details or metadata missing.',
          missingFields
        })
      };
    }

    // Ensure orderItems is always an array
    const rawOrderItems = Array.isArray(metadata.orderItems)
      ? metadata.orderItems
      : JSON.parse(metadata.orderItems || "[]");

    // Serialize orderItems and cartItemIds for PayMongo metadata
    const serializedMetadata = {
      ...metadata,
      orderItems: JSON.stringify(
        rawOrderItems.map(item => ({
          id: item.id || '',
          productId: item.productId || '',
          sizeId: item.sizeId || '',
          qty: item.qty || 1,
          product: item.product || 'Unnamed Product',
          basePrice: item.basePrice || 0,
          sizePrice: item.sizePrice || 0,
          addons: (item.addons || []).map(a => ({
            id: a.id || '',
            name: a.name || 'Addon',
            price: a.price || 0
          })),
          ingredients: (item.ingredients || []).map(i => ({
            id: i.id || '',
            name: i.name || 'Ingredient',
            qty: i.qty || 1
          })),
          others: (item.others || []).map(o => ({
            id: o.id || '',
            name: o.name || 'Other',
            qty: o.qty || 1
          }))
        }))
      ),
      cartItemIds: JSON.stringify(metadata.cartItemIds)
    };

    // Prepare line items for PayMongo (no duplicates)
    const lineItems = [];
    rawOrderItems.forEach(item => {
      const qty = Number(item.qty || 1);
      const baseAmount = Math.round((Number(item.basePrice || 0) + Number(item.sizePrice || 0)) * 100);

      // Main product
      lineItems.push({
        name: item.product || "Unnamed Product",
        currency: "PHP",
        amount: baseAmount,
        quantity: qty
      });

      // Add-ons
      (item.addons || []).forEach(addon => {
        lineItems.push({
          name: `${item.product || "Product"} Add-on: ${addon.name || "Addon"}`,
          currency: "PHP",
          amount: Math.round(Number(addon.price || 0) * 100),
          quantity: qty
        });
      });
    });

    // Add delivery fee if any
    const deliveryFee = Number(metadata.deliveryFee || 0);
    if (deliveryFee > 0) {
      lineItems.push({
        name: "Delivery Fee",
        currency: "PHP",
        amount: Math.round(deliveryFee * 100),
        quantity: 1
      });
    }

    // Create checkout session
    const response = await axios.post(
      `${PAYMONGO_API}/checkout_sessions`,
      {
        data: {
          attributes: {
            success_url: "https://fluffy-manatee-57fe7b.netlify.app/index.html",
            cancel_url: "https://fluffy-manatee-57fe7b.netlify.app/cart.html",
            send_email_receipt: false,
            description: description || `Payment for Order #${metadata.queueNumber}`,
            line_items: lineItems,
            payment_method_types: ['gcash'],
            metadata: serializedMetadata
          }
        }
      },
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ':').toString('base64')}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        checkout_url: response.data.data.attributes.checkout_url
      })
    };

  } catch (error) {
    console.error('PayMongo Checkout Error:', error.response?.data || error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create PayMongo checkout session.',
        details: error.response?.data || error.message
      })
    };
  }
};
