// ===============================
// create-checkout.js (Netlify Function)
// ===============================
require("dotenv").config();
const axios = require("axios");

// -------------------------------
// 🔹 Helper: Build PayMongo line items
// -------------------------------
function buildLineItems(metadata) {
  const lineItems = (metadata.items || metadata.orderItems || []).flatMap(item => {
    const qty = Number(item.qty || 1);
    const baseAmount = Math.round(
      (Number(item.basePrice || 0) + Number(item.sizePrice || 0)) * 100
    );

    const itemsArray = [
      {
        name: item.product || "Unnamed Product",
        currency: "PHP",
        amount: baseAmount,
        quantity: qty,
      },
    ];

    // Add-ons
    (item.addons || []).forEach(addon => {
      itemsArray.push({
        name: `${item.product || "Product"} Add-on: ${addon.name || "Addon"}`,
        currency: "PHP",
        amount: Math.round(Number(addon.price || 0) * 100),
        quantity: qty,
      });
    });

    return itemsArray;
  });

  // Delivery fee
  const deliveryFee = Number(metadata.deliveryFee || 0);
  if (deliveryFee > 0) {
    lineItems.push({
      name: "Delivery Fee",
      currency: "PHP",
      amount: Math.round(deliveryFee * 100),
      quantity: 1,
    });
  }

  // Fallback if lineItems empty
  if (lineItems.length === 0) {
    lineItems.push({
      name: "Order Payment",
      currency: "PHP",
      amount: Math.round(Number(metadata.total || 0) * 100),
      quantity: 1,
    });
  }

  return lineItems;
}

// -------------------------------
// 🔹 Netlify Function Handler
// -------------------------------
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");

    const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
    const BASE_URL = process.env.URL || "https://thriving-profiterole-03bc7e.netlify.app";
    const PAYMONGO_API = "https://api.paymongo.com/v1";

    const metadata = body.orderData || body.metadata || body.commonOrderData || body;

    if (!PAYMONGO_SECRET_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "PAYMONGO_SECRET_KEY not set" }) };
    }

    if (!metadata || !metadata.userId || !metadata.queueNumber || !(metadata.items || metadata.orderItems)?.length) {
      console.error("⚠️ Invalid metadata:", metadata);
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Invalid metadata: Missing userId, queueNumber, or items array.",
        }),
      };
    }

    const lineItems = buildLineItems(metadata);

    // Optional: Verify line items total matches metadata.total
    const sumLineItems = lineItems.reduce((sum, i) => sum + i.amount * i.quantity, 0);
    const expectedTotal = Math.round(Number(metadata.total || 0) * 100);
    if (sumLineItems !== expectedTotal) {
      console.warn("⚠️ Line items total does not match metadata.total", { sumLineItems, expectedTotal });
    }

    // -------------------- 🔹 CHANGES HERE 🔹 --------------------
    // 1. Stringify arrays for proper webhook parsing
    // 2. Include deliveryFee and total in metadata
    const paymongoMetadata = {
      userId: metadata.userId,
      queueNumber: metadata.queueNumber,
      fullOrderData: JSON.stringify({ ...metadata, status: "Pending" }),
      cartItemIds: JSON.stringify(metadata.cartItemIds || []),
      items: JSON.stringify(metadata.items || metadata.orderItems || []), // ✅ ensure items saved
      address: metadata.address || "",
      customerName: metadata.customerName || "",
      customerEmail: metadata.customerEmail || "",
      deliveryFee: metadata.deliveryFee || 0, // ✅ ensure deliveryFee saved
      total: metadata.total || 0            // ✅ ensure total saved
    };

    const payload = {
      data: {
        attributes: {
          success_url: `${BASE_URL}/index.html?status=success`,
          cancel_url: `${BASE_URL}/cart.html?status=cancelled`,
          send_email_receipt: false,
          description: `Payment for Order #${metadata.queueNumber}`,
          line_items: lineItems,
          payment_method_types: ["gcash"],
          metadata: paymongoMetadata,
          customer: {
            name: metadata.customerName || "Customer",
            email: metadata.customerEmail || ""
          },
        },
      },
    };

    const response = await axios.post(`${PAYMONGO_API}/checkout_sessions`, payload, {
      headers: {
        Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        checkout_url: response.data.data.attributes.checkout_url,
      }),
    };
  } catch (error) {
    console.error("❌ PayMongo Checkout Error:", error.response?.data || error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create checkout session",
        details: error.response?.data || error.message,
      }),
    };
  }
};
