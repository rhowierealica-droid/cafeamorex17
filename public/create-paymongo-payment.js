const axios = require("axios");

exports.handler = async (event, context) => {
  try {
    const { total, items, address } = JSON.parse(event.body);

    const response = await axios.post(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        data: {
          attributes: {
            line_items: [
              {
                currency: "PHP",
                amount: Math.round(total * 100), // PayMongo expects cents
                name: "Cafe Amore Order",
                quantity: 1
              }
            ],
            payment_method_types: ["gcash"],
            success_url: "https://zesty-beijinho-3dff6d.netlify.app/success.html",
            cancel_url: "https://zesty-beijinho-3dff6d.netlify.app/cancel.html"
          }
        }
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(process.env.PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
          "Content-Type": "application/json"
        }
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ url: response.data.data.attributes.checkout_url })
    };
  } catch (err) {
    console.error(err.response?.data || err.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Payment creation failed" }) };
  }
};
