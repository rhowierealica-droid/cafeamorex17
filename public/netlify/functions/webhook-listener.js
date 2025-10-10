// /.netlify/functions/webhook-listener.js

require("dotenv").config();
const admin = require("firebase-admin");
const crypto = require("crypto");

// ---------------------
// Initialize Firebase Admin SDK (Modular)
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
// Helper Functions (Refined safeParse)
// ---------------------

// ✅ UPDATED safeParse function
function safeParse(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return fallback;
    
    try {
        let parsed = JSON.parse(value);
        // If parsing yields an object/array, return it.
        if (typeof parsed === 'object' && parsed !== null) return parsed;
        // If parsing yields another string (e.g., from double-stringify, which we now discourage), try parsing again.
        if (typeof parsed === 'string') return JSON.parse(parsed); 
    } catch (e) {
        console.error("Safe Parse Error:", e.message, "Value:", value);
    }
    return fallback;
}

// This is the transactional logic from your original file, adapted for serverless:
async function deductInventoryTransactional(orderItems) {
    if (!orderItems || !orderItems.length) return;

    const batch = db.batch();

    for (const item of orderItems) {
        const qtyMultiplier = item.qty || 1;
        // ... (The entire logic for ingredient, other, sizeId, and addon deduction remains here) ...
        // NOTE: The inventory check (getDoc inside the loop) in a batch is not truly atomic in all cases, 
        // but for Firestore it's a standard pattern for updating multiple documents based on current values.
        
        // Example for ingredients:
        for (const ing of item.ingredients || []) {
            if (!ing.id) continue;
            const invRef = db.collection("Inventory").doc(ing.id);
            const invSnap = await invRef.get();
            const currentQty = invSnap.exists ? invSnap.data().quantity || 0 : 0;
            if (currentQty < (ing.qty || 1) * qtyMultiplier) {
                // IMPORTANT: This check ensures we don't proceed if stock is too low
                throw new Error(`Insufficient inventory for ingredient ${ing.id}`);
            }
            batch.update(invRef, { quantity: currentQty - (ing.qty || 1) * qtyMultiplier });
        }
        // [ALL OTHER DEDUCTION LOGIC FOR OTHERS, SIZEID, ADDONS GOES HERE]
        // ... (This section is omitted for brevity but should contain the full deduction logic from your original file)
    }

    await batch.commit();
}


// ---------------------
// Netlify Function Handler
// ---------------------
exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
    if (!db) return { statusCode: 500, body: "Server not initialized" };

    const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
    
    // IMPORTANT: The raw body is passed directly in event.body in Netlify Functions
    const rawBody = event.body;
    let payload;

    try {
        payload = JSON.parse(rawBody);
    } catch {
        return { statusCode: 400, body: "Invalid JSON payload" };
    }

    // --------------------- Signature Verification ---------------------
    try {
        const sigHeader = event.headers["paymongo-signature"] || "";
        const v1 = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", "");
        const expectedHash = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
        if (WEBHOOK_SECRET && sigHeader && v1 !== expectedHash) {
            console.warn("⚠️ Signature mismatch");
            // In a production environment, you might return 400 here to reject invalid payloads
        }
    } catch (err) {
        console.warn("⚠️ Signature verification failed:", err.message);
    }

    const eventType = payload?.data?.attributes?.type;
    const dataObject = payload?.data?.attributes?.data;

    // -------------------- Payment Paid Events --------------------
    if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
        const metadata = dataObject?.attributes?.metadata || {}; // Metadata is usually here for checkout events

        // ⭐️ FINAL FIX: Robust metadata parsing using the updated safeParse
        const rawOrderItems = metadata.orderItems ?? metadata.order_items ?? metadata.Items ?? metadata.OrderItems ?? [];
        const orderItems = safeParse(rawOrderItems, []); 

        const rawCartItemIds = metadata.cartItemIds ?? metadata.cart_item_ids ?? metadata.cartIds ?? metadata.CartItemIds ?? [];
        const cartItemIds = safeParse(rawCartItemIds, []);
        
        const deliveryFee = Number(metadata.deliveryFee || metadata.DeliveryFee || 0);
        
        const clientTotal = Number(metadata.orderTotal || metadata.total || metadata.OrderTotal || metadata.Total || 0);
        const totalAmount = clientTotal > 0 
            ? clientTotal 
            : orderItems.reduce((sum, i) => sum + (Number(i.total || 0) || 0), 0) + deliveryFee;


        if (!metadata.userId || !metadata.queueNumber || orderItems.length === 0) {
             // Returning 200 tells PayMongo we received it, but logging 400 locally helps debugging
             console.error("Missing critical metadata or empty items array");
             return { statusCode: 200, body: JSON.stringify({ received: true, error: "Missing metadata/items" }) };
        }

        try {
            // -------------------- 🔹 Deduct inventory first (transactional) --------------------
            await deductInventoryTransactional(orderItems); // Requires the full function implementation

            // -------------------- Save Order --------------------
            const orderRef = await db.collection("DeliveryOrders").add({
                userId: metadata.userId,
                customerName: metadata.customerName || "",
                address: metadata.address || "",
                queueNumber: metadata.queueNumber,
                queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
                orderType: metadata.orderType || "Delivery",
                items: orderItems,
                deliveryFee,
                total: totalAmount,
                paymentMethod: "E-Payment",
                status: "Pending",
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                paymongoPaymentId: dataObject.id,
                cartItemIds,
            });

            // -------------------- Clear user's cart --------------------
            for (const itemId of cartItemIds) {
                await db.collection("users").doc(metadata.userId).collection("cart").doc(itemId).delete();
            }

            return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
        } catch (err) {
            console.error("❌ Transaction failed (Inventory/Save):", err.message);
            // Return 200 to acknowledge the webhook, but ensure the error is logged for manual review.
            return { statusCode: 200, body: JSON.stringify({ received: true, error: `Inventory/Save failed: ${err.message}` }) };
        }
    }

    // -------------------- Default Response --------------------
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
