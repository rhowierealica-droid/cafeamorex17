// netlify/functions/create-checkout.js

require('dotenv').config(); // Keep for local development, Netlify ignores it
const axios = require('axios');

// PayMongo API endpoint
const PAYMONGO_API = 'https://api.paymongo.com/v1';

exports.handler = async (event, context) => {
    // 💡 CRITICAL FIX: Read the secret key inside the handler
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    // ⚠️ IMPORTANT: BASE_URL should be set as an Environment Variable in Netlify (Key: URL)
    const BASE_URL = process.env.URL || "https://thriving-profiterole-03bc7e.netlify.app"; 

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        // Expected payload from the client (cart.js):
        // { amount: 50000, description: "Order #G0001...", metadata: { orderId: "...", userId: "..." } }
        let { amount, metadata, description } = JSON.parse(event.body);

        // --- CHECK SECRET KEY & ESSENTIAL INPUTS ---
        if (!PAYMONGO_SECRET_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'PAYMONGO_SECRET_KEY is not set. Please verify Netlify variable scope.'
                })
            };
        }

        // 🛑 CRITICAL VALIDATION: Check for the required order ID and amount
        // The client now sends the ID of the 'Pending' order
        if (!amount || amount < 1 || !metadata || !metadata.orderId || !metadata.userId) {
            console.error("Missing required fields for checkout:", { amount, metadata });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid amount or metadata missing required fields: orderId and userId.'
                })
            };
        }

        // The metadata ONLY needs the orderId and userId for the webhook to find and process the order.
        const simpleMetadata = {
            orderId: metadata.orderId, // This is the DeliveryOrders Firebase ID
            userId: metadata.userId,
            // Queue number and total are helpful for PayMongo view, but optional for processing.
        };

        // --- CONSTRUCT PAYMONGO PAYLOAD ---
        const lineItems = [
            {
                currency: 'PHP',
                amount: Number(amount), // Amount is already in centavos
                name: description,      // Use the description field for the name
                quantity: 1
            }
        ];

        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        // Pass the Order ID back in the URLs for post-payment actions (Optional but helpful)
                        // Redirects customer to a status page or cart page
                        success_url: `${BASE_URL}/customer-status.html?orderId=${metadata.orderId}`,
                        cancel_url: `${BASE_URL}/cart.html`, 
                        send_email_receipt: false,
                        description,
                        line_items: lineItems,
                        payment_method_types: ['gcash'],
                        metadata: simpleMetadata // Use the simplified metadata
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
        // Axios error handling often includes a 'response' object with error data
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
