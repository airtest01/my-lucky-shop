const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');
const crypto = require('crypto');

// --- ส่วนการเชื่อมต่อ (ใช้ Base64) ---
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

// --- ฟังก์ชันเสริม (ไม่เปลี่ยนแปลง) ---
function findAmountInText(text) {
    // 1. กำหนดคำค้นหา (Keywords) ที่เป็นไปได้สำหรับ "ยอดเงิน"
    const keywords = ['จํานวนเงิน', 'จํานวน', 'Amount'];
    const lines = text.split('\n');

    // 2. สร้าง Regular Expression เพื่อค้นหาตัวเลขในรูปแบบเงิน (เช่น 10.00 หรือ 1,000.00)
    const amountRegex = /(\d{1,3}(?:,\d{3})*?\.\d{2})/g;

    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i].trim();
        const hasKeyword = keywords.some(kw => currentLine.includes(kw));

        if (hasKeyword) {
            // 3. ถ้าเจอ Keyword ให้ค้นหายอดเงินใน "บรรทัดเดียวกัน" ก่อน
            let matches = currentLine.match(amountRegex);
            if (matches && matches.length > 0) {
                return parseFloat(matches[0].replace(/,/g, ''));
            }

            // 4. ถ้าไม่เจอในบรรทัดเดียวกัน ให้ลองหาใน "บรรทัดถัดไป"
            if (i + 1 < lines.length) {
                const nextLine = lines[i + 1].trim();
                matches = nextLine.match(amountRegex);
                if (matches && matches.length > 0) {
                    return parseFloat(matches[0].replace(/,/g, ''));
                }
            }
        }
    }

    // 5. ถ้าไม่เจอจาก Keyword เลย ให้ลองหาจากทั้งข้อความ (สำหรับสลิปบางรูปแบบที่ยอดเงินอยู่บนสุด)
    const allMatches = text.match(amountRegex);
    if (allMatches) {
        // คืนค่าตัวเลขแรกที่เจอ ซึ่งมักจะเป็นยอดเงินหลัก
        for (const match of allMatches) {
             const amount = parseFloat(match.replace(/,/g, ''));
             // สันนิษฐานว่ายอดเงินโอนจริงไม่น่าจะเป็น 0.00
             if (amount > 0) return amount;
        }
    }

    return null; // หากไม่พบยอดเงิน
}

function findTransactionId(text) {
    const cleanedText = text.replace(/[\s\n]/g, '');
    const regex = /[A-Z0-9]{20,}/g;
    const matches = cleanedText.match(regex);
    return matches && matches.length > 0 ? matches[0] : null;
}

// --- โค้ดหลักของฟังก์ชัน (Main Handler) ที่แก้ไขใหม่ทั้งหมด ---
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
        totalPrice, 
        sellerId // รับ sellerId ที่ส่งมาจากหน้าบ้าน
    } = body;

    // ตรวจสอบว่ามี sellerId ส่งมาด้วยหรือไม่
    if (!sellerId) {
        throw new Error('ไม่พบข้อมูลผู้ขาย (Seller ID)');
    }
    if (!imageBase64 || !reservedNumbers || !customerData) {
      throw new Error('ข้อมูลที่ส่งมาไม่สมบูรณ์');
    }

    const imageBuffer = Buffer.from(imageBase64.split(',')[1], 'base64');
    
    // 1. ตรวจสอบสลิปซ้ำด้วย Image Hash (ในคอลเลกชันย่อยของ seller)
    const slipHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    const slipRef = db.collection('sellers').doc(sellerId).collection('usedSlips').doc(slipHash);
    const slipDoc = await slipRef.get();
    if (slipDoc.exists) {
      throw new Error('สลิปนี้ถูกใช้งานไปแล้ว (ตรวจสอบจากลายนิ้วมือรูปภาพ)');
    }

    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';
    
    console.log("--- OCR Detected Text ---:", detectedText);

    if (!detectedText) {
        throw new Error('ไม่สามารถอ่านข้อมูลจากรูปภาพได้ อาจไม่ใช่สลิปการโอนเงิน');
    }
    
    // 2. ตรวจสอบ Transaction ID ซ้ำ (ในคอลเลกชันย่อยของ seller)
    const transactionId = findTransactionId(detectedText);
    if (!transactionId) {
        throw new Error('ไม่สามารถหารหัสอ้างอิง (เลขที่รายการ) ในสลิปได้');
    }
    const txRef = db.collection('sellers').doc(sellerId).collection('usedTransactionIds').doc(transactionId);
    const txDoc = await txRef.get();
    if (txDoc.exists) {
        throw new Error('สลิปนี้มีรหัสอ้างอิงที่ถูกใช้งานไปแล้ว');
    }

    // 3. ตรวจสอบยอดเงิน (เหมือนเดิม)
    const amountOnSlip = findAmountInText(detectedText);
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินในสลิปไม่ถูกต้อง (${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }

    // 4. บันทึกข้อมูลทั้งหมด (ในคอลเลกชันย่อยของ seller)
    const batch = db.batch();
    const updateTimestamp = new Date();

    reservedNumbers.forEach(number => {
      // อัปเดตสถานะจาก pending เป็น needs_review
      const numberRef = db.collection('sellers').doc(sellerId).collection('numbers').doc(number);
      batch.update(numberRef, { 
        status: 'needs_review', 
        paidAt: updateTimestamp 
      });
    });
    
    // บันทึก Hash และ Transaction ID ที่ใช้แล้ว
    batch.set(slipRef, { usedAt: updateTimestamp, customerName: customerData.name, transactionId: transactionId });
    batch.set(txRef, { usedAt: updateTimestamp, customerName: customerData.name });
    
    await batch.commit();

    // 5. ส่ง LINE แจ้งเตือน (เหมือนเดิม)
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

    // 6. ส่งคำตอบว่าสำเร็จกลับไปหน้าเว็บ
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: 'อัปโหลดสลิปสำเร็จ กรุณารอการตรวจสอบ', status: 'needs_review' })
    };

  } catch (error) {
    console.error('--- DETAILED ERROR in uploadSlip function: ---');
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุในเซิร์ฟเวอร์' })
    };
  }
