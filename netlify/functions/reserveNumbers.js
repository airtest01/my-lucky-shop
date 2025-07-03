const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// --- ส่วนการเชื่อมต่อ (เหมือนเดิม) ---
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
    const { sellerId, selectedNumbers, customerData, userId } = JSON.parse(event.body);

    if (!sellerId || !selectedNumbers || !Array.isArray(selectedNumbers) || selectedNumbers.length === 0) {
        throw new Error('ข้อมูลสำหรับจองไม่สมบูรณ์');
    }

    await db.runTransaction(async (transaction) => {
        const docRefs = selectedNumbers.map(num => db.collection('sellers').doc(sellerId).collection('numbers').doc(num));
        
        for (const docRef of docRefs) {
            const docSnap = await transaction.get(docRef);
            
            // --- แก้ไขจุดนี้: เปลี่ยนจาก .exists() เป็น .exists ---
            if (docSnap.exists) { 
                throw new Error(`ขออภัย, เลข ${docRef.id} เพิ่งถูกจองไปแล้ว`);
            }
        }
        
        const reservationData = {
            status: "pending",
            customerName: customerData.name,
            customerPhone: customerData.phone,
            reservedBy: userId,
            reservedAt: new Date()
        };

        docRefs.forEach(ref => transaction.set(ref, reservationData));
    });

    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'ทำการจองชั่วคราวสำเร็จ' })
    };

  } catch (error) {
    console.error("Error in reserveNumbers function:", error);
    return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, message: error.message || 'เกิดข้อผิดพลาดในการจอง' })
    };
  }
};
