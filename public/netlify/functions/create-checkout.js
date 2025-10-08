// netlify/functions/create-checkout.js
require('dotenv').config(); // Keep for local development, Netlify ignores it
const axios = require('axios');

const PAYMONGO_API = 'https://api.paymongo.com/v1';

exports.handler = async (event, context) => {
    // 💡 CRITICAL FIX: Read the secret key inside the handler to ensure 
    // Netlify's runtime environment has loaded it into process.env.
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        let { amount, metadata, description } = JSON.parse(event.body);

        // Check for the secret key here
        if (!PAYMONGO_SECRET_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'PAYMONGO_SECRET_KEY is not set in Netlify Environment Variables. (Please verify Netlify variable scope is set to "Functions").'
                })
            };
        }

        // Ensure orderItems and cartItemIds are stringified for metadata storage
        if (metadata) {
            if (metadata.orderItems) metadata.orderItems = JSON.stringify(metadata.orderItems);
            if (metadata.cartItemIds) metadata.cartItemIds = JSON.stringify(metadata.cartItemIds);
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

        // Amount is already in centavos.
        const lineItems = [
            {
                currency: 'PHP',
                amount, 
                name: `Order #${metadata.queueNumber}`,
                quantity: 1
            }
        ];

        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        success_url: "https://grand-madeleine-e2fe55.netlify.app/customer-status.html",
                        // Corrected typo: cart.htmll -> cart.html
                        cancel_url: "https://grand-madeleine-e2fe55.netlify.app/cart.html", 
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
                    // Use Buffer.from for Base64 encoding of the Authorization header
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
