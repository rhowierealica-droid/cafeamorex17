// netlify/functions/paymongo-webhook.js (FINAL FIXED VERSION - Pending after Payment)

require("dotenv").config();
const admin = require("firebase-admin");
const crypto = require("crypto");

// ---------------------
// 1. Initialize Firebase Admin SDK
// ---------------------
let db;
try {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    const serviceAccount = JSON.parse(serviceAccountKey);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    db = admin.firestore();
    console.log("✅ Firebase Admin SDK initialized.");
  }
} catch (e) {
  console.error("⚠️ Firebase Admin SDK initialization failed:", e.message);
}

// ---------------------
// 2. Helper Functions
// ---------------------
function safeParse(value, fallback = []) {
  if (Array.isArray(value) && value.length > 0) return value;
  if (!value) return fallback;

  let result = value;
  try { result = JSON.parse(result); } catch {}
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch {}
  }
  return Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null
    ? result
    : fallback;
}

async function deductInventory(orderItems, transaction) {
  if (!orderItems || !orderItems.length) return;

  for (const item of orderItems) {
    if (!item || !item.product) continue;
    const qtyMultiplier = item.qty || 1;

    const inventoryParts = [
      ...(item.ingredients || []).map((ing) => ({ id: ing.id, qty: ing.qty || 1 })),
      ...(item.others || []).map((other) => ({ id: other.id, qty: other.qty || 1 })),
      ...(item.sizeId ? [{ id: item.sizeId, qty: 1 }] : []),
      ...(item.addons || []).map((addon) => ({ id: addon.id, qty: 1 })),
    ];

    for (const part of inventoryParts) {
      if (!part.id) continue;
      const invRef = db.collection("Inventory").doc(part.id);
      const qtyToDeduct = (part.qty || 1) * qtyMultiplier * -1;

      transaction.update(invRef, {
        quantity: admin.firestore.FieldValue.increment(qtyToDeduct),
      });
    }
  }
}

// ---------------------
// 3. Webhook Handler
// ---------------------
exports.handler = async (event, context) => {
  console.log("--- Webhook Handler Started ---");
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };
  if (!db) return { statusCode: 500, body: "Server not initialized" };

  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  const rawBody = event.body;
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("❌ Invalid JSON payload");
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  // -----------------------------
  // ✅ Signature Verification
  // -----------------------------
  if (WEBHOOK_SECRET) {
    try {
      const sigHeader =
        event.headers["x-paymongo-signature"] ||
        event.headers["paymongo-signature"] ||
        "";

      const parts = sigHeader.split(",").reduce((acc, part) => {
        const [key, value] = part.trim().split("=");
        acc[key.trim()] = value?.trim();
        return acc;
      }, {});

      const receivedTimestamp = parts.t;
      const receivedSignature = parts.v1 || parts.te || parts.li;

      if (!receivedSignature || !receivedTimestamp) {
        console.warn(
          "⚠️ Signature verification failed: Missing timestamp (t) or signature (v1/te/li). Header:",
          sigHeader
        );
        return { statusCode: 401, body: "Signature Invalid" };
      }

      const signedPayload = `${receivedTimestamp}.${rawBody}`;
      const expectedHash = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(signedPayload)
        .digest("hex");

      if (receivedSignature !== expectedHash) {
        console.error(
          "❌ Signature mismatch. Expected:",
          expectedHash,
          "Received:",
          receivedSignature
        );
        return { statusCode: 401, body: "Signature Invalid" };
      }

      console.log("✅ Signature verified successfully.");
    } catch (err) {
      console.error("❌ Signature verification error:", err.message);
      return { statusCode: 500, body: "Verification Error" };
    }
  }

  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;
  console.log(`--- Event Type: ${eventType} ---`);

  // -----------------------------
  // Ignore Refunds
  // -----------------------------
  if (
    eventType === "payment.refunded" ||
    eventType === "payment.refund.updated"
  ) {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // -----------------------------
  // Payment Success
  // -----------------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const paymentId = dataObject.id;
    const source = metadata.source || "customer_checkout";
    const collectionName = metadata.collectionName || "DeliveryOrders";
    const orderDocId = metadata.orderId;
    const userId = metadata.userId;
    const queueNumber = metadata.queueNumber;
    const rawCartItemIds =
      metadata.cartItemIds ?? metadata.CartItemIds ?? metadata.cartIds ?? [];
    const cartItemIds = safeParse(rawCartItemIds, []);

    console.log(`📦 Metadata:`, metadata);

    // ✅ Admin-Approved Payment
    if (source === "admin_approval_link") {
      console.log(`🧾 Admin-Approved Payment detected for Order ID: ${orderDocId}`);

      try {
        await db.runTransaction(async (transaction) => {
          const orderRef = db.collection(collectionName).doc(orderDocId);
          const orderSnap = await transaction.get(orderRef);
          if (!orderSnap.exists)
            throw new Error(`Order ${orderDocId} not found in ${collectionName}.`);

          const orderItems =
            orderSnap.data().items || orderSnap.data().products || [];
          await deductInventory(orderItems, transaction);

          transaction.update(orderRef, {
            paymongoPaymentId: paymentId,
            status: "Pending",
            paymentMetadata: admin.firestore.FieldValue.delete(),
          });

          console.log(`✅ Admin-approved Order ${orderDocId} marked as 'Pending'.`);
        });

        return { statusCode: 200, body: JSON.stringify({ received: true }) };
      } catch (err) {
        console.error("❌ Admin-approved Payment Error:", err.message);
        return {
          statusCode: 200,
          body: JSON.stringify({ received: true, error: err.message }),
        };
      }
    }

    // ✅ Regular Customer Checkout Flow
    try {
      const finalOrderRef = await db.runTransaction(async (transaction) => {
        let orderRef;
        let orderSnap;
        let existingOrderFound = false;

        if (orderDocId) {
          orderRef = db.collection(collectionName).doc(orderDocId);
          orderSnap = await transaction.get(orderRef);
          if (orderSnap.exists) existingOrderFound = true;
        }

        if (!existingOrderFound && userId && queueNumber) {
          const query = await transaction.get(
            db
              .collection(collectionName)
              .where("userId", "==", userId)
              .where("queueNumber", "==", queueNumber)
              .limit(1)
          );
          if (!query.empty) {
            orderSnap = query.docs[0];
            orderRef = orderSnap.ref;
            existingOrderFound = true;
          }
        }

        if (!existingOrderFound)
          throw new Error(
            `Order not found by ID (${orderDocId}) or User/Queue (${userId}/${queueNumber}).`
          );

        const orderItems =
          orderSnap.data().items || orderSnap.data().products || [];
        await deductInventory(orderItems, transaction);

        transaction.update(orderRef, {
          paymongoPaymentId: paymentId,
          status: "Pending",
          paymentMetadata: admin.firestore.FieldValue.delete(),
        });

        console.log(`✅ Regular order ${orderRef.id} marked as 'Pending'.`);
        return orderRef;
      });

      // 🗑️ Clean cart
      if (finalOrderRef && userId) {
        const batch = db.batch();
        for (const itemId of cartItemIds) {
          batch.delete(
            db.collection("users").doc(userId).collection("cart").doc(itemId)
          );
        }
        await batch.commit();
        console.log(`🗑️ Cart items cleaned for user ${userId}.`);
      }

      console.log("--- Webhook Handler Finished Successfully ---");
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    } catch (err) {
      console.error("❌ Transaction Error:", err.message);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, error: err.message }),
      };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
