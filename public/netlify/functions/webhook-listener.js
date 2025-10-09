// ===============================================
// --- netlify/functions/webhook-listener.js ---
// ===============================================

require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

let db;
try {
    // 🚨 CRITICAL: Attempt JSON parsing and Admin initialization first
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
    // 🔴 If this logs, the JSON formatting is still wrong, or the key is missing.
    console.error("❌ FIREBASE ADMIN INIT FAILED:", e.message); 
    
    // Set a handler that immediately returns a server error and stops execution
    exports.handler = async () => ({
        statusCode: 500,
        body: `Firebase Initialization Failed: ${e.message}`,
    });
    // Throw error to prevent the rest of the file from trying to run
    throw new Error("Firebase Admin failed to initialize."); 
}

// Helper: safely parse JSON fields (Handles case where PayMongo stringifies metadata)
function safeParse(value) {
    try {
        if (!value) return null;
        let parsedValue = typeof value === "string" ? JSON.parse(value) : value;
        if (typeof parsedValue === "string") parsedValue = JSON.parse(parsedValue);
        return parsedValue;
    } catch (e) {
        console.warn("⚠️ safeParse failed on value:", value, "Error:", e.message);
        return null;
    }
}

// Helper: Remove null/undefined/empty string fields before saving
function cleanObject(obj) {
    const cleaned = {};
    for (const key in obj) {
        const value = obj[key];
        // Only include values that are not null, undefined, and not an empty string
        if (value !== null && value !== undefined && value !== "") {
            cleaned[key] = value;
        }
    }
    return cleaned;
}

// Deduct inventory function
async function deductInventory(orderItems) {
    const deductItem = async (id, amount) => {
        if (!id || !amount) return;
        const invRef = db.collection("Inventory").doc(id);
        // Use FieldValue.increment to atomically decrease inventory
        await invRef.update({ 
            quantity: admin.firestore.FieldValue.increment(-Math.abs(amount))
        }).catch(err => console.error(`⚠️ Failed to deduct ${amount} from item ${id}:`, err.message));
    };

    for (const item of orderItems) {
        // Ensure we are using the correct quantity field name 'qty'
        const itemQty = Number(item.qty || 1); 
        for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * itemQty);
        for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * itemQty);
        if (item.sizeId) await deductItem(item.sizeId, itemQty);
        for (const addon of item.addons || []) await deductItem(addon.id, itemQty);
    }
}

