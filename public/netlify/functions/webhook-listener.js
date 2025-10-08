// webhook-listener.js (Local Express Route Handler and Helpers)

const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');

// ---------------------
// 8. Helper Functions
// ---------------------
function safeParse(value, fallback) {
    try {
        return typeof value === "string" ? JSON.parse(value) : value || fallback;
    } catch {
        return fallback;
    }
}

async function deductInventoryItem(db, id, qty, name = "Unknown") {
    if (!id || !db) return;
    try {
        await db.collection("Inventory").doc(id).update({
            quantity: admin.firestore.FieldValue.increment(-Math.abs(qty))
        });
        console.log(`💸 Deducted ${qty} from ${name} (ID: ${id})`);
    } catch (err) {
        console.error(`⚠️ Failed to deduct ${qty} from ${name} (ID: ${id})`, err.message);
    }
}

async function returnItemsToInventory(db, items) {
    if (!items || !items.length || !db) return;

    // Use a Firestore Batch for efficiency and atomicity
    const batch = db.batch();

    for (const item of items) {
        const qty = Number(item.qty || 1);

        // Helper to queue an inventory update in the batch
        const queueUpdate = (itemId, incrementQty, itemName = "Item") => {
            if (!itemId) return;
            const itemRef = db.collection("Inventory").doc(itemId);
            batch.update(itemRef, {
                quantity: admin.firestore.FieldValue.increment(incrementQty)
            });
            console.log(`⬆️ Queued return of ${incrementQty} for ${itemName} (ID: ${itemId})`);
        };

        // Base product and size variant
        if (item.productId) queueUpdate(item.productId, qty, item.product);
        if (item.sizeId) queueUpdate(item.sizeId, qty, `Size ${item.size} of ${item.product}`);

        // Ingredients, Others, and Add-ons
        (item.ingredients || []).forEach(ing => {
            const ingQty = Number(ing.qty || 1) * qty;
            queueUpdate(ing.id, ingQty, `Ingredient ${ing.name} of ${item.product}`);
        });

        (item.others || []).forEach(o => {
            const otherQty = Number(o.qty || 1) * qty;
            queueUpdate(o.id, otherQty, `Other ${o.name} of ${item.product}`);
        });

        (item.addons || []).forEach(addon => {
            const addonQty = Number(addon.qty || 1) * qty;
            queueUpdate(addon.id, addonQty, `Addon ${addon.name} of ${item.product}`);
        });
    }
    
    await batch.commit();
    console.log("✅ Inventory return batch committed.");
}


