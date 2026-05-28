import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import { createWorker } from "tesseract.js";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const INSTANCE = process.env.ULTRAMSG_INSTANCE || "instanceXXXX";
const TOKEN = process.env.ULTRAMSG_TOKEN || "PUT_TOKEN_HERE";

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

async function sendWhatsApp(to, body) {
  const url = `https://api.ultramsg.com/${INSTANCE}/messages/chat`;
  await axios.post(url, new URLSearchParams({
    token: TOKEN,
    to,
    body
  }).toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });
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
  res.send("WhatsApp QR Number Bot is running.");
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body;
    const from = data.from || data.author || data.chatId || data.to;
    const type = data.type || data.message_type || "";
    const mediaUrl = data.media || data.mediaUrl || data.body || data.url || "";

    if (!from) return;

    if (!mediaUrl || !String(mediaUrl).startsWith("http")) {
      await sendWhatsApp(from, "ابعت صورة فيها QR والرقم تحتها.");
      return;
    }

    const text = await ocrImageFromUrl(mediaUrl);
    const number = extractNumber(text);

    if (!number) {
      await sendWhatsApp(from, "مش قادر أقرأ الرقم من الصورة. جرّب صورة أوضح.");
      return;
    }

    const oldNumbers = loadDB();
    const isDuplicate = oldNumbers.includes(number);

    oldNumbers.push(number);
    saveDB(oldNumbers);

    const reply = isDuplicate ? `${number} - مكرر` : `${number}`;
    await sendWhatsApp(from, reply);

  } catch (err) {
    console.error(err);
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