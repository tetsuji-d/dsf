
// This script verifies that we can connect to Firebase and write data.
// Since we are in a Node environment, we need to polyfill some browser APIs or use the modular SDK carefully.
// However, the Firebase JS SDK v9+ works in Node environments too if we use it correctly.

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc } from "firebase/firestore";
// Storage upload in Node environment is tricky without 'File' object, so we'll skip storage test for now or use a buffer if really needed.
// But verifying Firestore write is the main critical path for "saving work".

const firebaseConfig = {
  apiKey: "AIzaSyBj3U-wFkNsWlW1d4OHayerECMIRyhQ40o",
  authDomain: "vmnn-26345.firebaseapp.com",
  projectId: "vmnn-26345",
  storageBucket: "vmnn-26345.firebasestorage.app",
  messagingSenderId: "16688261830",
  appId: "1:16688261830:web:c218463dd6429774eb3c77",
  measurementId: "G-N6J9C3XCVQ"
};

console.log("Initializing Firebase...");
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testFirestore() {
  console.log("Testing Firestore Write...");
  try {
    const testRef = doc(db, "test_verification", "connection_test");
    await setDoc(testRef, {
      timestamp: new Date().toISOString(),
      status: "verified",
      message: "Blaze plan verification successful from DSF Studio Pro local environment."
    });
    console.log("✅ Firestore Write Successful!");
    
    console.log("Testing Firestore Read...");
    const snap = await getDoc(testRef);
    if (snap.exists()) {
      console.log("✅ Firestore Read Successful:", snap.data());
    } else {
      console.error("❌ Firestore Read Failed: Document not found.");
    }

  } catch (error) {
    console.error("❌ Firestore Error:", error);
    process.exit(1);
  }
}

testFirestore();
