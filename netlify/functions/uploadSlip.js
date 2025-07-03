const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const vision = require('@google-cloud/vision');
const crypto = require('crypto');

// --- ส่วนที่ 1: การเชื่อมต่อ (เหมือนเดิม) ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
if (!serviceAccountBase64) {
    throw new Error("FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is not set.");
}
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const visionClient = new vision.ImageAnnotatorClient({
  projectId: serviceAccount.project_id,
  credentials: {
    client_email: serviceAccount.client_email,
    private_key: serviceAccount.private_key.replace(/\\n/g, '\n')
  }
});
const db = getFirestore();
const bucket = getStorage().bucket("gs://my-lucky-shop.appspot.com");

// --- ส่วนที่ 2: ฟังก์ชันเสริมสำหรับค้นหาข้อมูล (เวอร์ชันปรับปรุง) ---

/**
 * ฟังก์ชันค้นหายอดเงินที่ยืดหยุ่นมากขึ้น
 * @param {string} text - ข้อความทั้งหมดจาก OCR
 * @returns {number|null} ยอดเงินที่หาได้ หรือ null ถ้าหาไม่เจอ
 */
function findAmount(text) {
    const amountRegex = /(\d{1,3}(?:,\d{3})*|d+)\.\d{2}/g;
    
    // Pattern 1: มองหา Keywords แล้วตามด้วยตัวเลข (รองรับ K+, SCB, BBL)
    const keywordPatterns = [
        /(?:จำนวนเงิน|Amount|ยอดชำระ|ยอดเงิน|โอนเงินสำเร็จ)\s*([^\n]*)/i,
        /([^\n]*)\s*(?:จำนวนเงิน|Amount|ยอดชำระ|ยอดเงิน)/i
    ];

    for (const pattern of keywordPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            const amountMatch = match[1].match(amountRegex);
            if (amountMatch) {
                return parseFloat(amountMatch[0].replace(/,/g, ''));
            }
        }
    }

    // Pattern 2: (Fallback) ถ้าไม่มี Keyword, ให้หาตัวเลขเดี่ยวๆ ที่มีขนาดใหญ่และเด่นชัด (มักเป็นยอดโอน)
    // สำหรับสลิปสมัยใหม่ที่แสดงยอดเงินเป็นตัวใหญ่ๆ
    const lines = text.split('\n');
    let potentialAmounts = [];
    for (const line of lines) {
        // หาบรรทัดที่มีแค่ตัวเลขยอดเงินอย่างเดียว
        if (/^(\d{1,3}(?:,\d{3})*|d+)\.\d{2}$/.test(line.trim())) {
             potentialAmounts.push(parseFloat(line.trim().replace(/,/g, '')));
        }
    }
    // คืนค่าตัวเลขที่มากที่สุดที่หาได้ (มักเป็นยอดโอน ไม่ใช่ค่าธรรมเนียม)
    if (potentialAmounts.length > 0) {
        return Math.max(...potentialAmounts);
    }

    return null;
}


/**
 * ฟังก์ชันค้นหารหัสอ้างอิงที่ยืดหยุ่นมากขึ้น
 * @param {string} text - ข้อความทั้งหมดจาก OCR
 * @returns {string|null} รหัสอ้างอิงที่หาได้ หรือ null ถ้าหาไม่เจอ
 */
function findTransactionId(text) {
    const cleanedText = text.replace(/[\s\n-]/g, ''); // ลบช่องว่าง, ขึ้นบรรทัดใหม่, และขีดกลาง ออกไปก่อน
    
    // ชุดของ Patterns สำหรับค้นหา Transaction ID
    const patterns = [
        /[A-Z0-9|]{20,}/, // Pattern 1: สำหรับ GSB, KBank (ตัวอักษรตัวเลขยาวๆ)
        /(?<=รหัสอ้างอิง|เลขที่รายการ|RefNo|Ref)\s*:\s*([A-Z0-9|]+)/i, // Pattern 2: หาจาก Keyword ก่อน
        /\d{15,}/ // Pattern 3: (Fallback) หาตัวเลขล้วนยาวๆ
    ];

    for (const pattern of patterns) {
        const match = cleanedText.match(pattern);
        if (match && match[0]) {
            return match[0];
        }
    }
    
    return null;
}

