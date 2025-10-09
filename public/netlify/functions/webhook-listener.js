// netlify/functions/webhook-listener.js

require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

// PayMongo API endpoint
const PAYMONGO_API = 'https://api.paymongo.com/v1'; // Needed for refund status check

// Initialize Firebase Admin once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
  });
}
const db = admin.firestore();

// --- Helper Functions ---

/**
 * Safely parses stringified JSON fields from PayMongo metadata.
 */
function safeParse(value, fallback = null) {
  try {
    if (!value) return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (e) {
    console.error("Error parsing value:", value, e.message);
    return fallback;
  }
}

/**
 * Atomically decrements the quantity of an item in the Inventory collection.
 */
async function deductInventoryItem(id, qty, name = "Unknown") {
  if (!id || !db || qty <= 0) return;
  try {
    await db.collection("Inventory").doc(id).update({
      quantity: admin.firestore.FieldValue.increment(-Math.abs(qty)) // Decrement quantity
    });
    console.log(`💸 Deducted ${qty} from ${name} (ID: ${id})`);
  } catch (err) {
    console.error(`⚠️ Failed to deduct ${qty} from ${name} (ID: ${id}). Inventory may be zero.`, err.message);
  }
}

/**
 * Returns items to inventory (used for cancelled/refunded orders).
 * NOTE: This is a simplified version; use your full logic if complex.
 */
async function returnItemsToInventory(items) {
  if (!items || !items.length) return;
  for (const item of items) {
    const qty = Number(item.qty || 1);
    const inventoryUpdates = [];
        
    // If your orderItems structure includes inventory IDs for ingredients, addons, etc.,
    // you must put that complex return logic here. For simplicity, we assume an item-based deduction.
    // Since your `deductInventory` logic is complex, it's safer to use the original
    // return logic from your server.js (Section 7/8). I'll use a basic item loop here.

    // --- Return logic based on your deductInventory implementation ---
    for (const ing of item.ingredients || []) inventoryUpdates.push(deductInventoryItem(ing.id, -((ing.qty || 1) * qty))); // Use negative increment to ADD back
    for (const other of item.others || []) inventoryUpdates.push(deductInventoryItem(other.id, -((other.qty || 1) * qty)));
    if (item.sizeId) inventoryUpdates.push(deductInventoryItem(item.sizeId, -qty));
    for (const addon of item.addons || []) inventoryUpdates.push(deductInventoryItem(addon.id, -qty));
  }
  await Promise.all(inventoryUpdates);
}

// --- Main Handler ---

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const webhookSecret = process.env.WEBHOOK_SECRET_KEY;
    if (!webhookSecret) {
      console.error("❌ Missing WEBHOOK_SECRET_KEY");
      return { statusCode: 500, body: "Server misconfigured (Missing secret)" };
    }

    const sigHeader = event.headers["paymongo-signature"];
    if (!sigHeader) return { statusCode: 400, body: "Missing signature header" };

    const sigParts = sigHeader.split(",").reduce((acc, p) => {
      const [k, v] = p.split("=");
      acc[k] = v;
      return acc;
    }, {});
    
    const signature = sigParts.v1 || sigParts.te;
    const timestamp = sigParts.t;
    
    if (!signature || !timestamp) {
        console.error("❌ Invalid signature header format:", sigHeader);
        return { statusCode: 400, body: "Invalid signature header format" };
    }

    // 1. Signature Verification
    const signedPayload = `${timestamp}.${event.body}`; 
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(signedPayload, "utf8");
    const digest = hmac.digest("hex");

    if (digest !== signature) {
      console.error("❌ Invalid webhook signature.");
      return { statusCode: 401, body: "Invalid signature" };
    }
    console.log("✅ Webhook signature verified.");


    // 2. Parse Data
    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const dataObject = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);


    // --- A. Handle Successful Payment / Checkout Completion ---
    if (eventType === "payment.paid" || eventType === "checkout_session.payment.paid") {
      const payment = dataObject;
      const metadata = payment?.attributes?.metadata || {};
      
      // Retrieve and parse critical metadata
      const userId = safeParse(metadata.userId);
      const queueNumber = safeParse(metadata.queueNumber);
      const orderItems = safeParse(metadata.orderItems, []);
      const cartItemIds = safeParse(metadata.cartItemIds, []);
      const paymongoPaymentId = payment?.id;
      const orderTotal = Number(safeParse(metadata.orderTotal) || 0);

      if (!userId || !queueNumber || orderItems.length === 0 || !paymongoPaymentId) {
        console.error("❌ Missing required metadata for fulfillment:", metadata);
        return { statusCode: 400, body: "Missing required order metadata for fulfillment" };
      }
      
      // 2. Fetch Net Amount (Optional but Recommended)
      let paymongoNetAmount = orderTotal;
      try {
          // This fetches the final payment object to get net_amount (after PayMongo fees)
          const response = await axios.get(
              `${PAYMONGO_API}/payments/${paymongoPaymentId}`,
              {
                  headers: {
                      Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
                      Accept: "application/json",
                  },
              }
          );
          paymongoNetAmount = response.data.data.attributes.net_amount / 100;
      } catch (e) {
          console.warn("⚠️ Failed to fetch PayMongo net amount. Defaulting to full total.", e.message);
      }

      // 3. Save Final Order to Firebase
      const newOrderRef = await db.collection("DeliveryOrders").add({
        userId: userId,
        customerName: safeParse(metadata.customerName) || "",
        address: safeParse(metadata.address) || "",
        queueNumber: queueNumber,
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: Number(safeParse(metadata.deliveryFee) || 0),
        total: orderTotal,
        paymongoNetAmount: paymongoNetAmount,
        paymentMethod: "E-Payment", 
        status: "Pending", // Initial status for fulfillment
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: paymongoPaymentId,
      });

      console.log(`✅ Order ${newOrderRef.id} (#${queueNumber}) saved as Pending.`);

      // 4. Deduct inventory (using the simpler item-by-item deduction you defined)
      const deductionPromises = [];
      for (const item of orderItems) {
        const itemQty = Number(item.qty || 1);
        // Simplified, use your full loop from your Server.cjs if it was more complex
        for (const ing of item.ingredients || []) deductionPromises.push(deductInventoryItem(ing.id, (ing.qty || 1) * itemQty));
        for (const other of item.others || []) deductionPromises.push(deductInventoryItem(other.id, (other.qty || 1) * itemQty));
        if (item.sizeId) deductionPromises.push(deductInventoryItem(item.sizeId, itemQty));
        for (const addon of item.addons || []) deductionPromises.push(deductInventoryItem(addon.id, itemQty));
      }
      await Promise.all(deductionPromises);
      console.log("✅ Inventory deducted.");

      // 5. Clear Cart
      const batch = db.batch();
      for (const cartItemId of cartItemIds) {
        batch.delete(db.doc(`users/${userId}/cart/${cartItemId}`));
      }
      await batch.commit();
      console.log("✅ Cart cleared.");
    }


    // --- B. Handle Refund Events ---
    const isRefundEvent = eventType === "refund.succeeded" || eventType === "refund.failed";
    if (isRefundEvent) {
      const refund = dataObject;
      const paymongoPaymentId = refund?.attributes?.payment_id;
      const refundStatus = refund?.attributes?.status;
      const refundId = refund?.id;

      if (!paymongoPaymentId) return { statusCode: 400, body: "Missing payment ID in refund event" };

      // Find the corresponding order in Firestore
      const querySnapshot = await db.collection("DeliveryOrders")
        .where('paymongoPaymentId', '==', paymongoPaymentId)
        .limit(1).get();
      
      if (querySnapshot.empty) {
        console.warn(`⚠️ Refund event received for unknown payment ID: ${paymongoPaymentId}`);
        return { statusCode: 200, body: JSON.stringify({ received: true, message: "Order not found" }) };
      }

      const orderRef = querySnapshot.docs[0].ref;
      const orderData = querySnapshot.docs[0].data();
      
      if (refundStatus === 'succeeded') {
        await orderRef.update({
          status: "Refunded",
          paymongoRefundId: refundId,
          refundStatus: 'succeeded'
        });
        console.log(`✅ Order ${orderRef.id} status updated to REFUNDED.`);
        
        // Return inventory for the refunded order
        await returnItemsToInventory(orderData.items);
        console.log("✅ Inventory returned due to successful refund.");
      } else if (refundStatus === 'failed') {
        await orderRef.update({
          status: "Refund Failed",
          paymongoRefundId: refundId,
          refundStatus: 'failed'
        });
        console.log(`❌ Order ${orderRef.id} status updated to REFUND FAILED.`);
      }
    }
    
    // Acknowledge the webhook
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error("⚠️ Webhook handler error:", error);
    return { statusCode: 500, body: "Webhook handler failed" };
  }
};
