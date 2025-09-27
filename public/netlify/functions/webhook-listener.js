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

      // --- fix the loopin: prevent duplicate order using transaction ---
      const orderResult = await db.runTransaction(async (tx) => {
        const existingQuery = await tx.get(
          db.collection("DeliveryOrders").where("paymongoPaymentId", "==", payment.id).limit(1)
        );

        if (!existingQuery.empty) {
          console.log(`⚠️ Order for payment ${payment.id} already exists. Skipping.`);
          return { skipped: true };
        }

        // Parse order items safely
        const rawItems = safeParse(metadata.orderItems, []);
        const orderItems = rawItems.map(item => ({
          id: item.id || "",
          product: item.product || item.name || "Unnamed Product",
          productId: item.productId || null,
          size: item.size || null,
          sizeId: item.sizeId || null,
          qty: Number(item.qty || 1),
          basePrice: Number(item.basePrice || 0),
          sizePrice: Number(item.sizePrice || 0),
          addonsPrice: Number(item.addonsPrice || 0),
          total: Number(item.total || item.totalPrice || 0),
          name: item.name || "Unnamed Product",
          price: Number(item.unitPrice || 0),
          addons: Array.isArray(item.addons) ? item.addons.map(a => ({
            id: a.id || null,
            name: a.name || "Addon",
            price: Number(a.price || 0)
          })) : [],
          ingredients: Array.isArray(item.ingredients) ? item.ingredients.map(i => ({
            id: i.id || null,
            name: i.name || "Ingredient",
            qty: Number(i.qty || 1),
            unit: i.unit || "pcs"
          })) : [],
          others: Array.isArray(item.others) ? item.others.map(o => ({
            id: o.id || null,
            name: o.name || "Other",
            qty: Number(o.qty || 1)
          })) : []
        }));

        // --- Order save like in COD/CASh ---
        const orderRef = db.collection("DeliveryOrders").doc();
        tx.set(orderRef, {
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

        // --- i fix the deduction: deduct inventory immediately ---
        for (const item of orderItems) {
          if (item.productId) await deductInventoryItem(item.productId, item.qty, item.product);
          if (item.sizeId) await deductInventoryItem(item.sizeId, item.qty, `Size of ${item.product}`);
          for (const addon of item.addons) await deductInventoryItem(addon.id, item.qty, `Addon ${addon.name} of ${item.product}`);
          for (const ing of item.ingredients) await deductInventoryItem(ing.id, (ing.qty || 1) * item.qty, `Ingredient ${ing.name} of ${item.product}`);
          for (const other of item.others) await deductInventoryItem(other.id, (other.qty || 1) * item.qty, `Other ${other.name} of ${item.product}`);
        }

        return { skipped: false, orderId: orderRef.id };
      });

      if (orderResult.skipped) {
        return { statusCode: 200, body: JSON.stringify({ received: true, skipped: true }) };
      }

      console.log("💾 Order saved with ID:", orderResult.orderId);

      // --- Remove items from cart after successful order ---
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
  try {
    if (!value) return fallback;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

// Deduct inventory
async function deductInventoryItem(id, qty, name = "Unknown") {
  if (!id) return;
  const invRef = db.collection("Inventory").doc(id);
  const invSnap = await invRef.get();
  const invQty = invSnap.exists ? Number(invSnap.data().quantity || 0) : 0;
  const newQty = Math.max(invQty - qty, 0);
  await invRef.update({ quantity: newQty });
  console.log(`💸 Deducted ${qty} from ${name} (ID: ${id}). New quantity: ${newQty}`);
}

// Restore inventory if needed
async function restoreInventoryItem(id, qty, name = "Unknown") {
  if (!id) return;
  const invRef = db.collection("Inventory").doc(id);
  const invSnap = await invRef.get();
  const invQty = invSnap.exists ? Number(invSnap.data().quantity || 0) : 0;
  await invRef.update({ quantity: invQty + qty });
  console.log(`💹 Restored ${qty} to ${name} (ID: ${id}). New quantity: ${invQty + qty}`);
}
