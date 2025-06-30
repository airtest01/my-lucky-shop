// --- ฟังก์ชัน findTransactionId ฉบับอัปเกรดล่าสุด ---
function findTransactionId(text) {
  const lines = text.split('\n');
  // เราสามารถเพิ่มคำค้นหาอื่นๆ ได้ในอนาคต เช่น 'Ref', 'Transaction'
  const keywords = ['เลขที่รายการ'];

  let transactionId = null;

  // วนลูปเพื่อหาบรรทัดที่มีคำค้นหา
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];

    for (const keyword of keywords) {
      if (currentLine.includes(keyword)) {
        // เมื่อเจอคำค้นหา ให้ลองค้นหารหัสในบรรทัดนั้นและบรรทัดถัดไป
        // เพื่อรองรับกรณีที่รหัสอยู่คนละบรรทัด
        const searchArea = currentLine + (lines[i + 1] || '');

        // Regex เดิมที่มองหารหัสที่ประกอบด้วยตัวอักษรใหญ่และตัวเลขติดกันยาวๆ
        const regex = /[A-Z0-9]{20,}/g;
        const matches = searchArea.match(regex);

        if (matches && matches.length > 0) {
          transactionId = matches[0];
          break; 
        }
      }
    }
    if (transactionId) break; 
  }

  return transactionId;
}
