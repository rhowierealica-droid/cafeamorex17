const Paymongo = require('paymongo');
const paymongo = new Paymongo("YOUR_SECRET_KEY");

(async () => {
  const paymentIntent = await paymongo.paymentIntents.create({
    amount: 10000, // 100.00 PHP
    currency: 'PHP',
    payment_method_types: ['card']
  });

  console.log(paymentIntent.client_secret);
})();
