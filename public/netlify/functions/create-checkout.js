// create-checkout.js
require('dotenv').config(); // Keep for local development, Netlify ignores it
const axios = require('axios');

// PayMongo API endpoint
const PAYMONGO_API = 'https://api.paymongo.com/v1';

/**
 * Helper function to create the detailed line_items array for PayMongo.
 * This logic is ported directly from your Server.cjs file.
 * @param {object} metadata - The metadata/orderData object containing order details.
 * @returns {Array} Array of line item objects for PayMongo.
 */
function buildLineItems(metadata) {
    const lineItems = (metadata.items || []).flatMap(item => {
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
            amount: Math.round(Number(metadata.total || 0) * 100),
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
        // Parse body safely
        const body = JSON.parse(event.body || "{}");

        // 🟢 Support `commonOrderData` from frontend
let metadata = body.orderData || body.metadata || body.commonOrderData || null;

// 🟢 Extract total amount from whichever shape it’s in
let amount =
  body.amount ||
  metadata?.total ||
  body.commonOrderData?.total ||
  null;


        // 🟢 FIX: If metadata still missing, attempt to coerce a couple common shapes
        if (!metadata && body.metadata) {
            metadata = body.metadata;
        }

        // 🟢 FIX: If frontend accidentally sent the whole commonOrderData at top-level, handle it
        const likelyOrderKeys = ['userId', 'items', 'queueNumber', 'total'];
        if (!metadata && likelyOrderKeys.some(k => k in body)) {
            metadata = {
                ...body
            };
        }

        // --- CHECK SECRET KEY & ESSENTIAL INPUTS ---
        if (!PAYMONGO_SECRET_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'PAYMONGO_SECRET_KEY is not set. Please verify Netlify variable scope.'
                })
            };
        }

        // 🟢 FIX: Accept amount either as PHP (e.g. 420) or as centavos (e.g. 42000).
        // Normalize amount -> amountInCentavos
        let amountInCentavos;
        const parsedAmount = Number(amount);
        
        if (amount === undefined || amount === null || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
             console.error("Missing or invalid amount in request body:", { amount, body });
             return {
                 statusCode: 400,
                 body: JSON.stringify({ error: 'Missing or invalid amount provided.' })
             };
        }

        // If amount looks big enough to already be in centavos, don't multiply
        if (parsedAmount >= 1000) {
            amountInCentavos = Math.round(parsedAmount);
        } else {
            // Treat as PHP and convert to centavos
            amountInCentavos = Math.round(parsedAmount * 100);
        }

        // 🟢 FIX: Validate metadata shape more flexibly
        if (!metadata || !metadata.userId || !metadata.queueNumber || !Array.isArray(metadata.items) || metadata.items.length === 0) {
            console.error("Missing required fields or invalid order details for checkout:", { amount, amountInCentavos, metadata });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid amount or metadata missing required fields: amount (PHP or centavos), metadata.userId, metadata.queueNumber, or metadata.items (must be non-empty array).',
                    details: { amount, amountInCentavos }
                })
            };
        }

        // 🟢 CRITICAL FIX: Extract customer email for the billing object
        const customerEmail = metadata.customerEmail || metadata.email;

        if (!customerEmail) {
            console.error("Missing customer email in metadata:", { metadata });
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Missing customer email. The email must be included in the order data (metadata.customerEmail or metadata.email).'
                })
            };
        }

        // --- CONSTRUCT PAYMONGO PAYLOAD ---
        const lineItems = buildLineItems(metadata);
        const finalDescription = `Payment for Order #${metadata.queueNumber}`;

        // Prepare metadata for PayMongo (complex objects must be stringified)
        const paymongoMetadata = {
            userId: metadata.userId,
            queueNumber: metadata.queueNumber,
            // 💡 CRITICAL CHANGE: Pass the entire order data object as a string
            fullOrderData: JSON.stringify({
                ...metadata,
                status: "Pending" // Ensure status is correctly set to 'Pending' by the webhook
            }),
            // Keep original cart IDs and items for secondary check
            cartItemIds: JSON.stringify(metadata.cartItemIds || []),
            itemsSummary: JSON.stringify((metadata.items || []).map(i => ({ p: i.product, q: i.qty })))
        };

        // Build PayMongo payload attributes
        const payload = {
            data: {
                attributes: {
                    success_url: `${BASE_URL}/index.html?status=success`,
                    cancel_url: `${BASE_URL}/cart.html?status=cancelled`,
                    send_email_receipt: false,
                    description: finalDescription,
                    line_items: lineItems,
                    payment_method_types: ['gcash'],
                    metadata: paymongoMetadata,
                    // 🟢 CRITICAL FIX: Add the billing object with the required email address
                    billing: {
                        email: customerEmail,
                        name: metadata.name || "Customer", // Assuming name is optional but good to pass if available
                        phone: metadata.phone || undefined, // Optional
                        address: metadata.address || undefined // Optional
                    }
                }
            }
        };

        // Add fallback top-level amount only if line items are somehow empty (highly unlikely now)
        if (!payload.data.attributes.line_items || payload.data.attributes.line_items.length === 0) {
            payload.data.attributes.amount = amountInCentavos;
            payload.data.attributes.currency = "PHP";
        }

        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            payload,
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

