// ===============================
// webhook.js (Netlify Function) - Transactional Version
// ===============================
require("dotenv").config();
const admin = require("firebase-admin");
const crypto = require("crypto");

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
    let parsed = typeof value === "string" ? JSON.parse(value) : value || fallback;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed || fallback;
  } catch (e) {
    console.error("Safe Parse Error:", e.message, "Value:", value);
    return fallback;
  }
}

function normalizeMetadata(m) {
  if (!m) return {};
  if (typeof m === "object") return m;
  try {
    let parsed = JSON.parse(m);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed || {};
  } catch (e) {
    console.warn("Could not parse metadata string:", e.message);
    return {};
  }
}

// ---------------------
// 🔹 Deduct inventory transactionally
// ---------------------
async function deductInventoryTransactional(orderItems) {
  if (!orderItems || !orderItems.length) return;

  const batch = db.batch();

  for (const item of orderItems) {
    const qtyMultiplier = item.qty || 1;

    for (const ing of item.ingredients || []) {
      if (!ing.id) continue;
      const invRef = db.collection("Inventory").doc(ing.id);
      const invSnap = await invRef.get();
      const currentQty = invSnap.exists ? invSnap.data().quantity || 0 : 0;
      if (currentQty < (ing.qty || 1) * qtyMultiplier) {
        throw new Error(`Insufficient inventory for ingredient ${ing.id}`);
      }
      batch.update(invRef, { quantity: currentQty - (ing.qty || 1) * qtyMultiplier });
    }

    for (const other of item.others || []) {
      if (!other.id) continue;
      const invRef = db.collection("Inventory").doc(other.id);
      const invSnap = await invRef.get();
      const currentQty = invSnap.exists ? invSnap.data().quantity || 0 : 0;
      if (currentQty < (other.qty || 1) * qtyMultiplier) {
        throw new Error(`Insufficient inventory for other component ${other.id}`);
      }
      batch.update(invRef, { quantity: currentQty - (other.qty || 1) * qtyMultiplier });
    }

    if (item.sizeId) {
      const sizeRef = db.collection("Inventory").doc(item.sizeId);
      const sizeSnap = await sizeRef.get();
      const currentQty = sizeSnap.exists ? sizeSnap.data().quantity || 0 : 0;
      if (currentQty < qtyMultiplier) {
        throw new Error(`Insufficient inventory for size ${item.sizeId}`);
      }
      batch.update(sizeRef, { quantity: currentQty - qtyMultiplier });
    }

    for (const addon of item.addons || []) {
      if (!addon.id) continue;
      const addonRef = db.collection("Inventory").doc(addon.id);
      const addonSnap = await addonRef.get();
      const currentQty = addonSnap.exists ? addonSnap.data().quantity || 0 : 0;
      if (currentQty < qtyMultiplier) {
        throw new Error(`Insufficient inventory for addon ${addon.id}`);
      }
      batch.update(addonRef, { quantity: currentQty - qtyMultiplier });
    }
  }

  await batch.commit();
}

// ---------------------
// Netlify Function Handler
// ---------------------
exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  let payload;

  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  // --------------------- Signature Verification ---------------------
  try {
    const sigHeader = event.headers["paymongo-signature"] || "";
    if (WEBHOOK_SECRET && sigHeader) {
      const v1 = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", "");
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
    if (db && dataObject?.attributes?.payment_id) {
      const paymentId = dataObject.attributes.payment_id;
      const snapshot = await db.collection("DeliveryOrders").where("paymongoPaymentId", "==", paymentId).limit(1).get();
      if (!snapshot.empty) {
        const orderRef = snapshot.docs[0].ref;
        await orderRef.update({ status: "Refunded", paymongoRefundId: dataObject.id });
      }
    }
    return { statusCode: 200, body: JSON.stringify({ received: true, processedRefund: true }) };
  }

  // -------------------- Payment Paid Events --------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = normalizeMetadata(dataObject?.attributes?.metadata);
    const orderItems = safeParse(metadata.items ?? metadata.orderItems ?? metadata.order_items ?? [], []);
    const cartItemIds = safeParse(metadata.cartItemIds ?? metadata.cart_item_ids ?? metadata.cartIds ?? [], []);
    const deliveryFee = Number(metadata.deliveryFee || 0);
    const totalAmount = Number(metadata.orderTotal || metadata.total || 0) || orderItems.reduce((sum, i) => sum + (Number(i.total || 0) || 0), 0) + deliveryFee;

    if (!metadata.userId || !metadata.queueNumber) return { statusCode: 400, body: "Missing metadata" };

    try {
      // -------------------- 🔹 Deduct inventory first (transactional) --------------------
      await deductInventoryTransactional(orderItems);

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
        cartItemIds,
      });

      // -------------------- Clear user's cart --------------------
      for (const itemId of cartItemIds) {
        await db.collection("users").doc(metadata.userId).collection("cart").doc(itemId).delete();
      }

      return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
    } catch (err) {
      console.error("❌ Transaction failed:", err.message);
      return { statusCode: 500, body: `Inventory deduction failed: ${err.message}` };
    }
  }

  // -------------------- Default Response --------------------
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
