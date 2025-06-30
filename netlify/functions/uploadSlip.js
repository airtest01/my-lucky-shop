const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');
const crypto = require('crypto'); // เพิ่ม crypto สำหรับการทำ Hashing

// --- ส่วนที่ 1: การเชื่อมต่อและการยืนยันตัวตน (ไม่เปลี่ยนแปลง) ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key,
  }
});

const db = getFirestore();

// --- ส่วนที่ 2: ฟังก์ชันเสริมสำหรับค้นหาจำนวนเงิน (ไม่เปลี่ยนแปลง) ---
function findAmountInText(text) {
  const lines = text.split('\n');
  const keyword = 'จํานวน';
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

// --- ส่วนที่ 3: โค้ดหลักของฟังก์ชัน (Main Handler) ---
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { 
      imageBase64, 
      reservedNumbers, 
      userId, 
      customerData, 
      totalPrice 
    } = body;

    if (!imageBase64 || !reservedNumbers || !customerData) {
      throw new Error('ข้อมูลที่ส่งมาไม่สมบูรณ์');
    }

    const imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
    
    // --- เพิ่มเข้ามา: ตรวจสอบสลิปซ้ำ ---
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const slipRef = db.collection('usedSlips').doc(slipHash);
    const slipDoc = await slipRef.get();

    if (slipDoc.exists) {
      throw new Error('สลิปนี้ถูกใช้งานไปแล้ว โปรดตรวจสอบและอัปโหลดสลิปที่ถูกต้อง');
    }
    // --- จบส่วนตรวจสอบสลิปซ้ำ ---

    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    
    console.log("--- OCR Detected Text ---:", detectedText);

    if (!detectedText) {
        throw new Error('ไม่สามารถอ่านข้อมูลจากรูปภาพได้ อาจไม่ใช่สลิปการโอนเงิน');
    }

    const amountOnSlip = findAmountInText(detectedText);
    
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินในสลิปไม่ถูกต้อง (${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }

    const batch = db.batch();
    const updateTimestamp = new Date();

    reservedNumbers.forEach(number => {
      const numberRef = db.collection('numbers').doc(number);
      batch.set(numberRef, {
        status: 'needs_review',
        userId: userId,
        customerName: customerData.name,
        customerPhone: customerData.phone,
        totalPrice: totalPrice,
        paidAt: updateTimestamp
      }, { merge: true });
    });
    
    // --- เพิ่มเข้ามา: บันทึก Hash ของสลิปที่ใช้แล้ว ---
    batch.set(slipRef, { 
        usedAt: updateTimestamp,
        customerName: customerData.name,
        numbers: reservedNumbers
    });
    // --- จบส่วนบันทึก Hash ---
    
    await batch.commit();

    // ส่วนของ LINE Notification (ไม่เปลี่ยนแปลง)
    try {
        const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const lineAdminUserId = process.env.LINE_ADMIN_USER_ID;
        if (lineChannelAccessToken && lineAdminUserId) {
            // ... โค้ดส่ง LINE เหมือนเดิม ...
        }
    } catch (lineError) {
        console.error("Failed to send LINE notification:", lineError);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'อัปโหลดสลิปสำเร็จ กรุณารอการตรวจสอบ',
        status: 'needs_review'
      })
    };

  } catch (error) {
    console.error('--- DETAILED ERROR in uploadSlip function: ---');
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        message: error.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุในเซิร์ฟเวอร์'
      })
    };
  }
};
