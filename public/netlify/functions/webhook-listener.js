// netlify/functions/webhook-listener.js
require('dotenv').config();
const admin = require('firebase-admin');

// 🚨 ACTION REQUIRED: Initialize Firebase Admin using environment variables. 
// You must set the GOOGLE_APPLICATION_CREDENTIALS environment variable in Netlify.
// This example uses a simplified initialization for deployment.
let db = null;
try {
    // You MUST put your service account key content into Netlify's environment variables.
    // The key content is often stored as a single variable called FIREBASE_SERVICE_ACCOUNT_KEY
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY); 
    
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    db = admin.firestore();
} catch (e) {
    console.error("Firebase Admin SDK initialization failed:", e.message);
}

exports.handler = async (event, context) => {
    // Only allow POST requests (PayMongo webhooks are POST)
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }
    
    // Check if the database is initialized
    if (!db) {
        return { statusCode: 500, body: 'Server setup error (Firebase Admin failed to initialize)' };
    }

    try {
        const body = JSON.parse(event.body);
        const webhookEvent = body.data.attributes;

        if (webhookEvent.type === 'checkout_session.paid') {
            const session = webhookEvent.data;
            const metadata = session.attributes.metadata;
            
            if (!metadata || !metadata.userId || !metadata.queueNumber) {
                console.error("Webhook failed: Missing essential metadata.", metadata);
                return { statusCode: 400, body: 'Missing metadata' };
            }

            console.log(`Payment Succeeded for Order #${metadata.queueNumber}. Processing order...`);

            // 1. Record the order in Firebase
            await db.collection("DeliveryOrders").add({
                userId: metadata.userId,
                customerName: metadata.customerName, 
                address: metadata.address,
                queueNumber: metadata.queueNumber,
                orderType: "Delivery",
                items: metadata.orderItems, 
                deliveryFee: metadata.deliveryFee,
                total: metadata.orderTotal,
                paymentMethod: "GCash",
                status: "Paid", 
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                paymongoSessionId: session.id 
            });

            // 2. Clear the ordered items from the user's cart
            if (metadata.cartItemIds && metadata.cartItemIds.length > 0) {
                const batch = db.batch();
                metadata.cartItemIds.forEach(cartId => {
                    const cartRef = db.doc(`users/${metadata.userId}/cart/${cartId}`);
                    batch.delete(cartRef);
                });
                await batch.commit();
                console.log(`Cart cleared for Order #${metadata.queueNumber}`);
            }

            return { statusCode: 200, body: 'Webhook received and processed' };

        } else {
            // Acknowledge other events (like checkout_session.expired)
            return { statusCode: 200, body: `Event type ${webhookEvent.type} acknowledged.` };
        }
        
    } catch (error) {
        console.error('Webhook processing error:', error);
        return { statusCode: 500, body: 'Error processing webhook' };
    }
};