// /.netlify/functions/refund-payment.js

// Using 'node-fetch' for Netlify Node.js environments
const fetch = require('node-fetch');

// ==============================
// PayMongo API Details
// ==============================
const PAYMONGO_API_URL = "https://api.paymongo.com/v1/refunds";
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;

if (!PAYMONGO_SECRET_KEY) {
    console.error("FATAL ERROR: PAYMONGO_SECRET_KEY is not defined in environment variables.");
}

// ==============================
// Lambda Handler
// ==============================
exports.handler = async (event, context) => {
    // 1. Validate HTTP method
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    if (!PAYMONGO_SECRET_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Configuration Error", details: "Server Secret Key missing." })
        };
    }

    // 2. Parse JSON payload
    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, body: 'Invalid JSON payload' };
    }

    // ==============================
    // VALIDATION & DEFAULTS
    // ==============================
    // ✅ Added 'reason' default and safe destructure
    const { paymongoPaymentId, amount, reason } = payload;
    const refundReason = reason || "requested_by_customer"; // Default reason

    if (!paymongoPaymentId || !amount || typeof amount !== 'number' || amount <= 0) {
        return { 
            statusCode: 400, 
            body: JSON.stringify({ 
                error: "Invalid Request", 
                details: "Missing or invalid paymongoPaymentId or amount in body." 
            }) 
        };
    }

    // Convert PHP amount to centavos (PayMongo requirement)
    const amountInCentavos = Math.round(amount * 100);

    try {
        // ==============================
        // 3. Send Refund Request to PayMongo
        // ==============================
        const response = await fetch(PAYMONGO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString('base64')}`
            },
            body: JSON.stringify({
                data: {
                    attributes: {
                        payment_id: paymongoPaymentId,
                        amount: amountInCentavos,
                        reason: refundReason // ✅ Added dynamic reason usage
                    }
                }
            })
        });

        const paymongoData = await response.json();

        // ==============================
        // 4. Check PayMongo Response
        // ==============================
        if (!response.ok || paymongoData.errors) {
            console.error("PayMongo Refund API Error:", paymongoData.errors || { status: response.status, statusText: response.statusText });
            return {
                statusCode: 500,
                body: JSON.stringify({ 
                    error: "PayMongo API Error", 
                    details: paymongoData.errors?.[0]?.detail || `API returned status ${response.status}.`
                })
            };
        }

        // ==============================
        // 5. Refund Initiated Successfully
        // ==============================
        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: "Refund initiated successfully.",
                refundId: paymongoData.data.id,
                paymongoStatus: paymongoData.data.attributes.status 
            })
        };

    } catch (error) {
        console.error("Server Refund Processing Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: "Internal Server Error", 
                details: error.message 
            })
        };
    }
};
