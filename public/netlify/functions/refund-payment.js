const admin = require('firebase-admin');
const axios = require('axios');
const crypto = require('crypto'); // Needed for Buffer and base64 encoding

// ----------------------------------------------------
// 1. FIREBASE ADMIN INITIALIZATION (CRITICAL FOR NETLIFY)
//    - You must set FIREBASE_ADMIN_CONFIG in Netlify environment variables
// ----------------------------------------------------
let db;

if (!admin.apps.length) {
    try {
        // Netlify stores the Service Account JSON as a string environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CONFIG);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        console.log("✅ Firebase Admin Initialized.");
    } catch (e) {
        console.error("❌ FIREBASE ADMIN INIT FAILED:", e.message);
        // db will remain undefined, handled in the main function
    }
} else {
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

    try {
        // 1. Parse Request Body
        const reqBody = JSON.parse(event.body);
        const { paymongoPaymentId, amount } = reqBody; 
        
        // 2. Get Environment Variables
        const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
        const PAYMONGO_API = process.env.PAYMONGO_API_BASE_URL || "https://api.paymongo.com/v1";

        if (!PAYMONGO_SECRET_KEY || !paymongoPaymentId || !amount || Number(amount) <= 0) {
            return { 
                statusCode: 400, 
                body: JSON.stringify({ error: "Invalid refund details provided." }) 
            };
        }
        
        const amountInCentavos = Math.round(Number(amount) * 100);
        
        // 3. Find Order in Firestore
        const deliveryOrdersRef = db.collection("DeliveryOrders");
        const inStoreOrdersRef = db.collection("InStoreOrders");
        
        let orderRef = null;
        let querySnapshot = await deliveryOrdersRef.where('paymongoPaymentId', '==', paymongoPaymentId).limit(1).get();
        
        if (querySnapshot.empty) {
            querySnapshot = await inStoreOrdersRef.where('paymongoPaymentId', '==', paymongoPaymentId).limit(1).get();
            if (!querySnapshot.empty) {
                orderRef = querySnapshot.docs[0].ref;
            }
        } else {
            orderRef = querySnapshot.docs[0].ref;
        }
        
        let previousStatus = "Completed";
        if (orderRef) {
            previousStatus = (await orderRef.get()).data()?.status || previousStatus;
            
            // Immediate status update to signal "Refund in progress"
            await orderRef.update({
                status: "Refund Pending", // Changed from "Canceled" to be more explicit
                refundRequest: true
            });
            console.log(`✅ Order ${orderRef.id} status immediately updated to: Refund Pending`);
        } else {
            console.warn(`⚠️ Order not found for Payment ID: ${paymongoPaymentId}. Continuing with PayMongo request.`);
        }

        // 4. Initiate Refund with PayMongo
        const response = await axios.post(
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

        console.log(`✅ PayMongo Refund initiated for payment ${paymongoPaymentId}. Refund ID: ${response.data.data.id}`);
        
        // 5. Finalize local DB update after successful initiation
        if (orderRef) {
            await orderRef.update({
                paymongoRefundId: response.data.data.id,
                // Note: Final status confirmation (Refunded/Failed) should happen via Webhook
            });
        }

        // 6. Return Success Response
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: "Refund request submitted to PayMongo.",
                paymongoRefundId: response.data.data.id,
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
            await orderRef.update({
                status: previousStatus,
                refundRequest: admin.firestore.FieldValue.delete()
            });
            console.log(`⚠️ Refund failed. Order ${orderRef.id} status reverted to ${previousStatus}.`);
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