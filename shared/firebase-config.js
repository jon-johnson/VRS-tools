// VRS Sailing Tools — Firebase Configuration
// Project: vrs-sailing-tools

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6840waRqWQP8K3nAHVdbL-Lyh_FuAZ6A",
  authDomain: "vrs-sailing-tools.firebaseapp.com",
  projectId: "vrs-sailing-tools",
  storageBucket: "vrs-sailing-tools.firebasestorage.app",
  messagingSenderId: "1075889442099",
  appId: "1:1075889442099:web:37cdef2784422790cb0246"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
