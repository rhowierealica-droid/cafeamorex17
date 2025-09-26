// netlify/functions/webhook-listener.js
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

    const sigParts = sigHeader.split(",");
    const sigMap = {};
    sigParts.forEach((p) => {
      const [k, v] = p.split("=");
      sigMap[k] = v;
    });
    const signature = sigMap.te || sigMap.v1;
    const timestamp = sigMap.t;
    if (!signature || !timestamp) return { statusCode: 400, body: "Invalid signature header" };

    const signedPayload = `${timestamp}.${event.body}`;
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(signedPayload, "utf8");
    const digest = hmac.digest("hex");
    if (digest !== signature) return { statusCode: 401, body: "Invalid signature" };

    const body = JSON.parse(event.body);
    const eventType = body.data?.attributes?.type;
    const payment = body.data?.attributes?.data;

    console.log("🔔 PayMongo Webhook Event:", eventType);

    if (eventType === "payment.paid") {
      const metadata = payment?.attributes?.metadata || {};
      if (!metadata.userId || !metadata.queueNumber) {
        return { statusCode: 400, body: "Missing metadata" };
      }

      console.log(`✅ Payment confirmed for Order #${metadata.queueNumber}`);

      // Parse order items
      const rawItems = safeParse(metadata.orderItems, []);
      const orderItems = rawItems.map(item => ({
        product: item.product || item.name,
        productId: item.productId || null,
        size: item.size || null,
        sizeId: item.sizeId || null,
        qty: Number(item.qty || 1),
        basePrice: Number(item.basePrice || 0),
        sizePrice: Number(item.sizePrice || 0),
        addonsPrice: Number(item.addonsPrice || 0),
        addons: item.addons || [],
        ingredients: item.ingredients || [],
        others: item.others || [],
        total: Number(item.total || item.totalPrice || 0),
      }));

      // Save order in Firestore
      const orderRef = await db.collection("DeliveryOrders").add({
        userId: metadata.userId,
        customerName: metadata.customerName || metadata.email || "Customer",
        address: metadata.address || "",
        queueNumber: metadata.queueNumber,
        orderType: "Delivery",
        items: orderItems,
        deliveryFee: parseFloat(metadata.deliveryFee) || 0,
        total: parseFloat(metadata.orderTotal) || 0,
        paymentMethod: "GCash",
        status: "Pending",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paymongoPaymentId: payment.id,
      });

      console.log("💾 Order saved with ID:", orderRef.id);

      // Deduct inventory
      async function deductInventory(order) {
        const deductItem = async (id, amount, name = "Unknown") => {
          if (!id) return;
          const invRef = db.collection("Inventory").doc(id);
          const invSnap = await invRef.get();
          const invQty = invSnap.exists ? Number(invSnap.data().quantity || 0) : 0;
          const newQty = Math.max(invQty - amount, 0);
          await invRef.update({ quantity: newQty });
          console.log(`💸 Deducted ${amount} from ${name} (ID: ${id}). New quantity: ${newQty}`);
        };

        for (const item of order) {
          if (item.productId) await deductItem(item.productId, item.qty, item.product);
          if (item.sizeId) await deductItem(item.sizeId, item.qty, `Size of ${item.product}`);
          for (const addon of item.addons || []) await deductItem(addon.id, item.qty, `Addon ${addon.name} of ${item.product}`);
          for (const ing of item.ingredients || []) await deductItem(ing.id, (ing.qty || 1) * item.qty, `Ingredient ${ing.name} of ${item.product}`);
          for (const other of item.others || []) await deductItem(other.id, (other.qty || 1) * item.qty, `Other ${other.name} of ${item.product}`);
        }
      }

      await deductInventory(orderItems);

      // Clear user's cart items
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

// Helper: safely parse JSON
function safeParse(value, fallback) {
  try {
    if (!value) return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}
