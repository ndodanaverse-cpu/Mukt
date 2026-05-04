const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");
const path = require("path");

require('dotenv').config();
const admin = require('firebase-admin');
const app = express();

// File system and upload handling
const fs = require('fs');
const multer = require('multer');
const uploadDir = path.join(__dirname, 'public', 'uploads');
try { fs.mkdirSync(uploadDir, { recursive: true }); } catch (e) { /* ignore */ }
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '_' + Math.random().toString(36).slice(2,8) + ext);
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Optional Firestore admin initialization
let adminDb = null;
try {
  const saJson = process.env.FIRESTORE_SERVICE_ACCOUNT; // JSON string
  const saPath = process.env.FIRESTORE_SERVICE_ACCOUNT_PATH; // path to JSON file
  let creds = null;
  if (saJson) creds = JSON.parse(saJson);
  else if (saPath) creds = require(saPath);
  if (creds) {
    admin.initializeApp({ credential: admin.credential.cert(creds) });
    adminDb = admin.firestore();
    console.log('✅ Firestore admin initialized (server).');
  } else {
    console.log('⚠️ No Firestore service account provided; using static recommendations.');
  }
} catch (err) {
  console.error('❌ Firestore admin init error:', err.message || err);
}

// Whether admin SDK is available (used for password reset link generation)
const adminAvailable = Boolean(adminDb);

// Nodemailer transport (optional) — configure via env vars: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.FROM_EMAIL) {
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log('✅ SMTP transporter configured.');
  } catch (e) {
    console.error('⚠️ Could not configure SMTP transporter:', e.message || e);
    transporter = null;
  }
}

// ─── Caching: in-memory TTL cache with optional Redis backing ─────
const CACHE_TTL = Number(process.env.RECOMMEND_CACHE_TTL_SECONDS || 60); // seconds
const inMemoryCache = new Map(); // key -> { expires: ts, value }
let redisClient = null;
async function initRedis() {
  if (!process.env.REDIS_URL) return;
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', err => console.error('Redis error:', err));
    await redisClient.connect();
    console.log('✅ Connected to Redis for caching.');
  } catch (err) {
    console.error('⚠️ Could not initialize Redis:', err.message || err);
    redisClient = null;
  }
}
initRedis();

async function getCached(key) {
  const now = Date.now();
  // Try Redis first
  if (redisClient) {
    try {
      const v = await redisClient.get(key);
      if (v) return JSON.parse(v);
    } catch (err) { console.error('Redis GET error:', err); }
  }
  // In-memory
  const item = inMemoryCache.get(key);
  if (!item) return null;
  if (item.expires < now) { inMemoryCache.delete(key); return null; }
  return item.value;
}

async function setCached(key, value, ttl = CACHE_TTL) {
  const now = Date.now();
  const expires = now + ttl * 1000;
  // Set Redis
  if (redisClient) {
    try { await redisClient.setEx(key, ttl, JSON.stringify(value)); } catch (err) { console.error('Redis SET error:', err); }
  }
  // Set in-memory
  inMemoryCache.set(key, { expires, value });
}

// ─── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── CORS Middleware ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ─── Serve static files from root and public directories ────────────────────
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, "public")));

// ─── Paynow Test Credentials ────────────────────────────────────────────────
const PAYNOW_INTEGRATION_ID = "92bafa1f-e8ca-4d42-a4c8-36b57ceb8efb";
const PAYNOW_INTEGRATION_KEY = "c29eb7ce6abe4b11a2e4d4becd6335b6";
const PAYNOW_URL = "https://www.paynow.co.zw/interface/remotetransaction";

// ─── Hash Helper ─────────────────────────────────────────────────────────────
// Paynow hash = SHA512 of all field values (WITHOUT hash field) concatenated + integration key
function buildHash(fields, integrationKey) {
  // Fields must be in specific order for Paynow hash calculation
  const orderedFields = [
    fields.id,
    fields.reference,
    fields.amount,
    fields.additionalinfo,
    fields.returnurl,
    fields.resulturl,
    fields.status,
    fields.authemail,
    fields.phone,
    fields.method
  ];
  const raw = orderedFields.join("") + integrationKey;
  return crypto.createHash("sha512").update(raw).digest("hex").toUpperCase();
}

// ─── Parse Paynow URL-encoded response ───────────────────────────────────────
function parsePaynowResponse(text) {
  return Object.fromEntries(new URLSearchParams(text));
}

// ─── Health Check Endpoint ──────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Mukoto Ave payment server is running" });
});

