require('dotenv').config();
const axios = require('axios');
const admin = require('firebase-admin');
const crypto = require('crypto');

// ---------------------
// Initialize Firebase Admin SDK
// ---------------------
let db;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  db = admin.firestore();
  console.log("✅ Firebase Admin SDK initialized.");
} catch (e) {
  console.error("⚠️ Firebase Admin SDK initialization failed:", e.message);
}

// ---------------------
// Helper Functions
// ---------------------
function safeParse(value, fallback = []) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value || fallback;
  } catch {
    return fallback;
  }
}

// ---------------------
// Netlify Function Handler
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

  // --------------------- Signature Verification ---------------------
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
    console.log("💸 Refund event received:", dataObject?.id);

    // Optional: update Firestore order status if needed
    if (db && dataObject?.attributes?.payment_id) {
      const paymentId = dataObject.attributes.payment_id;
      const deliveryOrdersRef = db.collection("DeliveryOrders");
      const snapshot = await deliveryOrdersRef.where("paymongoPaymentId", "==", paymentId).limit(1).get();
      if (!snapshot.empty) {
        const orderRef = snapshot.docs[0].ref;
        await orderRef.update({ status: "Refunded", paymongoRefundId: dataObject.id });
        console.log(`✅ Updated order ${orderRef.id} status to Refunded`);
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true, processedRefund: true }) };
  }

  // -------------------- Payment Paid Events --------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const orderItems = safeParse(metadata.orderItems);
    const cartItemIds = safeParse(metadata.cartItemIds);

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

    // TODO: Deduct inventory and clear cart here if needed

    return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
  }

  // -------------------- Default Response --------------------
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
