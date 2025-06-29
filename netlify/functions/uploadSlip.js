const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const vision = require('@google-cloud/vision');

// --- ส่วนที่ 1: การเชื่อมต่อและการยืนยันตัวตน (Authentication) ---

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


// --- ส่วนที่ 2: ฟังก์ชันเสริมสำหรับค้นหาจำนวนเงิน ---
function findAmountInText(text) {
    const regex = /(\d{1,3}(?:,\d{3})*\.\d{2})|(\d+\.\d{2})|(\d+)/g;
    const matches = text.match(regex);
    if (!matches) return null;
    
    const numbers = matches.map(num => parseFloat(num.replace(/,/g, '')));
    return numbers.length > 0 ? numbers[numbers.length - 1] : null;
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

    // 1. อ่านข้อความจากสลิปด้วย Vision API
    const [result] = await visionClient.textDetection({ image: { content: imageBuffer } });
    const detectedText = result.fullTextAnnotation?.text || '';

    if (!detectedText) {
        throw new Error('ไม่สามารถอ่านข้อมูลจากรูปภาพได้ อาจไม่ใช่สลิปการโอนเงิน');
    }

    // 2. ค้นหาและตรวจสอบยอดเงิน
    const amountOnSlip = findAmountInText(detectedText);
    
    if (amountOnSlip === null || Math.abs(amountOnSlip - totalPrice) > 0.01) {
       throw new Error(`ยอดเงินในสลิปไม่ถูกต้อง (${amountOnSlip || 'ไม่พบ'}) ยอดที่ต้องชำระคือ ${totalPrice} บาท`);
    }

    // 3. (ผ่านการตรวจสอบ) สร้าง Batch Write เพื่อบันทึกข้อมูล
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
    
    await batch.commit();

    // 4. (ผ่านการบันทึก) ส่ง LINE แจ้งเตือน
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
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${lineChannelAccessToken}`
                },
                body: JSON.stringify(messageBody)
            });
        }
    } catch (lineError) {
        console.error("Failed to send LINE notification:", lineError);
    }

    // 5. ส่งคำตอบว่าสำเร็จกลับไปหน้าเว็บ
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
      statusCode: 500, // ส่งรหัส 500 เมื่อเกิดข้อผิดพลาด
      body: JSON.stringify({
        success: false,
        message: error.message || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุในเซิร์ฟเวอร์'
      })
    };
  }
};
