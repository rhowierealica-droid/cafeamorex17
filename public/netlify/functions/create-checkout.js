// netlify/functions/create-checkout.js

require('dotenv').config(); // Keep for local development, Netlify ignores it
const axios = require('axios');

// PayMongo API endpoint
const PAYMONGO_API = 'https://api.paymongo.com/v1';

/**
 * Helper function to create the detailed line_items array for PayMongo.
 * This logic is ported directly from your Server.cjs file.
 * @param {object} metadata - The metadata object containing order details.
 * @returns {Array} Array of line item objects for PayMongo.
 */
function buildLineItems(metadata) {
    const lineItems = (metadata.orderItems || []).flatMap(item => {
        const qty = Number(item.qty || 1);
        const baseAmount = Math.round(
            (Number(item.basePrice || 0) + Number(item.sizePrice || 0)) * 100
        );

        const itemsArray = [
            {
                name: item.product || "Unnamed Product",
                currency: "PHP",
                amount: baseAmount,
                quantity: qty,
            },
        ];

        (item.addons || []).forEach(addon => {
            itemsArray.push({
                name: `${item.product || "Product"} Add-on: ${addon.name || "Addon"}`,
                currency: "PHP",
                amount: Math.round(Number(addon.price || 0) * 100),
                quantity: qty,
            });
        });

        return itemsArray;
    });

    const deliveryFee = Number(metadata.deliveryFee || 0);
    if (deliveryFee > 0) {
        lineItems.push({
            name: "Delivery Fee",
            currency: "PHP",
            amount: Math.round(deliveryFee * 100),
            quantity: 1,
        });
    }
    
    // Fallback if no items were added (e.g., an error occurred on the client)
    if (lineItems.length === 0) {
        lineItems.push({
            name: "Order Payment",
            currency: "PHP",
            amount: Number(metadata.orderTotal || 0) * 100, // Assuming orderTotal exists and is in PHP
            quantity: 1,
        });
    }

    return lineItems;
}


exports.handler = async (event, context) => {
    // 💡 CRITICAL FIX: Read the secret key inside the handler
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    // ⚠️ IMPORTANT: BASE_URL should be set as an Environment Variable in Netlify (Key: URL)
    const BASE_URL = process.env.URL || "https://thriving-profiterole-03bc7e.netlify.app";

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        // Expected payload from the client (now MUST include orderItems and cartItemIds):
        /* { 
            amount: 500.00, // Total amount in PHP (not centavos)
            description: "Order #G0001...", 
            metadata: { 
                userId: "...", 
                queueNumber: "G0001",
                orderTotal: 500.00, // Total in PHP
                deliveryFee: 50.00, // Delivery fee in PHP
                orderItems: [{ product: "Coffee", basePrice: 100, qty: 1, ... }], // Full items array
                cartItemIds: ["id1", "id2"], // IDs to clear
                customerName: "...",
                address: "...",
            } 
        } 
        */
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
        
        // Convert amount to centavos for validation
        const amountInCentavos = Math.round(Number(amount) * 100);

        // 🛑 CRITICAL VALIDATION: Check for the required inputs and the order items
        if (
            !amount || amountInCentavos < 100 || 
            !metadata || !metadata.userId || !metadata.queueNumber || 
            !Array.isArray(metadata.orderItems) || metadata.orderItems.length === 0
        ) {
            console.error("Missing required fields or invalid order details for checkout:", { amount, metadata });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid amount or metadata missing required fields: userId, queueNumber, or orderItems.'
                })
            };
        }

        // --- CONSTRUCT PAYMONGO PAYLOAD ---
        const lineItems = buildLineItems(metadata);
        
        // Prepare metadata for PayMongo (must be strings for complex objects)
        const paymongoMetadata = {
            ...metadata,
            // These must be stringified for PayMongo to accept them
            orderItems: JSON.stringify(metadata.orderItems),
            cartItemIds: JSON.stringify(metadata.cartItemIds),
        };
        
        // Fallback description
        const finalDescription = description || `Payment for Order #${metadata.queueNumber}`;

        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        // Pass the Order ID back in the URLs for post-payment actions (Optional but helpful)
                        // Redirects customer to a status page or cart page
                        // NOTE: If you are using PayMongo's webhooks, the URL here is for user redirect,
                        // the webhook is the critical part for order fulfillment.
                        success_url: `${BASE_URL}/index.html`, // Redirect to main page after success
                        cancel_url: `${BASE_URL}/cart.html`,  // Redirect to cart page after cancel
                        send_email_receipt: false,
                        description: finalDescription,
                        line_items: lineItems,
                        payment_method_types: ['gcash'],
                        metadata: paymongoMetadata // Use the detailed metadata for the webhook
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
                details: error.response?.data?.errors?.[0]?.detail || error.message
            })
        };
    }
};
