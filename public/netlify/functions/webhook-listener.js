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

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const webhookSecret = process.env.webhook_SECRET_KEY;
    if (!webhookSecret) {
      console.error("❌ Missing webhook_SECRET_KEY in environment variables");
      return { statusCode: 500, body: "Server misconfigured" };
    }

    // 🔒 Verify PayMongo signature
    const signature = event.headers["paymongo-signature"];
    if (!signature) {
      console.error("❌ Missing PayMongo signature header");
      return { statusCode: 400, body: "Missing signature header" };
    }

    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(event.body, "utf8");
    const digest = hmac.digest("hex");

    if (digest !== signature) {
      console.error("❌ Invalid webhook signature");
      return { statusCode: 401, body: "Invalid signature" };
    }

    // ✅ Parse webhook body
    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const payment = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);

    if (eventType === "payment.paid") {
      const metadata = payment?.attributes?.metadata || {};

      if (!metadata.userId || !metadata.queueNumber) {
        console.error("❌ Missing required metadata:", metadata);
        return { statusCode: 400, body: "Missing metadata" };
      }

      console.log(`✅ Payment confirmed for Order #${metadata.queueNumber}`);

      // 💾 Save order in Firestore
      await db.collection("DeliveryOrders").add({
        userId: metadata.userId,
        customerName: metadata.customerName || "",
        address: metadata.address || "",
        queueNumber: metadata.queueNumber,
        orderType: "Delivery",
        items: safeParse(metadata.orderItems, []),
        deliveryFee: parseInt(metadata.deliveryFee) || 0,
        total: parseInt(metadata.orderTotal) || 0,
        paymentMethod: "GCash",
        status: "Paid",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: payment.id,
      });

      // 🗑 Clear cart items if provided
      const cartItemIds = safeParse(metadata.cartItemIds, []);
      if (Array.isArray(cartItemIds)) {
        for (const cartItemId of cartItemIds) {
          await db
            .collection("Cart")
            .doc(cartItemId)
            .delete()
            .catch((err) => {
              console.error(`❌ Failed to delete cart item ${cartItemId}`, err);
            });
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error("⚠️ Webhook handler error:", error);
    return { statusCode: 500, body: "Webhook handler failed" };
  }
};

// ✅ Helper: safely parse JSON fields
function safeParse(value, fallback) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
