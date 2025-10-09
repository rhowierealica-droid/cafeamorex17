// ===============================
// webhook.js (Netlify Function)
// ===============================
require('dotenv').config();
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
// ⭐ FIX: This function is updated to handle potential double-stringification from PayMongo metadata
function safeParse(value, fallback = []) {
  try {
    let parsed = typeof value === 'string' ? JSON.parse(value) : value || fallback;
    
    // If the first parse results in a string (due to double-stringification), try parsing again
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed);
    }

    return parsed;
  } catch (e) {
    console.error("Safe Parse Error:", e.message, "Value:", value);
    return fallback;
  }
}

// ---------------------
// 🔹 Deduct inventory function
// ---------------------
async function deductInventory(orderItems) {
  if (!orderItems || !orderItems.length) return;
  const batch = db.batch();

  for (const item of orderItems) {
    // Ingredients
    for (const ing of item.ingredients || []) {
      if (ing.id) {
        const invRef = db.collection("Inventory").doc(ing.id);
        batch.update(invRef, { quantity: Math.max((ing.currentQty || 0) - (ing.qty || 1) * (item.qty || 1), 0) });
      }
    }
    // Other components
    for (const other of item.others || []) {
      if (other.id) {
        const invRef = db.collection("Inventory").doc(other.id);
        batch.update(invRef, { quantity: Math.max((other.currentQty || 0) - (other.qty || 1) * (item.qty || 1), 0) });
      }
    }
    // Size
    if (item.sizeId) {
      const sizeRef = db.collection("Inventory").doc(item.sizeId);
      batch.update(sizeRef, { quantity: Math.max((item.sizeQty || 0) - (item.qty || 1), 0) });
    }
    // Addons
    for (const addon of item.addons || []) {
      if (addon.id) {
        const addonRef = db.collection("Inventory").doc(addon.id);
        batch.update(addonRef, { quantity: Math.max((addon.currentQty || 0) - (item.qty || 1), 0) });
      }
    }
  }

  await batch.commit();
}

// ---------------------
// Netlify Function Handler
// ---------------------
exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

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
      console.warn("⚠️ Skipping signature verification (local/test)");
    }
  } catch (err) {
    console.warn("⚠️ Signature verification failed:", err.message);
  }

  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  // -------------------- Refund Events --------------------
  if (eventType === "payment.refunded" || eventType === "payment.refund.updated") {
    console.log("💸 Refund event received:", dataObject?.id);

    if (db && dataObject?.attributes?.payment_id) {
      const paymentId = dataObject.attributes.payment_id;
      const snapshot = await db.collection("DeliveryOrders")
        .where("paymongoPaymentId", "==", paymentId)
        .limit(1)
        .get();

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

    // -------------------- 🔹 Parse arrays/objects --------------------
    // ⭐ FIX APPLIED HERE: safeParse now correctly handles the stringified JSON array
    const orderItems = safeParse(metadata.items);        
    const cartItemIds = safeParse(metadata.cartItemIds); 

    const deliveryFee = Number(metadata.deliveryFee || 0);
    const totalAmount = Number(metadata.total || 0) || 
      orderItems.reduce((sum, i) => sum + (Number(i.total || 0) || 0), 0) + deliveryFee;

    if (!metadata.userId || !metadata.queueNumber) {
      return { statusCode: 400, body: "Missing metadata" };
    }

    // -------------------- Save Order --------------------
    const orderRef = await db.collection("DeliveryOrders").add({
      userId: metadata.userId,
      customerName: metadata.customerName || "",
      customerEmail: metadata.customerEmail || "",
      address: metadata.address || "",
      queueNumber: metadata.queueNumber,
      queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
      orderType: metadata.orderType || "Delivery",
      items: orderItems,
      deliveryFee,
      total: totalAmount,
      paymentMethod: "E-Payment",
      status: "Pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      paymongoPaymentId: dataObject.id,
      cartItemIds
    });

    console.log("💾 Order saved with ID:", orderRef.id);

    // -------------------- 🔹 Deduct inventory --------------------
    await deductInventory(orderItems);

    // -------------------- 🔹 Clear user's cart --------------------
    for (const itemId of cartItemIds) {
      await db.collection("users").doc(metadata.userId).collection("cart").doc(itemId).delete();
    }

    return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
  }

  // -------------------- Default Response --------------------
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
