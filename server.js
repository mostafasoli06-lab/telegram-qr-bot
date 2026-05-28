import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 8080;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DB_PATH = path.join(process.cwd(), "numbers.json");

const albumBuffer = new Map();

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveDB(numbers) {
  fs.writeFileSync(DB_PATH, JSON.stringify([...new Set(numbers)], null, 2), "utf8");
}

function extractNumber(text) {
  const clean = String(text || "")
    .replace(/\s/g, "")
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

  let match = clean.match(/20\d{2}[-–—]?(\d{6,12})/);
  if (match) return match[1];

  match = clean.match(/\b(\d{7,12})\b/);
  if (match) return match[1];

  return "";
}

async function telegram(method, data) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  return axios.post(url, data);
}

async function sendMessage(chatId, text) {
  await telegram("sendMessage", { chat_id: chatId, text });
}

async function sendDocument(chatId, filePath, caption = "") {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("document", fs.createReadStream(filePath));
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, form, {
    headers: form.getHeaders()
  });
}

async function getFileUrl(fileId) {
  const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = res.data.result.file_path;
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
}

async function ocrImageFromUrl(imageUrl) {
  const img = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const tempPath = path.join(process.cwd(), `temp_${Date.now()}_${Math.random().toString(16).slice(2)}.jpg`);
  fs.writeFileSync(tempPath, img.data);

  const worker = await createWorker("eng");
  const result = await worker.recognize(tempPath);
  await worker.terminate();

  fs.unlinkSync(tempPath);
  return result.data.text;
}

async function handleFileIds(chatId, fileIds) {
  const oldNumbers = loadDB();
  const oldSet = new Set(oldNumbers);
  const batchSeen = new Set();

  const normalRows = [];
  const duplicateRows = [];

  for (const fileId of fileIds) {
    try {
      const fileUrl = await getFileUrl(fileId);
      const text = await ocrImageFromUrl(fileUrl);
      const number = extractNumber(text);

      if (!number) continue;

      const isDuplicate = oldSet.has(number) || batchSeen.has(number);
      batchSeen.add(number);

      if (isDuplicate) {
        duplicateRows.push({ number, status: "مكرر" });
      } else {
        normalRows.push({ number, status: "" });
      }
    } catch (err) {
      console.error("IMAGE ERROR:", err?.response?.data || err.message || err);
    }
  }

  const finalRows = [...normalRows, ...duplicateRows];

  if (!finalRows.length) {
    await sendMessage(chatId, "مش قادر أقرأ أرقام من الصور. جرّب صور أوضح.");
    return;
  }

  const allNumbersToSave = [...oldNumbers, ...finalRows.map(r => r.number)];
  saveDB(allNumbersToSave);

  let reply = finalRows.map(r => r.status ? `${r.number} - ${r.status}` : r.number).join("\n");
  reply += `\n\nالإجمالي: ${finalRows.length}\nالمكرر: ${duplicateRows.length}`;

  if (reply.length > 3500) {
    const txtPath = path.join(process.cwd(), `result_${Date.now()}.txt`);
    fs.writeFileSync(txtPath, reply, "utf8");
    await sendDocument(chatId, txtPath, "نتيجة استخراج الأرقام");
    fs.unlinkSync(txtPath);
  } else {
    await sendMessage(chatId, reply);
  }
}

function getImageFileId(message) {
  if (message.photo) {
    return message.photo[message.photo.length - 1].file_id;
  }

  if (message.document && String(message.document.mime_type || "").startsWith("image/")) {
    return message.document.file_id;
  }

  return "";
}

app.get("/", (req, res) => {
  res.send("Telegram QR Number Bot is running.");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;
    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message.chat.id;

    if (message.text === "/start") {
      await sendMessage(chatId, "ابعت صورة واحدة أو مجموعة صور Album، وأنا أطلع الأرقام وأحط المكرر في الآخر.");
      return;
    }

    if (message.text === "/export") {
      const numbers = loadDB();
      const txtPath = path.join(process.cwd(), "all_numbers.txt");
      fs.writeFileSync(txtPath, numbers.join("\n"), "utf8");
      await sendDocument(chatId, txtPath, "كل الأرقام المحفوظة");
      fs.unlinkSync(txtPath);
      return;
    }

    if (message.text === "/clear") {
      saveDB([]);
      await sendMessage(chatId, "تم مسح سجل الأرقام القديمة.");
      return;
    }

    const fileId = getImageFileId(message);

    if (!fileId) {
      await sendMessage(chatId, "ابعت صورة فقط، أو استخدم /export للتصدير، أو /clear لمسح السجل.");
      return;
    }

    const groupId = message.media_group_id;

    if (groupId) {
      const key = `${chatId}_${groupId}`;

      if (!albumBuffer.has(key)) {
        albumBuffer.set(key, { chatId, fileIds: [], timer: null });
      }

      const item = albumBuffer.get(key);
      item.fileIds.push(fileId);

      if (item.timer) clearTimeout(item.timer);

      item.timer = setTimeout(async () => {
        const saved = albumBuffer.get(key);
        albumBuffer.delete(key);

        await sendMessage(saved.chatId, `استلمت ${saved.fileIds.length} صورة، جاري استخراج الأرقام...`);
        await handleFileIds(saved.chatId, saved.fileIds);
      }, 3500);

      return;
    }

    await sendMessage(chatId, "جاري قراءة الصورة...");
    await handleFileIds(chatId, [fileId]);

  } catch (err) {
    console.error("WEBHOOK ERROR:", err?.response?.data || err.message || err);
  }
});

app.get("/export", (req, res) => {
  const numbers = loadDB();
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(numbers.join("\n"));
});

app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});