const admin = require('firebase-admin');
const { getStorage } = require('firebase-admin/storage');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

// --- START: การตั้งค่า Firebase Admin ---
// คุณต้องสร้าง Service Account Key ในโปรเจกต์ Firebase ของคุณ
// แล้วนำค่าต่างๆ มาใส่ในตัวแปร Environment Variables บน Netlify
// วิธีทำ: https://firebase.google.com/docs/admin/setup#initialize-sdk
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
} catch (error) {
  if (!/already exists/.test(error.message)) {
    console.error('Firebase admin initialization error', error.stack);
  }
}
// --- END: การตั้งค่า Firebase Admin ---


exports.handler = async (event, context) => {
  // ตรวจสอบว่าเป็นการร้องขอแบบ POST เท่านั้น
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const db = getFirestore();
    const bucket = getStorage().bucket();
    const body = JSON.parse(event.body);

    const { imageBase64, fileName, reservedNumbers, totalPrice, customerData } = body;

    // --- 1. อัปโหลดรูปสลิปไปยัง Firebase Storage ---
    const imageBuffer = Buffer.from(imageBase64.split(';base64,').pop(), 'base64');
    const filePath = `slips/${Date.now()}-${fileName}`;
    const file = bucket.file(filePath);

    await file.save(imageBuffer, {
      metadata: { contentType: 'image/png' }, // หรือ content type อื่นๆ ตามไฟล์
    });
    const publicUrl = await file.getSignedUrl({
        action: 'read',
        expires: '03-09-2491' // ตั้งวันหมดอายุในอนาคตไกลๆ
    }).then(urls => urls[0]);


    // --- 2. อัปเดตข้อมูลใน Firestore ---
    // ใช้ Transaction เพื่อให้แน่ใจว่าการอัปเดตข้อมูลทั้งหมดสำเร็จหรือไม่ก็ล้มเหลวทั้งหมด
    await db.runTransaction(async (transaction) => {
      const numberRefs = reservedNumbers.map(num => db.collection('numbers').doc(num));
      const numberDocs = await transaction.getAll(...numberRefs);

      // ตรวจสอบอีกครั้งว่าเลขยังเป็น pending อยู่หรือไม่
      for(const doc of numberDocs) {
        if (!doc.exists || doc.data().status !== 'pending') {
          throw new Error(`Number ${doc.id} is not in a pending state.`);
        }
      }

      // ถ้าทุกอย่างถูกต้อง ให้อัปเดตสถานะเป็น "sold"
      for (const docRef of numberRefs) {
        transaction.update(docRef, {
          status: 'sold',
          slipUrl: publicUrl,
          totalPrice: totalPrice,
          customerName: customerData.name, // อัปเดตชื่อจากข้อมูลที่ส่งมา
          customerPhone: customerData.phone, // อัปเดตเบอร์โทร
          soldAt: Timestamp.now() // บันทึกเวลาที่ขายสำเร็จ
        });
      }
    });

    // --- 3. ส่งคำตอบกลับไปที่หน้าบ้าน ---
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Payment confirmed and data updated successfully!',
        status: 'sold' // ส่งสถานะกลับไป
      }),
    };

  } catch (error) {
    console.error('Error processing payment:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message }),
    };
  }
};