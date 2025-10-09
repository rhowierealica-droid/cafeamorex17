// netlify/functions/webhook-listener.js

require('dotenv').config();
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

// Initialize Firebase Admin SDK (Use Netlify Environment Variables)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const firebaseApp = initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// --- HELPER FUNCTIONS ---

/**
 * Removes properties with null, undefined, or empty string values.
 * This is useful for cleaning up the data before saving to Firebase.
 * @param {object} obj - The object to clean.
 * @returns {object} The cleaned object.
 */
function cleanObject(obj) {
    const newObj = {};
    for (const key in obj) {
        if (obj[key] !== null && obj[key] !== undefined && obj[key] !== "") {
            newObj[key] = obj[key];
        }
    }
    return newObj;
}

/**
 * Deducts inventory based on the items in the order.
 * @param {Array} orderItems - The array of items from the order.
 */
async function deductInventory(orderItems) {
    const deductItem = async (id, amount) => {
        if (!id) return;
        const invRef = db.collection("Inventory").doc(id);
        const invSnap = await invRef.get();
        const invQty = invSnap.exists ? Number(invSnap.data().quantity || 0) : 0;
        await invRef.update({ quantity: Math.max(invQty - amount, 0) });
    };

    for (const item of orderItems) {
        // Deduct ingredients
        for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * item.qty);
        // Deduct other components
        for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * item.qty);
        // Deduct size component
        if (item.sizeId) await deductItem(item.sizeId, item.qty);
        // Deduct addons
        for (const addon of item.addons || []) await deductItem(addon.id, item.qty);
    }
}

/**
 * Clears the selected items from the user's cart.
 * @param {string} userId - The ID of the user.
 * @param {Array} cartItemIds - The IDs of the cart documents to delete.
 */
async function clearCartItems(userId, cartItemIds) {
    const cartRef = db.collection("users").doc(userId).collection("cart");
    const deletePromises = (cartItemIds || []).map(id => cartRef.doc(id).delete());
    await Promise.all(deletePromises);
}

// --- MAIN HANDLER ---

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // PayMongo Webhook Secret (Set as Netlify Environment Variable)
    const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
    
    // In a production environment, you should always verify the webhook signature.
    // However, for this simplified demonstration, we'll focus on the payload.
    // For a real-world implementation, look up PayMongo's webhook verification guide.
    /*
    const signature = event.headers['paymongo-signature'];
    if (!verifySignature(event.body, signature, PAYMONGO_WEBHOOK_SECRET)) {
        console.error("Webhook signature verification failed.");
        return { statusCode: 401, body: "Unauthorized" };
    }
    */

    try {
        const payload = JSON.parse(event.body);
        const eventType = payload.data.attributes.type;
        const data = payload.data.attributes.data;

        // We only care about successful payment events
        if (eventType === 'checkout_session.paid') {
            const status = data.attributes.status;
            const paymentIntentStatus = data.attributes.payment_intent.attributes.status;
            const metadata = data.attributes.metadata;

            // Only proceed if the payment was successful
            if (status === 'paid' && paymentIntentStatus === 'succeeded') {
                const fullOrderDataStr = metadata.fullOrderData;
                const cartItemIdsStr = metadata.cartItemIds;

                if (!fullOrderDataStr) {
                    console.error("Missing fullOrderData in metadata for paid session.");
                    return { statusCode: 400, body: "Order data missing." };
                }

                // --- 1. PARSE THE COMPLETE ORDER DATA ---
                const parsedOrderData = JSON.parse(fullOrderDataStr);
                const orderItems = parsedOrderData.items;
                const userId = parsedOrderData.userId;
                const queueNumber = parsedOrderData.queueNumber;
                
                // --- 2. CONSTRUCT FINAL FIREBASE DOCUMENT ---
                const finalOrderDoc = {
                    ...cleanObject(parsedOrderData),
                    // CRITICAL: Set the definitive status upon successful payment
                    status: "Pending", 
                    // CRITICAL: Use server timestamp for accuracy
                    createdAt: FieldValue.serverTimestamp(), 
                    // Add PayMongo specific IDs for reference
                    paymongoCheckoutId: data.id,
                    paymongoPaymentIntentId: data.attributes.payment_intent.id,
                };

                // --- 3. SAVE TO FIREBASE ---
                await db.collection("DeliveryOrders").add(finalOrderDoc);
                console.log(`Order #${queueNumber} successfully saved to Firebase (E-Payment).`);

                // --- 4. DEDUCT INVENTORY ---
                await deductInventory(orderItems);
                console.log(`Inventory deducted for Order #${queueNumber}.`);

                // --- 5. CLEAR CART ---
                const cartItemIds = JSON.parse(cartItemIdsStr || "[]");
                await clearCartItems(userId, cartItemIds);
                console.log(`Cart items cleared for User ${userId}.`);

                return { statusCode: 200, body: "Order processed successfully." };
            }
        }

        // Acknowledge receipt of other webhook events (e.g., checkout_session.failed, payment_intent.created)
        return { statusCode: 200, body: `Acknowledged event type: ${eventType}` };

    } catch (error) {
        console.error("Fatal Webhook Error:", error.message, error.stack);
        return { statusCode: 500, body: "Internal Server Error" };
    }
};
