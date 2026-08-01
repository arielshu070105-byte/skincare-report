import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// 跟保養品回報共用同一個 Firebase 專案(charis-inventory),資料庫分開的集合(insuranceSubmissions),
// 帳號密碼也共用同一組 Firebase Auth 使用者。
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyCvuSJPYWzS7w-BStkeK8aq1wgEAtV1ipM",
  authDomain: "charis-inventory.firebaseapp.com",
  projectId: "charis-inventory",
  storageBucket: "charis-inventory.firebasestorage.app",
  messagingSenderId: "1008317501020",
  appId: "1:1008317501020:web:316e2f3744bea78b0ae099",
};

export function initFirebase() {
  const app = initializeApp(DEFAULT_CONFIG, "insuranceApp");
  return { app, db: getFirestore(app), auth: getAuth(app) };
}
