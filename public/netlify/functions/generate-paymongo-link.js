// generate-paymongo-link.js (Standalone Module for Admin Approval Flow)

const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); 
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = "https://api.paymongo.com/v1";

// Base64 encode the secret key for PayMongo Basic Auth header
const AUTH_HEADER = PAYMONGO_SECRET_KEY 
    ? Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")
    : null;

/**
 * Handles the logic for generating a PayMongo Checkout Session link, 
 * typically used for admin-approved or manually created payments.
 * * @param {object} req - The request object (containing body parameters).
 * @param {object} res - The response object.
 */
exports.handler = async (req, res) => { 
    if (!PAYMONGO_SECRET_KEY) {
        return res.status(500).json({ error: "Server configuration error: PAYMONGO_SECRET_KEY is missing." });
    }

    // Deconstruct the request body
    const { 
        orderId, 
        collectionName, 
        amount, 
        lineItems, 
        customerDetails = {}, // Use default empty object for safety
        description 
    } = req.body;

    // amount is in Philippine Pesos (e.g., 100.50), convert to centavos
    const amountInCentavos = Math.round(Number(amount) * 100);

    if (!orderId || !collectionName || amountInCentavos < 100 || !lineItems?.length) {
        return res.status(400).json({ error: "Invalid order, amount, or line items details" });
    }

    // Use a unique idempotency key for this request
    const idempotencyKey = uuidv4(); 
    
    try {
        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        billing: {
                            name: customerDetails.name,
                            phone: customerDetails.phone,
                            email: customerDetails.email,
                            address: {
                                line1: customerDetails.addressLine1,
                                line2: customerDetails.addressLine2,
                                city: customerDetails.city,
                                state: customerDetails.state,
                                postal_code: customerDetails.postalCode,
                                country: "PH"
                            }
                        },
                        // NOTE: Update these URLs to your live domain when deploying
                        success_url: "http://192.168.1.5:5500/CafeAmoreSite/public/index.html", 
                        cancel_url: "http://192.168.1.5:5500/CafeAmoreSite/public/index.html", 
                        send_email_receipt: true,
                        description: description || "Order Payment (Admin Approved)",
                        line_items: lineItems, // Assumed to be correctly formatted (amount in centavos)
                        payment_method_types: ["gcash", "card", "paymaya", "grab_pay"], 
                        metadata: {
                            orderId: orderId,
                            collectionName: collectionName,
                            source: 'admin_approval_link' // CRITICAL for webhook logic
                        },
                    },
                },
            },
            {
                headers: {
                    Authorization: `Basic ${AUTH_HEADER}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "Idempotency-Key": idempotencyKey, // Prevents duplicate charges
                },
            }
        );

        // Success response
        return res.json({ checkoutUrl: response.data.data.attributes.checkout_url });

    } catch (error) {
        console.error(
            "❌ Admin Approval PayMongo Link Error:",
            error.response?.data || error.message
        );
        
        // Error response
        return res.status(500).json({
            error: "Failed to create checkout session for admin approval",
            details: error.response?.data?.errors?.[0]?.detail || error.message,
        });
    }
};

// If this file is required by server.cjs, ensure you export the handler function.
// If this is used as a Netlify/AWS Lambda function, you'd export 'handler' as module.exports.
module.exports = exports.handler;