const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

// --- ส่วนการเชื่อมต่อที่แก้ไขใหม่ ---

const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CONFIG);
const projectId = serviceAccount.project_id;

// จัดการรูปแบบของ private_key โดยการแทนที่ '\\n' ด้วย '\n'
const credentials = {
  client_email: serviceAccount.client_email,
  private_key: serviceAccount.private_key.replace(/\\n/g, '\n'),
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


// โค้ดส่วนที่เหลือของไฟล์ไม่ต้องแก้ไข
function findAmountInText(text) {
  // ...
}

exports.handler = async (event) => {
  // ...
};