exports.handler = async (event, context) => {
    // 🚨 NEW LOG 1: Confirm function STARTED (If you see this, Firebase Init passed)
    console.log("--- Webhook Handler Started ---"); 
    
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const webhookSecret = process.env.WEBHOOK_SECRET_KEY;
        if (!webhookSecret) {
            console.error("❌ Missing WEBHOOK_SECRET_KEY");
            return { statusCode: 500, body: "Server misconfigured" };
        }

        // --- 1. Signature Verification ---
        const sigHeader = event.headers["paymongo-signature"];
        if (!sigHeader) return { statusCode: 400, body: "Missing signature header" };

        const sigParts = sigHeader.split(",");
        const sigMap = {};
        sigParts.forEach((p) => { const [k, v] = p.split("="); sigMap[k] = v; });
        
        const signature = sigMap.v1 || sigMap.te;
        const timestamp = sigMap.t;
        
        if (!signature || !timestamp) {
            console.error("❌ Invalid signature header format:", sigHeader);
            return { statusCode: 400, body: "Invalid signature header format" };
        }

        const signedPayload = event.body; 
        
        const hmac = crypto.createHmac("sha256", webhookSecret);
        hmac.update(signedPayload, "utf8");
        const digest = hmac.digest("hex");

        if (digest !== signature) {
            console.error("❌ Invalid webhook signature. Expected:", digest, "Received:", signature);
            return { statusCode: 401, body: "Invalid signature" };
        }
        
        // --- Timestamp Verification against replay attacks ---
        const currentTimeInSeconds = Math.floor(Date.now() / 1000);
        const signatureTimeInSeconds = Number(timestamp);
        const tolerance = 300; // 5 minutes (300 seconds)

        if (Math.abs(currentTimeInSeconds - signatureTimeInSeconds) > tolerance) {
            console.error("❌ Webhook timestamp too old/new (Replay attack?):", signatureTimeInSeconds, "Current:", currentTimeInSeconds);
            return { statusCode: 401, body: "Invalid or expired signature timestamp" };
        }
        
        // Signature valid, continue processing
        const body = JSON.parse(event.body);
        const eventType = body.data?.attributes?.type;
        const payment = body.data?.attributes?.data;

        console.log("🔔 PayMongo Webhook Event:", eventType);
        console.log("DEBUG: PayMongo Data ID:", payment?.id || "N/A"); // 🚨 New Log
        
        // --- 2. Handle Successful Payment / Checkout Completion ---
        if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
            const metadata = payment?.attributes?.metadata || {};
            
            // Retrieve the full order data payload from the metadata
            const initialOrderData = safeParse(metadata.fullOrderData);
            
            console.log("DEBUG: Parsed initialOrderData (first 500 chars):", JSON.stringify(initialOrderData, null, 2).substring(0, 500) + "...");

            // 🛑 STRONGER VALIDATION: Check for the presence of crucial fields
            if (
                !initialOrderData || 
                !initialOrderData.userId || 
                !initialOrderData.queueNumber ||
                !Array.isArray(initialOrderData.items) ||
                initialOrderData.items.length === 0
            ) {
                console.error(
                    "❌ Missing required order data in metadata or items array is empty. Aborting save.", 
                    {
                        userId: initialOrderData?.userId,
                        queueNumber: initialOrderData?.queueNumber,
                        itemsCount: initialOrderData?.items?.length,
                        rawMetadata: metadata
                    }
                );
                return { statusCode: 400, body: "Missing required order data for saving" };
            }

            // 🚨 NEW LOG 3: Confirm data is validated
            console.log("DEBUG: Data validation passed, preparing order object.");
            
            // Calculate net amount (total paid in centavos - fee in centavos)
            const totalAmount = payment?.attributes?.amount ?? 0;
            const fee = payment?.attributes?.fee ?? 0;
            const netAmountInCentavos = totalAmount - fee;
            const paymongoNetAmount = netAmountInCentavos / 100; // Convert to PHP
            
            // 1. Construct the final data for Firebase with explicit mapping
            const orderToSave = {
                // Data pulled explicitly from the metadata (the client's order data)
                userId: initialOrderData.userId,
                customerName: initialOrderData.customerName || "",
                address: initialOrderData.address || "",
                queueNumber: initialOrderData.queueNumber,
                queueNumberNumeric: Number(initialOrderData.queueNumberNumeric) || 0,
                orderType: initialOrderData.orderType || "Delivery",
                items: initialOrderData.items || [], 
                deliveryFee: Number(initialOrderData.deliveryFee) || 0,
                total: Number(initialOrderData.total) || 0, 
                cartItemIds: initialOrderData.cartItemIds || [],
                estimatedTime: initialOrderData.estimatedTime || "",
                
                // Overridden/Added fields
                paymentMethod: "E-Payment",
                status: "Pending", 
                
                // PayMongo details
                paymongoPaymentId: payment.id,
                paymongoNetAmount: paymongoNetAmount,
                
                // Timestamps
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            // 2. Clean the object (removes empty strings like address: "")
            const cleanedOrderToSave = cleanObject(orderToSave);

            // 🚨 NEW LOG 4: Confirm we are about to save
            console.log("DEBUG: Attempting to save to DeliveryOrders.");

            // 3. Save Order to Firebase (CREATE the document)
            const newOrderRef = await db.collection("DeliveryOrders").add(cleanedOrderToSave);
            const orderId = newOrderRef.id;

            console.log(`✅ Order ${orderId} saved to Firebase with status: Pending.`);

            // 4. Perform Fulfillment Tasks
            const orderItems = initialOrderData.items || [];
            const userId = initialOrderData.userId;
            const cartItemIds = safeParse(metadata.cartItemIds) || []; 
            
            if (orderItems.length > 0) {
                console.log(`Deducting inventory for Order ${orderId}...`);
                await deductInventory(orderItems); 
            }

            if (userId && cartItemIds.length > 0) {
                console.log(`Clearing ${cartItemIds.length} cart items for user ${userId}...`);
                const batch = db.batch();
                const userCartRef = db.collection("users").doc(userId).collection("cart");
                cartItemIds.forEach(itemId => {
                    batch.delete(userCartRef.doc(itemId));
                });
                await batch.commit();
            }

            console.log(`✅ Fulfillment for Order ${orderId} complete.`);

            return { statusCode: 200, body: "Success: Order paid, saved, and fulfilled" };
        }

        // --- 3. Handle Failed/Expired Payments (No Action Needed) ---
        if (eventType === "payment.failed" || eventType === "checkout_session.expired") {
            console.log(`Payment failed/expired. No action needed as order was not saved.`);
            return { statusCode: 200, body: "Event received. No pending order to clean." };
        }

        // Fallback for unhandled events
        return { statusCode: 200, body: "Event received, but no action taken" };

    } catch (error) {
        // 🔴 If this logs, the crash happened inside the handler (after Firebase Init)
        console.error("🔴 Fatal error in webhook handler:", error.message, error.stack); 
        return { statusCode: 500, body: "Internal Server Error" };
    }
};
