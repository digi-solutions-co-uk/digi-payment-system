import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Replace with your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyC-lA5TQMrn_Jy6YF-qsI0y6Mvc1UMDyJY",
  authDomain: "digi-payment-system.firebaseapp.com",
  projectId: "digi-payment-system",
  storageBucket: "digi-payment-system.firebasestorage.app",
  messagingSenderId: "659922449124",
  appId: "1:659922449124:web:855a3b5d79a7f24b7d32f1",
  measurementId: "G-99ZRFYP3BL",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");
