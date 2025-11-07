// ===========================================
// generate-paymongo-link.js
// Standalone Netlify Function for Admin Approval Flow
// ===========================================

const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

// === PayMongo API Configuration ===
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const PAYMONGO_API = "https://api.paymongo.com/v1";

// === Basic Auth Header ===
const AUTH_HEADER = PAYMONGO_SECRET_KEY
  ? Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString("base64")
  : null;

/**
 * Netlify Function Entry Point
 * Generates a PayMongo Checkout Session link for admin-approved orders
 */
exports.handler = async (event, context) => {
  // 1️⃣ Ensure Environment Variable Exists
  if (!PAYMONGO_SECRET_KEY) {
    console.error("🚨 PAYMONGO_SECRET_KEY is missing from environment.");
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server configuration error: PAYMONGO_SECRET_KEY is missing.",
      }),
    };
  }

  // 2️⃣ Parse Request Body
  let parsedBody;
  try {
    parsedBody = JSON.parse(event.body);
  } catch (e) {
    console.error("🚨 Invalid JSON in request:", e.message);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON format in request body." }),
    };
  }

  // 3️⃣ Extract Data from Body
  const {
    orderId,
    collectionName,
    amount,
    lineItems,
    customerDetails = {},
    description,
  } = parsedBody;

  // 4️⃣ Validate Essential Fields
  const amountInCentavos = Math.round(Number(amount) * 100);

  if (!orderId || !collectionName || !lineItems?.length || amountInCentavos < 100) {
    console.error("🚨 Missing or invalid required data:", parsedBody);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "Invalid order, amount, or line item details.",
      }),
    };
  }

  // 5️⃣ Create Unique Idempotency Key
  const idempotencyKey = uuidv4();

  try {
    // 6️⃣ Call PayMongo API to Create Checkout Session
    const response = await axios.post(
      `${PAYMONGO_API}/checkout_sessions`,
      {
        data: {
          attributes: {
            billing: {
              name: customerDetails.name || "Unknown Customer",
              phone: customerDetails.phone || "",
              email: customerDetails.email || "",
              address: {
                line1: customerDetails.addressLine1 || "",
                line2: customerDetails.addressLine2 || "",
                city: customerDetails.city || "",
                state: customerDetails.state || "",
                postal_code: customerDetails.postalCode || "",
                country: "PH",
              },
            },
            // ✅ Update with your live domain
            success_url: "https://lastcafeamore.netlify.app/customer-status.html",
            cancel_url: "https://lastcafeamore.netlify.app/cart.html",
            send_email_receipt: true,
            description: description || "Order Payment (Admin Approved)",
            line_items: lineItems,
            payment_method_types: ["gcash"],
            metadata: {
              orderId, // 🔹 Required to locate Firestore document
              collectionName, // 🔹 "DeliveryOrders" or "InStoreOrders"
              source: "admin_approval_link", // 🔹 To identify the link type
              userId: customerDetails.userId || "", // 🔹 For webhook lookup
              queueNumber: customerDetails.queueNumber || "", // 🔹 Optional display ID
              orderType: customerDetails.orderType || "Delivery", // 🔹 For record clarity
              cartItemIds: JSON.stringify(customerDetails.cartItemIds || []), // 🔹 For cleanup after payment
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Basic ${AUTH_HEADER}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": idempotencyKey,
        },
      }
    );

    // ✅ Success Response
    const checkoutUrl = response.data?.data?.attributes?.checkout_url;
    if (!checkoutUrl) throw new Error("PayMongo did not return a checkout_url.");

    console.log("✅ PayMongo checkout link created successfully for:", orderId);

    return {
      statusCode: 200,
      body: JSON.stringify({ checkoutUrl }),
    };
  } catch (error) {
    // 7️⃣ Error Handling & Logging
    const errorDetails =
      error.response?.data?.errors?.[0]?.detail || error.message;

    console.error("❌ PayMongo Link Creation Failed:", {
      status: error.response?.status,
      details: errorDetails,
      data: error.response?.data,
    });

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to create checkout session for admin approval.",
        details: errorDetails,
      }),
    };
  }
};

// Netlify automatically uses exports.handler as the function entry point

