// netlify/functions/create-checkout.js
require('dotenv').config(); 
const axios = require('axios');

// Netlify will read this from its Environment Variables, not a local .env file.
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = 'https://api.paymongo.com/v1';

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { amount, metadata, description } = JSON.parse(event.body);

        if (!PAYMONGO_SECRET_KEY) {
            return { statusCode: 500, body: JSON.stringify({ error: 'PAYMONGO_SECRET_KEY is not set in Netlify Environment Variables.' }) };
        }
        if (amount < 100 || !metadata || !metadata.userId || !metadata.queueNumber) { 
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid order details or metadata missing.' }) };
        }

        const lineItems = [
            {
                currency: 'PHP',
                amount: parseInt(amount), 
                name: `Order #${metadata.queueNumber}`,
                quantity: 1
            }
        ];
        
        const response = await axios.post(`${PAYMONGO_API}/checkout_sessions`, {
            data: {
                attributes: {
                    // **CRITICAL:** Use dynamic Netlify URLs for success/cancel
                    success_url: `${event.headers.referer}success.html`, 
                    cancel_url: `${event.headers.referer}cart.html`,
                    
                    send_email_receipt: false,
                    description,
                    line_items: lineItems,
                    payment_method_types: ['gcash'], 
                    metadata: metadata, 
                },
            },
        }, {
            headers: {
                'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ':').toString('base64')}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ checkout_url: response.data.data.attributes.checkout_url }),
        };

    } catch (error) {
        console.error('PayMongo Checkout Error:', error.response?.data || error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to create PayMongo checkout session.', details: error.response?.data || error.message }),
        };
    }

};
