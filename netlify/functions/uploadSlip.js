const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage'); //
const vision = require('@google-cloud/vision');
const crypto = require('crypto');

// --- ส่วนที่ 1: การเชื่อมต่อและการยืนยันตัวตน ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

// ตรวจสอบว่า Environment Variable ถูกตั้งค่าหรือไม่
if (!serviceAccountBase64) {
    // โยน Error ทันทีถ้าไม่พบค่าที่จำเป็น
    throw new Error("FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is not set.");
}

const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key.replace(/\\n/g, '\n') // จัดการ Newline สำหรับ Private Key
  }
});

const db = getFirestore();
const bucket = getStorage().bucket("gs://my-lucky-shop.appspot.com")
// --- ส่วนที่ 2: ฟังก์ชันเสริมสำหรับค้นหาข้อมูล ---

function findAmountInText(text) {
  const lines = text.split('\n');
  const keyword = 'จำนวน';
  const keywordIndex = lines.findIndex(line => line.includes(keyword));
  if (keywordIndex === -1 || keywordIndex + 1 >= lines.length) {
    return null;
  }
  const amountLine = lines[keywordIndex + 1];
  const regex = /(\d{1,3}(?:,\d{3})*\.\d{2})|(\d+\.\d{2})/g;
  const matches = amountLine.match(regex);
  if (matches && matches.length > 0) {
    return parseFloat(matches[0].replace(/,/g, ''));
  }
  return null;
}

function findTransactionId(text) {
    const cleanedText = text.replace(/[\s\n]/g, '');
    const regex = /[A-Z0-9]{20,}/g;
    const matches = cleanedText.match(regex);
    return matches && matches.length > 0 ? matches[0] : null;
}

// --- ส่วนที่ 3: โค้ดหลักของฟังก์ชัน (Main Handler) ---
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { imageBase64, reservedNumbers, userId, customerData, totalPrice, sellerId } = body;

    if (!imageBase64 || !reservedNumbers || !customerData || !sellerId) {
      throw new Error('ข้อมูลที่ส่งมาไม่สมบูรณ์');
    }

    const imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
    
    // 1. ตรวจสอบสลิปซ้ำด้วย Image Hash
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const slipRef = db.collection('sellers').doc(sellerId).collection('usedSlips').doc(slipHash);
    const slipDoc = await slipRef.get();
    if (slipDoc.exists) {
      throw new Error('สลิปนี้ถูกใช้งานไปแล้ว (ตรวจสอบจากลายนิ้วมือรูปภาพ)');
    }

    // 2. อ่านข้อความจากสลิป
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    
    // --- บรรทัดสำหรับ DEBUG ---
    // ส่วนนี้จะแสดงผลใน Function Log บน Netlify
    console.log("--- OCR Detected Text ---:", detectedText);
    // -------------------------

    if (!detectedText) {
        throw new Error('ไม่สามารถอ่านข้อมูลจากรูปภาพได้ อาจไม่ใช่สลิปการโอนเงิน');
    }
    
    // 3. ตรวจสอบ Transaction ID ซ้ำ
    const transactionId = findTransactionId(detectedText);
    if (!transactionId) {
        throw new Error('ไม่สามารถหารหัสอ้างอิง (เลขที่รายการ) ในสลิปได้');
    }
    const txRef = db.collection('sellers').doc(sellerId).collection('usedTransactionIds').doc(transactionId);
    const txDoc = await txRef.get();
    if (txDoc.exists) {
        throw new Error('สลิปนี้มีรหัสอ้างอิงที่ถูกใช้งานไปแล้ว');
    }

    // 4. ตรวจสอบยอดเงิน
    const amountOnSlip = findAmountInText(detectedText);
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินในสลิปไม่ถูกต้อง (ที่อ่านได้: ${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }
// --- ส่วนที่ 4.5: อัปโหลดสลิปไปที่ Storage และรับ URL ---
const filePath = `slips/${sellerId}/${slipHash}.jpg`;
const file = bucket.file(filePath);

await file.save(imageBuffer, {
  metadata: {
    contentType: 'image/jpeg',
  },
});

// ทำให้ไฟล์เป็นสาธารณะเพื่อให้ทุกคนดูได้ผ่าน URL
await file.makePublic(); 

// รับ URL ของไฟล์ที่อัปโหลดแล้ว
const slipDownloadURL = file.publicUrl();

// --------------------------------------------------------

// 5. บันทึกข้อมูลทั้งหมด
const batch = db.batch();
const updateTimestamp = new Date();

reservedNumbers.forEach(number => {
    const numberRef = db.collection('sellers').doc(sellerId).collection('numbers').doc(number);
    
    // แทนที่ด้วยโค้ดเวอร์ชันสมบูรณ์นี้
    batch.update(numberRef, { 
        status: 'needs_review', 
        paidAt: updateTimestamp,
        customerName: customerData.name,
        customerPhone: customerData.phone,
        slipUrl: slipDownloadURL // <-- เพิ่มข้อมูลที่ขาดไป
    });
});

batch.set(slipRef, { usedAt: updateTimestamp, customerName: customerData.name, transactionId: transactionId });
batch.set(txRef, { usedAt: updateTimestamp, customerName: customerData.name });

await batch.commit();

// 6. ส่ง LINE แจ้งเตือน
// ... (ส่วนนี้ถูกต้องแล้ว ไม่ต้องแก้ไข) ...
    try {
        const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const lineAdminUserId = process.env.LINE_ADMIN_USER_ID;
        if (lineChannelAccessToken && lineAdminUserId) {
            const messageBody = {
                to: lineAdminUserId,
                messages: [{
                    type: 'text',
                    text: `✅ มีรายการใหม่รอตรวจสอบ!\n\nเลขที่จอง: ${reservedNumbers.join(', ')}\nยอดเงิน: ${totalPrice} บาท\nลูกค้า: ${customerData.name}`
                }]
            };
            await fetch('https://api.line.me/v2/bot/message/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${lineChannelAccessToken}` },
                body: JSON.stringify(messageBody)
            });
        }
    } catch (lineError) {
        console.error("Failed to send LINE notification:", lineError);
    }

    // 7. ส่งคำตอบว่าสำเร็จกลับไปหน้าเว็บ
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'อัปโหลดสลิปสำเร็จ กรุณารอการตรวจสอบ', status: 'needs_review' })
    };

  // ... โค้ดส่วนอื่นๆ ...
  } catch (error) {
    console.error('--- DETAILED ERROR in uploadSlip function: ---');
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุในเซิร์ฟเวอร์' })
    };
  } // <-- ปีกกานี้สำหรับปิด try...catch

} // <-- ปีกกานี้สำหรับปิด exports.handler
