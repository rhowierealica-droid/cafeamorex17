// netlify/functions/webhook-listener.js
require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Firebase Admin once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}
const db = admin.firestore();

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    // Get event type correctly
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

      // Save to DeliveryOrders collection
      await db.collection("DeliveryOrders").add({
        userId: metadata.userId,
        customerName: metadata.customerName,
        address: metadata.address,
        queueNumber: metadata.queueNumber,
        orderType: "Delivery",
        items: metadata.orderItems,
        deliveryFee: metadata.deliveryFee,
        total: metadata.orderTotal,
        paymentMethod: "GCash",
        status: "Paid",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: payment.id
      });

      // Clear cart items if provided
      if (metadata.cartItemIds) {
        for (const cartItemId of metadata.cartItemIds) {
          await db.collection("Cart").doc(cartItemId).delete().catch(err => {
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
