require("dotenv").config();
const axios = require("axios");
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = "https://api.paymongo.com/v1";

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!PAYMONGO_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: "PAYMONGO_SECRET_KEY not set" }) };

    let requestBody;
    try { requestBody = JSON.parse(event.body); } catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) }; }

    const { amount, description, metadata } = requestBody;

    if (!amount || amount < 100 || !metadata?.userId || !metadata?.queueNumber || !metadata?.cartItemIds || metadata.cartItemIds.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "Invalid order details or missing cartItemIds" }) };
    }

    const clientOrderItems = metadata.orderItems;
    if (!clientOrderItems || clientOrderItems.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing 'orderItems' array for PayMongo line_items generation." }) };
    }

    // Build PayMongo line items
    const lineItems = clientOrderItems.flatMap(item => {
        const qty = Number(item.qty || 1);
        const baseAmount = Math.round((Number(item.basePrice || 0) + Number(item.sizePrice || 0)) * 100);
        const itemsArray = [{ name: item.product || "Unnamed Product", currency: "PHP", amount: baseAmount, quantity: qty }];
        (item.addons || []).forEach(addon => {
            itemsArray.push({ name: `${item.product || "Product"} Add-on: ${addon.name || "Addon"}`, currency: "PHP", amount: Math.round(Number(addon.price || 0) * 100), quantity: qty });
        });
        return itemsArray;
    });

    const deliveryFee = Number(metadata.deliveryFee || 0);
    if (deliveryFee > 0) lineItems.push({ name: "Delivery Fee", currency: "PHP", amount: Math.round(deliveryFee * 100), quantity: 1 });

    try {
        const response = await axios.post(
            `${PAYMONGO_API}/checkout_sessions`,
            {
                data: {
                    attributes: {
                        success_url: process.env.SUCCESS_URL || 'https://remarkable-cassata-a847b0.netlify.app/customer-status.html',
                        cancel_url: process.env.CANCEL_URL || 'https://remarkable-cassata-a847b0.netlify.app/cart.html',
                        send_email_receipt: false,
                        description: description || `Payment for Order #${metadata.queueNumber}`,
                        line_items: lineItems,
                        payment_method_types: ["gcash"],
                        metadata: {
                            ...metadata,
                            orderItems: JSON.stringify(metadata.orderItems), // backup for webhook fallback
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

        return { statusCode: 200, body: JSON.stringify({ checkout_url: response.data.data.attributes.checkout_url }) };
    } catch (error) {
        console.error("❌ PayMongo Checkout Error:", error.response?.data || error.message);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to create checkout session", details: error.response?.data || error.message }) };
    }
};
