require('dotenv').config();
const admin = require('firebase-admin');
const crypto = require('crypto');

// Initialize Firebase Admin
let db = null;
try {
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

// Your webhook secret
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;

function verifyPayMongoSignature(payload, signature) {
    const expected = crypto
        .createHmac('sha256', PAYMONGO_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');
    return signature === expected;
}

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    if (!db) {
        return { statusCode: 500, body: 'Firebase not initialized' };
    }

    try {
        const signature = event.headers['paymongo-signature'];
        if (!verifyPayMongoSignature(event.body, signature)) {
            console.error("Invalid PayMongo webhook signature.");
            return { statusCode: 400, body: 'Invalid signature' };
        }

        const body = JSON.parse(event.body);
        const webhookEvent = body.data.attributes;

        // Handle payment.paid
        if (webhookEvent.type === 'payment.paid') {
            const payment = webhookEvent.data;
            const metadata = payment.attributes.metadata;

            if (!metadata || !metadata.userId || !metadata.queueNumber) {
                console.error("Missing metadata", metadata);
                return { statusCode: 400, body: 'Missing metadata' };
            }

            console.log(`Payment succeeded for Order #${metadata.queueNumber}`);

            // 1. Save order
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
                paymongoPaymentId: payment.id
            });

            // 2. Clear user cart
            if (metadata.cartItemIds?.length > 0) {
                const batch = db.batch();
                metadata.cartItemIds.forEach(cartId => {
                    const cartRef = db.doc(`users/${metadata.userId}/cart/${cartId}`);
                    batch.delete(cartRef);
                });
                await batch.commit();
                console.log(`Cart cleared for Order #${metadata.queueNumber}`);
            }

            return { statusCode: 200, body: 'Webhook processed' };
        }

        return { statusCode: 200, body: `Event type ${webhookEvent.type} acknowledged.` };
    } catch (error) {
        console.error('Webhook processing error:', error);
        return { statusCode: 500, body: 'Error processing webhook' };
    }
};
