# WhatsApp QR Number Bot

البوت ده بيستقبل صورة على واتساب، يقرأ الرقم اللي تحت QR، يشيل السنة مثل 2026-، ويرد عليك بالرقم.
لو الرقم موجود قبل كده، يرد: الرقم - مكرر.

## التشغيل

1. اعمل حساب UltraMsg واعمل Instance.
2. امسح QR من UltraMsg بواتسابك.
3. فعّل:
   - Webhook on Received
   - Webhook Download Media
4. ارفع المشروع على Render أو أي استضافة Node.js.
5. حط Environment Variables:
   - ULTRAMSG_INSTANCE
   - ULTRAMSG_TOKEN
6. في UltraMsg حط Webhook URL:
   https://YOUR-LINK.onrender.com/webhook

## تجربة
ابعت صورة للبوت على واتساب.
الرد يكون مثل:
05289460

ولو مكرر:
05289460 - مكرر

## تصدير الأرقام
افتح:
https://YOUR-LINK.onrender.com/export