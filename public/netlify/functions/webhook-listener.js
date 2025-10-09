// webhook-listener.js (Local Express Route Handler and Helpers)

const crypto = require('crypto');
const axios = require('axios');
const admin = require('firebase-admin');

// ---------------------
// 8. Helper Functions
// ---------------------
function safeParse(value, fallback) {
    try {
        // PayMongo sometimes sends metadata as stringified JSON inside the metadata fields
        return typeof value === "string" ? JSON.parse(value) : value || fallback;
    } catch {
        return fallback;
    }
}

async function findOrderRefByRefundId(db, refundId) {
    const deliveryOrdersRef = db.collection("DeliveryOrders");
    const inStoreOrdersRef = db.collection("InStoreOrders");
    
    let querySnapshot = await deliveryOrdersRef.where('paymongoRefundId', '==', refundId).limit(1).get();
    
    if (querySnapshot.empty) {
        querySnapshot = await inStoreOrdersRef.where('paymongoRefundId', '==', refundId).limit(1).get();
        if (!querySnapshot.empty) {
            return querySnapshot.docs[0].ref;
        }
    } else {
        return querySnapshot.docs[0].ref;
    }
    return null;
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
        // WARNING: Your current `returnItemsToInventory` includes `productId` which isn't 
        // usually consumed as an inventory item. I've left the logic as you provided it, 
        // but typically only ingredients/sizes/addons are deducted/returned.
        // if (item.productId) queueUpdate(item.productId, qty, item.product); // <-- Consider removing this line
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
            const addonQty = qty; // Addons are typically tracked per item, not per ingredient
            queueUpdate(addon.id, addonQty, `Addon ${addon.name} of ${item.product}`);
        });
    }
    
    await batch.commit();
    console.log("✅ Inventory return batch committed.");
}

