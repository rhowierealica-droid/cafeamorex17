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
    // NOTE: In a Netlify environment, it's safer to base64 encode this in your ENV
    // and decode it here to avoid issues with multi-line JSON.
    // const serviceAccount = JSON.parse(Buffer.from(serviceAccountKey, 'base64').toString('utf8'));
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

  try {
    result = JSON.parse(result);
  } catch {}

  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {}
  }

  return Array.isArray(result) ? result : typeof result === "object" && result !== null ? result : fallback;
}

async function fetchOrderItemsFromCart(userId, cartItemIds) {
  if (!userId || !cartItemIds || cartItemIds.length === 0) return [];

  const itemPromises = cartItemIds.map((id) => db.collection("users").doc(userId).collection("cart").doc(id).get());
  const itemSnaps = await Promise.all(itemPromises);

  const items = itemSnaps.filter((snap) => snap.exists).map((snap) => ({ id: snap.id, ...snap.data() }));
  return items;
}

// ----------------------------------------------------
// Inventory Helpers
// ----------------------------------------------------

// V2: Deduct stock atomically using FieldValue.increment (BEST PRACTICE)
// NOTE: This removes the in-function stock check, relying on a client-side/pre-payment check.
// This is critical for preventing race conditions.
async function deductInventory(orderItems) {
  if (!orderItems || !orderItems.length) return;
  const batch = db.batch();

  for (const item of orderItems) {
    if (!item || !item.product) continue;
    const qtyMultiplier = item.qty || 1;

    // Define all inventory parts to deduct
    const inventoryParts = [
      // Ingredients
      ...(item.ingredients || []).map((ing) => ({ id: ing.id, qty: ing.qty || 1 })),
      // Other Components
      ...(item.others || []).map((other) => ({ id: other.id, qty: other.qty || 1 })),
      // Size Variant
      ...(item.sizeId ? [{ id: item.sizeId, qty: 1 }] : []),
      // Add-ons
      ...(item.addons || []).map((addon) => ({ id: addon.id, qty: 1 })),
    ];

    for (const part of inventoryParts) {
      if (!part.id) continue;
      const invRef = db.collection("Inventory").doc(part.id);
      // Deduct by adding a negative number
      const qtyToDeduct = (part.qty || 1) * qtyMultiplier * -1;

      // Use Firebase's FieldValue.increment for atomic stock deduction
      batch.update(invRef, {
        quantity: admin.firestore.FieldValue.increment(qtyToDeduct),
      });
    }
  }

  await batch.commit();
}

