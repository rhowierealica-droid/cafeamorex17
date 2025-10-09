const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto'); // Used for Buffer and base64 encoding

// ----------------------------------------------------
// 1. FIREBASE ADMIN INITIALIZATION
// ----------------------------------------------------
let db;

if (!admin.apps.length) {
    try {
        // Netlify stores the Service Account JSON as a single string environment variable
        // The previously corrected FIREBASE_ADMIN_CONFIG variable handles the JSON.parse
        const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CONFIG);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("✅ Firebase Admin Initialized.");
    } catch (e) {
        console.error("❌ FIREBASE ADMIN INIT FAILED:", e.message);
        // db will remain undefined if initialization fails
    }
} else {
    // If already initialized (e.g., in development or warm start)
    db = admin.firestore();
}

// ----------------------------------------------------
// 2. MAIN NETLIFY HANDLER FUNCTION
// ----------------------------------------------------
exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    // Check for Firebase initialization failure
    if (!db) {
        return { statusCode: 500, body: JSON.stringify({ error: "Firebase not initialized." }) };
    }

    let orderRef = null; // Declare outside try block so it's accessible in catch

    try {
        // 1. Parse Request Body
        const reqBody = JSON.parse(event.body);
        const { paymongoPaymentId, amount } = reqBody; 
        
        // 2. Get Environment Variables & Validate Input
        const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
        const PAYMONGO_API = process.env.PAYMONGO_API_BASE_URL || "https://api.paymongo.com/v1";

        if (!PAYMONGO_SECRET_KEY || !paymongoPaymentId || !amount || Number(amount) <= 0) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: "Invalid refund details or missing secret key." }) 
            };
        }
        
        const amountInCentavos = Math.round(Number(amount) * 100);
        
        // 3. Find Order in Firestore
        const deliveryOrdersRef = db.collection("DeliveryOrders");
        const inStoreOrdersRef = db.collection("InStoreOrders");
        
        let previousStatus = "Completed"; // Default status if order is not found/no previous status

        let querySnapshot = await deliveryOrdersRef.where('paymongoPaymentId', '==', paymongoPaymentId).limit(1).get();
        
        if (querySnapshot.empty) {
            querySnapshot = await inStoreOrdersRef.where('paymongoPaymentId', '==', paymongoPaymentId).limit(1).get();
            if (!querySnapshot.empty) {
                orderRef = querySnapshot.docs[0].ref;
            }
        } else {
            orderRef = querySnapshot.docs[0].ref;
        }
        
        if (orderRef) {
            // Store current status to revert to in case of PayMongo failure
            previousStatus = (await orderRef.get()).data()?.status || previousStatus; 
            
            // Immediate status update to signal "Refund in progress"
            await orderRef.update({
                status: "Refund Pending", // Status while waiting for PayMongo response/webhook
                refundRequest: true,
                // Add the amount being refunded to the DB for tracking
                refundAmount: amount, 
                refundRequestedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`✅ Order ${orderRef.id} status updated to: Refund Pending`);
        } else {
            console.warn(`⚠️ Order not found for Payment ID: ${paymongoPaymentId}. Continuing with PayMongo request.`);
        }

        // 4. Initiate Refund with PayMongo
        const paymongoResponse = await axios.post(
            `${PAYMONGO_API}/refunds`,
            {
                data: {
                    attributes: {
                        payment_id: paymongoPaymentId,
                        amount: amountInCentavos, 
                        reason: "requested_by_customer" 
                    }
                }
            },
            {
                headers: {
                    // PayMongo requires Basic Authorization header with the secret key
                    Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
            }
        );

        const paymongoRefundId = paymongoResponse.data.data.id;
        console.log(`✅ PayMongo Refund initiated for payment ${paymongoPaymentId}. Refund ID: ${paymongoRefundId}`);
        
        // 5. Finalize local DB update after successful initiation
        if (orderRef) {
            await orderRef.update({
                paymongoRefundId: paymongoRefundId,
                // Do NOT set final status here. Webhook handles 'Refunded' or 'Refund Failed'.
            });
        }

        // 6. Return Success Response
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Refund request submitted to PayMongo.",
                paymongoRefundId: paymongoRefundId,
            }),
        };

    } catch (error) {
        // 7. Handle Errors
        console.error(
            "❌ PayMongo Refund Initiation Error:",
            error.response?.data || error.message
        );
        
        // Revert status if the PayMongo API call failed immediately
        if (orderRef) {
            try {
                 await orderRef.update({
                    status: previousStatus, // Revert to the status before 'Refund Pending' (usually 'Completed')
                    refundRequest: admin.firestore.FieldValue.delete(), // Remove the request flag
                    refundAmount: admin.firestore.FieldValue.delete(), // Remove temporary amount field
                    refundRequestedAt: admin.firestore.FieldValue.delete(), // Remove timestamp field
                 });
                 console.log(`⚠️ Refund failed. Order ${orderRef.id} status reverted to ${previousStatus}.`);
            } catch (updateError) {
                console.error("Failed to revert order status:", updateError.message);
            }
        }
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: "Failed to initiate refund with PayMongo.",
                details: error.response?.data?.errors?.[0]?.detail || error.message,
            }),
        };
    }
};
