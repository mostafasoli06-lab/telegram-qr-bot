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

async function getFileUrl(fileId) {
  const res = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const filePath = res.data.result.file_path;
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
}

async function ocrImageFromUrl(imageUrl) {
  const img = await axios.get(imageUrl, { responseType: "arraybuffer" });
  const tempPath = path.join(process.cwd(), `temp_${Date.now()}.jpg`);
  fs.writeFileSync(tempPath, img.data);

  const worker = await createWorker("eng");
  const result = await worker.recognize(tempPath);
  await worker.terminate();

  fs.unlinkSync(tempPath);
  return result.data.text;
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
      await sendMessage(chatId, "ابعت صورة فيها QR والرقم تحتها، وأنا أطلع الرقم وأقولك لو مكرر.");
      return;
    }

    if (!message.photo && !message.document) {
      await sendMessage(chatId, "ابعت صورة فقط.");
      return;
    }

    let fileId = "";

    if (message.photo) {
      fileId = message.photo[message.photo.length - 1].file_id;
    } else if (message.document && String(message.document.mime_type || "").startsWith("image/")) {
      fileId = message.document.file_id;
    } else {
      await sendMessage(chatId, "الملف مش صورة.");
      return;
    }

    const fileUrl = await getFileUrl(fileId);
    const text = await ocrImageFromUrl(fileUrl);
    const number = extractNumber(text);

    if (!number) {
      await sendMessage(chatId, "مش قادر أقرأ الرقم من الصورة. جرّب صورة أوضح.");
      return;
    }

    const oldNumbers = loadDB();
    const isDuplicate = oldNumbers.includes(number);

    oldNumbers.push(number);
    saveDB(oldNumbers);

    await sendMessage(chatId, isDuplicate ? `${number} - مكرر` : number);

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