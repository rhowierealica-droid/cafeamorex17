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
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return null;
  }
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

    // CRITICAL: The signed payload is ONLY the raw request body
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
        
        // Get the orderId of the *existing* DeliveryOrder document
        const orderId = metadata.orderId || safeParse(metadata.orderId);

        if (!orderId) {
            console.error("❌ Missing orderId in metadata.");
            return { statusCode: 400, body: "Missing order ID for fulfillment" };
        }

        const orderRef = db.collection("DeliveryOrders").doc(orderId);
        const orderSnap = await orderRef.get();

        if (!orderSnap.exists) {
            console.error(`❌ Order document ${orderId} not found.`);
            return { statusCode: 404, body: "Order not found" };
        }

        const orderData = orderSnap.data();
        
        // Prevent double-processing
        if (orderData.status !== "Pending") {
            console.log(`ℹ️ Order ${orderId} already processed (Status: ${orderData.status}). Skipping.`);
            return { statusCode: 200, body: "Order already processed" };
        }

        // 1. Update Order Status
        await orderRef.update({
            status: "Paid/Confirmed", // New status for successfully paid orders
            paymentId: payment.id, // Save the PayMongo payment ID
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // 2. Perform Fulfillment Tasks
        const orderItems = orderData.items || [];
        const userId = orderData.userId;
        const cartItemIds = orderData.cartItemIds || []; // IDs of the cart items to delete
        
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

        console.log(`✅ Order ${orderId} successfully confirmed and fulfilled.`);

        return { statusCode: 200, body: "Success: Order paid and fulfilled" };
    }

    // --- Handle Failed/Expired Payments (Cleanup) ---
    if (eventType === "payment.failed" || eventType === "checkout_session.expired") {
        // Get the order ID from the payment object's metadata
        const orderId = payment?.attributes?.metadata?.orderId || safeParse(payment?.attributes?.metadata?.orderId);

        if (orderId) {
            console.log(`Payment failed/expired for order ${orderId}. Deleting pending order...`);
            // Delete the pending order since payment was unsuccessful
            await db.collection("DeliveryOrders").doc(orderId).delete();
        }
        return { statusCode: 200, body: "Payment failed/expired. Pending order cleaned up." };
    }

    // Fallback for unhandled events
    return { statusCode: 200, body: "Event received, but no action taken" };

  } catch (error) {
    console.error("🔴 Fatal error in webhook handler:", error);
    // Return a 200 to PayMongo to prevent retries if the error is due to bad data,
    // but log the error clearly. A 500 would signal PayMongo to retry.
    return { statusCode: 500, body: "Internal Server Error" };
  }
};
