const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require("firebase-admin/storage");

// --- ส่วนการเชื่อมต่อ ---
if (!admin.apps.length) {
  // ... (คัดลอกส่วนการเชื่อมต่อ admin.initializeApp ทั้งหมดจากไฟล์ uploadSlip.js มาวางที่นี่)
}
const db = getFirestore();
const bucket = getStorage().bucket();

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) throw new Error('ไม่พบ Token สำหรับยืนยันตัวตน');

    const decodedToken = await admin.auth().verifyIdToken(token);
    const adminUid = decodedToken.uid;

    const adminDocRef = db.collection('admins').doc(adminUid);
    const adminDocSnap = await adminDocRef.get();
    if (!adminDocSnap.exists) {
        return { statusCode: 403, body: JSON.stringify({ success: false, message: 'คุณไม่ได้รับสิทธิ์' }) };
    }

    // ลบไฟล์ใน Storage
    const prefix = `slips/${adminUid}/`;
    await bucket.deleteFiles({ prefix: prefix });

    // ลบข้อมูลใน Firestore
    const collectionsToDelete = ['numbers', 'usedSlips', 'usedTransactionIds'];
    for (const collectionName of collectionsToDelete) {
        const collectionRef = db.collection('sellers').doc(adminUid).collection(collectionName);
        const snapshot = await collectionRef.get();
        if (snapshot.empty) continue;
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }

    return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'รีเซ็ตระบบทั้งหมดเรียบร้อยแล้ว' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message || 'เกิดข้อผิดพลาด' })
    };
  }
};
