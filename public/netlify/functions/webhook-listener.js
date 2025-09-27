// netlify/functions/webhook-listener.js
require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

// ✅ Initialize Firebase Admin once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
  });
}
const db = admin.firestore();

// Deduct inventory function
async function deductInventory(order) {
  const deductItem = async (id, amount) => {
    if (!id) return;
    const invRef = db.collection("Inventory").doc(id);
    const invSnap = await invRef.get();
    const invQty = invSnap.exists ? Number(invSnap.data().quantity || 0) : 0;
    await invRef.update({ quantity: Math.max(invQty - amount, 0) });
  };

  for (const item of order) {
    for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * item.qty);
    for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * item.qty);
    if (item.sizeId) await deductItem(item.sizeId, item.qty);
    for (const addon of item.addons || []) await deductItem(addon.id, item.qty);
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
    const signature = sigMap.te || sigMap.v1;
    const timestamp = sigMap.t;
    if (!signature || !timestamp) return { statusCode: 400, body: "Invalid signature header format" };

    const signedPayload = `${timestamp}.${event.body}`;
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(signedPayload, "utf8");
    const digest = hmac.digest("hex");

    if (digest !== signature) {
      console.error("❌ Invalid webhook signature.");
      return { statusCode: 401, body: "Invalid signature" };
    }

    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const payment = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);

    if (eventType === "payment.paid") {
      const metadata = payment?.attributes?.metadata || {};
      console.log("📦 Metadata received:", metadata);

      if (!metadata.userId || !metadata.queueNumber) {
        console.error("❌ Missing required metadata:", metadata);
        return { statusCode: 400, body: "Missing metadata" };
      }

      // Parse orderItems safely (stringified)
      const orderItems = safeParse(metadata.orderItems, []);
      console.log("📦 Parsed orderItems:", orderItems);

      // Save order in Firestore as Pending
      await db.collection("DeliveryOrders").add({
        userId: metadata.userId,
        customerName: metadata.customerName || "",
        address: metadata.address || "",
        queueNumber: metadata.queueNumber,
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: Number(metadata.deliveryFee) || 0,
        total: Number(metadata.orderTotal) || 0,
        paymentMethod: "GCash",
        status: "Pending", // ✅ now uses Pending
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: payment.id,
      });

      // Deduct inventory immediately
      await deductInventory(orderItems);

      // Clear user's cart
      const cartItemIds = Array.isArray(metadata.cartItemIds) ? metadata.cartItemIds : [];
      for (const cartItemId of cartItemIds) {
        await db
          .collection("users")
          .doc(metadata.userId)
          .collection("cart")
          .doc(cartItemId)
          .delete()
          .catch((err) => console.error(`❌ Failed to delete cart item ${cartItemId}`, err));
      }

      console.log(`✅ Order #${metadata.queueNumber} saved as Pending and inventory deducted.`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error("⚠️ Webhook handler error:", error);
    return { statusCode: 500, body: "Webhook handler failed" };
  }
};

// Helper: safely parse JSON fields
function safeParse(value, fallback) {
  try {
    if (!value) return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}
