// netlify/functions/paymongo-webhook.js (FINAL STABLE VERSION)

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
  }
} catch (e) {
  console.error("⚠️ Firebase Admin SDK initialization failed:", e.message);
}

// ---------------------
// 2. Helper Functions (Inventory and Others)
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

async function fetchOrderItemsFromCart(userId, cartItemIds) {
  if (!userId || !cartItemIds || cartItemIds.length === 0) return [];
  const itemPromises = cartItemIds.map((id) =>
    db.collection("users").doc(userId).collection("cart").doc(id).get()
  );
  const itemSnaps = await Promise.all(itemPromises);
  return itemSnaps.filter((snap) => snap.exists).map((snap) => ({
    id: snap.id,
    ...snap.data(),
  }));
}

// Inventory Helpers (MODIFIED to accept a transaction/batch object)
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

      // Use transaction for atomic deduction
      transaction.update(invRef, {
        quantity: admin.firestore.FieldValue.increment(qtyToDeduct),
      });
    }
  }
}

async function returnInventory(orderItems) {
  if (!orderItems || !orderItems.length) return;
  const batch = db.batch();

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
      const qtyToReturn = (part.qty || 1) * qtyMultiplier;
      batch.update(invRef, {
        quantity: admin.firestore.FieldValue.increment(qtyToReturn),
      });
    }
  }

  await batch.commit();
}

// ---------------------
// 3. Netlify Function Handler
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

  // ----------------------------------------------------
  // ⭐ Signature Verification (Security Critical)
  // ----------------------------------------------------
  if (WEBHOOK_SECRET) {
    try {
      const sigHeader = event.headers["paymongo-signature"] || "";
      const receivedSignature = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", "");

      if (!receivedSignature) {
        console.warn("⚠️ Signature verification failed: missing v1=");
        return { statusCode: 401, body: "Signature Invalid" };
      }

      const expectedHash = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (receivedSignature !== expectedHash) {
        console.error(`❌ Signature mismatch. Expected: ${expectedHash}, Received: ${receivedSignature}`);
        return { statusCode: 401, body: "Signature Invalid" };
      }

      console.log("✅ Signature verified successfully.");
    } catch (err) {
      console.error("❌ Signature verification error:", err.message);
      return { statusCode: 500, body: "Verification Error" };
    }
  } else {
    console.warn("⚠️ WEBHOOK_SECRET missing. Skipping signature check.");
    if (process.env.NODE_ENV === "production") {
      return { statusCode: 401, body: "Webhook Secret Missing" };
    }
  }

  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  console.log(`--- Event Type Received: ${eventType} ---`);

  // ----------------------------------------------------
  // Refund Handler (no change)
  // ----------------------------------------------------
  if (eventType === "payment.refunded" || eventType === "payment.refund.updated") {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // ----------------------------------------------------
  // Payment Success Handler
  // ----------------------------------------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const userId = metadata.userId;
    const queueNumber = metadata.queueNumber;
    const orderDocId = metadata.orderId;
    const paymentId = dataObject.id;
    const rawCartItemIds =
      metadata.cartItemIds ?? metadata.CartItemIds ?? metadata.cartIds ?? [];
    const cartItemIds = safeParse(rawCartItemIds, []);

    const orderType = metadata.orderType || "Delivery";
    const collectionName =
      metadata.collectionName ||
      (orderType === "Delivery" ? "DeliveryOrders" : "InStoreOrders");

    console.log(
      `Received Payment Hook. Metadata: { orderId: ${orderDocId}, collection: ${collectionName}, userId: ${userId}, queueNumber: ${queueNumber} }`
    );

    if (!orderDocId && (!userId || !queueNumber)) {
      console.error("❌ Missing metadata. Cannot proceed.");
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, error: "Insufficient metadata" }),
      };
    }

    try {
      const finalOrderRef = await db.runTransaction(async (transaction) => {
        let orderRef;
        let orderItems;
        let finalOrderRefId = null;
        let orderSnap = null;
        let existingOrderFound = false;

        // 1️⃣ Lookup by Document ID
        if (orderDocId) {
          orderRef = db.collection(collectionName).doc(orderDocId);
          orderSnap = await transaction.get(orderRef);
          if (orderSnap.exists) {
            existingOrderFound = true;
            console.log(`🔍 Found existing order by ID: ${orderDocId}`);
          } else {
            console.warn(`⚠️ Not found by ID: ${orderDocId}`);
          }
        }

        // 2️⃣ Fallback by userId/queueNumber
        if (!existingOrderFound && userId && queueNumber) {
          console.log(`🔍 Fallback query by userId + queueNumber`);
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
            console.log(`🔍 Found order by Query: ${orderRef.id}`);
          }
        }

        // 3️⃣ If order found
        if (orderSnap && existingOrderFound) {
          finalOrderRefId = orderRef.id;

          // Already paid check
          if (orderSnap.data().paymongoPaymentId) {
            console.warn(
              `⚠️ Duplicate webhook: Order ${finalOrderRefId} already has payment ID.`
            );
            return null;
          }

          orderItems = orderSnap.data().items || orderSnap.data().products || [];

          await deductInventory(orderItems, transaction);
          console.log(`✅ Inventory deducted for order ID ${finalOrderRefId}.`);

          // ✅ FIXED: Mark order as PAID
          transaction.update(orderRef, {
            paymongoPaymentId: paymentId,
            status: "Paid", // ✅ Updated from Pending to Paid
            paymentMetadata: admin.firestore.FieldValue.delete(),
          });
          console.log(`✅ Order ${finalOrderRefId} updated to 'Paid'.`);
        } else {
          console.error("❌ Order not found.");
          throw new Error("Order not found or insufficient metadata.");
        }

        return orderRef;
      });

      if (finalOrderRef) {
        // Delete cart items (standard checkout)
        const batch = db.batch();
        for (const itemId of cartItemIds) {
          if (userId) {
            batch.delete(db.collection("users").doc(userId).collection("cart").doc(itemId));
          }
        }
        await batch.commit();

        // ✅ Optional: Auto-change to "Preparing" after a short delay
        setTimeout(async () => {
          try {
            await db.collection(finalOrderRef.parent.id)
              .doc(finalOrderRef.id)
              .update({ status: "Preparing" });
            console.log(`🔁 Auto-updated order ${finalOrderRef.id} to 'Preparing'`);
          } catch (err) {
            console.warn("⚠️ Auto-update to Preparing failed:", err.message);
          }
        }, 5000);

        console.log("--- Webhook Handler Finished Successfully ---");
        return {
          statusCode: 200,
          body: JSON.stringify({ received: true, orderId: finalOrderRef.id }),
        };
      } else {
        console.log("--- Webhook Handler Finished (Duplicate Skipped) ---");
        return {
          statusCode: 200,
          body: JSON.stringify({
            received: true,
            warning: "Duplicate webhook skipped",
          }),
        };
      }
    } catch (err) {
      console.error("❌ TRANSACTION ERROR:", err.message);
      return {
        statusCode: 200,
        body: JSON.stringify({
          received: true,
          error: "Internal error: " + err.message,
          fatal: true,
        }),
      };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
