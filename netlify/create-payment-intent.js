// netlify/functions/create-payment-link.js
import fetch from "node-fetch";

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { amount, description } = JSON.parse(event.body);

    // PayMongo expects amount in centavos
    const payload = {
      data: {
        attributes: {
          amount: Math.round(amount * 100), // ₱ to centavos
          currency: "PHP",
          payment_method_types: ["gcash"],
          description: description || "Purchase",
          redirect: {
            success: "https://zesty-beijinho-3dff6d.netlify.app/success.html",
            failed: "https://zesty-beijinho-3dff6d.netlify.app/failed.html"
          }
        }
      }
    };

    const res = await fetch("https://api.paymongo.com/v1/links", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      return { statusCode: 200, body: JSON.stringify({ checkout_url: data.data.attributes.checkout_url }) };
    } else {
      console.error("PayMongo error:", data);
      return { statusCode: 500, body: JSON.stringify(data) };
    }
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