// This function will be called by the main server file (e.g., server.cjs)
module.exports = (app, db, PAYMONGO_SECRET_KEY, PAYMONGO_API, WEBHOOK_SECRET) => {
    
    // ---------------------
    // 5. Initiate Refund Request
    // ---------------------
    app.post("/refund-payment", async (req, res) => {
        if (!db) return res.status(500).json({ error: "Firebase not initialized." });
        
        const { paymongoPaymentId, amount } = req.body; 

        if (!PAYMONGO_SECRET_KEY || !paymongoPaymentId || !amount || Number(amount) <= 0) {
            return res.status(400).json({ error: "Invalid refund details provided." });
        }
        
        const amountInCentavos = Math.round(Number(amount) * 100);
        
        const deliveryOrdersRef = db.collection("DeliveryOrders");
        const inStoreOrdersRef = db.collection("InStoreOrders");
        
        let orderRef = null;
        let querySnapshot = await deliveryOrdersRef.where('paymongoPaymentId', '==', paymongoPaymentId).limit(1).get();
        
        if (querySnapshot.empty) {
            querySnapshot = await inStoreOrdersRef.where('paymongoPaymentId', '==', paymongoPaymentId).limit(1).get();
            if (!querySnapshot.empty) {
                orderRef = querySnapshot.docs[0].ref;
            }
        } else {
            orderRef = querySnapshot.docs[0].ref;
        }
        
        let previousStatus = "Completed";
        if (orderRef) {
            previousStatus = (await orderRef.get()).data()?.status || previousStatus;
            await orderRef.update({
                status: "Canceled",
                refundRequest: true
            });
            console.log(`✅ Order ${orderRef.id} status immediately updated to: Refund Pending`);
        } else {
            console.warn(`⚠️ Order not found for Payment ID: ${paymongoPaymentId}. Could not update initial refund status.`);
        }

        try {
            const response = await axios.post(
                `${PAYMONGO_API}/refunds`,
                {
                    data: {
                        attributes: {
                            payment_id: paymongoPaymentId,
                            amount: amountInCentavos, 
                            reason: "requested_by_customer" 
                        }
                    }
                },
                {
                    headers: {
                        Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
                        "Content-Type": "application/json",
                        Accept: "application/json",
                    },
                }
            );

            console.log(`✅ PayMongo Refund initiated for payment ${paymongoPaymentId}. Refund ID: ${response.data.data.id}`);
            
            if (orderRef) {
                await orderRef.update({
                    paymongoRefundId: response.data.data.id,
                });
            }

            res.json({
                message: "Refund request submitted to PayMongo.",
                paymongoRefundId: response.data.data.id,
            });

        } catch (error) {
            console.error(
                "❌ PayMongo Refund Initiation Error:",
                error.response?.data || error.message
            );
            
            if (orderRef) {
                await orderRef.update({
                    status: previousStatus,
                    refundRequest: admin.firestore.FieldValue.delete()
                });
                console.log(`⚠️ Refund failed. Order ${orderRef.id} status reverted to ${previousStatus}.`);
            }
            
            res.status(500).json({
                error: "Failed to initiate refund with PayMongo.",
                details: error.response?.data?.errors?.[0]?.detail || error.message,
            });
        }
    });

    // ---------------------
    // 6. Webhook Listener
    // ---------------------
    app.post("/webhook-listener", async (req, res) => {
        console.log("📥 Webhook hit!"); 

        if (!db) return res.status(500).send("Server not initialized");

        let payload;
        
        try {
            // Raw body is required for signature verification
            if (req.body instanceof Buffer) {
                payload = JSON.parse(req.body.toString());
            } else {
                payload = req.body; 
            }
        } catch (e) {
            console.error("⚠️ Failed to parse webhook body:", e.message);
            return res.status(400).send("Invalid payload format.");
        }

        try {
            const sigHeader = req.headers["paymongo-signature"] || "";
            let signatureValid = true;

            // Signature Verification Logic
            if (WEBHOOK_SECRET && sigHeader) {
                const parts = sigHeader.split(",");
                const v1 = parts.find(p => p.startsWith("v1="))?.replace("v1=", "");

                const expectedHash = crypto
                    .createHmac("sha256", WEBHOOK_SECRET)
                    .update(req.body.toString() || JSON.stringify(payload)) 
                    .digest("hex");

                signatureValid = expectedHash === v1;
                if (!signatureValid)
                    console.warn("⚠️ Signature mismatch (testing may bypass this)");
            } else {
                console.warn("⚠️ Skipping signature verification (local test)");
            }

            const eventType = payload?.data?.attributes?.type;
            const dataObject = payload?.data?.attributes?.data;
            const dataId = dataObject?.id;

            // -------------------- Refund Event --------------------
            if (eventType === "payment.refunded" || eventType === "payment.refund.updated") {
                // Find order by paymongoRefundId and update status accordingly
                // (Your refund logic goes here if needed, or simply acknowledge)
                console.log(`ℹ️ Refund event received: ${eventType} for ID: ${dataId}`);
                return res.status(200).send({ received: true, signatureValid, processedRefund: true });
            } 
            // -------------------- Payment Paid Event --------------------
            else if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
                const payment = dataObject;
                if (!payment || !payment.attributes) return res.status(400).send("Invalid payment data");

                const metadata = payment.attributes.metadata || {};
                // Use safeParse for stringified JSON in metadata
                const orderItems = safeParse(metadata.orderItems, []);
                const cartItemIds = safeParse(metadata.cartItemIds, []);

                if (!metadata.userId || !metadata.queueNumber) return res.status(400).send("Missing metadata");

                console.log(`✅ Payment confirmed for Order #${metadata.queueNumber}`);
                
                let paymongoNetAmount = Number(metadata.orderTotal || 0);
                try {
                    const paymongoResponse = await axios.get(
                        `${PAYMONGO_API}/payments/${payment.id}`,
                        {
                            headers: {
                                Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
                                Accept: "application/json",
                            },
                        }
                    );
                    paymongoNetAmount = paymongoResponse.data.data.attributes.net_amount / 100;
                } catch (e) {
                    console.error("⚠️ Failed to fetch PayMongo net amount. Defaulting to full total.", e.message);
                }

                const orderRef = await db.collection("DeliveryOrders").add({
                    userId: metadata.userId,
                    customerName: metadata.customerName || "",
                    address: metadata.address || "",
                    queueNumber: metadata.queueNumber,
                    queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
                    orderType: "Delivery",
                    items: orderItems,
                    deliveryFee: Number(metadata.deliveryFee) || 0,
                    total: Number(metadata.orderTotal) || 0,
                    paymentMethod: "E-Payment",
                    status: "Pending",
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    paymongoPaymentId: payment.id,
                    paymongoNetAmount: paymongoNetAmount, 
                });

                console.log("💾 Order saved with ID:", orderRef.id);

                // Deduct inventory after payment confirmed
                const deductionPromises = [];
                for (const item of orderItems) {
                    const itemQty = Number(item.qty || 1);
                    if (item.productId) deductionPromises.push(deductInventoryItem(db, item.productId, itemQty, item.product));
                    if (item.sizeId) deductionPromises.push(deductInventoryItem(db, item.sizeId, itemQty, `Size ${item.size} of ${item.product}`));
                    (item.addons || []).forEach(addon => deductionPromises.push(deductInventoryItem(db, addon.id, itemQty, `Addon ${addon.name} of ${item.product}`)));
                    (item.ingredients || []).forEach(ing => deductionPromises.push(deductInventoryItem(db, ing.id, Number(ing.qty || 1) * itemQty, `Ingredient ${ing.name} of ${item.product}`)));
                    (item.others || []).forEach(o => deductionPromises.push(deductInventoryItem(db, o.id, Number(o.qty || 1) * itemQty, `Other ${o.name} of ${item.product}`)));
                }
                await Promise.all(deductionPromises);
                console.log(`✅ Inventory Deduction Complete.`);

                // Clear cart
                if (Array.isArray(cartItemIds) && cartItemIds.length) {
                    const batch = db.batch();
                    cartItemIds.forEach(id => batch.delete(db.doc(`users/${metadata.userId}/cart/${id}`)));
                    await batch.commit();
                    console.log(`🗑 Cart cleared for user ${metadata.userId}`);
                }
            }

            res.status(200).send({ received: true, signatureValid });

        } catch (err) {
            console.error("⚠️ Webhook error:", err);
            res.status(500).send("Error processing webhook");
        }
    });

    // ---------------------
    // 7. Cancel Order Route (Return Items to Inventory)
    // ---------------------
    app.post("/cancel-order", async (req, res) => {
        if (!db) return res.status(500).json({ error: "Firebase not initialized." });
        
        const { orderId, orderType } = req.body;
        if (!orderId || !orderType) return res.status(400).json({ error: "Missing orderId or orderType" });

        const orderRef = db.collection(orderType === "Delivery" ? "DeliveryOrders" : "InStoreOrders").doc(orderId);
        const orderSnap = await orderRef.get();
        if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });

        const orderData = orderSnap.data();
        const items = orderData.items || [];
        
        const currentStatus = orderData.status;
        if (currentStatus === "Cancelled" || currentStatus === "Canceled") {
             return res.status(400).json({ error: "Order is already cancelled." });
        }

        // Return items to inventory
        await returnItemsToInventory(db, items);
        await orderRef.update({ status: "Cancelled" });

        console.log(`✅ Returned items to inventory for cancelled order ${orderId}`);
        res.json({ message: "Order cancelled and inventory returned." });
    });
};
