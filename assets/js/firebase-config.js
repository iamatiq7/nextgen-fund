/* ============================================================
   NextGen Fund - Firebase configuration (LIVE)
   Project: nextgen-fund-2040 (connected 2026-09-10)
   These values are public client identifiers; security is
   enforced by Firestore/Storage rules and Authentication.
   ============================================================ */

window.NGF_FIREBASE_CONFIG = {
  apiKey: "AIzaSyC0SxvJnkfSIjv4eMzIpk9xbtAQqD7xYmM",
  authDomain: "nextgen-fund-2040.firebaseapp.com",
  projectId: "nextgen-fund-2040",
  storageBucket: "nextgen-fund-2040.firebasestorage.app",
  messagingSenderId: "179987100574",
  appId: "1:179987100574:web:59e573836e329901e7dc8f"
};


/* ---------------------------------------------------------------------------
   Member documents -> Google Drive (added 2026-09-15)
   Deploy tools/drive-upload/Code.gs as a Web app (Execute as: me, access: anyone)
   and paste the /exec URL below. Empty = the site keeps using Firebase Storage.
   --------------------------------------------------------------------------- */
window.NGF_DRIVE_ENDPOINT = '';
