
// This script verifies Firebase connectivity against the current security model.
// Anonymous public reads should work; anonymous protected writes should be denied.

import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, getDocs, limit, query } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBj3U-wFkNsWlW1d4OHayerECMIRyhQ40o",
  authDomain: "vmnn-26345.firebaseapp.com",
  projectId: "vmnn-26345",
  storageBucket: "vmnn-26345.firebasestorage.app",
  messagingSenderId: "16688261830",
  appId: "1:166808261830:web:c218463dd04297749eb3c7",
  measurementId: "G-N6J9C3XCVQ"
};

console.log("Initializing Firebase...");
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function testFirestore() {
  console.log("Testing Firestore Public Read...");
  try {
    const publicSnap = await getDocs(query(collection(db, "public_projects"), limit(1)));
    console.log(`✅ Firestore Public Read Successful (${publicSnap.size} docs)`);

    console.log("Testing Firestore Protected Write Denial...");
    const testRef = doc(db, "test_verification", "connection_test");
    await setDoc(testRef, {
      timestamp: new Date().toISOString(),
      status: "verified",
      message: "This anonymous write must be denied by Firestore rules."
    });
    console.error("❌ Firestore Rules Error: anonymous protected write unexpectedly succeeded.");
    process.exit(1);
  } catch (error) {
    if (error?.code === "permission-denied") {
      console.log("✅ Firestore Protected Write Correctly Denied.");
      return;
    }
    console.error("❌ Firestore Error:", error);
    process.exit(1);
  }
}

testFirestore();
