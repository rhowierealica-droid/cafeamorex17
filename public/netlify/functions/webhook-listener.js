// netlify/functions/paymongo-webhook.js (FINAL VERSION)

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
// 2. Helper Functions (Unchanged)
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

// Inventory Helpers (Unchanged)
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

  // ----------------------------------------------------
  // ⭐ Signature Verification (Security Critical)
  // ----------------------------------------------------
  if (WEBHOOK_SECRET) {
    try {
      const sigHeader = event.headers["paymongo-signature"] || "";
      const receivedSignature = sigHeader.split(",").find((p) => p.startsWith("v1="))?.replace("v1=", ""); 
      
      if (!receivedSignature) {
        console.warn("⚠️ Signature verification failed: 'paymongo-signature' header missing 'v1=' part.");
        return { statusCode: 401, body: "Signature Invalid" }; 
      }

      const expectedHash = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");
      
      if (receivedSignature !== expectedHash) {
        console.warn("⚠️ Signature mismatch: Received:", receivedSignature, " Expected:", expectedHash);
        return { statusCode: 401, body: "Signature Invalid" }; 
      }
      
      console.log("✅ Signature verified successfully.");
    } catch (err) {
      console.error("❌ Signature verification error:", err.message);
      return { statusCode: 500, body: "Verification Error" };
    }
  } else {
     console.warn("⚠️ WEBHOOK_SECRET environment variable is missing. Skipping signature verification.");
     if (process.env.NODE_ENV === 'production') {
         return { statusCode: 401, body: "Webhook Secret Missing" };
     }
  }
  // ----------------------------------------------------
  
  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  // ----------------------------------------------------
  // Refund Handler
  // ----------------------------------------------------
  if (
    eventType === "payment.refunded" ||
    eventType === "payment.refund.updated"
  ) {
    const refundData = dataObject;
    const refundStatus = refundData?.attributes?.status; 
    const paymentId = refundData?.attributes?.payment_id;

    console.log(`Refund Event: ${refundStatus} for Payment ID: ${paymentId}`);

    const collections = ["DeliveryOrders", "InStoreOrders"];
    let orderRef, orderSnap;

    // Find the order using the payment ID
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
      return { statusCode: 200, body: JSON.stringify({ received: true, warning: "Order not found" }) };
    }

    const orderData = orderSnap.data();
    let updates = {}; 

    if (refundStatus === "succeeded") {
      console.log("✅ Refund succeeded — updating Firestore and returning inventory.");
      updates = {
        status: "Refunded",
        finalRefundStatus: "Succeeded", 
        refundRequest: admin.firestore.FieldValue.delete(),
        refundStatus: admin.firestore.FieldValue.delete(), 
      };
      try {
        await returnInventory(orderData.items || orderData.products);
      } catch (err) {
        console.error("❌ Inventory return failed:", err.message);
      }
    } else if (refundStatus === "failed") {
      console.log("❌ Refund failed — updating status only.");
      updates = {
        status: "Refund Failed",
        finalRefundStatus: "Failed",
        refundRequest: admin.firestore.FieldValue.delete(),
        refundStatus: admin.firestore.FieldValue.delete(), 
      };
    }
    
    if (Object.keys(updates).length > 0) {
        await orderRef.update(updates);
    }

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
  // Payment Success Handler (Order Creation)
  // ----------------------------------------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const userId = metadata.userId;
    const paymentId = dataObject.id;
    const rawCartItemIds =
      metadata.cartItemIds ??
      metadata.CartItemIds ??
      metadata.cartIds ??
      [];
    const cartItemIds = safeParse(rawCartItemIds, []);
    
    let orderItems = await fetchOrderItemsFromCart(userId, cartItemIds); 
    if (!orderItems.length && metadata.orderItems) {
      orderItems = safeParse(metadata.orderItems, []);
      console.log("⚠️ Using fallback metadata.orderItems for empty cart");
    }
    
    const deliveryFee = Number(metadata.deliveryFee || 0);
    const totalAmount =
      orderItems.reduce((sum, i) => sum + Number(i.total || 0), 0) + deliveryFee;

    if (!userId || !metadata.queueNumber || !orderItems.length) {
      console.error("❌ Missing metadata or empty cart. Cannot create order.");
      return { statusCode: 200, body: JSON.stringify({ received: true, error: "Missing metadata" }) };
    }

    // ⭐ CRITICAL IMPROVEMENT: Idempotency Check
    const collections = ["DeliveryOrders", "InStoreOrders"];
    let isDuplicate = false;
    for (const col of collections) {
      const existingOrder = await db.collection(col)
        .where("paymongoPaymentId", "==", paymentId)
        .limit(1)
        .get();
      if (!existingOrder.empty) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      console.warn(`⚠️ DUPLICATE PAYMENT HOOK: Payment ID ${paymentId} already processed. Skipping order creation.`);
      return { 
        statusCode: 200, 
        body: JSON.stringify({ received: true, warning: "Payment already processed." }) 
      };
    }
    // END Idempotency Check

    try {
      await deductInventory(orderItems);

      // Determine the correct collection based on orderType from metadata
      const orderType = metadata.orderType || "Delivery";
      const collectionName = (orderType === "Delivery") ? "DeliveryOrders" : "InStoreOrders";

      const orderRef = await db.collection(collectionName).add({ 
        userId,
        customerName: metadata.customerName || "",
        customerEmail: metadata.customerEmail || "",
        // Only include address if it's a Delivery Order
        ...(orderType === "Delivery" && { address: metadata.address || "" }), 
        queueNumber: metadata.queueNumber,
        queueNumberNumeric: Number(metadata.queueNumberNumeric) || 0,
        orderType: orderType, 
        items: orderItems,
        deliveryFee,
        total: totalAmount,
        paymentMethod: "E-Payment",
        status: "Pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: paymentId,
        cartItemIds,
      });

      // Atomically delete cart items
      const batch = db.batch();
      for (const itemId of cartItemIds) {
        batch.delete(db.collection("users").doc(userId).collection("cart").doc(itemId));
      }
      await batch.commit();

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, orderId: orderRef.id }),
      };
    } catch (err) {
      console.error("❌ Transaction failed (Inventory or Order Creation):", err.message);
      return {
        statusCode: 200, 
        body: JSON.stringify({ received: true, error: err.message, fatal: true }),
      };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

