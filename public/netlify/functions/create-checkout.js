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

    // Serialize orderItems and cartItemIds for metadata
    const serializedMetadata = {
      ...metadata,
      orderItems: JSON.stringify(metadata.orderItems),
      cartItemIds: JSON.stringify(metadata.cartItemIds)
    };

    // Prepare line items
    const lineItems = metadata.orderItems.flatMap(item => {
      const qty = Number(item.qty || 1);
      const baseAmount = Math.round((Number(item.basePrice || 0) + Number(item.sizePrice || 0)) * 100);

      const itemsArray = [{
        name: item.product || "Unnamed Product",
        currency: 'PHP',
        amount: baseAmount,
        quantity: qty
      }];

      // Add-ons
      (item.addons || []).forEach(addon => {
        itemsArray.push({
          name: `${item.product || "Product"} Add-on: ${addon.name || "Addon"}`,
          currency: 'PHP',
          amount: Math.round(Number(addon.price || 0) * 100),
          quantity: qty // total add-on per product qty
        });
      });

      return itemsArray;
    });

    // Add delivery fee
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
            success_url: "https://thriving-blancmange-e2dc71.netlify.app/index.html",
            cancel_url: "https://thriving-blancmange-e2dc71.netlify.app/cart.html",
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
