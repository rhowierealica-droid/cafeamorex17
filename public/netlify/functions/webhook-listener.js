// netlify/functions/paymongo-webhook.js (FINAL DEBUG VERSION)

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
      
      // Use the transaction object to ensure atomicity
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
        console.warn("⚠️ Signature verification failed: 'paymongo-signature' header missing 'v1=' part.");
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
      console.warn("⚠️ WEBHOOK_SECRET environment variable is missing. Skipping signature verification.");
      if (process.env.NODE_ENV === 'production') {
        return { statusCode: 401, body: "Webhook Secret Missing" };
      }
  }
  // ----------------------------------------------------
  
  const eventType = payload?.data?.attributes?.type;
  const dataObject = payload?.data?.attributes?.data;

  console.log(`--- Event Type Received: ${eventType} ---`);

  // ----------------------------------------------------
  // Refund Handler (UNCHANGED)
  // ----------------------------------------------------
  if (
    eventType === "payment.refunded" ||
    eventType === "payment.refund.updated"
  ) {
    // Refund logic...
    // (Omitted for brevity in this response, as it's unchanged)
    // ...
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // ----------------------------------------------------
  // Payment Success Handler (Order Creation/Update)
  // ----------------------------------------------------
  if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
    const metadata = dataObject?.attributes?.metadata || {};
    const userId = metadata.userId;
    const queueNumber = metadata.queueNumber;
    const orderDocId = metadata.orderId; // The document ID from the admin link flow
    const paymentId = dataObject.id;
    const rawCartItemIds =
      metadata.cartItemIds ??
      metadata.CartItemIds ??
      metadata.cartIds ??
      [];
    const cartItemIds = safeParse(rawCartItemIds, []);
    
    const orderType = metadata.orderType || "Delivery";
    const collectionName = metadata.collectionName || (orderType === "Delivery" ? "DeliveryOrders" : "InStoreOrders");
    
    console.log(`Received Payment Hook. Metadata: { orderId: ${orderDocId}, collection: ${collectionName}, userId: ${userId}, queueNumber: ${queueNumber} }`);
    
    // Check for minimum data required to search for an order
    if (!orderDocId && (!userId || !queueNumber)) {
        console.error("❌ Insufficient metadata (need orderId OR userId/queueNumber). Cannot proceed with payment hook.");
        return { statusCode: 200, body: JSON.stringify({ received: true, error: "Insufficient metadata" }) };
    }
    
    // --- Start Transaction for Atomic Update ---
    try {
      const finalOrderRef = await db.runTransaction(async (transaction) => {
        let orderRef;
        let orderItems;
        let finalOrderRefId = null;
        let orderSnap = null;
        let existingOrderFound = false;


        // 1. Try to find the EXISTING order reference within the transaction
        
        // A. Lookup by Document ID (Covers Admin Link Flow)
        if (orderDocId) {
            orderRef = db.collection(collectionName).doc(orderDocId);
            orderSnap = await transaction.get(orderRef);
            if (orderSnap.exists) {
                existingOrderFound = true;
                console.log(`🔍 Found existing order by Document ID: ${orderDocId}`);
            } else {
                console.warn(`⚠️ Lookup by Document ID failed: ${orderDocId} not found in ${collectionName}.`);
                orderSnap = null;
            }
        }
        
        // B. Fallback to Query by userId/queueNumber (Covers Standard Checkout Flow)
        if (!existingOrderFound && userId && queueNumber) {
            console.log(`🔍 Falling back to query by userId/queueNumber...`);
            const existingOrderQuery = await transaction.get(db.collection(collectionName)
                .where("userId", "==", userId)
                .where("queueNumber", "==", queueNumber)
                .limit(1));

            if (!existingOrderQuery.empty) {
                orderSnap = existingOrderQuery.docs[0];
                orderRef = orderSnap.ref;
                existingOrderFound = true;
                console.log(`🔍 Found existing order by Query: ${orderRef.id}`);
            }
        }


        if (orderSnap && existingOrderFound) {
            finalOrderRefId = orderRef.id;

            // 2. ⭐ CRITICAL CHECK: If already paid, skip. This is now atomic.
            if (orderSnap.data().paymongoPaymentId) {
                console.warn(`⚠️ DUPLICATE PAYMENT HOOK (Transaction): Order ID ${finalOrderRefId} already has Payment ID ${orderSnap.data().paymongoPaymentId}. Skipping transaction.`);
                return null; // Signal that no further action is needed
            }
            
            // Get items from the existing order
            orderItems = orderSnap.data().items || orderSnap.data().products || [];
            
            // 3. Perform the deduction *within the Transaction*
            await deductInventory(orderItems, transaction);
            console.log(`✅ Inventory Deduction applied for order ID ${finalOrderRefId}.`);
            
            // 4. Update the Order document
            transaction.update(orderRef, {
                paymongoPaymentId: paymentId,
                status: "Pending", // Set the final confirmed status
                paymentMetadata: admin.firestore.FieldValue.delete(),
            });
            console.log(`✅ Existing Order ID ${finalOrderRefId} updated to 'Pending'.`);

        } else {
          // Case 3: Order not found by either method. This is an error state.
          console.error("❌ FATAL: Order document was not found using any metadata provided.");
          throw new Error("Order not found or fallback data is insufficient.");
        }
        
        return orderRef;
      });

      // --- Post-Transaction Cleanup ---
      if (finalOrderRef) {
        // Atomically delete cart items (Only applicable for standard checkout flow)
        const batch = db.batch();
        for (const itemId of cartItemIds) {
          if (userId) { // Ensure userId exists before trying to delete cart items
            batch.delete(db.collection("users").doc(userId).collection("cart").doc(itemId));
          }
        }
        await batch.commit();
      
        console.log("--- Webhook Handler Finished Successfully ---");
        return {
          statusCode: 200,
          body: JSON.stringify({ received: true, orderId: finalOrderRef.id }),
        };
      } else {
         // This is for the case where the transaction returned null (duplicate hook)
        console.log("--- Webhook Handler Finished (Duplicate Skipped) ---");
        return { statusCode: 200, body: JSON.stringify({ received: true, warning: "Order already processed, duplicate webhook skipped." }) };
      }

    } catch (err) {
      // Transaction failures (like contention or the manual error throw) end up here
      console.error("❌ TRANSACTION ERROR:", err.message);
      
      // Returning a 200 here prevents PayMongo from retrying repeatedly for a fatal error.
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, error: "Internal processing error: " + err.message, fatal: true }),
      };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