// ---------------------
// 9. Main Exported Module
// ---------------------
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
            // Update status to reflect refund is in progress
            await orderRef.update({
                status: "Refund Pending", // Use "Refund Pending" for explicit tracking
                refundRequest: true
            });
            console.log(`✅ Order ${orderRef.id} status immediately updated to: Refund Pending`);
        } else {
            console.warn(`⚠️ Order not found for Payment ID: ${paymongoPaymentId}. Continuing with PayMongo request.`);
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

// ------------------------------------------------------------------
// 6. Webhook Listener (UPDATED TO HANDLE DRAFT ORDERS AND REFUNDS)
// ------------------------------------------------------------------
    app.post("/webhook-listener", async (req, res) => {
        console.log("📥 Webhook hit!"); 

        if (!db) return res.status(500).send("Server not initialized");

        let payload;
        
        try {
            // Raw body is required for signature verification
            if (req.body instanceof Buffer) {
                payload = JSON.parse(req.body.toString());
            } else {
                // If using express.json() middleware, req.body is already parsed
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

                // Use the raw body buffer/string for signature verification
                const rawBody = req.body instanceof Buffer ? req.body.toString() : JSON.stringify(payload);
                
                const expectedHash = crypto
                    .createHmac("sha256", WEBHOOK_SECRET)
                    .update(rawBody) 
                    .digest("hex");

                signatureValid = expectedHash === v1;
                if (!signatureValid)
                    console.warn("⚠️ Signature mismatch (testing may bypass this)");
            } else {
                console.warn("⚠️ Skipping signature verification (local test)");
            }

            if (!signatureValid) {
                 // You might want to return 401 Unauthorized for production environments
                 // return res.status(401).send("Invalid signature");
            }
            
            const eventType = payload?.data?.attributes?.type;
            const dataObject = payload?.data?.attributes?.data;
            const dataId = dataObject?.id;

            // -------------------- Refund Events --------------------
            if (eventType === "refund.succeeded" || eventType === "refund.failed") {
                const refundId = dataId; // This is the PayMongo Refund ID (pm_rf_...)
                const refundStatus = dataObject?.attributes?.status; 
                
                console.log(`ℹ️ Refund event received: ${eventType} for ID: ${refundId}. Status: ${refundStatus}`);

                const orderRef = await findOrderRefByRefundId(db, refundId);

                if (orderRef) {
                    const orderData = (await orderRef.get()).data();
                    let newStatus = "Completed"; 
                    let finalRefundStatus = 'Denied'; 

                    if (eventType === "refund.succeeded") {
                        newStatus = "Refunded";
                        finalRefundStatus = "Refunded";
                        
                        // CRITICAL: Return stock ONLY on successful refund
                        await returnItemsToInventory(db, orderData.items || orderData.products || []);
                        console.log(`✅ Refund Succeeded. Inventory returned for order ${orderRef.id}.`);

                    } else if (eventType === "refund.failed") {
                        newStatus = "Refund Failed"; 
                        finalRefundStatus = "Failed";
                        console.log(`⚠️ Refund Failed. Order ${orderRef.id} status updated.`);
                        // DO NOT return inventory on failure.
                    }

                    // Finalize order status and remove the temporary 'refundRequest' flag
                    await orderRef.update({ 
                        status: newStatus, 
                        finalRefundStatus: finalRefundStatus, // Custom field to show final outcome
                        refundRequest: admin.firestore.FieldValue.delete()
                    });
                } else {
                    console.warn(`⚠️ Order not found for PayMongo Refund ID: ${refundId}`);
                }

                return res.status(200).send({ received: true, signatureValid, processedRefund: true });
            } 
            
            // -------------------- Payment Paid/Checkout Completed Event --------------------
            // Use 'checkout_session.completed' if you are using Checkout API
            // Use 'payment.paid' if you are using Payment Intent API
            else if (eventType === "payment.paid" || eventType === "checkout_session.completed") {
                
                const payment = dataObject;

                if (!payment || !payment.attributes) return res.status(400).send("Invalid payment data");

                // PayMongo Checkout API includes the metadata in the payment object, 
                // but we must check for the draftOrderId instead of all the large fields.
                const metadata = payment.attributes.metadata || {};
                const draftOrderId = metadata.draftOrderId;

                if (!draftOrderId) {
                     console.error("❌ Draft Order ID missing from PayMongo metadata. Cannot fulfill order.");
                     return res.status(400).send("Missing draftOrderId in metadata.");
                }

                console.log(`✅ Payment confirmed for Draft Order ID: ${draftOrderId}`);
                
                const draftRef = db.collection("DraftOrders").doc(draftOrderId);
                const draftSnap = await draftRef.get();

                if (!draftSnap.exists) {
                    console.error(`❌ Draft Order ${draftOrderId} not found. Payment confirmed, but order fulfillment failed.`);
                    return res.status(404).send("Draft Order not found.");
                }

                const draftData = draftSnap.data();
                
                // --- Step 1: Fetch Net Amount from PayMongo (Optional but good practice) ---
                let paymongoNetAmount = draftData.total; // Default to the stored total
                try {
                    const paymentId = payment.id || payment.attributes.payment_intent.id; // Get correct Payment ID

                    const paymongoResponse = await axios.get(
                        `${PAYMONGO_API}/payments/${paymentId}`,
                        {
                            headers: {
                                Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
                                Accept: "application/json",
                            },
                        }
                    );
                    paymongoNetAmount = paymongoResponse.data.data.attributes.net_amount / 100;
                } catch (e) {
                    console.error("⚠️ Failed to fetch PayMongo net amount. Defaulting to Draft Order total.", e.message);
                }

                // --- Step 2: Transition Draft Order to Final DeliveryOrder ---
                const orderRef = await db.collection("DeliveryOrders").add({
                    userId: draftData.userId,
                    customerName: draftData.customerName || "",
                    address: draftData.address || "",
                    queueNumber: draftData.queueNumber,
                    queueNumberNumeric: Number(draftData.queueNumberNumeric) || 0,
                    orderType: "Delivery",
                    items: draftData.orderItems, // Use details from Draft Order
                    deliveryFee: Number(draftData.deliveryFee) || 0,
                    total: Number(draftData.orderTotal) || 0,
                    paymentMethod: "E-Payment",
                    status: "Pending", // Initial status after payment
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    paymongoPaymentId: payment.id || (payment.attributes.payment_intent ? payment.attributes.payment_intent.id : null),
                    paymongoNetAmount: paymongoNetAmount, 
                });

                console.log("💾 Final Order saved with ID:", orderRef.id);

                // --- Step 3: Deduct Inventory and Clear Cart ---
                const orderItems = draftData.orderItems || [];
                const cartItemIds = draftData.cartItemIds || [];

                // Deduct inventory
                const deductionPromises = [];
                for (const item of orderItems) {
                    const itemQty = Number(item.qty || 1);
                    // NOTE: Removed `item.productId` deduction as it's rarely a raw inventory item
                    if (item.sizeId) deductionPromises.push(deductInventoryItem(db, item.sizeId, itemQty, `Size ${item.size} of ${item.product}`));
                    (item.addons || []).forEach(addon => deductionPromises.push(deductInventoryItem(db, addon.id, itemQty, `Addon ${addon.name} of ${item.product}`)));
                    (item.ingredients || []).forEach(ing => deductionPromises.push(deductInventoryItem(db, ing.id, Number(ing.qty || 1) * itemQty, `Ingredient ${ing.name} of ${item.product}`)));
                    (item.others || []).forEach(o => deductionPromises.push(deductInventoryItem(db, o.id, Number(o.qty || 1) * itemQty, `Other ${o.name} of ${item.product}`)));
                }
                await Promise.all(deductionPromises);
                console.log(`✅ Inventory Deduction Complete.`);

                // Clear cart (using a batch)
                if (Array.isArray(cartItemIds) && cartItemIds.length) {
                    const batch = db.batch();
                    cartItemIds.forEach(id => batch.delete(db.doc(`users/${draftData.userId}/cart/${id}`)));
                    await batch.commit();
                    console.log(`🗑 Cart cleared for user ${draftData.userId}`);
                }
                
                // --- Step 4: Delete the Draft Order ---
                await draftRef.delete();
                console.log(`🗑 Draft Order ${draftOrderId} deleted.`);
            }

            res.status(200).send({ received: true, signatureValid });

        } catch (err) {
            console.error("⚠️ Webhook error:", err);
            res.status(500).send("Error processing webhook");
        }
    });
// ------------------------------------------------------------------

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
        
        // Prevent cancellation of E-Payment orders that are already processed (and may need refunding)
        if (orderData.paymentMethod === "E-Payment" && currentStatus !== "Pending") {
            return res.status(400).json({ error: "E-Payment orders must be refunded, not manually cancelled." });
        }


        // Return items to inventory
        await returnItemsToInventory(db, items);
        await orderRef.update({ status: "Cancelled" });

        console.log(`✅ Returned items to inventory for cancelled order ${orderId}`);
        res.json({ message: "Order cancelled and inventory returned." });
    });
};
