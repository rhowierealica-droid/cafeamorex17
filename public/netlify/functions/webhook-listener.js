require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

// --- Global DB Initialization ---
let db;
try {
    // CRITICAL: Ensure this is the stringified JSON key from your Netlify environment variables
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
        throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is missing in environment.");
    }
    const serviceAccount = JSON.parse(serviceAccountKey);

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
    }
    db = admin.firestore();
    console.log("✅ Firebase Admin SDK Initialized Successfully.");
} catch (e) {
    console.error("❌ FIREBASE ADMIN INIT FAILED:", e.message);
    // Set a handler that immediately returns a server error and stops execution
    exports.handler = async () => ({
        statusCode: 500,
        body: `Firebase Initialization Failed: ${e.message}`,
    });
    throw new Error("Firebase Admin failed to initialize.");
}

// ===============================================
// --- Helper Functions ---
// ===============================================

/**
 * Helper: safely parse JSON fields.
 * Handles both standard and double-stringified JSON, common in metadata.
 */
function safeParse(value) {
    if (!value) return null;
    let parsedValue = value;
    try {
        // Attempt to parse if it's a string
        if (typeof parsedValue === "string") {
            parsedValue = JSON.parse(parsedValue);
        }
        // If the result is *still* a string, try parsing again (handles double-stringification)
        if (typeof parsedValue === "string") {
            parsedValue = JSON.parse(parsedValue);
        }
        return parsedValue;
    } catch (e) {
        console.warn("⚠️ safeParse failed on value:", typeof value, "Error:", e.message);
        return null;
    }
}

