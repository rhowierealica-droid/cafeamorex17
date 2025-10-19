// generate-paymongo-link.js (Standalone Module for Admin Approval Flow - Netlify Format)

const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); 
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = "https://api.paymongo.com/v1";

// Base64 encode the secret key for PayMongo Basic Auth header
const AUTH_HEADER = PAYMONGO_SECRET_KEY 
    ? Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")
    : null;

/**
 * Handles the logic for generating a PayMongo Checkout Session link.
 * * @param {object} event - The event object (contains request body in event.body).
 * @param {object} context - The context object.
 */
exports.handler = async (event, context) => { 
    
    // 1. Check for Secret Key
    if (!PAYMONGO_SECRET_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Server configuration error: PAYMONGO_SECRET_KEY is missing." }),
        };
    }

    // 2. Parse the Request Body (CRITICAL for Netlify functions)
    let parsedBody;
    try {
        // Netlify event.body is a string
        parsedBody = JSON.parse(event.body); 
    } catch (e) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid JSON format in request body." }),
        };
    }

    // Deconstruct the parsed body
    const { 
        orderId, 
        collectionName, 
        amount, 
        lineItems, 
        customerDetails = {},
        description 
    } = parsedBody;

    // amount is in Philippine Pesos (e.g., 100.50), convert to centavos
    const amountInCentavos = Math.round(Number(amount) * 100);

    // 3. Basic Validation
    if (!orderId || !collectionName || amountInCentavos < 100 || !lineItems?.length) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: "Invalid order, amount, or line items details" }),
        };
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
                        // CORRECTED: Using the live Netlify domain
                        success_url: "https://inquisitive-tarsier-f8128f.netlify.app/public/index.html", 
                        cancel_url: "https://inquisitive-tarsier-f8128f.netlify.app/public/index.html", 
                        send_email_receipt: true,
                        description: description || "Order Payment (Admin Approved)",
                        line_items: lineItems,
                        payment_method_types: ["gcash", "card", "paymaya", "grab_pay"], 
                        metadata: {
                            orderId: orderId,
                            collectionName: collectionName,
                            source: 'admin_approval_link'
                        },
                    },
                },
            },
            {
                headers: {
                    Authorization: `Basic ${AUTH_HEADER}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "Idempotency-Key": idempotencyKey,
                },
            }
        );

        // Success response (Netlify format)
        return {
            statusCode: 200,
            body: JSON.stringify({ checkoutUrl: response.data.data.attributes.checkout_url }),
        };

    } catch (error) {
        console.error(
            "❌ Admin Approval PayMongo Link Error:",
            error.response?.data || error.message
        );
        
        // Error response (Netlify format)
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Failed to create checkout session for admin approval",
                // Provide clearer error details from PayMongo
                details: error.response?.data?.errors?.[0]?.detail || error.message,
            }),
        };
    }
};

// Netlify uses exports.handler as the entry point, so no other exports are needed.
