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
    storageBucket: `${serviceAccount.project_id}.appspot.com`
  });
}

const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key }
});

const db = getFirestore();
const bucket = getStorage().bucket();

// =================================================================
// ส่วนของฟังก์ชันที่เพิ่มเข้ามาใหม่
// =================================================================
function findAmountInText(text) {
    const patterns = [
        // เพิ่มรูปแบบใหม่: มองหาบรรทัดที่มีแค่ตัวเลขยอดเงินอย่างเดียว
        // รูปแบบนี้จะแม่นยำกับสลิปที่ให้มามาก
        /^([,\d]+\.\d{2})$/m,
        
        // รูปแบบเดิม (ปรับปรุงเล็กน้อย) ใช้เป็นตัวสำรอง
        /(?:จำนวนเงิน|Amount|ยอดโอน)\s+([,\d]+\.\d{2})/i,
        /THB\s+([,\d]+\.\d{2})/i
    ];
    for (const pattern of patterns) {
        // ลองค้นหาด้วยแต่ละรูปแบบ
        const match = text.match(pattern);
        if (match && match[1]) {
            // ถ้าเจอ ให้แปลงเป็นตัวเลขแล้วส่งค่ากลับ
            return parseFloat(match[1].replace(/,/g, ''));
        }
    }
    // ถ้าไม่เจอเลย
    return null;
}

function findTransactionId(text) {
    // มองหาข้อความที่น่าจะเป็นรหัสอ้างอิงของธนาคาร
    // ตัวอย่าง: รหัสอ้างอิง 20240701... , Ref. 012345...
    const patterns = [
        /(?:รหัสอ้างอิง|Ref\.|Ref No\.)[:\s\n]+([\w\d]{10,})/i,
        /(\d{14,})/ // มองหาตัวเลขยาวๆ ที่อาจเป็นรหัสอ้างอิงโดยตรง
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    return null; // ถ้าหาไม่เจอ ให้คืนค่า null
}
// =================================================================
// จบส่วนของฟังก์ชันที่เพิ่มเข้ามา
// =================================================================


exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const body = JSON.parse(event.body);
    const { imageBase64, reservedNumbers, totalPrice, sellerId, customerData } = body;
    if (!sellerId || !imageBase64 || !reservedNumbers || !customerData) throw new Error('ข้อมูลไม่สมบูรณ์');
    
    const imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    const slipRef = db.collection('sellers').doc(sellerId).collection('usedSlips').doc(slipHash);
    if ((await slipRef.get()).exists) throw new Error('สลิปนี้ถูกใช้แล้ว');

    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    if (!detectedText) throw new Error('ไม่สามารถอ่านข้อมูลได้');
    
    const transactionId = findTransactionId(detectedText);
    if (!transactionId) throw new Error('ไม่พบรหัสอ้างอิง');
    const txRef = db.collection('sellers').doc(sellerId).collection('usedTransactionIds').doc(transactionId);
    if ((await txRef.get()).exists) throw new Error('รหัสอ้างอิงนี้ถูกใช้แล้ว');

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
    batch.set(slipRef, { usedAt: updateTimestamp, transactionId: transactionId });
    batch.set(txRef, { usedAt: updateTimestamp });
    await batch.commit();

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'อัปโหลดสำเร็จ' }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
