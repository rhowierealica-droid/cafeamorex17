// /.netlify/functions/create-checkout.js

require("dotenv").config();
const axios = require("axios");
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = "https://api.paymongo.com/v1";

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!PAYMONGO_SECRET_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "PAYMONGO_SECRET_KEY not set" }) };
    }

    let requestBody;
    try {
        requestBody = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const { amount, description, metadata } = requestBody;

    if (!amount || amount < 100 || !metadata?.userId || !metadata?.queueNumber || !metadata?.orderItems) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid order details or missing orderItems" }) };
    }

    // --- Build PayMongo Line Items ---
    const lineItems = metadata.orderItems.flatMap(item => {
        const qty = Number(item.qty || 1);
        // Base and size price combined
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

        // Add-ons
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

    // Delivery Fee
    const deliveryFee = Number(metadata.deliveryFee || 0);
    if (deliveryFee > 0) {
        lineItems.push({
            name: "Delivery Fee",
            currency: "PHP",
            amount: Math.round(deliveryFee * 100),
            quantity: 1,
        });
    }

    try {
        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        // Success and cancel URLs must be public for PayMongo checkout
                        success_url: process.env.SUCCESS_URL || 'https://your-public-domain.com/index.html', 
                        cancel_url: process.env.CANCEL_URL || 'https://your-public-domain.com/cart.html',
                        send_email_receipt: false,
                        description: description || `Payment for Order #${metadata.queueNumber}`,
                        line_items: lineItems,
                        payment_method_types: ["gcash"],
                        metadata: {
                            ...metadata,
                            // ⭐ FIX: Pass arrays/objects directly. Let PayMongo handle any necessary stringification.
                            orderItems: metadata.orderItems, 
                            cartItemIds: metadata.cartItemIds,
                        },
                    },
                },
            },
            {
                headers: {
                    Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
            }
        );

        return {
            statusCode: 200,
            body: JSON.stringify({ checkout_url: response.data.data.attributes.checkout_url }),
        };
    } catch (error) {
        console.error(
            "❌ PayMongo Checkout Error:",
            error.response?.data || error.message
        );
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Failed to create checkout session",
                details: error.response?.data || error.message,
            }),
        };
    }
};
