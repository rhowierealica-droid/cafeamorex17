// netlify/functions/create-checkout.js

require('dotenv').config(); // Keep for local development, Netlify ignores it
const axios = require('axios');

const PAYMONGO_API = 'https://api.paymongo.com/v1';

exports.handler = async (event, context) => {
    // 💡 CRITICAL FIX: Read the secret key inside the handler
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    const BASE_URL = "https://thriving-profiterole-03bc7e.netlify.app"; // Your site base URL

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        // Only expect the minimal, essential data from the client
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

        // 🛑 CRITICAL DRAFT ORDER VALIDATION: Only check for the draft ID and amount
        if (!amount || amount < 1 || !metadata || !metadata.draftOrderId) {
            console.error("Missing required fields for checkout:", { amount, metadata });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid amount or metadata missing required field: draftOrderId.'
                })
            };
        }

        // The client is now only sending the minimal metadata:
        // { draftOrderId, userId, queueNumber, orderTotal }

        // --- CONSTRUCT PAYMONGO PAYLOAD ---
        const lineItems = [
            {
                currency: 'PHP',
                amount: Number(amount), // Amount is already in centavos
                name: `Order #${metadata.queueNumber}`,
                quantity: 1
            }
        ];

        // The metadata only includes the few simple fields required for the webhook
        const simpleMetadata = {
            draftOrderId: metadata.draftOrderId,
            userId: metadata.userId,
            queueNumber: metadata.queueNumber,
            orderTotal: metadata.orderTotal,
        };

        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        // Pass the draft ID back in the URLs for post-payment actions
                        success_url: `${BASE_URL}/order-success.html?draftId=${metadata.draftOrderId}`,
                        cancel_url: `${BASE_URL}/cart.html?draftId=${metadata.draftOrderId}`, 
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
