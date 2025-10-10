// /.netlify/functions/webhook-listener.js
require("dotenv").config();
const admin = require("firebase-admin");
const crypto = require("crypto");

// ---------------------
// 1. Initialize Firebase Admin SDK
// ---------------------
let db;
try {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (serviceAccountKey) {
        const serviceAccount = JSON.parse(serviceAccountKey);
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
            });
        }
        db = admin.firestore();
    }
} catch (e) {
    console.error("⚠️ Firebase Admin SDK initialization failed:", e.message);
}

// ---------------------
// 2. Helper Functions
// ---------------------
function safeParse(value, fallback = []) {
    if (Array.isArray(value) && value.length > 0) return value;
    if (!value) return fallback;

    let result = value;
    try { result = JSON.parse(result); } catch {}
    if (typeof result === "string") {
        try { result = JSON.parse(result); } catch {}
    }
    return Array.isArray(result) ? result : (typeof result === 'object' && result !== null ? result : fallback);
}

async function fetchOrderItemsFromCart(userId, cartItemIds) {
    if (!userId || !cartItemIds || cartItemIds.length === 0) return [];
    const itemPromises = cartItemIds.map(id => 
        db.collection("users").doc(userId).collection("cart").doc(id).get()
    );
    const itemSnaps = await Promise.all(itemPromises);
    const items = itemSnaps
        .filter(snap => snap.exists)
        .map(snap => ({ id: snap.id, ...snap.data() }));
    return items;
}

async function deductInventoryTransactional(orderItems) {
    if (!orderItems || !orderItems.length) return;
    const batch = db.batch();

    for (const item of orderItems) {
        if (!item || !item.product) continue;
        const qtyMultiplier = item.qty || 1;

        // Deduct Ingredients
        for (const ing of item.ingredients || []) {
            if (!ing.id) continue;
            const invRef = db.collection("Inventory").doc(ing.id);
            const invSnap = await invRef.get();
            const currentQty = invSnap.exists ? invSnap.data().quantity || 0 : 0;
            if (currentQty < (ing.qty || 1) * qtyMultiplier) {
                throw new Error(`Insufficient inventory for ingredient ${ing.id}`);
            }
            batch.update(invRef, { quantity: currentQty - (ing.qty || 1) * qtyMultiplier });
        }

        // Deduct Other Components
        for (const other of item.others || []) {
            if (!other.id) continue;
            const invRef = db.collection("Inventory").doc(other.id);
            const invSnap = await invRef.get();
            const currentQty = invSnap.exists ? invSnap.data().quantity || 0 : 0;
            if (currentQty < (other.qty || 1) * qtyMultiplier) {
                throw new Error(`Insufficient inventory for other component ${other.id}`);
            }
            batch.update(invRef, { quantity: currentQty - (other.qty || 1) * qtyMultiplier });
        }

        // Deduct Size Variant
        if (item.sizeId) {
            const sizeRef = db.collection("Inventory").doc(item.sizeId);
            const sizeSnap = await sizeRef.get();
            const currentQty = sizeSnap.exists ? sizeSnap.data().quantity || 0 : 0;
            if (currentQty < qtyMultiplier) {
                throw new Error(`Insufficient inventory for size ${item.sizeId}`);
            }
            batch.update(sizeRef, { quantity: currentQty - qtyMultiplier });
        }

        // Deduct Add-ons
        for (const addon of item.addons || []) {
            if (!addon.id) continue;
            const addonRef = db.collection("Inventory").doc(addon.id);
            const addonSnap = await addonRef.get();
            const currentQty = addonSnap.exists ? addonSnap.data().quantity || 0 : 0;
            if (currentQty < qtyMultiplier) {
                throw new Error(`Insufficient inventory for addon ${addon.id}`);
            }
            batch.update(addonRef, { quantity: currentQty - qtyMultiplier });
        }
    }

    await batch.commit();
}

// ---------------------
// 3. Netlify Function Handler
// ---------------------
exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!db) return { statusCode: 500, body: "Server not initialized" };

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    const rawBody = event.body;
    let payload;

    try {
        payload = JSON.parse(rawBody);
    } catch {
        return { statusCode: 400, body: "Invalid JSON payload" };
    }

    // Signature verification
    try {
        const sigHeader = event.headers["paymongo-signature"] || "";
        const v1 = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", "");
        const expectedHash = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
        if (WEBHOOK_SECRET && sigHeader && v1 !== expectedHash) {
            console.warn("⚠️ Signature mismatch");
        }
    } catch (err) {
        console.warn("⚠️ Signature verification failed:", err.message);
    }

    const eventType = payload?.data?.attributes?.type;
    const dataObject = payload?.data?.attributes?.data;

    // Handle refunds
    if (eventType === "payment.refunded" || eventType === "payment.refund.updated") {
        return { statusCode: 200, body: JSON.stringify({ received: true, processedRefund: true }) };
    }

    // Payment events
    if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
        const metadata = dataObject?.attributes?.metadata || {};
        const userId = metadata.userId;

        const rawCartItemIds = metadata.cartItemIds ?? metadata.CartItemIds ?? metadata.cartIds ?? metadata.CartItemIds ?? [];
        const cartItemIds = safeParse(rawCartItemIds, []);

        // Try fetching from Firestore first
        let orderItems = await fetchOrderItemsFromCart(userId, cartItemIds);

        // FALLBACK: use metadata.orderItems if cart is empty
        if (!orderItems.length && metadata.orderItems) {
            orderItems = safeParse(metadata.orderItems, []);
            console.log("⚠️ Using fallback metadata.orderItems for empty cart");
        }

        const deliveryFee = Number(metadata.deliveryFee || metadata.DeliveryFee || 0);
        const calculatedTotal = orderItems.reduce((sum, i) => sum + Number(i.total || 0), 0) + deliveryFee;
        const totalAmount = calculatedTotal > 0 ? calculatedTotal : Number(metadata.orderTotal || metadata.total || 0);

        if (!userId || !metadata.queueNumber || !orderItems.length) {
            console.error(`Missing metadata or orderItems empty. User: ${userId}, Queue: ${metadata.queueNumber}, Cart IDs: ${cartItemIds.length}`);
            return { statusCode: 200, body: JSON.stringify({ received: true, error: "Missing metadata/fetched items" }) };
        }

        try {
            await deductInventoryTransactional(orderItems);

            const orderRef = await db.collection("DeliveryOrders").add({
                userId,
                customerName: metadata.customerName || "",
                customerEmail: metadata.customerEmail || "",
                address: metadata.address || "",
                queueNumber: metadata.queueNumber,
                queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
                orderType: metadata.orderType || "Delivery",
                items: orderItems, // always non-empty
                deliveryFee,
                total: totalAmount,
                paymentMethod: "E-Payment",
                status: "Pending",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                paymongoPaymentId: dataObject.id,
                cartItemIds,
            });

            // Clear user's cart AFTER saving order
            for (const itemId of cartItemIds) {
                await db.collection("users").doc(userId).collection("cart").doc(itemId).delete();
            }

            return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
        } catch (err) {
            console.error("❌ Transaction failed:", err.message);
            return { statusCode: 200, body: JSON.stringify({ received: true, error: `Inventory/Save failed: ${err.message}` }) };
        }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
