
// netlify/functions/create-checkout.js
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

    // Metadata required for webhook listener
    const requiredFields = [
      'userId', 'queueNumber', 'customerName',
      'address', 'orderItems', 'deliveryFee',
      'orderTotal', 'cartItemIds'
    ];
    const missingFields = requiredFields.filter(
      f => !(metadata && metadata[f] !== undefined)
    );

    if (!amount || amount < 1 || missingFields.length > 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid order details or metadata missing.',
          missingFields
        })
      };
    }

    // ✅ amount is already in centavos, don’t multiply again
    const lineItems = [
      {
        currency: 'PHP',
        amount, // already in centavos
        name: `Order #${metadata.queueNumber}`,
        quantity: 1
      }
    ];

    const response = await axios.post(
      `${PAYMONGO_API}/checkout_sessions`,
      {
        data: {
          attributes: {
            success_url: "https://thriving-blancmange-e2dc71.netlify.app/index.html",
            cancel_url: "https://thriving-blancmange-e2dc71.netlify.app/cart.html",
            send_email_receipt: false,
            description,
            line_items: lineItems,
            payment_method_types: ['gcash'],
            metadata
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



