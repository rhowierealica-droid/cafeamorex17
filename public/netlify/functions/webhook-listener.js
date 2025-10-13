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

// ---------------------
// Inventory Helpers
// ---------------------
async function deductInventory(orderItems) {
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
      const qtyToDeduct = (part.qty || 1) * qtyMultiplier * -1;
      batch.update(invRef, {
        quantity: admin.firestore.FieldValue.increment(qtyToDeduct),
      });
    }
  }

  await batch.commit();
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
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };
  if (!db) return { statusCode: 500, body: "Server not initialized" };

  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  const rawBody = event.body;
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  // Verify signature (important for security)
  try {
    const sigHeader = event.headers["paymongo-signature"] || "";
    const v1 = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", "");
    const expectedHash = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    if (WEBHOOK_SECRET && sigHeader && v1 !== expectedHash) {
      console.warn("⚠️ Signature mismatch");
    }
  } catch (err) {
    console.warn("⚠️ Signature verification failed:", err.message);
  }

  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  // ----------------------------------------------------
  // ⭐ UPDATED: Handle Refunds from PayMongo
  // ----------------------------------------------------
  if (
    eventType === "payment.refunded" ||
    eventType === "refund.succeeded" ||
    eventType === "refund.failed"
  ) {
    const refundData = dataObject;
    const refundStatus = refundData?.attributes?.status; // succeeded | failed
    const paymentId = refundData?.attributes?.payment_id;

    console.log(`Refund Event: ${refundStatus} for Payment ID: ${paymentId}`);

    const collections = ["DeliveryOrders", "InStoreOrders"];
    let orderRef, orderSnap;

    for (const col of collections) {
      const querySnapshot = await db
        .collection(col)
        .where("paymongoPaymentId", "==", paymentId)
        .limit(1)
        .get();
      if (!querySnapshot.empty) {
        orderSnap = querySnapshot.docs[0];
        orderRef = orderSnap.ref;
        break;
      }
    }

    if (!orderSnap) {
      console.warn(`⚠️ Order not found for Payment ID: ${paymentId}`);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, warning: "Order not found" }),
      };
    }

    const orderData = orderSnap.data();
    let updates = {
      refundRequest: admin.firestore.FieldValue.delete(),
      refundStatus: admin.firestore.FieldValue.delete(),
    };

    if (refundStatus === "succeeded") {
      console.log("✅ Refund succeeded — updating Firestore and returning inventory.");
      updates = {
        ...updates,
        status: "Refunded",
        finalRefundStatus: "Refunded",
      };
      try {
        await returnInventory(orderData.items || orderData.products);
      } catch (err) {
        console.error("❌ Inventory return failed:", err.message);
      }
    } else if (refundStatus === "failed") {
      console.log("❌ Refund failed — updating status only.");
      updates = {
        ...updates,
        status: "Refund Failed",
        finalRefundStatus: "Refund Failed",
      };
    }

    if (updates.status) await orderRef.update(updates);

    return {
      statusCode: 200,
      body: JSON.stringify({
        received: true,
        processedRefund: true,
        orderId: orderRef.id,
        refundStatus,
      }),
    };
  }

  // ----------------------------------------------------
  // Payment success handler (unchanged)
  // ----------------------------------------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const userId = metadata.userId;
    const rawCartItemIds =
      metadata.cartItemIds ??
      metadata.CartItemIds ??
      metadata.cartIds ??
      metadata.CartItemIds ??
      [];
    const cartItemIds = safeParse(rawCartItemIds, []);
    let orderItems = await fetchOrderItemsFromCart(userId, cartItemIds);
    if (!orderItems.length && metadata.orderItems) {
      orderItems = safeParse(metadata.orderItems, []);
      console.log("⚠️ Using fallback metadata.orderItems for empty cart");
    }

    const deliveryFee = Number(metadata.deliveryFee || metadata.DeliveryFee || 0);
    const totalAmount =
      orderItems.reduce((sum, i) => sum + Number(i.total || 0), 0) + deliveryFee;

    if (!userId || !metadata.queueNumber || !orderItems.length) {
      console.error("❌ Missing metadata or empty cart.");
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, error: "Missing metadata" }),
      };
    }

    try {
      await deductInventory(orderItems);

      const orderRef = await db.collection("DeliveryOrders").add({
        userId,
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

      for (const itemId of cartItemIds) {
        await db.collection("users").doc(userId).collection("cart").doc(itemId).delete();
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, orderId: orderRef.id }),
      };
    } catch (err) {
      console.error("❌ Transaction failed:", err.message);
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, error: err.message }),
      };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
