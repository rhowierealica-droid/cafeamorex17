require("dotenv").config();
const crypto = require("crypto");
const admin = require("firebase-admin");

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    ),
  });
}
const db = admin.firestore();

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const webhookSecret = process.env.WEBHOOK_SECRET_KEY;
    if (!webhookSecret) return { statusCode: 500, body: "Server misconfigured" };

    // Verify PayMongo signature
    const sigHeader = event.headers["paymongo-signature"];
    if (!sigHeader) return { statusCode: 400, body: "Missing signature header" };

    const sigMap = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
    const signature = sigMap.te || sigMap.v1;
    const timestamp = sigMap.t;
    if (!signature || !timestamp) return { statusCode: 400, body: "Invalid signature header" };

    const signedPayload = `${timestamp}.${event.body}`;
    const digest = crypto.createHmac("sha256", webhookSecret).update(signedPayload, "utf8").digest("hex");
    if (digest !== signature) return { statusCode: 401, body: "Invalid signature" };

    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const payment = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);

    if (eventType === "payment.paid") {
      const metadata = payment?.attributes?.metadata || {};
      if (!metadata.userId || !metadata.queueNumber) return { statusCode: 400, body: "Missing metadata" };

      // --- Prevent duplicate processing ---
      const existingQuery = await db
        .collection("DeliveryOrders")
        .where("paymongoPaymentId", "==", payment.id)
        .limit(1)
        .get();

      if (!existingQuery.empty) {
        console.log(`⚠️ Order already processed for payment ${payment.id}`);
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: true }) };
      }

      const orderItems = safeParse(metadata.orderItems, []);

      // --- Save order like COD/GCash ---
      const orderRef = db.collection("DeliveryOrders").doc();
      await orderRef.set({
        userId: metadata.userId,
        customerName: metadata.customerName || metadata.email || "Customer",
        email: metadata.email || null,
        address: metadata.address || "",
        queueNumber: metadata.queueNumber.toString(),
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: parseFloat(metadata.deliveryFee) || 0,
        total: parseFloat(metadata.orderTotal) || 0,
        paymentMethod: "GCash",
        status: "Pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: payment.id
      });

      console.log("💾 Order saved with ID:", orderRef.id);

      // --- Deduct inventory safely ---
      for (const item of orderItems) {
        if (item.productId) await deductInventoryItem(item.productId, item.qty, item.product);
        if (item.sizeId) await deductInventoryItem(item.sizeId, item.qty, `Size of ${item.product}`);
        for (const addon of item.addons || []) await deductInventoryItem(addon.id, item.qty, `Addon ${addon.name} of ${item.product}`);
        for (const ing of item.ingredients || []) await deductInventoryItem(ing.id, (ing.qty || 1) * item.qty, `Ingredient ${ing.name} of ${item.product}`);
        for (const other of item.others || []) await deductInventoryItem(other.id, (other.qty || 1) * item.qty, `Other ${other.name} of ${item.product}`);
      }

      // --- Remove purchased cart items ---
      const cartItemIds = safeParse(metadata.cartItemIds, []);
      if (Array.isArray(cartItemIds) && metadata.userId) {
        for (const cartItemId of cartItemIds) {
          try {
            await db.collection("users").doc(metadata.userId).collection("cart").doc(cartItemId).delete();
            console.log(`🗑️ Removed cart item ${cartItemId}`);
          } catch (err) {
            console.error(`❌ Failed to delete cart item ${cartItemId}`, err);
          }
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (error) {
    console.error("⚠️ Webhook handler error:", error);
    return { statusCode: 500, body: "Webhook handler failed" };
  }
};

// Helper to safely parse JSON
function safeParse(value, fallback) {
  try { return typeof value === "string" ? JSON.parse(value) : value || fallback; }
  catch { return fallback; }
}

// Deduct inventory helper
async function deductInventoryItem(id, qty, name = "Unknown") {
  if (!id) return;
  const invRef = db.collection("Inventory").doc(id);
  const invSnap = await invRef.get();
  const currentQty = invSnap.exists ? Number(invSnap.data().quantity || 0) : 0;
  const newQty = Math.max(currentQty - qty, 0);
  await invRef.update({ quantity: newQty });
  console.log(`💸 Deducted ${qty} from ${name} (ID: ${id}). New quantity: ${newQty}`);
}
