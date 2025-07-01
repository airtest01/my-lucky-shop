// ในไฟล์ uploadSlip.js

//... (โค้ดส่วนอื่น ๆ ด้านบน)

exports.handler = async (event) => {
  // ---- เพิ่มบรรทัดนี้เข้าไป ----
  console.log("--- EXECUTING UPLOADSLIP CODE VERSION 4.0 (GLOBAL CHECK) ---"); 
  // -------------------------

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    //... (โค้ดที่เหลือ)
  }
  //...
};
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require("firebase-admin/storage");
const vision = require('@google-cloud/vision');
const crypto = require('crypto');

const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
if (!serviceAccountBase64) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not set.");
}
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'my-lucky-shop.firebasestorage.app'
  });
}

const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key }
});

const db = getFirestore();
const bucket = getStorage().bucket();

function findAmountInText(text) {
    const patterns = [
        /^([,\d]+\.\d{2})$/m,
        /(?:จำนวนเงิน|Amount|ยอดโอน)\s+([,\d]+\.\d{2})/i,
        /THB\s+([,\d]+\.\d{2})/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return parseFloat(match[1].replace(/,/g, ''));
        }
    }
    return null;
}

function findTransactionId(text) {
    const patterns = [
        /(?:รหัสอ้างอิง|Ref\.|Ref No\.)[:\s\n]+([\w\d]{10,})/i,
        /(\d{14,})/
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const { imageBase64, reservedNumbers, totalPrice, sellerId, customerData } = body;
    if (!sellerId || !imageBase64 || !reservedNumbers || !customerData) throw new Error('ข้อมูลไม่สมบูรณ์');
    
    const imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // ---- START: ส่วนที่แก้ไข ----
    // เปลี่ยนไปใช้ Collection กลางสำหรับเช็คสลิปซ้ำ
    const slipRef = db.collection('globalUsedSlips').doc(slipHash);
    if ((await slipRef.get()).exists) throw new Error('สลิปนี้ถูกใช้ไปแล้วในระบบ');

    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    if (!detectedText) throw new Error('ไม่สามารถอ่านข้อมูลได้');
    
    const transactionId = findTransactionId(detectedText);
    if (!transactionId) throw new Error('ไม่พบรหัสอ้างอิง');
    
    // เปลี่ยนไปใช้ Collection กลางสำหรับเช็ครหัสอ้างอิงซ้ำ
    const txRef = db.collection('globalUsedTransactionIds').doc(transactionId);
    if ((await txRef.get()).exists) throw new Error('รหัสอ้างอิงนี้ถูกใช้ไปแล้วในระบบ');
    // ---- END: ส่วนที่แก้ไข ----

    const amountOnSlip = findAmountInText(detectedText);
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินไม่ถูกต้อง (ที่อ่านได้: ${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }

    const filePath = `slips/${sellerId}/${slipHash}.jpg`;
    const file = bucket.file(filePath);
    await file.save(imageBuffer, { metadata: { contentType: 'image/jpeg' } });
    await file.makePublic();
    const publicUrl = file.publicUrl();

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

    // ---- START: ส่วนที่แก้ไข ----
    // บันทึกลงทะเบียนกลาง พร้อมระบุว่าใครเป็นคนใช้
    batch.set(slipRef, { usedAt: updateTimestamp, transactionId: transactionId, sellerId: sellerId });
    batch.set(txRef, { usedAt: updateTimestamp, sellerId: sellerId });
    // ---- END: ส่วนที่แก้ไข ----

    await batch.commit();

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'อัปโหลดสำเร็จ' }) };
  } catch (error) {
    console.error("Error in uploadSlip:", error);
    return { statusCode: 500, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
