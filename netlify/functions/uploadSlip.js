const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require("firebase-admin/storage");
const vision = require('@google-cloud/vision');
const crypto = require('crypto');

// --- ส่วนการเชื่อมต่อ ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
if (!serviceAccountBase64) {
    throw new Error("Firebase service account is not set in environment variables.");
}
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: `${serviceAccount.project_id}.appspot.com`
  });
}

const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key }
});

const db = getFirestore();
const bucket = getStorage().bucket();

// --- ฟังก์ชันเสริม ---
function findAmountInText(text) { /* ... */ }
function findTransactionId(text) { /* ... */ }

// --- โค้ดหลักของฟังก์ชัน ---
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const { imageBase64, reservedNumbers, totalPrice, sellerId, customerData } = body;
    if (!sellerId || !imageBase64 || !reservedNumbers || !customerData) throw new Error('ข้อมูลที่ส่งมาไม่สมบูรณ์');
    
    const imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // Check for duplicate slip hash
    const slipRef = db.collection('sellers').doc(sellerId).collection('usedSlips').doc(slipHash);
    const slipDoc = await slipRef.get();
    if (slipDoc.exists) throw new Error('สลิปนี้ถูกใช้งานไปแล้ว');

    // OCR
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    if (!detectedText) throw new Error('ไม่สามารถอ่านข้อมูลจากรูปภาพได้');
    
    // Check for duplicate transaction ID
    const transactionId = findTransactionId(detectedText);
    if (!transactionId) throw new Error('ไม่สามารถหารหัสอ้างอิงในสลิปได้');
    const txRef = db.collection('sellers').doc(sellerId).collection('usedTransactionIds').doc(transactionId);
    const txDoc = await txRef.get();
    if (txDoc.exists) throw new Error('สลิปนี้มีรหัสอ้างอิงที่ถูกใช้งานไปแล้ว');

    // Check amount
    const amountOnSlip = findAmountInText(detectedText);
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินในสลิปไม่ถูกต้อง (${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }

    // Upload image to Storage
    const filePath = `slips/${sellerId}/${slipHash}.jpg`;
    const file = bucket.file(filePath);
    await file.save(imageBuffer, { metadata: { contentType: 'image/jpeg' } });
    await file.makePublic();
    const publicUrl = file.publicUrl();

    // Batch write to Firestore
    const batch = db.batch();
    const updateTimestamp = new Date();
    reservedNumbers.forEach(number => {
      const numberRef = db.collection('sellers').doc(sellerId).collection('numbers').doc(number);
      batch.set(numberRef, { 
        status: 'needs_review', 
        paidAt: updateTimestamp,
        customerName: customerData.name,
        customerPhone: customerData.phone,
        slipUrl: publicUrl
      });
    });
    batch.set(slipRef, { usedAt: updateTimestamp, transactionId: transactionId });
    batch.set(txRef, { usedAt: updateTimestamp });
    await batch.commit();

    // LINE Notification (optional)
    // ...

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'อัปโหลดสลิปสำเร็จ' }) };
  } catch (error) {
    console.error('--- ERROR in uploadSlip function: ---', error);
    return { statusCode: 500, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
