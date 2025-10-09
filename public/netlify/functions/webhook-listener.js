require('dotenv').config();
const axios = require('axios');
const admin = require('firebase-admin');
const crypto = require('crypto');

// ---------------------
// Initialize Firebase Admin SDK
// ---------------------
let db;
try {
  const serviceAccount = require("./cafeamore-service-key.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  db = admin.firestore();
  console.log("✅ Firebase Admin SDK initialized.");
} catch (e) {
  console.error("⚠️ Firebase Admin SDK initialization failed:", e.message);
}

// ---------------------
// Netlify handler
// ---------------------
exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  let payload;

  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  // Verify signature
  try {
    const sigHeader = event.headers["paymongo-signature"] || "";
    if (WEBHOOK_SECRET && sigHeader) {
      const v1 = sigHeader.split(",").find(p => p.startsWith("v1="))?.replace("v1=", "");
      const expectedHash = crypto.createHmac("sha256", WEBHOOK_SECRET).update(event.body).digest("hex");
      if (v1 !== expectedHash) console.warn("⚠️ Signature mismatch");
    } else {
      console.warn("⚠️ Skipping signature verification (local test)");
    }
  } catch (err) {
    console.warn("⚠️ Signature verification failed:", err.message);
  }

  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  // -------------------- Refund Events --------------------
  if (eventType === "payment.refunded" || eventType === "payment.refund.updated") {
    // You can implement Firestore update logic here if needed
    console.log("💸 Refund event received:", dataObject?.id);
    return { statusCode: 200, body: JSON.stringify({ received: true, processedRefund: true }) };
  }

  // -------------------- Payment Paid --------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const orderItems = metadata.orderItems ? JSON.parse(metadata.orderItems) : [];
    const cartItemIds = metadata.cartItemIds ? JSON.parse(metadata.cartItemIds) : [];

    if (!metadata.userId || !metadata.queueNumber) return { statusCode: 400, body: "Missing metadata" };

    // Save order to Firestore
    const orderRef = await db.collection("DeliveryOrders").add({
      userId: metadata.userId,
      customerName: metadata.customerName || "",
      address: metadata.address || "",
      queueNumber: metadata.queueNumber,
      queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
      orderType: "Delivery",
      items: orderItems,
      deliveryFee: Number(metadata.deliveryFee) || 0,
      total: Number(metadata.orderTotal) || 0,
      paymentMethod: "E-Payment",
      status: "Pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      paymongoPaymentId: dataObject.id,
    });

    console.log("💾 Order saved with ID:", orderRef.id);

    // TODO: Deduct inventory, clear cart, etc.
    return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
