import { db } from './firebase-config.js';

import {
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = getAuth();
const feedbackContainer = document.getElementById('feedback-container');

const style = document.createElement('style');
style.textContent = `
.rating-stars { 
  color: gold;
  font-size: 1.2em;
  margin-left: 5px;
}
.feedback-card {
  border: 1px solid #ccc;
  padding: 15px;
  margin-bottom: 15px;
  border-radius: 8px;
  background-color: #f9f9f9;
  transition: box-shadow 0.3s;
}
.feedback-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.order-info {
  font-size: 0.9em;
  color: #555;
  margin-bottom: 10px;
  border-bottom: 1px solid #eee;
  padding-bottom: 5px;
}
.item-rating-info {
  display: flex;
  align-items: center;
  font-weight: bold;
  margin-bottom: 5px;
}
.feedback-text p {
  margin: 5px 0 0 0;
  font-style: italic;
  color: #333;
}
.no-feedback {
  text-align: center;
  padding: 20px;
  color: #777;
}
`;
document.head.appendChild(style);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists() || userDoc.data().role !== "Admin") {
      console.error("Access denied. User is not an Admin.");
      window.location.href = "login.html";
      return;
    }

    console.log("Admin verified, access granted.");
    loadFeedback();

  } catch (err) {
    console.error("Error verifying admin:", err);
    window.location.href = "login.html";
  }
});

function getStarHtml(rating) {
  const maxStars = 5;
  let starsHtml = '';
  for (let i = 1; i <= rating; i++) {
    starsHtml += '★';
  }
  for (let i = rating + 1; i <= maxStars; i++) {
    starsHtml += '☆';
  }
  return `<span class="rating-stars">${starsHtml}</span>`;
}

function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@') || email.length < 5) {
    return "(Email unavailable)";
  }

  const atIndex = email.indexOf('@');
  const localPart = email.substring(0, atIndex);
  const domainPart = email.substring(atIndex);

  if (localPart.length <= 3) {
    const firstChar = localPart.substring(0, 1);
    const mask = '*'.repeat(localPart.length - 1);
    return `${firstChar}${mask}${domainPart}`;
  }

  // Mask all but the first three characters
  const firstThree = localPart.substring(0, 3);
  const maskLength = localPart.length - 3;
  const mask = '*'.repeat(maskLength);

  return `${firstThree}${mask}${domainPart}`;
}

/**
 
 * @param {object} feedback 
 * @returns {{text: string, rating: number, email: string | null}} 
 */
function getCleanFeedbackData(feedback) {
  let text = '*(No text feedback provided)*';
  let rating = 0;
  let email = null; 

  if (feedback && typeof feedback === 'object' && feedback !== null) {
    if (feedback.comment && typeof feedback.comment === 'string') {
      text = feedback.comment.trim() || '*(No text feedback provided)*';
    }
    if (feedback.rating != null) {
      rating = Number(feedback.rating) || 0;
    }
    if (feedback.customerEmail && typeof feedback.customerEmail === 'string') {
      email = feedback.customerEmail;
    }
  } else if (typeof feedback === 'string') {
    text = feedback.trim() || '*(No text feedback provided)*';
  }

  return { text, rating, email };
}

async function loadFeedback() {
  feedbackContainer.innerHTML = '';
  const ordersRef = collection(db, "DeliveryOrders");
  const q = query(ordersRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  let hasFeedback = false;

  snapshot.forEach(docSnap => {
    const order = docSnap.data();
    const feedbackArray = order.feedback || [];
    const items = order.items || [];

    if (feedbackArray.length === 0) return;

    let displayCustomerName = order.customerName || "Customer";
    let orderEmail = order.customerEmail || "";

    feedbackArray.forEach((fb, index) => {
      const { text: cleanFeedbackText, rating: itemRating, email: feedbackEmail } = getCleanFeedbackData(fb);
      const hasValidData = (cleanFeedbackText !== '*(No text feedback provided)*') || (itemRating > 0);

      if (hasValidData) {
        hasFeedback = true;

        let emailToMask = orderEmail;
        if (!emailToMask && feedbackEmail) {
          emailToMask = feedbackEmail;
        }
        const maskedEmail = maskEmail(emailToMask);
        

        const ratingHtml = getStarHtml(itemRating);
        const productName = fb.productName || items[index]?.product || 'Unnamed Item';

        const card = document.createElement('div');
        card.className = 'feedback-card';
        card.innerHTML = `
          <div class="order-info">
            Order #${order.queueNumber || docSnap.id} - (${maskedEmail})
          </div>
          <div class="item-rating-info">
            Item: <strong>${productName}</strong> ${ratingHtml}
          </div>
          <div class="feedback-text">
            <p>💬 ${cleanFeedbackText}</p>
          </div>
        `;
        feedbackContainer.appendChild(card);
      }
    });
  });

  if (!hasFeedback) {
    feedbackContainer.innerHTML = '<p class="no-feedback">No feedback available yet.</p>';
  }
}
