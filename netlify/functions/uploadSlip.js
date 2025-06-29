const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

// --- ส่วนการเชื่อมต่อที่แก้ไขใหม่ ---

// อ่านค่าจาก Environment Variable
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CONFIG);
const projectId = serviceAccount.project_id;
const credentials = {
  client_email: serviceAccount.client_email,
  private_key: serviceAccount.private_key,
};

// Initialize Firebase (ถ้ายังไม่เคยทำ)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Initialize Vision API โดยส่งค่า credential และ projectId เข้าไปโดยตรง
const visionClient = new vision.ImageAnnotatorClient({
  projectId,
  credentials,
});

const db = getFirestore();

// --- จบส่วนการเชื่อมต่อที่แก้ไขใหม่ ---


// ฟังก์ชันสำหรับค้นหาจำนวนเงินจากข้อความ (โค้ดส่วนนี้เหมือนเดิม)
function findAmountInText(text) {
    // ... โค้ดส่วนนี้ไม่ต้องแก้ไข ...
}

// Main Handler (โค้ดส่วนนี้เหมือนเดิม)
exports.handler = async (event) => {
    // ... โค้ดส่วนนี้ไม่ต้องแก้ไข ...
};
