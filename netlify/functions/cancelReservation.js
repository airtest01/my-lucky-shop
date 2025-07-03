const admin = require('firebase-admin');
const { getFirestore, writeBatch } = require('firebase-admin/firestore');

// --- ส่วนการเชื่อมต่อ (ใช้รูปแบบเดียวกับฟังก์ชันอื่นๆ) ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
if (!serviceAccountBase64) {
    throw new Error("FATAL ERROR: FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable is not set.");
}
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = getFirestore();

// --- โค้ดหลักของฟังก์ชัน (Main Handler) ---
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  try {
    const { sellerId, numbersToCancel } = JSON.parse(event.body);

    if (!sellerId || !numbersToCancel || !Array.isArray(numbersToCancel) || numbersToCancel.length === 0) {
        throw new Error('ข้อมูลสำหรับยกเลิกการจองไม่สมบูรณ์');
    }

    // ใช้ Batch Write เพื่อลบข้อมูลทั้งหมดในครั้งเดียว
    const batch = db.batch();
    numbersToCancel.forEach(num => {
        const docRef = db.collection('sellers').doc(sellerId).collection('numbers').doc(String(num));
        batch.delete(docRef);
    });

    await batch.commit();

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'ยกเลิกการจองสำเร็จ' })
    };

  } catch (error) {
    console.error("Error in cancelReservation function:", error);
    return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการยกเลิกการจอง' })
    };
  }
};