// --- ส่วนที่ 3: โค้ดหลักของฟังก์ชัน (ปรับปรุงให้เรียกใช้ฟังก์ชันใหม่) ---
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
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // 1. ตรวจสอบ Hash (เหมือนเดิม)
    const slipRef = db.collection('sellers').doc(sellerId).collection('usedSlips').doc(slipHash);
    const slipDoc = await slipRef.get();
    if (slipDoc.exists) {
      throw new Error('สลิปนี้ถูกใช้งานไปแล้ว (ตรวจสอบจากลายนิ้วมือรูปภาพ)');
    }

    // 2. อ่านข้อความจากสลิป (เหมือนเดิม)
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    console.log("--- OCR Detected Text ---:", detectedText);
    if (!detectedText) {
        throw new Error('ไม่สามารถอ่านข้อมูลจากรูปภาพได้ อาจไม่ใช่สลิปการโอนเงิน');
    }
    
    // 3. ตรวจสอบ Transaction ID ซ้ำ (เรียกใช้ฟังก์ชันใหม่)
    const transactionId = findTransactionId(detectedText);
    if (!transactionId) {
        throw new Error('ไม่สามารถหารหัสอ้างอิง (เลขที่รายการ) ในสลิปได้');
    }
    const txRef = db.collection('sellers').doc(sellerId).collection('usedTransactionIds').doc(transactionId);
    const txDoc = await txRef.get();
    if (txDoc.exists) {
        throw new Error('สลิปนี้มีรหัสอ้างอิงที่ถูกใช้งานไปแล้ว');
    }

    // 4. ตรวจสอบยอดเงิน (เรียกใช้ฟังก์ชันใหม่)
    const amountOnSlip = findAmount(detectedText);
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินในสลิปไม่ถูกต้อง (ที่อ่านได้: ${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }

    // 5. อัปโหลดและบันทึกข้อมูล (เหมือนเดิม)
    const filePath = `slips/${sellerId}/${slipHash}.jpg`;
    const file = bucket.file(filePath);
    await file.save(imageBuffer, { metadata: { contentType: 'image/jpeg' } });
    await file.makePublic(); 
    const slipDownloadURL = file.publicUrl();

    const batch = db.batch();
    const updateTimestamp = new Date();
    reservedNumbers.forEach(number => {
        const numberRef = db.collection('sellers').doc(sellerId).collection('numbers').doc(number);
        batch.update(numberRef, { 
            status: 'needs_review', 
            paidAt: updateTimestamp,
            customerName: customerData.name,
            customerPhone: customerData.phone,
            slipUrl: slipDownloadURL
        });
    });
    batch.set(slipRef, { usedAt: updateTimestamp, customerName: customerData.name, transactionId: transactionId });
    batch.set(txRef, { usedAt: updateTimestamp, customerName: customerData.name });
    await batch.commit();

    // 6. ส่ง LINE แจ้งเตือน (เหมือนเดิม)
    try {
        const lineChannelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const lineAdminUserId = process.env.LINE_ADMIN_USER_ID;
        if (lineChannelAccessToken && lineAdminUserId) {
            //... (โค้ดส่ง LINE เหมือนเดิมทุกประการ)
        }
    } catch (lineError) {
        console.error("Failed to send LINE notification:", lineError);
    }

    // 7. ส่งคำตอบว่าสำเร็จ (เหมือนเดิม)
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'อัปโหลดสลิปสำเร็จ กรุณารอการตรวจสอบ', status: 'needs_review' })
    };

  } catch (error) {
    console.error('--- DETAILED ERROR in uploadSlip function: ---', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุในเซิร์ฟเวอร์' })
    };
  }
}
