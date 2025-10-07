// Click tracker بسيط لـ Replit — بدون DB, كيحفظ فـ CSV
import express from "express";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const app = express();
const PORT = process.env.PORT || 5000;

// هوم بيج باش مايبقاش فاضي
app.get("/", (req, res) => {
  res.send(`
    <h1>Click Tracker</h1>
    <p>صايب لينك: <code>/create?email=you@example.com&url=https://example.com</code></p>
    <p>اللوغات: <code>/logs?key=YOUR_ADMIN_KEY</code></p>
  `);
});

// حضّر CSV إلا ماكاينش
if (!fs.existsSync("clicks.csv")) {
  fs.writeFileSync("clicks.csv", "token,email,timestamp,ip,user_agent,referer\n");
}

// ستور بسيط فالميموري
const tokens = {}; // { token: { email, url } }

// توليد لينك لشخص واحد
app.get("/create", (req, res) => {
  const email = req.query.email;
  const url = req.query.url || "https://example.com";
  if (!email) return res.status(400).send("خاص email: ?email=x&url=y");
  const token = uuidv4();
  tokens[token] = { email, url };
  const base = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`;
  const trackingLink = `${base}/r/${token}`;
  res.send(`Tracking link for ${email}: <a href="${trackingLink}" target="_blank">${trackingLink}</a>`);
});

// Redirect + تسجيل الكليك
app.get("/r/:token", (req, res) => {
  const t = req.params.token;
  const data = tokens[t];
  if (!data) return res.status(404).send("Invalid token");

  const now = new Date().toISOString();
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || req.socket.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";
  const ref = req.headers["referer"] || "";

  const row = `${t},${data.email},${now},"${ip}","${ua}","${ref}"\n`;
  fs.appendFileSync("clicks.csv", row);

  return res.redirect(302, data.url);
});

// لوغات محمية بـ ADMIN_KEY (ديريها فـ Secrets)
app.get("/logs", (req, res) => {
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== process.env.ADMIN_KEY) return res.status(401).send("Unauthorized");
  const csv = fs.readFileSync("clicks.csv", "utf8");
  res.type("text/csv").send(csv);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Listening on 0.0.0.0:${PORT}`);
});
