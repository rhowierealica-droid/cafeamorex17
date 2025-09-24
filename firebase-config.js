import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
 apiKey: "AIzaSyDl0j2V4j-vK0yUvctbYHUJXnXr5VFs1vk",
  authDomain: "cafeamore-7f222.firebaseapp.com",
  projectId: "cafeamore-7f222",
  storageBucket: "cafeamore-7f222.firebasestorage.app",
  messagingSenderId: "1017215131164",
  appId: "1:1017215131164:web:b3ffda4c6ef3b3b0ffc9d9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
