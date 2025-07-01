// ในไฟล์ uploadSlip.js

// ... (โค้ดส่วนอื่น ๆ)

function findAmountInText(text) {
    // มองหาตัวเลขที่มีทศนิยม 2 ตำแหน่ง หรือจำนวนเต็ม ที่อยู่หลังคำว่า "จำนวนเงิน" หรือ "Amount"
    // ตัวอย่าง: THB 100.00, 100.00 บาท
    const patterns = [
        /(?:จำนวนเงิน|Amount|ยอดโอน)\s*?([,\d]+\.\d{2})/i,
        /THB\s*?([,\d]+\.\d{2})/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            // แปลง , ออกแล้วแปลงเป็นตัวเลข
            return parseFloat(match[1].replace(/,/g, ''));
        }
    }
    return null;
}

function findTransactionId(text) {
    // มองหาข้อความที่น่าจะเป็นรหัสอ้างอิงของธนาคาร
    // ตัวอย่าง: รหัสอ้างอิง 20240701... , Ref. 012345...
    const patterns = [
        /(?:รหัสอ้างอิง|Ref\.|Ref No\.)[:\s\n]+([\w\d]{10,})/i,
        /(\d{14,})/ // มองหาตัวเลขยาวๆ ที่อาจเป็นรหัสอ้างอิงโดยตรง
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    return null; // ถ้าหาไม่เจอ ให้คืนค่า null
}


exports.handler = async (event) => {
// ... (โค้ดส่วนที่เหลือ)