// Helper: Remove null/undefined/empty string fields before saving
function cleanObject(obj) {
    const cleaned = {};
    for (const key in obj) {
        const value = obj[key];
        // Ensure to keep '0' values for numeric fields
        if (value !== null && value !== undefined && value !== "") {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

// Helper: Deduct inventory (using Admin SDK's atomic increment)
async function deductInventory(orderItems) {
    const deductItem = async (id, amount, name = "Unknown") => {
        if (!id || !amount) return;
        const invRef = db.collection("Inventory").doc(id);

        await invRef.update({
            quantity: admin.firestore.FieldValue.increment(-Math.abs(amount))
        }).catch(err => {
            // Log an error if the document doesn't exist or update fails
            console.error(`⚠️ Failed to deduct ${amount} from ${name} (ID: ${id}):`, err.message);
        });
    };

    const deductionPromises = [];
    for (const item of orderItems) {
        const itemQty = Number(item.qty || 1);
        if (item.productId) deductionPromises.push(deductItem(item.productId, itemQty, item.product));
        if (item.sizeId) deductionPromises.push(deductItem(item.sizeId, itemQty, `Size ${item.size} of ${item.product}`));
        (item.addons || []).forEach(addon => deductionPromises.push(deductItem(addon.id, itemQty, `Addon ${addon.name} of ${item.product}`)));
        (item.ingredients || []).forEach(ing => deductionPromises.push(deductItem(ing.id, Number(ing.qty || 1) * itemQty, `Ingredient ${ing.name} of ${item.product}`)));
        (item.others || []).forEach(o => deductionPromises.push(deductItem(o.id, Number(o.qty || 1) * itemQty, `Other ${o.name} of ${item.product}`)));
    }
    await Promise.all(deductionPromises);
    console.log(`✅ Inventory Deduction Complete.`);
}

/**
 * Finds an order document reference across multiple collections based on a single field match.
 * @param {string} field The Firestore field to query (e.g., 'paymongoPaymentId').
 * @param {string} value The value to match (e.g., the PayMongo ID).
 * @returns {Promise<admin.firestore.DocumentReference | null>} The Firestore document reference or null.
 */
async function findOrderRef(field, value) {
    if (!value) return null;

    const collections = ["DeliveryOrders", "InStoreOrders"];

    for (const collectionName of collections) {
        const collectionRef = db.collection(collectionName);
        
        let querySnapshot = await collectionRef.where(field, '==', value).limit(1).get();

        if (!querySnapshot.empty) {
            console.log(`Order found in collection: ${collectionName}`);
            return querySnapshot.docs[0].ref;
        }
    }

    return null; // Not found in any collection
}

/**
 * Finds the order document reference based on the PayMongo payment ID (used for idempotency).
 */
async function findOrderRefByPaymentId(paymongoPaymentId) {
    return findOrderRef('paymongoPaymentId', paymongoPaymentId);
}

/**
 * Finds the order document reference based on the PayMongo refund ID (used for refund handling).
 */
async function findOrderRefByRefundId(paymongoRefundId) {
    return findOrderRef('paymongoRefundId', paymongoRefundId);
}

// Helper: Return items to inventory
async function returnItemsToInventory(items) {
    if (!items || !items.length) return;

    const returnItem = async (id, amount, name = "Unknown") => {
        if (!id || !amount) return;
        const invRef = db.collection("Inventory").doc(id);

        await invRef.update({
            // Use positive increment to increase quantity
            quantity: admin.firestore.FieldValue.increment(Math.abs(amount))
        }).catch(err => {
            console.error(`⚠️ Failed to return ${amount} to ${name} (ID: ${id}):`, err.message);
        });
    };

    const returnPromises = [];
    for (const item of items) {
        const itemQty = Number(item.qty || 1);
        if (item.productId) returnPromises.push(returnItem(item.productId, itemQty, item.product));
        if (item.sizeId) returnPromises.push(returnItem(item.sizeId, itemQty, `Size ${item.size} of ${item.product}`));
        (item.addons || []).forEach(addon => returnPromises.push(returnItem(addon.id, itemQty, `Addon ${addon.name} of ${item.product}`)));
        (item.ingredients || []).forEach(ing => returnPromises.push(returnItem(ing.id, Number(ing.qty || 1) * itemQty, `Ingredient ${ing.name} of ${item.product}`)));
        (item.others || []).forEach(o => returnPromises.push(returnItem(o.id, Number(o.qty || 1) * itemQty, `Other ${o.name} of ${item.product}`)));
    }
    await Promise.all(returnPromises);
    console.log(`✅ Inventory Return Complete.`);
}

// ===============================================
// --- Netlify Handler ---
// ===============================================

exports.handler = async (event) => {
    console.log("--- Webhook Handler Started ---");

    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const webhookSecret = process.env.WEBHOOK_SECRET_KEY; // CRITICAL: Ensure this is set in Netlify
        if (!webhookSecret) {
            console.error("❌ Missing WEBHOOK_SECRET_KEY");
            return { statusCode: 500, body: "Server misconfigured" };
        }

        // --- 1. Signature Verification ---
        const sigHeader = event.headers["paymongo-signature"];
        if (!sigHeader) {
            console.error("❌ Missing signature header");
            return { statusCode: 400, body: "Missing signature header" };
        }

        const sigParts = sigHeader.split(",");
        const sigMap = {};
        sigParts.forEach((p) => { 
            const [k, v] = p.trim().split("="); 
            if (k && v) sigMap[k] = v; 
        });

        const signature = sigMap.v1; // PayMongo standard is 'v1' for signature
        const timestamp = sigMap.t;

        if (!signature || !timestamp) {
            console.error("❌ Invalid signature header format:", sigHeader);
            return { statusCode: 400, body: "Invalid signature header format" };
        }

        // CRITICAL: Use timestamp + "." + raw body for PayMongo signature
        const signedPayload = `${timestamp}.${event.body}`;

        const hmac = crypto.createHmac("sha256", webhookSecret);
        hmac.update(signedPayload);
        const digest = hmac.digest("hex");

        if (digest !== signature) {
            console.error("❌ Invalid webhook signature. Expected:", digest, "Received:", signature);
            return { statusCode: 401, body: "Invalid signature" };
        }
        
        // --- Timestamp Verification ---
        const currentTimeInSeconds = Math.floor(Date.now() / 1000);
        const signatureTimeInSeconds = Number(timestamp);
        const tolerance = 300; // 5 minutes

        if (Math.abs(currentTimeInSeconds - signatureTimeInSeconds) > tolerance) {
            console.error("❌ Webhook timestamp too old/new (Replay attack?):", signatureTimeInSeconds, "Current:", currentTimeInSeconds);
            return { statusCode: 401, body: "Invalid or expired signature timestamp" };
        }

        console.log("✅ Signature Verified. Processing payload.");

        const body = JSON.parse(event.body);
        const eventType = body.data?.attributes?.type;
        const dataObject = body.data?.attributes?.data;

        console.log("🔔 PayMongo Webhook Event:", eventType);

        // ===============================================
        // --- 2. Handle Successful Payment ---
        // ===============================================
        if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
            const payment = dataObject;
            const metadata = payment?.attributes?.metadata || {};
            const paymongoPaymentId = payment.id; 

            // --- CRITICAL IDEMPOTENCY CHECK ---
            const existingOrderRef = await findOrderRefByPaymentId(paymongoPaymentId);
            
            if (existingOrderRef) {
                console.warn(`⚠️ DUPLICATE WEBHOOK received. Order with PayMongo ID ${paymongoPaymentId} already exists at ${existingOrderRef.path}. Aborting fulfillment.`);
                return { statusCode: 200, body: "Success: Payment already processed (Idempotency check passed)" };
            }

            // Parse the stringified fields from metadata
            const orderItems = safeParse(metadata.orderItems);
            const cartItemIds = safeParse(metadata.cartItemIds);
            
            // Check for the fields passed in your metadata block
            if (
                !metadata.userId || 
                !metadata.queueNumber ||
                !Array.isArray(orderItems) ||
                orderItems.length === 0
            ) {
                console.error("❌ Missing required order data in metadata or items array is empty. Aborting save.");
                return { statusCode: 400, body: "Missing required order data for saving" };
            }
            
            // Calculate net amount (PayMongo amounts are in centavos)
            const totalAmount = payment?.attributes?.amount ?? 0;
            const fee = payment?.attributes?.fee ?? 0;
            const paymongoNetAmount = (totalAmount - fee) / 100;

            const orderToSave = {
                // Data pulled directly from the metadata fields set in /create-checkout
                userId: metadata.userId,
                customerName: metadata.customerName || "",
                address: metadata.address || "",
                queueNumber: metadata.queueNumber,
                // These fields were stored as strings in metadata, convert them back to numbers
                queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
                deliveryFee: Number(metadata.deliveryFee) || 0,
                total: Number(metadata.orderTotal) || 0, // orderTotal is total in PHP from client
                
                // Parsed arrays
                items: orderItems,
                cartItemIds: cartItemIds || [],
                
                // Overridden/Added fields
                orderType: "Delivery",
                paymentMethod: "E-Payment",
                status: "Pending", 
                
                // PayMongo details
                paymongoPaymentId: paymongoPaymentId, 
                paymongoNetAmount: paymongoNetAmount,
                
                // Timestamps
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            const cleanedOrderToSave = cleanObject(orderToSave);

            // 1. Save Order to Firebase
            const newOrderRef = await db.collection("DeliveryOrders").add(cleanedOrderToSave);
            const orderId = newOrderRef.id;

            console.log(`✅ Order ${orderId} saved to Firebase with status: Pending.`);

            // 2. Perform Fulfillment Tasks (Deduct Inventory and Clear Cart)
            await deductInventory(orderItems);
            
            if (metadata.userId && Array.isArray(cartItemIds) && cartItemIds.length > 0) {
                console.log(`Clearing ${cartItemIds.length} cart items for user ${metadata.userId}...`);
                const batch = db.batch();
                const userCartRef = db.collection("users").doc(metadata.userId).collection("cart");
                cartItemIds.forEach(itemId => {
                    batch.delete(userCartRef.doc(itemId));
                });
                await batch.commit();
            }

            console.log(`✅ Fulfillment for Order ${orderId} complete. Returning success.`);

            return { statusCode: 200, body: "Success: Order paid, saved, and fulfilled" };
        }

        // ===============================================
        // --- 3. Handle Refund Events ---
        // ===============================================
        else if (eventType === "refund.succeeded" || eventType === "refund.failed" || eventType === "refund.updated") {
            const refund = dataObject;
            const refundStatus = refund?.attributes?.status || "unknown";
            const paymongoRefundId = refund?.id;
            
            console.log(`🔔 PayMongo Refund Status Event: ${refundStatus} for Refund ID: ${paymongoRefundId}`);

            const orderRef = await findOrderRefByRefundId(paymongoRefundId);

            if (!orderRef) {
                console.warn(`⚠️ Order not found for Refund ID: ${paymongoRefundId}. Aborting update.`);
                return { statusCode: 200, body: "Refund event received, but matching order not found." };
            }

            const orderSnap = await orderRef.get();
            const orderData = orderSnap.data();

            if (refundStatus === "succeeded") {
                await orderRef.update({
                    status: "Refunded",
                    refundRequest: admin.firestore.FieldValue.delete(),
                    paymongoRefundStatus: "succeeded",
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`✅ Order ${orderRef.id} successfully updated to: Refunded.`);

                // CRITICAL: Return items to inventory upon successful refund
                await returnItemsToInventory(orderData.items || []);

            } else if (refundStatus === "failed") {
                await orderRef.update({
                    status: orderData.previousStatus || "Completed", // Revert to a safe status
                    refundRequest: admin.firestore.FieldValue.delete(),
                    paymongoRefundStatus: "failed",
                    paymongoRefundId: admin.firestore.FieldValue.delete(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`❌ Order ${orderRef.id} updated to: Refund Failed. Status reverted to ${orderData.previousStatus || 'Completed'}.`);
            } else {
                await orderRef.update({
                    paymongoRefundStatus: refundStatus, // e.g., 'pending'
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`ℹ️ Order ${orderRef.id} refund status updated to: ${refundStatus}.`);
            }
            
            return { statusCode: 200, body: `Refund event processed. Order ${orderRef.id} status: ${refundStatus}` };
        }


        // ===============================================
        // --- 4. Handle Other Events ---
        // ===============================================
        else if (eventType === "payment.failed" || eventType === "checkout_session.expired") {
            console.log(`Payment failed/expired. No action needed as order was never saved.`);
            return { statusCode: 200, body: "Event received. No pending order to clean." };
        }

        // Fallback for unhandled events
        return { statusCode: 200, body: "Event received, but no action taken" };

    } catch (error) {
        // 🔴 This catches unexpected runtime errors inside the handler
        console.error("🔴 Fatal error in webhook handler:", error.message, error.stack);
        return { statusCode: 500, body: "Internal Server Error" };
    }
};
