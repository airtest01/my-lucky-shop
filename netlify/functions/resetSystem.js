const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require("firebase-admin/storage");

// --- ส่วนการเชื่อมต่อ ---
const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
if (!serviceAccountBase64) {
    throw new Error("Firebase service account is not set in environment variables.");
}
const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
const serviceAccount = JSON.parse(serviceAccountJson);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // ใส่ชื่อที่ถูกต้องกลับเข้าไปตามนี้
    storageBucket: 'my-lucky-shop.firebasestorage.app'
  });
}
const db = getFirestore();
const bucket = getStorage().bucket();

// --- โค้ดหลักของฟังก์ชัน ---
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const token = event.headers.authorization?.split('Bearer ')[1];
    if (!token) throw new Error('ไม่พบ Token สำหรับยืนยันตัวตน');
    const decodedToken = await admin.auth().verifyIdToken(token);
    const adminUid = decodedToken.uid;
    
    // Authorize admin
    const adminDocSnap = await db.collection('admins').doc(adminUid).get();
    if (!adminDocSnap.exists) throw new Error('คุณไม่ได้รับสิทธิ์ในการดำเนินการนี้');
    
    console.log(`Reset initiated by admin: ${adminUid}`);

    // Delete Storage files
    const prefix = `slips/${adminUid}/`;
    await bucket.deleteFiles({ prefix: prefix });
    
    // Delete Firestore data
    const collectionsToDelete = ['numbers', 'usedSlips', 'usedTransactionIds'];
    for (const collectionName of collectionsToDelete) {
        const collectionRef = db.collection('sellers').doc(adminUid).collection(collectionName);
        const snapshot = await collectionRef.get();
        if (snapshot.empty) continue;
        const batch = db.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
    }
    
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'รีเซ็ตระบบทั้งหมดเรียบร้อยแล้ว' }) };
  } catch (error) {
    console.error('Error in resetSystem function:', error);
    return { statusCode: 500, body: JSON.stringify({ success: false, message: error.message }) };
  }
};
