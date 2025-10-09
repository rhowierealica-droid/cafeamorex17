// netlify/functions/webhook-listener.js

require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

// Initialize Firebase Admin once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
  });
}
const db = admin.firestore();

// Helper: safely parse JSON fields (Handles case where PayMongo stringifies metadata)
function safeParse(value) {
  try {
    if (!value) return null;
    // PayMongo often double-stringifies complex metadata objects
    let parsedValue = typeof value === "string" ? JSON.parse(value) : value;
    // Attempt a second parse for complex objects like fullOrderData
    if (typeof parsedValue === "string") parsedValue = JSON.parse(parsedValue);
    return parsedValue;
  } catch {
    return null;
  }
}

// Deduct inventory function (kept unchanged, but simplified for clarity)
async function deductInventory(orderItems) {
  const deductItem = async (id, amount) => {
    if (!id || !amount) return;
    const invRef = db.collection("Inventory").doc(id);
    await invRef.update({ 
        quantity: admin.firestore.FieldValue.increment(-Math.abs(amount))
    }).catch(err => console.error(`⚠️ Failed to deduct ${amount} from item ${id}:`, err.message));
  };

  for (const item of orderItems) {
    const itemQty = Number(item.qty || 1);
    for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * itemQty);
    for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * itemQty);
    if (item.sizeId) await deductItem(item.sizeId, itemQty);
    for (const addon of item.addons || []) await deductItem(addon.id, itemQty);
  }
}

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const webhookSecret = process.env.WEBHOOK_SECRET_KEY;
    if (!webhookSecret) {
      console.error("❌ Missing WEBHOOK_SECRET_KEY");
      return { statusCode: 500, body: "Server misconfigured" };
    }

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

    // Signature valid, continue processing
    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const payment = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);

    // --- Handle Successful Payment / Checkout Completion ---
    if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
        const metadata = payment?.attributes?.metadata || {};
        
        // 💡 CRITICAL CHANGE: Retrieve the full order data payload
        const finalOrderData = safeParse(metadata.fullOrderData);

        if (!finalOrderData || !finalOrderData.userId || !finalOrderData.items) {
            console.error("❌ Missing or invalid fullOrderData in metadata.", metadata);
            return { statusCode: 400, body: "Missing required order data for saving" };
        }
        
        // 1. Prepare data for Firebase save
        // We override the status to "Pending" as requested, regardless of what the client sent.
        const orderToSave = {
            ...finalOrderData,
            status: "Pending", // 🎯 SET FINAL STATUS TO "Pending"
            paymentId: payment.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // 2. Save Order to Firebase (CREATE the document)
        const newOrderRef = await db.collection("DeliveryOrders").add(orderToSave);
        const orderId = newOrderRef.id;

        console.log(`✅ Order ${orderId} saved to Firebase with status: Pending.`);

        // 3. Perform Fulfillment Tasks
        const orderItems = finalOrderData.items || [];
        const userId = finalOrderData.userId;
        const cartItemIds = finalOrderData.cartItemIds || [];
        
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

    // --- Handle Failed/Expired Payments (Cleanup) ---
    // 💡 This section is NO LONGER NEEDED in the new flow! 
    // Since the order is never saved before payment, there's nothing to clean up.
    if (eventType === "payment.failed" || eventType === "checkout_session.expired") {
        console.log(`Payment failed/expired. No action needed as order was not saved.`);
        return { statusCode: 200, body: "Event received. No pending order to clean." };
    }

    // Fallback for unhandled events
    return { statusCode: 200, body: "Event received, but no action taken" };

  } catch (error) {
    console.error("🔴 Fatal error in webhook handler:", error);
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
