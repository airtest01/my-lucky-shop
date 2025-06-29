const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

// --- ส่วนการเชื่อมต่อที่แก้ไขใหม่ทั้งหมด ---

// สร้าง object สำหรับยืนยันตัวตนจาก Environment Variables แต่ละตัว
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  // ยังคงต้องจัดรูปแบบ private key แต่ดึงมาจากตัวแปรของตัวเอง
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
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

// --- จบส่วนการเชื่อมต่อที่แก้ไขใหม่ทั้งหมด ---


// โค้ดส่วนที่เหลือของไฟล์ (function findAmountInText และ exports.handler) ไม่ต้องแก้ไข
function findAmountInText(text) {
    // ... โค้ดเดิม ...
}

exports.handler = async (event) => {
    // ... โค้ดเดิม ...
};
