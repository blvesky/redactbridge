// Copy this file to firebase-config.js, fill in the values from
// Firebase Console > Project settings (project created under the ckpurshit
// Google account), and include it BEFORE cloud.js in index.html:
//
//   <script src="firebase-config.js"></script>
//
// NEVER commit a filled-in firebase-config.js, an App Check debug token, or
// any .env to the public repo (hackathon FAQ rule). The values below are
// placeholders, not real credentials.
window.RB_FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID"
};

// Local development only (App Check debug token flow):
// uncomment, load the page once, copy the token printed in the console into
// Firebase Console > App Check > Apps > Manage debug tokens.
// self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
