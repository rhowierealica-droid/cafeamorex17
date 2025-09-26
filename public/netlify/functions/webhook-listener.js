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
    // ✅ Load secret from environment
    const webhookSecret = process.env.WEBHOOK_SECRET_KEY;
    if (!webhookSecret) {
      console.error("❌ Missing WEBHOOK_SECRET_KEY in environment variables");
      return { statusCode: 500, body: "Server misconfigured" };
    }

    // 🔒 Verify PayMongo signature
    const sigHeader = event.headers["paymongo-signature"];
    if (!sigHeader) {
      console.error("❌ Missing PayMongo signature header");
      return { statusCode: 400, body: "Missing signature header" };
    }

    const sigParts = sigHeader.split(",");
    const sigMap = {};
    sigParts.forEach((p) => {
      const [k, v] = p.split("=");
      sigMap[k] = v;
    });

    const signature = sigMap.te || sigMap.v1;
    const timestamp = sigMap.t;
    if (!signature || !timestamp) {
      console.error("❌ Could not extract signature/timestamp from header:", sigHeader);
      return { statusCode: 400, body: "Invalid signature header format" };
    }

    // ✅ Build signed payload and compute HMAC
    const signedPayload = `${timestamp}.${event.body}`;
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(signedPayload, "utf8");
    const digest = hmac.digest("hex");

    if (digest !== signature) {
      console.error("❌ Invalid webhook signature.", { expected: signature, got: digest });
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

      // 💾 Save order in Firestore like COD
      await db.collection("DeliveryOrders").add({
        userId: metadata.userId,
        customerName: metadata.customerName || metadata.email || "Customer",
        address: metadata.address || "",
        queueNumber: metadata.queueNumber,
        orderType: "Delivery",
        items: safeParse(metadata.orderItems, []),
        deliveryFee: parseFloat(metadata.deliveryFee) || 0,
        total: parseFloat(metadata.orderTotal) || 0,
        paymentMethod: "GCash",
        status: "Pending", // ✅ same as COD
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
            .catch((err) => console.error(`❌ Failed to delete cart item ${cartItemId}`, err));
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
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}
