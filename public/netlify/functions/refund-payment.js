// The 'node-fetch' library is no longer needed as modern Netlify/Lambda
// environments provide a built-in global 'fetch' function, which avoids
// the "ERR_REQUIRE_ESM" module error.

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

    // FIX APPLIED: Assuming 'amount' is already in centavos from the frontend caller.
    const amountInCentavos = Math.round(amount); 
    
    // ⚠️ IMPORTANT DEBUG LOG: Log what we are sending 
    console.log(`[DEBUG] Attempting refund for Payment ID: ${paymongoPaymentId} with amount (centavos): ${amountInCentavos}`);
    console.log(`[DEBUG] Using Refund Reason: ${refundReason}`);


    try {
        // ==============================
        // 3. Send Refund Request to PayMongo
        // ==============================
        // NOTE: Using native global fetch
        const response = await fetch(PAYMONGO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Basic Auth requires a colon after the secret key
                'Authorization': `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString('base64')}`
            },
            body: JSON.stringify({
                data: {
                    attributes: {
                        payment_id: paymongoPaymentId,
                        amount: amountInCentavos,
                        reason: refundReason
                    }
                }
            })
        });

        const paymongoData = await response.json();

        // ⚠️ IMPORTANT DEBUG LOG: Log PayMongo's raw response for inspection
        console.log("[DEBUG] PayMongo API Response Status:", response.status);
        console.log("[DEBUG] PayMongo API Response Body:", JSON.stringify(paymongoData, null, 2));


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
        const finalStatus = paymongoData.data.attributes.status;
        console.log(`[SUCCESS] Refund initiated successfully for ID: ${paymongoData.data.id}. Status: ${finalStatus}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: `Refund initiated successfully with status: ${finalStatus}.`,
                refundId: paymongoData.data.id,
                paymongoStatus: finalStatus 
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
