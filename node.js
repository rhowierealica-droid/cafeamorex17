// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;

// Create payment link
app.post("/create-payment-link", async (req, res) => {
  const { amount, description } = req.body;
  try {
    const response = await axios.post(
      "https://api.paymongo.com/v1/links",
      {
        data: {
          attributes: {
            amount: amount * 100, // convert to centavos
            currency: "PHP",
            type: "GCash",
            description
          }
        }
      },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({ checkout_url: response.data.data.attributes.checkout_url });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ error: "Failed to create payment link" });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
