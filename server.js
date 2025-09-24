import express from 'express';
import bodyParser from 'body-parser';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();
admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());

app.post('/paymongo-webhook', async (req, res) => {
  const event = req.body;

  console.log("Webhook event received:", event.type);

  try {
    if (event.type === 'payment.paid') {
      const payment = event.data;
      const orderRef = db.collection('DeliveryOrders').doc(payment.attributes.description);
      const orderSnap = await orderRef.get();
      if (orderSnap.exists) {
        await orderRef.update({
          status: 'Paid',
          paymentId: payment.id,
          paidAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Order ${payment.attributes.description} marked as Paid.`);
      }
    }

    res.status(200).send('Webhook received');
  } catch (err) {
    console.error(err);
    res.status(500).send('Webhook error');
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
