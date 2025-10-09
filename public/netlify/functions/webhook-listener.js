// netlify/functions/webhook-listener.js

require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

//  Initialize Firebase Admin once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
  });
}
const db = admin.firestore();

// Helper: safely parse JSON fields (Handles case where PayMongo stringifies metadata)
function safeParse(value, fallback = null) {
  try {
    if (!value) return fallback;
    // Attempt to parse if it's a string, otherwise return the value or fallback
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

// Deduct inventory function (kept as is, assumes full order items are passed)
async function deductInventory(order) {
  const deductItem = async (id, amount) => {
    if (!id || !amount) return;
    const invRef = db.collection("Inventory").doc(id);
    // Use transaction for safer decrement if this was a production bottleneck, but basic update is fine for now
    await invRef.update({ 
        quantity: admin.firestore.FieldValue.increment(-Math.abs(amount)) // Use increment for atomicity
    }).catch(err => console.error(`⚠️ Failed to deduct ${amount} from item ${id}:`, err.message));
  };

  for (const item of order) {
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
    
    // PayMongo uses 'v1' for live mode, 'te' for test mode (or 'v1' sometimes)
    const signature = sigMap.v1 || sigMap.te;
    const timestamp = sigMap.t;
    
    if (!signature || !timestamp) {
        console.error("❌ Invalid signature header format:", sigHeader);
        return { statusCode: 400, body: "Invalid signature header format" };
    }

    // ⭐ CRITICAL FIX: The signed payload is ONLY the raw request body (event.body)
    const signedPayload = event.body; 
    
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(signedPayload, "utf8");
    const digest = hmac.digest("hex");

    if (digest !== signature) {
      console.error("❌ Invalid webhook signature. Expected:", digest, "Received:", signature);
      return { statusCode: 401, body: "Invalid signature" };
    }

    // Continue processing only if signature is valid
    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const payment = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);

    // --- Handle Successful Payment / Checkout Completion ---
    if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
      const metadata = payment?.attributes?.metadata || {};
      
      // PayMongo may stringify large metadata objects. Use safeParse on fields.
      const userId = safeParse(metadata.userId);
      const queueNumber = safeParse(metadata.queueNumber);
      const orderItems = safeParse(metadata.orderItems, []);
      const cartItemIds = safeParse(metadata.cartItemIds, []);

      // Check for critical data (assuming `orderItems` is the full item list now)
      if (!userId || !queueNumber || orderItems.length === 0) {
        console.error("❌ Missing required metadata (userId, queueNumber, or orderItems):", metadata);
        return { statusCode: 400, body: "Missing required order metadata for fulfillment" };
      }

      // --- Save Final Order ---
      const newOrderRef = await db.collection("DeliveryOrders").add({
        userId: userId,
        customerName: safeParse(metadata.customerName) || "",
        address: safeParse(metadata.address) || "",
        queueNumber: queueNumber,
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: Number(safeParse(metadata.deliveryFee) || 0),
        total: Number(safeParse(metadata.orderTotal) || 0),
        paymentMethod: "GCash", // Assuming GCash/E-Payment from checkout
        status: "Pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: payment.id,
      });

      console.log(`✅ Order ${newOrderRef.id} (#${queueNumber}) saved as Pending.`);

      // --- Deduct inventory ---
      await deductInventory(orderItems);
      console.log("✅ Inventory deducted.");

      // --- Clear Cart ---
      for (const cartItemId of cartItemIds) {
        await db
          .collection("users")
          .doc(userId)
          .collection("cart")
          .doc(cartItemId)
          .delete()
          .catch((err) => console.warn(`⚠️ Failed to delete cart item ${cartItemId}. Continuing.`, err));
      }
      console.log("✅ Cart cleared.");
    }
    
    // You should also handle other important events like:
    // "payment.failed" (for logging/reverting draft status)
    // "refund.succeeded" / "refund.failed" (for inventory return, as discussed previously)

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error("⚠️ Webhook handler error:", error);
    return { statusCode: 500, body: "Webhook handler failed" };
  }
};

// Helper: safely parse JSON fields (Moved to the top for consistency, but defined here)
// function safeParse(value, fallback = null) { ... }
