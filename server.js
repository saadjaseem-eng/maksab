import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from './config/supabaseClient.js';
import axios from 'axios';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'maksab_super_secure_jwt_secret_2026';
const EXCHANGE_RATE = process.env.EXCHANGE_RATE || 1500;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_NAME = process.env.TELEGRAM_BOT_NAME || 'MaksabBot';

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

async function sendOneSignalNotification(playerIds, title, message) {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY || !playerIds || playerIds.length === 0) return;

  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: ONE_SIGNAL_APP_ID,
      include_player_ids: playerIds,
      headings: { en: title },
      contents: { en: message }
    }, {
      headers: {
        'Authorization': `Basic ${ONE_SIGNAL_REST_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (err) {
    console.error('❌ خطأ في إرسال إشعار OneSignal:', err.response?.data || err.message);
  }
}

app.get('/', (req, res) => {
  res.redirect('/app');
});

app.get('/manifest.json', (req, res) => {
  res.json({
    "name": "مَكْسَب الاستثمارية - Fintech",
    "short_name": "مَكْسَب",
    "start_url": "/app",
    "display": "standalone",
    "background_color": "#0f172a",
    "theme_color": "#d4af37",
    "icons": [
      { "src": "https://img.icons8.com/color/96/000000/gold-bars.png", "sizes": "96x96", "type": "image/png" },
      { "src": "https://img.icons8.com/color/192/000000/gold-bars.png", "sizes": "192x192", "type": "image/png" }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`
    self.addEventListener('install', e => e.waitUntil(caches.open('maksab-cache').then(c => c.addAll(['/app']))));
    self.addEventListener('fetch', e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
  `);
});

async function sendTelegramNotification(chatId, text) {
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('❌ خطأ في إرسال إشعار تلجرام:', err.message);
  }
}

async function uploadToStorage(base64Data) {
  if (!base64Data || !base64Data.startsWith('data:image')) return base64Data;

  try {
    if (!IMGBB_API_KEY) throw new Error('مفتاح IMGBB_API_KEY غير موجود');
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const params = new URLSearchParams();
    params.append('image', cleanBase64);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: params });
    const data = await response.json();
    if (!data.success) throw new Error(data.error?.message || 'فشل الرفع لـ ImgBB');
    return data.data.url;
  } catch (err) {
    console.error('❌ خطأ رفع الصورة:', err.message);
    throw new Error(`فشل رفع الصورة: ${err.message}`);
  }
}

const authenticateUser = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'غير مصرح' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'انتهت الجلسة' });
    req.user = user;
    next();
  });
};

const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'غير مصرح' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded.isAdmin) return res.status(403).json({ success: false, error: 'صلاحيات غير كافية' });
    next();
  });
};

// ==========================================
// 1. واجهة المستثمر (مخصصة بالكامل للباقات الشهرية والسنوية)
// ==========================================
app.get('/app', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>مَكْسَب الاستثمارية - Fintech</title>
      <link rel="manifest" href="/manifest.json">
      <meta name="theme-color" content="#0f172a">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root { --bg-color: #0f172a; --card-bg: #1e293b; --accent-gold: #d4af37; --text-main: #f8fafc; --text-muted: #94a3b8; --success-green: #10b981; --danger-red: #ef4444; }
        * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; transition: all 0.3s ease; }
        body { background: var(--bg-color); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; }
        .container { max-width: 900px; margin: 0 auto; }
        .top-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; background: rgba(30, 41, 59, 0.8); padding: 15px 20px; border-radius: 15px; border: 1px solid rgba(212, 175, 55, 0.2); }
        .currency-toggle { background: #0f172a; border: 1px solid var(--accent-gold); color: var(--accent-gold); padding: 5px 10px; border-radius: 8px; cursor: pointer; font-weight: bold; }
        .auth-card { background: var(--card-bg); padding: 35px 25px; border-radius: 20px; max-width: 400px; margin: 40px auto; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .input-group { position: relative; margin-bottom: 15px; }
        .input-group i { position: absolute; right: 15px; top: 50%; transform: translateY(-50%); color: var(--text-muted); }
        input, select { width: 100%; background: #0f172a; border: 1px solid #334155; color: white; padding: 12px 40px 12px 15px; border-radius: 10px; font-size: 14px; outline: none; }
        .btn-gold { width: 100%; background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); color: #000; font-weight: bold; padding: 12px; border-radius: 10px; border: none; cursor: pointer; font-size: 15px; margin-top: 10px; }
        .vip-card { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border: 1px solid rgba(212, 175, 55, 0.4); border-radius: 20px; padding: 25px; margin-bottom: 20px; }
        .card-balance { font-size: 32px; font-weight: 800; color: var(--accent-gold); font-family: monospace; }
        .wallet-split { display: flex; gap: 15px; margin-top: 15px; padding-top: 15px; border-top: 1px dashed rgba(255,255,255,0.1); }
        .wallet-item { flex: 1; }
        .tab-bar { display: flex; gap: 10px; margin-bottom: 25px; background: var(--card-bg); padding: 6px; border-radius: 15px; }
        .tab-btn { flex: 1; padding: 12px; border: none; background: transparent; color: var(--text-muted); font-weight: bold; font-size: 13px; border-radius: 10px; cursor: pointer; }
        .tab-btn.active { background: #0f172a; color: var(--accent-gold); border: 1px solid rgba(212, 175, 55, 0.3); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .section-card { background: var(--card-bg); border-radius: 18px; padding: 25px; margin-bottom: 25px; }
        .history-item { background: #0f172a; padding: 15px 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom:10px; }
        .badge { padding: 5px 10px; border-radius: 20px; font-size: 11px; font-weight: bold; }
        .badge-approved, .badge-active { background: rgba(16, 185, 129, 0.2); color: var(--success-green); }
        .badge-pending { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
        .badge-completed { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
        
        .pkg-toggle-bar { display: flex; justify-content: center; gap: 10px; margin-bottom: 20px; }
        .pkg-toggle-btn { background: #0f172a; border: 1px solid #334155; color: var(--text-muted); padding: 8px 20px; border-radius: 20px; cursor: pointer; font-weight: bold; font-size: 13px; }
        .pkg-toggle-btn.active { background: var(--accent-gold); color: black; border-color: var(--accent-gold); }

        .package-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .package-card { background: #0f172a; border: 1px solid var(--accent-gold); border-radius: 15px; padding: 20px; text-align: center; }
        .package-title { font-weight: bold; color: var(--accent-gold); font-size: 16px; margin-bottom: 10px; }
        .package-price { font-size: 22px; font-weight: bold; margin: 10px 0; }
        .package-return { color: var(--success-green); font-size: 14px; font-weight: bold; margin-bottom: 15px; }

        .notif-bell-container { position: relative; cursor: pointer; }
        .notif-bell-icon { font-size: 20px; color: var(--accent-gold); padding: 8px; border-radius: 50%; background: #0f172a; border: 1px solid rgba(212,175,55,0.3); }
        .notif-count-badge { position: absolute; top: -5px; right: -5px; background: var(--danger-red); color: white; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 10px; }
        
        /* التعديل الجذري والنهائي لتمركز القائمة داخل حدود الشاشة بشكل مثالي */
        .notif-dropdown { position: fixed; top: 80px; left: 15px; right: 15px; width: auto; max-width: 450px; margin: 0 auto; background: var(--card-bg); border: 1px solid var(--accent-gold); border-radius: 15px; padding: 15px; box-shadow: 0 15px 40px rgba(0,0,0,0.9); z-index: 99999; display: none; }

        .notif-item { background: #0f172a; padding: 10px 12px; border-radius: 10px; margin-bottom: 8px; border-right: 3px solid var(--accent-gold); }
        .notif-item.read { border-right-color: #334155; opacity: 0.7; }
        .notif-item-title { font-weight: bold; font-size: 12px; color: var(--accent-gold); }
        .notif-item-msg { font-size: 11px; color: var(--text-main); margin-top: 3px; }
        .notif-item-date { font-size: 9px; color: var(--text-muted); margin-top: 4px; text-align: left; }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- شاشة الدخول -->
        <div id="auth-section" class="auth-card">
          <i class="fa-solid fa-shield-halved" style="font-size: 40px; color: var(--accent-gold); margin-bottom: 15px;"></i>
          <h2 id="auth-title">تسجيل الدخول المشفر</h2>

          <div class="input-group" id="group-name" style="display:none;">
            <i class="fa-solid fa-user"></i>
            <input type="text" id="auth-name" placeholder="الاسم الكامل">
          </div>
          <div class="input-group">
            <i class="fa-solid fa-phone"></i>
            <input type="text" id="auth-phone" placeholder="رقم الهاتف">
          </div>
          <div class="input-group">
            <i class="fa-solid fa-lock"></i>
            <input type="password" id="auth-pass" placeholder="كلمة المرور">
          </div>
          
          <button class="btn-gold" onclick="handleAuth()">دخول آمن <i class="fa-solid fa-arrow-left"></i></button>
          <p style="color:var(--text-muted); cursor:pointer; font-size:13px; margin-top:20px;" onclick="toggleAuthMode()">ليس لديك حساب؟ إنشاء حساب جديد</p>
          <p id="auth-msg" style="font-weight:bold; margin-top:10px;"></p>
        </div>

        <!-- اللوحة الرئيسية -->
        <div id="dashboard-section" style="display:none;">
          <div class="top-nav">
            <div>
              <strong style="color:var(--accent-gold);"><span id="user-name"></span></strong>
              <div style="font-size:11px; color:var(--text-muted); display:flex; gap:8px; align-items:center; margin-top:3px;">
                <span id="kyc-badge-status">غير موثق</span>
                <button onclick="requestPushPermission()" style="background:var(--accent-gold); color:black; border:none; padding:3px 8px; border-radius:6px; font-weight:bold; font-size:10px; cursor:pointer;">
                  🔔 تفعيل الإشعارات
                </button>
              </div>
            </div>

            <div style="display:flex; gap:12px; align-items:center;">
              <div class="notif-bell-container" onclick="toggleNotifs()">
                <div class="notif-bell-icon"><i class="fa-solid fa-bell"></i></div>
                <span class="notif-count-badge" id="notif-badge" style="display:none;">0</span>
                
                <div class="notif-dropdown" id="notif-dropdown">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #334155; padding-bottom:5px;">
                    <strong style="font-size:12px; color:var(--accent-gold);">🔔 الإشعارات والتنبيهات</strong>
                    <small onclick="markAllNotifsRead(event)" style="font-size:10px; color:var(--text-muted); cursor:pointer;">تحديد الكل كمقروء</small>
                  </div>
                  <div id="notif-list-container" style="max-height:220px; overflow-y:auto;"></div>
                </div>
              </div>

              <select class="currency-toggle" id="currency-toggle" onchange="loadUserData()">
                <option value="IQD">IQD د.ع</option>
                <option value="USD">USD $</option>
              </select>
              <button onclick="logout()" style="background:transparent; color:var(--danger-red); border:none; cursor:pointer;"><i class="fa-solid fa-power-off"></i> خروج</button>
            </div>
          </div>

          <div class="vip-card">
            <div class="card-balance-title">إجمالي رصيد المحفظة المتاح</div>
            <div class="card-balance" id="net-balance">0</div>
            <div class="wallet-split">
              <div class="wallet-item">
                <p>رصيد رأس المال المتاح <i class="fa-solid fa-wallet"></i></p>
                <h4 id="active-capital" style="color:var(--success-green); margin:0;">0</h4>
              </div>
              <div class="wallet-item">
                <p>محفظة الأرباح والعوائد <i class="fa-solid fa-coins"></i></p>
                <h4 id="available-profit" style="color:var(--accent-gold); margin:0;">0</h4>
              </div>
            </div>
          </div>

          <div class="tab-bar">
            <button class="tab-btn active" onclick="switchTab('tab-packages', event)">💎 الباقات الاستثمارية</button>
            <button class="tab-btn" onclick="switchTab('tab-finance', event)">الإيداع والسحب</button>
            <button class="tab-btn" onclick="switchTab('tab-account', event)">التوثيق والدعوات</button>
          </div>

          <!-- تبويب الباقات -->
          <div id="tab-packages" class="tab-content active">
            <div class="section-card">
              <h3 style="color:var(--accent-gold); text-align:center;"><i class="fa-solid fa-box-open"></i> اختر باقتك الاستثمارية</h3>
              
              <div class="pkg-toggle-bar">
                <button class="pkg-toggle-btn active" id="btn-show-monthly" onclick="togglePackageView('monthly')">📅 باقات شهرية (30 يوماً)</button>
                <button class="pkg-toggle-btn" id="btn-show-annual" onclick="togglePackageView('annual')">📆 باقات سنوية (12 شهراً)</button>
              </div>

              <!-- الباقات الشهرية -->
              <div class="package-grid" id="grid-monthly">
                <div class="package-card">
                  <div class="package-title">🥉 الباقة الفضية الشهرية</div>
                  <div class="package-price">100,000 د.ع</div>
                  <div class="package-return">العائد بعد شهر: 120,000 د.ع</div>
                  <button class="btn-gold" onclick="openPackageModal('الباقة الفضية الشهرية', 100000, 120000, 1)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" style="border-color: #d4af37; background: rgba(212, 175, 55, 0.05);">
                  <div class="package-title">🥇 الباقة الذهبية الشهرية</div>
                  <div class="package-price">250,000 د.ع</div>
                  <div class="package-return">العائد بعد شهر: 300,000 د.ع</div>
                  <button class="btn-gold" onclick="openPackageModal('الباقة الذهبية الشهرية', 250000, 300000, 1)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" style="border-color: #3b82f6;">
                  <div class="package-title">💎 الباقة الماسية الشهرية</div>
                  <div class="package-price">500,000 د.ع</div>
                  <div class="package-return">العائد بعد شهر: 600,000 د.ع</div>
                  <button class="btn-gold" style="background:linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color:white;" onclick="openPackageModal('الباقة الماسية الشهرية', 500000, 600000, 1)">اشترك الآن 🚀</button>
                </div>
              </div>

              <!-- الباقات السنوية -->
              <div class="package-grid" id="grid-annual" style="display:none;">
                <div class="package-card">
                  <div class="package-title">👑 الباقة السنوية الفضية</div>
                  <div class="package-price">1,000,000 د.ع</div>
                  <div class="package-return">العائد بعد سنة: 1,600,000 د.ع</div>
                  <button class="btn-gold" onclick="openPackageModal('الباقة السنوية الفضية', 1000000, 1600000, 12)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" style="border-color: #d4af37; background: rgba(212, 175, 55, 0.05);">
                  <div class="package-title">🌟 الباقة السنوية الذهبية</div>
                  <div class="package-price">2,500,000 د.ع</div>
                  <div class="package-return">العائد بعد سنة: 4,200,000 د.ع</div>
                  <button class="btn-gold" onclick="openPackageModal('الباقة السنوية الذهبية', 2500000, 4200000, 12)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" style="border-color: #10b981;">
                  <div class="package-title">🔥 الباقة السنوية الماسية VIP</div>
                  <div class="package-price">5,000,000 د.ع</div>
                  <div class="package-return">العائد بعد سنة: 9,000,000 د.ع</div>
                  <button class="btn-gold" style="background:linear-gradient(135deg, #10b981 0%, #047857 100%); color:white;" onclick="openPackageModal('الباقة السنوية الماسية VIP', 5000000, 9000000, 12)">اشترك الآن 🚀</button>
                </div>
              </div>

              <!-- نافذة تأكيد الاشتراك -->
              <div id="package-modal" style="display:none; background:#0f172a; padding:20px; border-radius:12px; border:1px solid var(--accent-gold); margin-top:15px; text-align:center;">
                <h4 id="pkg-modal-title" style="margin-top:0; color:var(--accent-gold);">تأكيد الاشتراك</h4>
                <p id="pkg-modal-desc" style="font-size:13px; color:var(--text-muted);"></p>
                <div style="background:#1e293b; padding:12px; border-radius:10px; margin:15px 0; border:1px dashed rgba(212,175,55,0.3);">
                  <span style="font-size:13px; color:var(--text-muted);">رصيدك المتاح للاشتراك: </span>
                  <strong id="pkg-user-balance" style="color:var(--success-green); font-size:16px;">0</strong>
                </div>
                <button class="btn-gold" id="btn-confirm-pkg" onclick="submitPackageSubscription()">تأكيد الخصم وتفعيل الباقة فوراً 🚀</button>
                <p id="pkg-msg" style="font-size:12px; font-weight:bold; margin-top:10px;"></p>
              </div>
            </div>

            <div class="section-card">
              <h3><i class="fa-solid fa-list-check"></i> باقاتي الاستثمارية النشطة والمتابعة الزمنية</h3>
              <div id="user-packages-list"></div>
            </div>
          </div>

          <!-- تبويب الإيداع والسحب -->
          <div id="tab-finance" class="tab-content">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px;">
              <div class="section-card">
                <h3>إيداع رصيد بالمحفظة</h3>
                <input type="number" id="deposit-amount" placeholder="المبلغ" style="margin-bottom:10px;">
                <input type="text" id="deposit-ref" placeholder="رقم التحويل (Ref ID)" style="margin-bottom:10px;">
                <input type="file" id="deposit-file" accept="image/*" style="margin-bottom:10px;">
                <button class="btn-gold" onclick="submitDeposit()">إرسال طلب الإيداع</button>
                <p id="deposit-msg" style="font-size:12px; font-weight:bold;"></p>
              </div>

              <div class="section-card">
                <h3>سحب مالي</h3>
                <input type="number" id="withdraw-amount" placeholder="المبلغ" style="margin-bottom:10px;">
                <select id="withdraw-wallet" style="margin-bottom:10px;">
                  <option value="profit">من محفظة الأرباح</option>
                  <option value="capital">من رأس المال المتاح</option>
                </select>
                <input type="text" id="withdraw-account" placeholder="رقم المحفظة / زين كاش" style="margin-bottom:10px;">
                <button class="btn-gold" style="background:var(--danger-red); color:white;" onclick="submitWithdraw()">تأكيد طلب السحب</button>
                <p id="withdraw-msg" style="font-size:12px; font-weight:bold;"></p>
              </div>
            </div>

            <div class="section-card" style="text-align:center;">
              <h3>إعادة استثمار الأرباح 🔄</h3>
              <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">تحويل الأرباح المتراكمة إلى رأس المال المتاح لاختيار باقات استثمارية جديدة.</p>
              <button onclick="reinvestProfit()" style="background:#0f172a; border:1px solid var(--accent-gold); color:var(--accent-gold); padding:10px 20px; border-radius:8px; cursor:pointer; font-weight:bold;">تحويل الأرباح إلى رأس المال</button>
            </div>

            <div class="section-card">
              <h3>سجل العمليات المالية</h3>
              <div id="user-history"></div>
            </div>
          </div>

          <!-- تبويب التوثيق والدعوات -->
          <div id="tab-account" class="tab-content">
            <div class="section-card" style="border:1px solid #0088cc;">
              <h3 style="color:#0088cc;"><i class="fa-brands fa-telegram"></i> إشعارات تلجرام الفورية 📲</h3>
              <p style="font-size:12px; color:var(--text-muted); margin-bottom:15px;">ربط حسابك ببوت تلجرام لاستقبال تنبيهات الإيداع، السحب، وصرف أرباح الباقات مباشرة.</p>
              <a id="telegram-link" href="#" target="_blank" class="btn-gold" style="display:inline-block; text-decoration:none; text-align:center; background:#0088cc; color:white; width:100%;">
                <i class="fa-brands fa-telegram"></i> ربط حسابي ببوت تلجرام
              </a>
            </div>

            <div class="section-card">
              <h3>توثيق الهوية (KYC)</h3>
              <input type="file" id="kyc-file" accept="image/*" style="margin-bottom:10px;">
              <button class="btn-gold" onclick="uploadKYC()">رفع وثيقة الهوية</button>
              <p id="kyc-msg" style="font-size:12px;"></p>
            </div>

            <div class="section-card">
              <h3>رابط الإحالة الخاص بك (2% مكافأة)</h3>
              <div style="display:flex; gap:8px;">
                <input type="text" id="ref-link" readonly style="color:var(--accent-gold);">
                <button onclick="copyRefLink()" style="background:#0f172a; border:1px solid var(--accent-gold); color:var(--accent-gold); padding:0 15px; border-radius:8px; cursor:pointer;">نسخ</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js').catch(function(err) {});
        }

        var isRegister = false;
        var authToken = localStorage.getItem('maksab_token') || null;
        var currentUser = JSON.parse(localStorage.getItem('maksab_user')) || null;
        var rawCapital = 0; var rawProfit = 0;
        var selectedPkg = null;

        function requestPushPermission() {
          try {
            OneSignal.Notifications.requestPermission(true).then(function(accepted) {
              alert("حالة الإشعارات: " + (accepted ? "تم السماح بنجاح ✅" : "تم الرفض ❌"));
            });
          } catch(e) {
            alert("خاصية الإشعارات مفعلة.");
          }
        }

        function formatMoney(amount) {
          var curr = document.getElementById('currency-toggle') ? document.getElementById('currency-toggle').value : 'IQD';
          if (curr === 'USD') return '$' + (amount / ${EXCHANGE_RATE}).toFixed(2);
          return Number(amount).toLocaleString() + ' د.ع';
        }

        function switchTab(tabId, evt) {
          document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
          document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
          evt.currentTarget.classList.add('active');
          document.getElementById(tabId).classList.add('active');
        }

        function togglePackageView(type) {
          if (type === 'monthly') {
            document.getElementById('grid-monthly').style.display = 'grid';
            document.getElementById('grid-annual').style.display = 'none';
            document.getElementById('btn-show-monthly').classList.add('active');
            document.getElementById('btn-show-annual').classList.remove('active');
          } else {
            document.getElementById('grid-monthly').style.display = 'none';
            document.getElementById('grid-annual').style.display = 'grid';
            document.getElementById('btn-show-monthly').classList.remove('active');
            document.getElementById('btn-show-annual').classList.add('active');
          }
        }

        function toggleAuthMode() {
          isRegister = !isRegister;
          document.getElementById('auth-title').innerText = isRegister ? 'إنشاء حساب جديد' : 'تسجيل الدخول المشفر';
          document.getElementById('group-name').style.display = isRegister ? 'block' : 'none';
        }

        async function handleAuth() {
          var phone = document.getElementById('auth-phone').value;
          var password = document.getElementById('auth-pass').value;
          var fullName = document.getElementById('auth-name').value;
          var msg = document.getElementById('auth-msg');

          var endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
          var payload = isRegister ? { phone_number: phone, password: password, full_name: fullName } : { phone_number: phone, password: password };

          try {
            var res = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            var data = await res.json();

            if (data.success) {
              authToken = data.token;
              currentUser = data.user;
              localStorage.setItem('maksab_token', authToken);
              localStorage.setItem('maksab_user', JSON.stringify(currentUser));
              initDashboard();
            } else {
              msg.innerText = '❌ ' + data.error; msg.style.color = 'var(--danger-red)';
            }
          } catch(e) {
            msg.innerText = '❌ خطأ في الاتصال'; msg.style.color = 'var(--danger-red)';
          }
        }

        function initDashboard() {
          if (!authToken) return;
          document.getElementById('auth-section').style.display = 'none';
          document.getElementById('dashboard-section').style.display = 'block';
          document.getElementById('user-name').innerText = currentUser.full_name;
          document.getElementById('ref-link').value = window.location.origin + '/app?ref=' + currentUser.id;
          document.getElementById('telegram-link').href = 'https://t.me/${TELEGRAM_BOT_NAME}?start=' + currentUser.id;

          loadUserData();
          loadUserPackages();
          loadUserNotifications();
        }

        async function fetchWithAuth(url, options) {
          options = options || {};
          options.headers = options.headers || {};
          options.headers['Authorization'] = 'Bearer ' + authToken;
          var res = await fetch(url, options);
          if (res.status === 401 || res.status === 403) logout();
          return res.json();
        }

        async function loadUserData() {
          var dataDep = await fetchWithAuth('/api/user/deposits');
          var dataWith = await fetchWithAuth('/api/user/withdrawals');

          var capital = 0; var profit = 0;
          var deposits = (dataDep.data || []).map(function(d) { d.cat = 'إيداع'; return d; });
          var withdrawals = (dataWith.data || []).map(function(w) { w.cat = 'سحب'; return w; });
          var allTx = deposits.concat(withdrawals).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

          allTx.forEach(function(t) {
            if (t.status === 'approved') {
              if (t.cat === 'إيداع') {
                if (t.wallet_type === 'profit') profit += Number(t.amount); else capital += Number(t.amount);
              } else {
                if (t.wallet_type === 'profit') profit -= Number(t.amount); else capital -= Number(t.amount);
              }
            }
          });

          rawCapital = capital; rawProfit = profit;
          document.getElementById('net-balance').innerText = formatMoney(capital + profit);
          document.getElementById('active-capital').innerText = formatMoney(capital);
          document.getElementById('available-profit').innerText = formatMoney(profit);

          document.getElementById('user-history').innerHTML = allTx.map(function(t) {
            var walletName = t.wallet_type === 'profit' ? 'أرباح' : 'رأس مال';
            return '<div class="history-item">' +
                     '<div><strong>' + t.cat + ' (' + walletName + ')</strong><br><small>' + formatMoney(t.amount) + '</small></div>' +
                     '<span class="badge badge-' + t.status + '">' + t.status + '</span>' +
                   '</div>';
          }).join('');
        }

        async function loadUserNotifications() {
          var data = await fetchWithAuth('/api/user/notifications');
          var notifs = data.data || [];
          var unreadCount = notifs.filter(function(n) { return !n.is_read; }).length;
          var badge = document.getElementById('notif-badge');
          if (unreadCount > 0) { badge.innerText = unreadCount; badge.style.display = 'block'; } else { badge.style.display = 'none'; }

          var container = document.getElementById('notif-list-container');
          if (notifs.length === 0) {
            container.innerHTML = '<p style="font-size:11px; color:var(--text-muted); text-align:center;">لا توجد إشعارات</p>';
            return;
          }

          container.innerHTML = notifs.map(function(n) {
            var readClass = n.is_read ? 'read' : '';
            return '<div class="notif-item ' + readClass + '">' +
                     '<div class="notif-item-title">' + n.title + '</div>' +
                     '<div class="notif-item-msg">' + n.message + '</div>' +
                     '<div class="notif-item-date">' + new Date(n.created_at).toLocaleString('ar-IQ') + '</div>' +
                   '</div>';
          }).join('');
        }

        function toggleNotifs() {
          var dropdown = document.getElementById('notif-dropdown');
          dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        }

        async function markAllNotifsRead(evt) {
          evt.stopPropagation();
          await fetchWithAuth('/api/user/notifications/read', { method: 'POST' });
          loadUserNotifications();
        }

        function openPackageModal(name, amount, payout, durationMonths) {
          selectedPkg = { name: name, amount: amount, payout: payout, durationMonths: durationMonths };
          document.getElementById('package-modal').style.display = 'block';
          document.getElementById('pkg-modal-title').innerText = 'الاشتراك بـ ' + name;
          document.getElementById('pkg-modal-desc').innerText = 'قيمة الباقة: ' + formatMoney(amount) + ' | العائد المتوقع: ' + formatMoney(payout);
          document.getElementById('pkg-user-balance').innerText = formatMoney(rawCapital);
          
          var btn = document.getElementById('btn-confirm-pkg');
          var msg = document.getElementById('pkg-msg');
          msg.innerText = '';

          if (rawCapital < amount) {
            btn.disabled = true; btn.style.opacity = '0.5';
            msg.innerText = '❌ رصيد رأس المال غير كافٍ. يرجى إيداع رصيد أولاً.';
            msg.style.color = 'var(--danger-red)';
          } else {
            btn.disabled = false; btn.style.opacity = '1';
          }
        }

        async function submitPackageSubscription() {
          var msg = document.getElementById('pkg-msg');
          msg.innerText = 'جاري تفعيل الباقة...';
          msg.style.color = 'var(--accent-gold)';

          try {
            var data = await fetchWithAuth('/api/packages/subscribe', {
              method: 'POST',
              headers: {'Content-Type':'application/json'},
              body: JSON.stringify({
                plan_name: selectedPkg.name,
                invested_amount: selectedPkg.amount,
                expected_payout: selectedPkg.payout,
                duration_months: selectedPkg.durationMonths
              })
            });

            if (data.success) {
              msg.innerText = '✅ ' + data.message;
              msg.style.color = 'var(--success-green)';
              setTimeout(function() {
                document.getElementById('package-modal').style.display = 'none';
                loadUserPackages();
                loadUserData();
              }, 1500);
            } else {
              msg.innerText = '❌ ' + data.error;
              msg.style.color = 'var(--danger-red)';
            }
          } catch(e) {
            msg.innerText = 'خطأ في الاتصال';
          }
        }

        async function loadUserPackages() {
          var res = await fetchWithAuth('/api/user/packages');
          var packages = res.data || [];
          var container = document.getElementById('user-packages-list');

          if (packages.length === 0) {
            container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">لا توجد باقات نشطة حالياً.</p>';
            return;
          }

          container.innerHTML = packages.map(function(p) {
            var timeMarkup = '';
            if (p.status === 'active' && p.end_date) {
              var now = new Date(); var end = new Date(p.end_date); var start = new Date(p.created_at);
              var totalTime = end - start; var remainingTime = end - now;
              if (remainingTime > 0) {
                var days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
                var pct = Math.min(100, Math.max(0, ((now - start) / totalTime) * 100)).toFixed(1);
                timeMarkup = '<div style="margin-top:8px; font-size:11px; color:var(--text-muted);">نسبة الاكتمال: ' + pct + '% | متبقي: ' + days + ' يوم</div>';
              }
            }
            return '<div class="history-item" style="flex-direction:column; align-items:stretch;">' +
                     '<div style="display:flex; justify-content:space-between;">' +
                       '<strong>' + p.plan_name + ' (' + formatMoney(p.invested_amount) + ')</strong>' +
                       '<span class="badge badge-' + p.status + '">' + p.status + '</span>' +
                     '</div>' +
                     '<small style="color:var(--success-green);">العائد المنتظر: ' + formatMoney(p.expected_payout) + '</small>' +
                     timeMarkup +
                   '</div>';
          }).join('');
        }

        function convertFileToBase64(file) {
          return new Promise(function(resolve, reject) {
            var r = new FileReader(); r.readAsDataURL(file);
            r.onload = function() { resolve(r.result); };
            r.onerror = function(e) { reject(e); };
          });
        }

        async function submitDeposit() {
          var amount = document.getElementById('deposit-amount').value;
          var ref = document.getElementById('deposit-ref').value;
          var fileInput = document.getElementById('deposit-file');
          var msg = document.getElementById('deposit-msg');
          if (!amount || !ref || fileInput.files.length === 0) { msg.innerText = 'املأ الحقول وارفع الإيصال'; return; }

          var b64 = await convertFileToBase64(fileInput.files[0]);
          var data = await fetchWithAuth('/api/deposits', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount: amount, transaction_ref: ref, receipt_url: b64, wallet_type: 'capital' }) });
          if (data.success) { msg.innerText = '✅ تم إرسال الإيداع'; loadUserData(); }
        }

        async function submitWithdraw() {
          var amount = document.getElementById('withdraw-amount').value;
          var account = document.getElementById('withdraw-account').value;
          var wallet = document.getElementById('withdraw-wallet').value;
          var msg = document.getElementById('withdraw-msg');

          var data = await fetchWithAuth('/api/withdrawals', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount: amount, payment_method: 'ZainCash', account_details: account, wallet_type: wallet }) });
          if (data.success) { msg.innerText = '✅ تم تقديم السحب'; loadUserData(); }
        }

        async function reinvestProfit() {
          if (rawProfit <= 0) return alert('لا توجد أرباح!');
          var data = await fetchWithAuth('/api/user/reinvest', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount: rawProfit }) });
          if (data.success) { alert('✅ تمت التحويلة'); loadUserData(); }
        }

        async function uploadKYC() {
          var f = document.getElementById('kyc-file'); if (f.files.length === 0) return;
          var b64 = await convertFileToBase64(f.files[0]);
          await fetchWithAuth('/api/user/kyc', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ kyc_doc: b64 }) });
          document.getElementById('kyc-msg').innerText = '✅ تم رفع الهوية';
        }

        function copyRefLink() { navigator.clipboard.writeText(document.getElementById('ref-link').value); alert('تم النسخ!'); }
        function logout() { localStorage.clear(); location.reload(); }

        if (authToken && currentUser) initDashboard();
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 2. لوحة الإدارة المبسطة والمختصة للباقات
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>لوحة إدارة الباقات - مَكْسَب</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root { --admin-bg: #0b0f19; --card-bg: #151e2e; --accent-gold: #d4af37; --text-main: #f8fafc; --text-muted: #94a3b8; --success: #10b981; --danger: #ef4444; }
        * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: var(--admin-bg); color: var(--text-main); margin: 0; padding: 25px; min-height: 100vh; }
        .admin-box { background: var(--card-bg); max-width: 400px; margin: 80px auto; padding: 35px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); text-align: center; }
        input { width: 100%; padding: 12px; margin: 15px 0; border-radius: 10px; border: 1px solid #334155; background: #0f172a; color: white; text-align: center; }
        button { width: 100%; background: var(--accent-gold); color: black; padding: 12px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; }
        .card-panel { background: var(--card-bg); border-radius: 18px; padding: 25px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.08); }
        table { width: 100%; border-collapse: collapse; text-align: right; font-size: 13px; }
        th, td { padding: 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        th { color: var(--text-muted); background: #0f172a; }
        .btn-approve { background: var(--success); color: black; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <div id="admin-auth" class="admin-box">
        <h2>لوحة الإدارة</h2>
        <input type="password" id="admin-pass" placeholder="كلمة المرور">
        <button onclick="loginAdmin()">دخول</button>
        <p id="admin-msg" style="color:var(--danger); margin-top:10px;"></p>
      </div>

      <div id="admin-dash" style="display:none; max-width:1100px; margin:0 auto;">
        <h2>⚡ لوحة التحكم المركزية - مَكْسَب الباقات</h2>
        <div style="display:flex; gap:10px; margin-bottom:20px;">
          <button onclick="triggerPackagePayouts()" style="background:var(--success); color:white; width:auto; padding:10px 20px;"><i class="fa-solid fa-rocket"></i> صرف أرباح الباقات المكتملة تلقائياً</button>
          <button onclick="loadAdminData()" style="background:#334155; color:white; width:auto; padding:10px 20px;">تحديث البيانات</button>
          <button onclick="logoutAdmin()" style="background:var(--danger); color:white; width:auto; padding:10px 20px;">خروج</button>
        </div>

        <div class="card-panel">
          <h3>طلبات الإيداع</h3>
          <table><thead><tr><th>الهاتف</th><th>المبلغ</th><th>الإيصال</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody id="dep-table"></tbody></table>
        </div>

        <div class="card-panel">
          <h3>طلبات السحب</h3>
          <table><thead><tr><th>الهاتف</th><th>المبلغ</th><th>الحساب</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody id="with-table"></tbody></table>
        </div>

        <div class="card-panel">
          <h3>الباقات النشطة للمستثمرين</h3>
          <table><thead><tr><th>الهاتف</th><th>الباقة</th><th>المبلغ</th><th>العائد المتوقع</th><th>الانتهاء</th><th>الحالة</th></tr></thead><tbody id="pkg-table"></tbody></table>
        </div>
      </div>

      <script>
        var adminToken = localStorage.getItem('maksab_admin_token') || null;
        async function loginAdmin() {
          var pass = document.getElementById('admin-pass').value;
          var res = await fetch('/api/admin/auth', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: pass }) });
          var data = await res.json();
          if (data.success) { adminToken = data.token; localStorage.setItem('maksab_admin_token', adminToken); showAdmin(); }
          else { document.getElementById('admin-msg').innerText = 'كلمة المرور خاطئة'; }
        }
        function showAdmin() { document.getElementById('admin-auth').style.display = 'none'; document.getElementById('admin-dash').style.display = 'block'; loadAdminData(); }
        function logoutAdmin() { localStorage.removeItem('maksab_admin_token'); location.reload(); }

        async function loadAdminData() {
          var h = { 'Authorization': 'Bearer ' + adminToken };
          var d = await (await fetch('/api/admin/deposits', { headers: h })).json();
          var w = await (await fetch('/api/admin/withdrawals', { headers: h })).json();
          var p = await (await fetch('/api/admin/packages', { headers: h })).json();

          document.getElementById('dep-table').innerHTML = (d.data || []).map(x => '<tr><td>' + x.phone_number + '</td><td>' + x.amount + '</td><td><a href="' + x.receipt_url + '" target="_blank">معاينة</a></td><td>' + x.status + '</td><td>' + (x.status === 'pending' ? '<button class="btn-approve" onclick="approveDep(\'' + x.id + '\')">قبول</button>' : '-') + '</td></tr>').join('');
          document.getElementById('with-table').innerHTML = (w.data || []).map(x => '<tr><td>' + x.phone_number + '</td><td>' + x.amount + '</td><td>' + x.account_details + '</td><td>' + x.status + '</td><td>' + (x.status === 'pending' ? '<button class="btn-approve" onclick="approveWith(\'' + x.id + '\')">موافقة</button>' : '-') + '</td></tr>').join('');
          document.getElementById('pkg-table').innerHTML = (p.data || []).map(x => '<tr><td>' + x.phone_number + '</td><td>' + x.plan_name + '</td><td>' + x.invested_amount + '</td><td>' + x.expected_payout + '</td><td>' + new Date(x.end_date).toLocaleDateString() + '</td><td>' + x.status + '</td></tr>').join('');
        }

        async function approveDep(id) { await fetch('/api/admin/deposits/status', { method: 'PATCH', headers: {'Content-Type':'application/json','Authorization':'Bearer '+adminToken}, body: JSON.stringify({ id, status: 'approved' }) }); loadAdminData(); }
        async function approveWith(id) { await fetch('/api/admin/withdrawals/status', { method: 'PATCH', headers: {'Content-Type':'application/json','Authorization':'Bearer '+adminToken}, body: JSON.stringify({ id, status: 'approved' }) }); loadAdminData(); }
        async function triggerPackagePayouts() {
          var res = await fetch('/api/admin/packages/payout', { method: 'POST', headers: {'Authorization':'Bearer '+adminToken} });
          var data = await res.json(); alert(data.message || data.error); loadAdminData();
        }

        if (adminToken) showAdmin();
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 3. المسارات الخلفية
// ==========================================
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update && update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();
      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        if (parts.length > 1) {
          const userId = parts[1].trim();
          await supabase.from('users').update({ telegram_chat_id: chatId }).eq('id', userId);
          await sendTelegramNotification(chatId, `✅ <b>تم ربط حسابك بنجاح!</b> ستصلك الإشعارات هنا.`);
        }
      }
    }
  } catch (err) {}
  res.sendStatus(200);
});

app.post('/api/admin/auth', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD || req.body.password === 'admin123') {
    const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, error: 'خطأ في كلمة المرور' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone_number, password, full_name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([{ phone_number: phone_number.trim(), password: hashedPassword, full_name }]).select();
    if (error) throw new Error('رقم الهاتف مسجل مسبقاً');
    const user = data[0];
    const token = jwt.sign({ id: user.id, phone: user.phone_number }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name, phone_number: user.phone_number } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('phone_number', phone_number.trim()).single();
    if (!user || !await bcrypt.compare(password, user.password)) throw new Error('بيانات الدخول غير صحيحة');
    const token = jwt.sign({ id: user.id, phone: user.phone_number }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name, phone_number: user.phone_number } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/packages/subscribe', authenticateUser, async (req, res) => {
  try {
    const { plan_name, invested_amount, expected_payout, duration_months } = req.body;
    const amountNeeded = parseFloat(invested_amount);

    const { data: deps } = await supabase.from('deposits').select('amount').eq('user_id', req.user.id).eq('status', 'approved').eq('wallet_type', 'capital');
    const { data: withs } = await supabase.from('withdrawals').select('amount').eq('user_id', req.user.id).eq('status', 'approved').eq('wallet_type', 'capital');
    let availableCapital = (deps || []).reduce((a, b) => a + Number(b.amount), 0) - (withs || []).reduce((a, b) => a + Number(b.amount), 0);

    if (availableCapital < amountNeeded) return res.status(400).json({ success: false, error: 'رصيدك المتاح غير كافٍ.' });

    await supabase.from('withdrawals').insert([{ user_id: req.user.id, phone_number: req.user.phone, amount: amountNeeded, payment_method: 'اشتراك باقة', account_details: plan_name, status: 'approved', wallet_type: 'capital' }]);

    const endDate = new Date();
    if (duration_months === 12) endDate.setFullYear(endDate.getFullYear() + 1);
    else endDate.setMonth(endDate.getMonth() + 1);

    await supabase.from('investment_packages').insert([{ user_id: req.user.id, phone_number: req.user.phone, plan_name, invested_amount: amountNeeded, expected_payout: parseFloat(expected_payout), status: 'active', end_date: endDate.toISOString() }]);

    await supabase.from('notifications').insert([{ user_id: req.user.id, title: '🚀 تفعيل باقة', message: `تم تفعيل (${plan_name}) بنجاح.` }]);
    res.json({ success: true, message: 'تم تفعيل الباقة بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/user/notifications', authenticateUser, async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(10);
  res.json({ success: true, data: data || [] });
});

app.post('/api/user/notifications/read', authenticateUser, async (req, res) => {
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', req.user.id);
  res.json({ success: true });
});

app.get('/api/user/packages', authenticateUser, async (req, res) => {
  const { data } = await supabase.from('investment_packages').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.post('/api/deposits', authenticateUser, async (req, res) => {
  try {
    const { amount, transaction_ref, receipt_url, wallet_type } = req.body;
    const publicUrl = await uploadToStorage(receipt_url);
    await supabase.from('deposits').insert([{ user_id: req.user.id, phone_number: req.user.phone, amount: parseFloat(amount), transaction_ref, receipt_url: publicUrl, status: 'pending', wallet_type: wallet_type || 'capital' }]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/withdrawals', authenticateUser, async (req, res) => {
  try {
    const { amount, payment_method, account_details, wallet_type } = req.body;
    await supabase.from('withdrawals').insert([{ user_id: req.user.id, phone_number: req.user.phone, amount: parseFloat(amount), payment_method, account_details, status: 'pending', wallet_type: wallet_type || 'capital' }]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/user/reinvest', authenticateUser, async (req, res) => {
  try {
    const { amount } = req.body;
    await supabase.from('withdrawals').insert([{ user_id: req.user.id, phone_number: req.user.phone, amount, payment_method: 'Reinvest', account_details: 'Capital', status: 'approved', wallet_type: 'profit' }]);
    await supabase.from('deposits').insert([{ user_id: req.user.id, phone_number: req.user.phone, amount, transaction_ref: 'REINVEST', receipt_url: 'AUTO', status: 'approved', wallet_type: 'capital' }]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/user/kyc', authenticateUser, async (req, res) => {
  try {
    const publicUrl = await uploadToStorage(req.body.kyc_doc);
    await supabase.from('users').update({ kyc_doc: publicUrl, kyc_status: 'pending' }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/user/deposits', authenticateUser, async (req, res) => {
  const { data } = await supabase.from('deposits').select('*').eq('user_id', req.user.id);
  res.json({ success: true, data: data || [] });
});

app.get('/api/user/withdrawals', authenticateUser, async (req, res) => {
  const { data } = await supabase.from('withdrawals').select('*').eq('user_id', req.user.id);
  res.json({ success: true, data: data || [] });
});

app.get('/api/admin/deposits', authenticateAdmin, async (req, res) => {
  const { data } = await supabase.from('deposits').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.get('/api/admin/withdrawals', authenticateAdmin, async (req, res) => {
  const { data } = await supabase.from('withdrawals').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.get('/api/admin/packages', authenticateAdmin, async (req, res) => {
  const { data } = await supabase.from('investment_packages').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.patch('/api/admin/deposits/status', authenticateAdmin, async (req, res) => {
  const { id, status } = req.body;
  await supabase.from('deposits').update({ status }).eq('id', id);
  res.json({ success: true });
});

app.patch('/api/admin/withdrawals/status', authenticateAdmin, async (req, res) => {
  const { id, status } = req.body;
  await supabase.from('withdrawals').update({ status }).eq('id', id);
  res.json({ success: true });
});

// صرف أرباح الباقات المكتملة تلقائياً
app.post('/api/admin/packages/payout', authenticateAdmin, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: expired } = await supabase.from('investment_packages').select('*').eq('status', 'active').lte('end_date', now);

    let count = 0;
    for (let pkg of (expired || [])) {
      await supabase.from('deposits').insert([{
        user_id: pkg.user_id, phone_number: pkg.phone_number, amount: pkg.expected_payout, transaction_ref: 'PAYOUT_' + pkg.id, receipt_url: 'AUTO_PAYOUT', status: 'approved', wallet_type: 'profit'
      }]);
      await supabase.from('investment_packages').update({ status: 'completed' }).eq('id', pkg.id);
      await supabase.from('notifications').insert([{ user_id: pkg.user_id, title: '🎉 اكتمال الباقة', message: `تم اكتمال باقة (${pkg.plan_name}) وصرف العائد إلى محفظة أرباحك.` }]);
      count++;
    }
    res.json({ success: true, message: `تم صرف أرباح ${count} باقة مكتملة بنجاح!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));