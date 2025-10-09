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
    const lineItems = (metadata.items || []).flatMap(item => { // Changed metadata.orderItems to metadata.items
        const qty = Number(item.qty || 1);
        
        // Calculate the base price (base + size price) for the item, in centavos
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

        // Add separate line items for all addons
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
            // Use the total from metadata in centavos as a fallback
            amount: Math.round(Number(metadata.total || 0) * 100), // Changed metadata.orderTotal to metadata.total
            quantity: 1,
        });
    }

    return lineItems;
}


exports.handler = async (event, context) => {
    // CRITICAL FIX: Read the secret key inside the handler
    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    // IMPORTANT: BASE_URL should be set as an Environment Variable in Netlify (Key: URL)
    const BASE_URL = process.env.URL || "https://thriving-profiterole-03bc7e.netlify.app";

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        // Renamed 'metadata' to 'orderData' for clarity, which holds the commonOrderData from client
        let { amount, orderData: metadata } = JSON.parse(event.body); 

        // --- CHECK SECRET KEY & ESSENTIAL INPUTS ---
        if (!PAYMONGO_SECRET_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'PAYMONGO_SECRET_KEY is not set. Please verify Netlify variable scope.'
                })
            };
        }
        
        // Convert amount (in PHP) to centavos for PayMongo
        const amountInCentavos = Math.round(Number(amount) * 100);

        // 🛑 CRITICAL VALIDATION: Check for the required inputs and the order items
        if (
            !amount || amountInCentavos < 100 || 
            !metadata || !metadata.userId || !metadata.queueNumber || 
            !Array.isArray(metadata.items) || metadata.items.length === 0 // Changed metadata.orderItems to metadata.items
        ) {
            console.error("Missing required fields or invalid order details for checkout:", { amount, metadata });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid amount or metadata missing required fields: amount (PHP), metadata.userId, metadata.queueNumber, or metadata.items (must be non-empty array).'
                })
            };
        }

        // --- CONSTRUCT PAYMONGO PAYLOAD ---
        // Pass the metadata object to the line items builder
        const lineItems = buildLineItems(metadata); 
        
        // Prepare metadata for PayMongo (complex objects must be stringified)
        const paymongoMetadata = {
            userId: metadata.userId,
            queueNumber: metadata.queueNumber,
            // ✅ UPDATED: Pass the entire metadata object stringified.
            // The webhook is the single source of truth for setting the final "Pending" status.
            fullOrderData: JSON.stringify(metadata), 
            // Keep original cart IDs and items for secondary check
            cartItemIds: JSON.stringify(metadata.cartItemIds),
            itemsSummary: JSON.stringify(metadata.items.map(i => ({ p: i.product, q: i.qty })))
        };
        
        // Use queue number as a fallback description
        const finalDescription = `Payment for Order #${metadata.queueNumber}`;

        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        success_url: `${BASE_URL}/index.html?status=success`, // Added status param
                        cancel_url: `${BASE_URL}/cart.html?status=cancelled`, // Added status param
                        send_email_receipt: false,
                        description: finalDescription,
                        line_items: lineItems,
                        payment_method_types: ['gcash'],
                        metadata: paymongoMetadata // Use the new metadata object
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