// Helper to return stock to inventory atomically (CRITICAL for safety during refund)
async function returnInventory(orderItems) {
  if (!orderItems || !orderItems.length) return;
  const batch = db.batch();

  for (const item of orderItems) {
    if (!item || !item.product) continue;
    const qtyMultiplier = item.qty || 1;

    // Define all inventory parts to return
    const inventoryParts = [
      // Ingredients
      ...(item.ingredients || []).map((ing) => ({ id: ing.id, qty: ing.qty || 1 })),
      // Other Components
      ...(item.others || []).map((other) => ({ id: other.id, qty: other.qty || 1 })),
      // Size Variant
      ...(item.sizeId ? [{ id: item.sizeId, qty: 1 }] : []),
      // Add-ons
      ...(item.addons || []).map((addon) => ({ id: addon.id, qty: 1 })),
    ];

    for (const part of inventoryParts) {
      if (!part.id) continue;
      const invRef = db.collection("Inventory").doc(part.id);
      const qtyToReturn = (part.qty || 1) * qtyMultiplier;

      // Use Firebase's FieldValue.increment for atomic stock return (CRITICAL for safety)
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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  if (!db) return { statusCode: 500, body: "Server not initialized" };

  const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
  const rawBody = event.body;
  let payload;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  // Signature verification (KEEP AS IS)
  try {
    const sigHeader = event.headers["paymongo-signature"] || "";
    const v1 = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", "");
    const expectedHash = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    if (WEBHOOK_SECRET && sigHeader && v1 !== expectedHash) {
      console.warn("⚠️ Signature mismatch");
    }
  } catch (err) {
    console.warn("⚠️ Signature verification failed:", err.message);
  }

  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  // ----------------------------------------------------
  // ⭐ UPDATED: Handle refunds
  // ----------------------------------------------------
  if (eventType === "payment.refunded" || eventType === "refund.succeeded" || eventType === "refund.failed") {
    const refundData = dataObject;
    const refundStatus = refundData?.attributes?.status; // e.g., 'succeeded', 'failed'
    const paymentId = refundData?.attributes?.payment_id; // PayMongo Payment ID

    console.log(`Received refund event for payment ID: ${paymentId}. Status: ${refundStatus}`);

    // Search both collections for the order using the PayMongo Payment ID
    const orderCollections = ["DeliveryOrders", "InStoreOrders"];
    let orderSnap;
    let orderRef;

    for (const col of orderCollections) {
      // Search by payment ID
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
      console.warn(`Order not found for payment ID: ${paymentId}`);
      return { statusCode: 200, body: JSON.stringify({ received: true, warning: "Order not found" }) };
    }

    const orderData = orderSnap.data();
    let finalStatusUpdate = {
      // CRITICAL: Clean up the temporary flags set by the front-end
      refundRequest: admin.firestore.FieldValue.delete(),
      refundStatus: admin.firestore.FieldValue.delete(),
    };

    if (refundStatus === "succeeded") {
      console.log("✅ Refund succeeded. Returning stock and updating status.");
      finalStatusUpdate = {
        ...finalStatusUpdate,
        status: "Refunded", // New main status
        finalRefundStatus: "Refunded", // Final status for display
      };

      // CRITICAL: Return stock only when refund is confirmed Succeeded
      try {
        await returnInventory(orderData.items || orderData.products);
        console.log(`Inventory returned for Order: ${orderRef.id}`);
      } catch (err) {
        console.error("❌ Failed to return inventory on successful refund:", err.message);
      }
    } else if (refundStatus === "failed") {
      console.log("❌ Refund failed. Updating status.");
      finalStatusUpdate = {
        ...finalStatusUpdate,
        status: "Refund Failed", // New main status
        finalRefundStatus: "Refund Failed", // Final status for display
      };
      // Do NOT return stock if the refund failed
    }

    // Only update if one of the statuses was matched
    if (finalStatusUpdate.status) {
      await orderRef.update(finalStatusUpdate);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true, processedRefund: true, orderId: orderRef.id }),
    };
  }

  // Payment events (KEEP AS IS)
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const userId = metadata.userId;

    const rawCartItemIds = metadata.cartItemIds ?? metadata.CartItemIds ?? metadata.cartIds ?? metadata.CartItemIds ?? [];
    const cartItemIds = safeParse(rawCartItemIds, []);

    // Try fetching from Firestore first
    let orderItems = await fetchOrderItemsFromCart(userId, cartItemIds);

    // FALLBACK: use metadata.orderItems if cart is empty
    if (!orderItems.length && metadata.orderItems) {
      orderItems = safeParse(metadata.orderItems, []);
      console.log("⚠️ Using fallback metadata.orderItems for empty cart");
    }

    const deliveryFee = Number(metadata.deliveryFee || metadata.DeliveryFee || 0);
    const calculatedTotal = orderItems.reduce((sum, i) => sum + Number(i.total || 0), 0) + deliveryFee;
    const totalAmount = calculatedTotal > 0 ? calculatedTotal : Number(metadata.orderTotal || metadata.total || 0);

    if (!userId || !metadata.queueNumber || !orderItems.length) {
      console.error(
        `Missing metadata or orderItems empty. User: ${userId}, Queue: ${metadata.queueNumber}, Cart IDs: ${cartItemIds.length}`
      );
      return { statusCode: 200, body: JSON.stringify({ received: true, error: "Missing metadata/fetched items" }) };
    }

    try {
      // V2: Use the new atomic deduction function
      await deductInventory(orderItems);

      const orderRef = await db.collection("DeliveryOrders").add({
        userId,
        customerName: metadata.customerName || "",
        customerEmail: metadata.customerEmail || "",
        address: metadata.address || "",
        queueNumber: metadata.queueNumber,
        queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
        orderType: metadata.orderType || "Delivery",
        items: orderItems, // always non-empty
        deliveryFee,
        total: totalAmount,
        paymentMethod: "E-Payment",
        status: "Pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: dataObject.id,
        cartItemIds,
      });

      // Clear user's cart AFTER saving order
      // NOTE: Batch deletion is recommended for performance, but this loop is fine for small carts.
      for (const itemId of cartItemIds) {
        await db.collection("users").doc(userId).collection("cart").doc(itemId).delete();
      }

      return { statusCode: 200, body: JSON.stringify({ received: true, orderId: orderRef.id }) };
    } catch (err) {
      console.error("❌ Transaction failed:", err.message);
      // Consider adding a separate collection for failed payments/inventory issues for later review.
      return { statusCode: 200, body: JSON.stringify({ received: true, error: `Inventory/Save failed: ${err.message}` }) };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
