require("dotenv").config();
const axios = require("axios");

// PayMongo API Base URL
const PAYMONGO_API_URL = "https://api.paymongo.ph/v1";

/**
 * Netlify function to create a PayMongo Checkout Session.
 * @param {object} event - The Netlify event object.
 * @returns {object} The response object containing the redirect URL or an error.
 */
exports.handler = async (event) => {
    console.log("--- Create Checkout Started ---");

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        // CRITICAL: Expects the client to send the data wrapped as 'commonOrderData'
        const { commonOrderData } = JSON.parse(event.body);
        
        // 1. Validate incoming data
        if (!commonOrderData || !commonOrderData.total || !commonOrderData.items || !commonOrderData.userId) {
            console.error("❌ Missing required order data in request body.");
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: "Missing required order data: total, items, or userId." }) 
            };
        }

        const { total, items, userId, cartItemIds, customerName, address, queueNumber, queueNumberNumeric, deliveryFee } = commonOrderData;

        // 2. Prepare PayMongo Payload
        // PayMongo requires amount to be in centavos (total * 100)
        const amountInCentavos = Math.round(total * 100);

        // PayMongo metadata only supports string values. We must stringify arrays/objects.
        const metadata = {
            userId: userId,
            customerName: customerName || "",
            address: address || "",
            queueNumber: queueNumber,
            queueNumberNumeric: String(queueNumberNumeric || 0), // Stringify numeric value
            deliveryFee: String(deliveryFee || 0),               // Stringify numeric value
            orderTotal: String(total),                           // Store the total in PHP for reference
            // CRITICAL: Stringify the arrays for fulfillment in the webhook
            orderItems: JSON.stringify(items),
            cartItemIds: JSON.stringify(cartItemIds || []),
        };

        const checkoutPayload = {
            data: {
                attributes: {
                    billing: {
                        name: customerName,
                        email: "user@example.com", // Replace with actual user email if available
                        phone: "09170000000"       // Replace with actual user phone if available
                    },
                    line_items: [{
                        currency: "PHP",
                        amount: amountInCentavos,
                        name: `Order #${queueNumber}`,
                        quantity: 1,
                        // Note: PayMongo Line Items are simplified for E-Commerce Checkout; 
                        // detailed item list is passed via metadata for Firebase fulfillment.
                    }],
                    payment_method_types: ["card", "gcash", "paymaya"], // Available payment options
                    send_email_receipt: false,
                    show_description: true,
                    show_line_items: false, // We're using a single line item for simplicity
                    description: `Online Order #${queueNumber}`,
                    success_url: `${process.env.PUBLIC_BASE_URL}/success?order=epayment`, // Replace with your actual success URL
                    cancel_url: `${process.env.PUBLIC_BASE_URL}/cart?status=cancelled`,    // Replace with your actual cancel URL
                    // Pass fulfillment data to the webhook
                    metadata: metadata,
                },
            },
        };

        // 3. Call PayMongo API to create Checkout Session
        const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY; // CRITICAL: Secret Key
        if (!PAYMONGO_SECRET_KEY) {
             throw new Error("PAYMONGO_SECRET_KEY is missing in environment variables.");
        }

        const response = await axios.post(
            `${PAYMONGO_API_URL}/checkout_sessions`,
            checkoutPayload,
            {
                headers: {
                    "Authorization": `Basic ${Buffer.from(PAYMONGO_SECRET_KEY).toString("base64")}`,
                    "Content-Type": "application/json",
                },
            }
        );

        const checkoutUrl = response.data.data.attributes.checkout_url;

        console.log(`✅ Checkout Session created. Redirecting to: ${checkoutUrl}`);

        // 4. Return the checkout URL to the client
        return {
            statusCode: 200,
            body: JSON.stringify({ checkoutUrl }),
        };

    } catch (error) {
        console.error("🔴 Error creating PayMongo Checkout Session:", error.response ? error.response.data : error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: "Failed to create checkout session.",
                details: error.response ? error.response.data.errors : error.message
            }),
        };
    }
};
