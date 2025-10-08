// create-checkout.js (Local Express Route Handler)

const axios = require('axios');
const path = require('path');

// This function will be called by the main server file (e.g., server.cjs)
module.exports = (app, PAYMONGO_SECRET_KEY, PAYMONGO_API) => {

    // ---------------------
    // 4. Create Checkout Session
    // ---------------------
    app.post("/create-checkout", async (req, res) => {
        const { amount, description, metadata } = req.body;

        if (!PAYMONGO_SECRET_KEY)
            return res.status(500).json({ error: "PAYMONGO_SECRET_KEY not set" });

        // NOTE: Adjusted check to look for metadata.orderItems existence
        if (!amount || amount < 100 || !metadata?.userId || !metadata?.queueNumber || !metadata?.orderItems)
            return res.status(400).json({ error: "Invalid order details or missing orderItems" });

        const lineItems = metadata.orderItems.flatMap(item => {
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

        try {
            const response = await axios.post(
                `${PAYMONGO_API}/checkout_sessions`,
                {
                    data: {
                        attributes: {
                            // These are local success/cancel URLs, update if necessary
                            success_url: "http://192.168.1.5:5500/CafeAmoreSite/public/index.html",
                            cancel_url: "http://192.168.1.5:5500/CafeAmoreSite/public/cart.html",
                            send_email_receipt: false,
                            description: description || `Payment for Order #${metadata.queueNumber}`,
                            line_items: lineItems,
                            payment_method_types: ["gcash"],
                            metadata: {
                                ...metadata,
                                // IMPORTANT: Stringify complex objects for PayMongo metadata
                                orderItems: JSON.stringify(metadata.orderItems),
                                cartItemIds: JSON.stringify(metadata.cartItemIds),
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

            res.json({ checkout_url: response.data.data.attributes.checkout_url });
        } catch (error) {
            console.error(
                "❌ PayMongo Checkout Error:",
                error.response?.data || error.message
            );
            res.status(500).json({
                error: "Failed to create checkout session",
                details: error.response?.data || error.message,
            });
        }
    });

};
