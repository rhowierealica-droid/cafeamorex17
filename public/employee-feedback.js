import { db } from './firebase-config.js';

import {
    collection, getDocs, query, orderBy, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const feedbackContainer = document.getElementById('feedback-container');

document.addEventListener("DOMContentLoaded", () => {
    loadFeedback();
});


function getStarHtml(rating) {
    const maxStars = 5;
    let starsHtml = '';
    for (let i = 1; i <= maxStars; i++) {
        starsHtml += i <= rating ? '★' : '☆';
    }
    return `<span class="rating-stars">${starsHtml}</span>`;
}


function maskEmail(email) {
    if (typeof email !== 'string' || !email.includes('@') || email.length < 5) {
        return "No Email Found";
    }

    const atIndex = email.indexOf('@');
    const localPart = email.substring(0, atIndex);
    const domainPart = email.substring(atIndex);

    const firstThree = localPart.substring(0, Math.min(localPart.length, 3));

    return `${firstThree}****${domainPart}`;
}

async function loadFeedback() {
    feedbackContainer.innerHTML = '';
    const ordersRef = collection(db, "DeliveryOrders");
    const q = query(ordersRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    let hasFeedback = false;

    snapshot.forEach(docSnap => {
        const order = docSnap.data();

        if (order.feedback && order.feedback.length > 0 && order.items?.length > 0) {
            hasFeedback = true;

            let emailToMask = order.customerEmail;
            let customerName = order.customerName || "Unknown Customer";

            if ((!emailToMask || !emailToMask.includes('@')) && customerName.includes('@')) {
                emailToMask = customerName;
                customerName = "Customer";
            }

            const maskedEmail = maskEmail(emailToMask);

            const ratings = order.feedbackRating || [];

            order.items.forEach((item, index) => {
                const feedbackText = order.feedback[index];
                const itemRating = ratings[index] || 0;
                const ratingHtml = getStarHtml(itemRating);

                if (feedbackText) {
                    const card = document.createElement('div');
                    card.className = 'feedback-card';

                    card.innerHTML = `
                        <div class="order-info">
                          Order #${order.queueNumber || docSnap.id} - ${customerName} - ${maskedEmail}
                        </div>
                        <div class="item-rating-info">
                          <strong>${item.product}</strong> ${ratingHtml}
                        </div>
                        <div class="feedback-text">
                          <p>💬 ${feedbackText}</p>
                        </div>
                    `;
                    feedbackContainer.appendChild(card);
                }
            });
        }
    });

    if (!hasFeedback) {
        feedbackContainer.innerHTML = '<p class="no-feedback">No feedback available yet.</p>';
    }
}