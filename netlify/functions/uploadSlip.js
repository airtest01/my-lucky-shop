// --- ฟังก์ชัน findAmountInText ฉบับแก้ไขล่าสุด ---
function findAmountInText(text) {
  const lines = text.split('\n');
  const keyword = 'จํานวน';

  // ค้นหาลำดับบรรทัด (index) ที่มีคำว่า "จํานวน"
  const keywordIndex = lines.findIndex(line => line.includes(keyword));

  // ถ้าไม่เจอบรรทัดที่มี keyword หรือเป็นบรรทัดสุดท้าย ให้คืนค่า null
  if (keywordIndex === -1 || keywordIndex + 1 >= lines.length) {
    return null;
  }

  // ตัวเลขที่ต้องการจะอยู่ในบรรทัดถัดไป (index + 1)
  const amountLine = lines[keywordIndex + 1];

  // ดึงตัวเลขจากบรรทัดนั้น
  const regex = /(\d{1,3}(?:,\d{3})*\.\d{2})|(\d+\.\d{2})/g;
  const matches = amountLine.match(regex);

  if (matches && matches.length > 0) {
    // คืนค่าตัวเลขแรกที่เจอ
    return parseFloat(matches[0].replace(/,/g, ''));
  }

  return null;
}
