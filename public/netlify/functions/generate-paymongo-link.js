const axios = require('axios');
const { v4: uuidv4 } = require('uuid'); 

// Environment variables are accessed directly inside the handler via process.env
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = "https://api.paymongo.com/v1";

/**
 * Handles the logic for generating a PayMongo Checkout Session link.
 * @param {object} event - The event object (contains request body in event.body).
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

    // Calculate the AUTH_HEADER here to ensure environment variables are loaded
    const AUTH_HEADER = Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64");


    // 2. Parse the Request Body
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
            body: JSON.stringify({ error: "Invalid order, amount (min 1.00 PHP), or line items details" }),
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
                        amount: amountInCentavos, 
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
                        // NOTE: REPLACE THESE WITH YOUR ACTUAL SUCCESS/CANCEL URLS
                        success_url: "YOUR_NETLIFY_DOMAIN/public/index.html", 
                        cancel_url: "YOUR_NETLIFY_DOMAIN/public/index.html", 
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
                {
                    headers: {
                        Authorization: `Basic ${AUTH_HEADER}`, // Use the corrected header
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
       
        // Extract the most helpful error detail from PayMongo's response structure
        const paymongoErrorDetail = error.response?.data?.errors?.[0]?.detail || error.message;

        // Error response (Netlify format)
        return {
            // Return a 400 for client errors (like missing line items) or 500 otherwise
            statusCode: error.response?.status || 500, 
            body: JSON.stringify({
                error: "Failed to create checkout session for admin approval",
                details: paymongoErrorDetail,
            }),
        };
    }
};
