const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

// --- ส่วนการเชื่อมต่อใหม่โดยใช้ Base64 ---

// 1. อ่านค่า Base64 จาก Environment Variable
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

// 2. ถอดรหัส Base64 กลับมาเป็น JSON String
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');

// 3. แปลง JSON String เป็น Object
const serviceAccount = JSON.parse(serviceAccountJson);

// Initialize Firebase (ถ้ายังไม่เคยทำ)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Initialize Vision API
const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  }
});

const db = getFirestore();

// --- จบส่วนการเชื่อมต่อ ---

// โค้ดส่วนที่เหลือของไฟล์ไม่ต้องแก้ไข
function findAmountInText(text) {
    // ... โค้ดเดิม ...
}

exports.handler = async (event) => {
    // ... โค้ดเดิม ...
};
