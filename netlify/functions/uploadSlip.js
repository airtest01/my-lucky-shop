const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

// --- ส่วนการเชื่อมต่อที่แก้ไขใหม่ (Simplified) ---

// สร้าง object สำหรับยืนยันตัวตนจาก Environment Variables โดยตรง
// โดยเอา .replace ออก
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY, 
};

// Initialize Firebase ด้วย object ที่สร้างขึ้น
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey
    }),
  });
}

// Initialize Vision API ด้วย object เดียวกัน
const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.projectId,
  credentials: {
    client_email: serviceAccount.clientEmail,
    private_key: serviceAccount.privateKey,
  }
});

const db = getFirestore();

// --- จบส่วนการเชื่อมต่อที่แก้ไขใหม่ ---


// โค้ดส่วนที่เหลือของไฟล์ไม่ต้องแก้ไข
function findAmountInText(text) {
    // ... โค้ดเดิม ...
}

exports.handler = async (event) => {
    // ... โค้ดเดิม ...
};