// ─── POST /api/pay ────────────────────────────────────────────────────────────
// Body: { reference, amount, email, phone, description }
app.post("/api/pay", async (req, res) => {
  try {
    console.log("💳 Payment request received:", req.body);
    
    let { reference, amount, email, phone, description, method } = req.body;

    if (!reference || !amount || !email) {
      console.error("❌ Missing required fields:", { reference, amount, email });
      return res.status(400).json({ error: "Missing required fields." });
    }

    // ─── Cash on Pickup: skip Paynow entirely ────────────────────────────────
    if (method === 'cash') {
      console.log("💵 Cash on pickup — no Paynow call needed");
      return res.json({ success: true, pollUrl: null, cash: true });
    }

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required for mobile money payments." });
    }

    // ─── Normalize phone to local format (e.g. +263771234567 → 0771234567) ──
    let phoneNorm = phone.replace(/\s/g, '');
    if (phoneNorm.startsWith('+263')) phoneNorm = '0' + phoneNorm.slice(4);
    if (phoneNorm.startsWith('263'))  phoneNorm = '0' + phoneNorm.slice(3);
    console.log(`📱 Normalized phone: ${phoneNorm}`);

    // ─── Derive Paynow method from payment method selection ──────────────────
    const paynowMethod = ['onemoney', 'telecash'].includes(method) ? method : 'ecocash';
    console.log(`💳 Paynow method: ${paynowMethod}`);

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    console.log(`📍 Base URL: ${baseUrl}`);

    // Build fields in exact order Paynow expects
    const fields = {
      id: PAYNOW_INTEGRATION_ID,
      reference: reference,
      amount: parseFloat(amount).toFixed(2),
      additionalinfo: description || "Mukoto Ave Order",
      returnurl: `${baseUrl}/payment-complete.html`,
      resulturl: `${baseUrl}/api/result`,
      status: "Message",
      authemail: email,
      phone: phoneNorm,
      method: paynowMethod,
    };

    // Calculate hash BEFORE adding it to fields (hash should not include itself)
    const hash = buildHash(fields, PAYNOW_INTEGRATION_KEY);
    fields.hash = hash;

    console.log("🔐 Payment fields prepared:");
    console.log("   ID: " + fields.id);
    console.log("   Reference: " + fields.reference);
    console.log("   Amount: " + fields.amount);
    console.log("   Phone: " + fields.phone);
    console.log("   Hash: " + fields.hash);
    console.log("   Sending to Paynow at: " + PAYNOW_URL);

    // Send to Paynow
    const response = await fetch(PAYNOW_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });

    const text = await response.text();
    console.log("📥 Raw Paynow response:", text);
    
    const data = parsePaynowResponse(text);

    console.log("✅ Paynow response received:");
    console.log("   Full response:", JSON.stringify(data));
    console.log("   Status:", data.status);
    console.log("   Error:", data.error);

    if (data.status && data.status.toLowerCase() === "ok") {
      console.log("✅ Payment initiation successful");
      return res.json({
        success: true,
        pollUrl: data.pollurl,
        instructions: data.instructions || "Check your phone for the EcoCash USSD prompt.",
      });
    } else {
      console.error("❌ Paynow error response:", data);
      return res.status(400).json({
        success: false,
        error: data.error || "Paynow could not initiate the transaction.",
      });
    }
  } catch (err) {
    console.error("❌ Payment error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ─── GET /api/status?pollUrl=... ──────────────────────────────────────────────
// Frontend polls this to check if payment went through
app.get("/api/status", async (req, res) => {
  const { pollUrl } = req.query;
  if (!pollUrl) return res.status(400).json({ error: "No poll URL provided." });

  try {
    const response = await fetch(decodeURIComponent(pollUrl));
    const text = await response.text();
    const data = parsePaynowResponse(text);

    console.log("Poll response:", data);

    const paid = data.status && data.status.toLowerCase() === "paid";
    return res.json({ paid, status: data.status || "pending" });
  } catch (err) {
    console.error("Poll error:", err);
    res.status(500).json({ error: "Could not check payment status." });
  }
});

// ─── POST /api/result ─────────────────────────────────────────────────────────
// Paynow posts payment results here (server-to-server notification)
app.post("/api/result", (req, res) => {
  console.log("Paynow result notification:", req.body);
  // TODO: Verify hash and update your order status in your database here
  res.sendStatus(200);
});

// ─── Lightweight Recommendations API (MVP) ─────────────────────────────────
// Returns a small list of rule-based recommendations.
app.get('/api/recommendations', async (req, res) => {
  try {
    const { productId, category } = req.query;
    const cacheKey = `recs:${category||'all'}:${productId||'none'}`;
    // Try cache
    const cached = await getCached(cacheKey);
    if (cached) {
      return res.json({ recommendations: cached, cached: true });
    }

    // If Firestore admin is available, fetch from `products` collection
    if (adminDb) {
      try {
        const productsRef = adminDb.collection('products');
        let snap;
        if (category) snap = await productsRef.where('category', '==', category).limit(12).get();
        else snap = await productsRef.limit(12).get();

        const docs = [];
        snap.forEach(d => {
          const data = d.data();
          docs.push({ id: d.id, title: data.title, image: (data.images && data.images[0]) || data.image || '', price: data.price || data.priceZWG || 0, category: data.category || '' });
        });

        let recs = docs.filter(p => p.id !== productId).slice(0, 6);
        if (!recs.length) recs = docs.slice(0, 6);
        // Cache results
        await setCached(cacheKey, recs);
        return res.json({ recommendations: recs });
      } catch (err) {
        console.error('Firestore recommendations error:', err);
        // fall through to static catalogue fallback
      }
    }

    // Static sample catalogue (fallback)
    const catalogue = [
      { id: 'p1', title: 'Handmade Basket', image: 'public/images/basket.jpg', price: 12.5, category: 'Home' },
      { id: 'p2', title: 'Canvas Tote Bag', image: 'public/images/tote.jpg', price: 8.0, category: 'Bags' },
      { id: 'p3', title: 'Leather Sandals', image: 'public/images/sandals.jpg', price: 22.0, category: 'Shoes' },
      { id: 'p4', title: 'Kitenge Dress', image: 'public/images/dress.jpg', price: 35.0, category: 'Clothing' },
      { id: 'p5', title: 'Vintage Sunglasses', image: 'public/images/sunglasses.jpg', price: 9.5, category: 'Accessories' },
      { id: 'p6', title: 'Children Toy Set', image: 'public/images/toy.jpg', price: 6.0, category: 'Kids' }
    ];

    let recs = catalogue;
    if (category) {
      recs = catalogue.filter(p => String(p.category).toLowerCase() === String(category).toLowerCase());
    }
    if (productId) recs = recs.filter(p => p.id !== productId);
    if (!recs.length) recs = catalogue.sort(() => 0.5 - Math.random()).slice(0, 4);
    recs = recs.slice(0, 6);
    await setCached(cacheKey, recs);
    res.json({ recommendations: recs });
  } catch (err) {
    console.error('Recommendations error:', err);
    res.status(500).json({ error: 'Could not compute recommendations.' });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mukoto Ave payment server running → http://localhost:${PORT}`);
});

// ─── POST /api/upload ─────────────────────────────────────────────────────────
// Accepts up to 5 image files (field name: 'images') and saves them to public/uploads
app.post('/api/upload', upload.array('images', 5), (req, res) => {
  try {
    const files = req.files || [];
    const base = `${req.protocol}://${req.get('host')}`;
    const urls = files.map(f => `${base}/uploads/${f.filename}`);
    return res.json({ urls });
  } catch (err) {
    console.error('Upload endpoint error:', err);
    return res.status(500).json({ error: 'Could not save uploaded files.' });
  }
});

// ─── POST /api/reset-password ─────────────────────────────────────────────────
// Server-side password reset: generates Firebase reset link (requires Firebase Admin)
// and sends an email using configured SMTP transporter. Expects JSON { email }
app.post('/api/reset-password', async (req, res) => {
  try {
    const email = req.body && req.body.email;
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    if (!adminDb) {
      return res.status(500).json({ error: 'Server missing Firebase admin credentials.' });
    }
    if (!transporter) {
      return res.status(500).json({ error: 'SMTP not configured on server.' });
    }

    const actionCodeSettings = {
      url: `${req.protocol}://${req.get('host')}/login.html`,
      handleCodeInApp: false
    };

    const link = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);

    const mailOptions = {
      from: process.env.FROM_EMAIL,
      to: email,
      subject: 'Reset your Mukoto Avenue password',
      text: `Reset your password by visiting the following link: ${link}`,
      html: `<p>Click the link below to reset your password:</p><p><a href="${link}">${link}</a></p>`
    };

    await transporter.sendMail(mailOptions);
    return res.json({ success: true });
  } catch (err) {
    console.error('Password reset error:', err);
    return res.status(500).json({ error: 'Could not send reset email.' });
  }
});
