require("dotenv").config();
const axios = require("axios");

// PayMongo API Base URL (Verified: This URL is correct and not the source of the ENOTFOUND error.)
const PAYMONGO_API_URL = "https://api.paymongo.ph/v1";

/**
 * Netlify function to create a PayMongo Checkout Session.
 * This function receives order details from the client-side cart.js,
 * formats the data, and calls the PayMongo API to generate a checkout URL.
 *
 * @param {object} event - The Netlify event object.
 * @returns {object} The response object containing the redirect URL or an error.
 */
exports.handler = async (event) => {
    console.log("--- Create Checkout Started (Redeploy Attempt) ---");

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
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
        const amountInCentavos = Math.round(total * 100);

        const metadata = {
            userId: userId,
            customerName: customerName || "Guest",
            address: address || "N/A",
            queueNumber: queueNumber,
            queueNumberNumeric: String(queueNumberNumeric || 0),
            deliveryFee: String(deliveryFee || 0),
            orderTotal: String(total),
            orderItems: JSON.stringify(items),
            cartItemIds: JSON.stringify(cartItemIds || []),
        };

        const checkoutPayload = {
            data: {
                attributes: {
                    billing: {
                        name: customerName,
                        email: "user@example.com", // Placeholder: Replace with actual user email if available
                        phone: "09170000000"       // Placeholder: Replace with actual user phone if available
                    },
                    line_items: [{
                        currency: "PHP",
                        amount: amountInCentavos,
                        name: `Online Order #${queueNumber}`,
                        quantity: 1,
                    }],
                    payment_method_types: ["card", "gcash", "paymaya"],
                    send_email_receipt: false,
                    show_description: true,
                    description: `Online Order #${queueNumber} for delivery`,
                    success_url: `${process.env.PUBLIC_BASE_URL}/success?order=epayment`,
                    cancel_url: `${process.env.PUBLIC_BASE_URL}/cart?status=cancelled`,
                    metadata: metadata,
                },
            },
        };

        // 3. Call PayMongo API to create Checkout Session
        const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
        if (!PAYMONGO_SECRET_KEY) {
             throw new Error("PAYMONGO_SECRET_KEY is missing in environment variables.");
        }

        const response = await axios.post(
            `${PAYMONGO_API_URL}/checkout_sessions`,
            checkoutPayload,
            {
                headers: {
                    // PayMongo uses Basic Auth with the Secret Key
                    "Authorization": `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
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
        // Log the full error response from PayMongo for debugging
        console.error("🔴 Error creating PayMongo Checkout Session:", 
            error.response ? error.response.data : error.message);
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Failed to create checkout session.",
                details: error.response ? error.response.data.errors : error.message
            }),
        };
    }
};
