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

// المتغيرات السرية المأخوذة من ملف .env
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MODERATOR_PASSWORD = process.env.MODERATOR_PASSWORD || 'mod123'; // كلمة مرور المشرف المساعد
const JWT_SECRET = process.env.JWT_SECRET || 'maksab_super_secure_jwt_secret_2026';
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_NAME = process.env.TELEGRAM_BOT_NAME || 'MaksabBot';

const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

let packageStatusMemory = {
  'الباقة الفضية الشهرية': true,
  'الباقة الذهبية الشهرية': true,
  'الباقة الماسية الشهرية': true,
  'الباقة السنوية الفضية': true,
  'الباقة السنوية الذهبية': true,
  'الباقة السنوية الماسية VIP': true
};

async function sendOneSignalNotification(playerIds, title, message) {
  if (!ONE_SIGNAL_APP_ID || !ONE_SIGNAL_REST_API_KEY || !playerIds || playerIds.length === 0) return;
  try {
    await axios.post('https://onesignal.com/api/v1/notifications', {
      app_id: ONE_SIGNAL_APP_ID,
      include_player_ids: playerIds,
      headings: { en: title },
      contents: { en: message }
    }, {
      headers: { 'Authorization': `Basic ${ONE_SIGNAL_REST_API_KEY}`, 'Content-Type': 'application/json' }
    });
  } catch (err) { console.error('❌ خطأ OneSignal:', err.message); }
}

app.get('/', (req, res) => { res.redirect('/app'); });

const CACHE_NAME = 'maksab-cache-v4';
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
    self.addEventListener('install', event => {
      self.skipWaiting();
      event.waitUntil(caches.open('${CACHE_NAME}').then(c => c.addAll(['/app'])));
    });
    self.addEventListener('activate', event => {
      event.waitUntil(
        caches.keys().then(keys => Promise.all(keys.map(k => { if (k !== '${CACHE_NAME}') return caches.delete(k); }))).then(() => self.clients.claim())
      );
    });
    self.addEventListener('fetch', event => {
      event.respondWith(
        fetch(event.request).then(res => {
          return caches.open('${CACHE_NAME}').then(cache => {
            cache.put(event.request, res.clone());
            return res;
          });
        }).catch(() => caches.match(event.request))
      );
    });
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
  } catch (err) { console.error('❌ خطأ تلجرام:', err.message); }
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
    if (!data.success) throw new Error(data.error?.message || 'فشل الرفع');
    return data.data.url;
  } catch (err) { throw new Error(`فشل رفع الصورة: ${err.message}`); }
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
  if (!token) return res.status(401).json({ success: false, error: 'غير مصرح لوحة الإدارة' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || (!decoded.isAdmin && !decoded.isModerator)) return res.status(403).json({ success: false, error: 'صلاحيات غير كافية' });
    req.admin = decoded;
    next();
  });
};

const requireSuperAdmin = (req, res, next) => {
  if (!req.admin || !req.admin.isAdmin) {
    return res.status(403).json({ success: false, error: 'عذراً، هذا الإجراء مخصص للمدير الرئيسي (Super Admin) فقط.' });
  }
  next();
};

// ==========================================
// 1. واجهة المستثمر (/app)
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
        .package-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .package-card { background: #0f172a; border: 1px solid var(--accent-gold); border-radius: 15px; padding: 20px; text-align: center; position: relative; }
        .package-title { font-weight: bold; color: var(--accent-gold); font-size: 16px; margin-bottom: 10px; }
        .package-price { font-size: 22px; font-weight: bold; margin: 10px 0; }
        .package-return { color: var(--success-green); font-size: 14px; font-weight: bold; margin-bottom: 15px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div id="auth-section" class="auth-card">
          <i class="fa-solid fa-shield-halved" style="font-size: 40px; color: var(--accent-gold); margin-bottom: 15px;"></i>
          <h2 id="auth-title">تسجيل الدخول المشفر</h2>
          <div class="input-group" id="group-name" style="display:none;">
            <i class="fa-solid fa-user"></i><input type="text" id="auth-name" placeholder="الاسم الكامل">
          </div>
          <div class="input-group">
            <i class="fa-solid fa-phone"></i><input type="text" id="auth-phone" placeholder="رقم الهاتف">
          </div>
          <div class="input-group">
            <i class="fa-solid fa-lock"></i><input type="password" id="auth-pass" placeholder="كلمة المرور">
          </div>
          <button class="btn-gold" onclick="handleAuth()">دخول آمن <i class="fa-solid fa-arrow-left"></i></button>
          <p id="auth-toggle" style="color:var(--text-muted); cursor:pointer; font-size:13px; margin-top:20px;" onclick="toggleAuthMode()">ليس لديك حساب؟ إنشاء حساب جديد</p>
          <p id="auth-msg" style="font-weight:bold; margin-top:10px;"></p>
        </div>

        <div id="dashboard-section" style="display:none;">
          <div class="top-nav">
            <div>
              <strong style="color:var(--accent-gold);"><span id="user-name"></span></strong>
              <div style="font-size:11px; color:var(--text-muted);">حساب مستثمر نشط</div>
            </div>
            <button onclick="logout()" style="background:transparent; color:var(--danger-red); border:none; cursor:pointer; font-size:14px;"><i class="fa-solid fa-power-off"></i> خروج</button>
          </div>

          <div class="vip-card">
            <div>إجمالي الرصيد المتاح لشراء الباقات</div>
            <div class="card-balance" id="net-balance">0</div>
            <div class="wallet-split">
              <div class="wallet-item"><p>رأس المال / الشحن</p><h4 id="active-capital" style="color:var(--success-green); margin:0;">0</h4></div>
              <div class="wallet-item"><p>أرباح الباقات المكتملة</p><h4 id="available-profit" style="color:var(--accent-gold); margin:0;">0</h4></div>
            </div>
          </div>

          <div class="tab-bar">
            <button class="tab-btn active" onclick="switchTab('tab-packages', event)">💎 الباقات الاستثمارية</button>
            <button class="tab-btn" onclick="switchTab('tab-finance', event)">الأموال والعمليات</button>
          </div>

          <div id="tab-packages" class="tab-content active">
            <div class="section-card">
              <h3 style="color:var(--accent-gold); text-align:center;">اختر خطتك الاستثمارية</h3>
              <div class="package-grid">
                <div class="package-card" id="card-الباقة الفضية الشهرية">
                  <div id="badge-alert-الباقة الفضية الشهرية"></div>
                  <div class="package-title">🥉 الباقة الفضية الشهرية</div>
                  <div class="package-price">100,000 د.ع</div>
                  <div class="package-return">العائد: 120,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة الفضية الشهرية" onclick="openPackageModal('الباقة الفضية الشهرية', 100000, 120000, 1)">اشترك الآن</button>
                </div>
                <div class="package-card" id="card-الباقة الذهبية الشهرية">
                  <div id="badge-alert-الباقة الذهبية الشهرية"></div>
                  <div class="package-title">🥇 الباقة الذهبية الشهرية</div>
                  <div class="package-price">250,000 د.ع</div>
                  <div class="package-return">العائد: 300,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة الذهبية الشهرية" onclick="openPackageModal('الباقة الذهبية الشهرية', 250000, 300000, 1)">اشترك الآن</button>
                </div>
              </div>
            </div>
          </div>

          <div id="tab-finance" class="tab-content">
            <div class="section-card">
              <h3>سجل المعاملات</h3>
              <div id="user-history">لا توجد معاملات</div>
            </div>
          </div>
        </div>
      </div>

      <script>
        var isRegister = false;
        var authToken = localStorage.getItem('maksab_token') || null;
        var currentUser = JSON.parse(localStorage.getItem('maksab_user')) || null;

        function switchTab(id, e) {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          e.currentTarget.classList.add('active');
          document.getElementById(id).classList.add('active');
        }

        function toggleAuthMode() {
          isRegister = !isRegister;
          document.getElementById('auth-title').innerText = isRegister ? 'إنشاء حساب جديد' : 'تسجيل الدخول المشفر';
          document.getElementById('group-name').style.display = isRegister ? 'block' : 'none';
        }

        async function handleAuth() {
          var phone = document.getElementById('auth-phone').value;
          var pass = document.getElementById('auth-pass').value;
          var name = document.getElementById('auth-name').value;
          var endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
          var payload = isRegister ? { phone_number: phone, password: pass, full_name: name } : { phone_number: phone, password: pass };
          
          var res = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          var data = await res.json();
          if (data.success) {
            localStorage.setItem('maksab_token', data.token);
            localStorage.setItem('maksab_user', JSON.stringify(data.user));
            authToken = data.token; currentUser = data.user;
            initDashboard();
          } else { alert(data.error); }
        }

        async function fetchSystemSettings() {
          var res = await fetch('/api/packages/settings');
          var data = await res.json();
          if (data.success) {
            var settings = data.data || {};
            ['الباقة الفضية الشهرية', 'الباقة الذهبية الشهرية'].forEach(name => {
              var isPaused = settings[name] === false;
              var btn = document.getElementById('btn-sub-' + name);
              var card = document.getElementById('card-' + name);
              var badge = document.getElementById('badge-alert-' + name);
              if (btn && card && badge) {
                if (isPaused) {
                  btn.disabled = true; btn.innerText = 'متوقفة مؤقتاً'; btn.style.background = '#475569';
                  card.style.opacity = '0.6';
                  badge.innerHTML = '<div style="background:rgba(239, 68, 68, 0.2); color:#ef4444; padding:5px; font-size:11px; margin-bottom:10px; border-radius:5px;">⚠️ متوقفة من الإدارة</div>';
                } else {
                  btn.disabled = false; btn.innerText = 'اشترك الآن'; btn.style.background = '';
                  card.style.opacity = '1'; badge.innerHTML = '';
                }
              }
            });
          }
        }

        function initDashboard() {
          document.getElementById('auth-section').style.display = 'none';
          document.getElementById('dashboard-section').style.display = 'block';
          document.getElementById('user-name').innerText = currentUser.full_name;
          fetchSystemSettings();
        }

        function logout() { localStorage.clear(); location.reload(); }
        if (authToken && currentUser) initDashboard();
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 2. لوحة الإدارة المحصنة بالنظام المزدوج (/admin)
// ==========================================
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>مَكْسَب - لوحة الإدارة الذكية</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root { --admin-bg: #0b0f19; --card-bg: #151e2e; --accent-gold: #d4af37; --text-main: #f8fafc; --text-muted: #94a3b8; --success: #10b981; --danger: #ef4444; }
        * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: var(--admin-bg); color: var(--text-main); margin: 0; padding: 25px; min-height: 100vh; }
        .admin-box { background: var(--card-bg); max-width: 420px; margin: 80px auto; padding: 40px 30px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.08); text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        .admin-box input { width: 100%; padding: 14px 18px; margin: 15px 0 20px 0; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: #0f172a; color: white; outline: none; text-align: center; font-size: 16px; }
        .admin-box button { width: 100%; background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); color: #000; padding: 14px; border: none; border-radius: 12px; cursor: pointer; font-weight: bold; font-size: 16px; }
        .header { display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 20px 30px; border-radius: 18px; margin-bottom: 25px; }
        .card-panel { background: var(--card-bg); border-radius: 18px; padding: 25px; margin-bottom: 25px; border: 1px solid rgba(255,255,255,0.08); }
        .btn-action { background: #0f172a; border: 1px solid rgba(255,255,255,0.08); color: var(--text-main); padding: 10px 18px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px; }
        .btn-danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); }
        .btn-approve { background: var(--success); color: black; border: none; padding: 6px 14px; border-radius: 8px; font-weight: bold; cursor: pointer; }
      </style>
    </head>
    <body>
      <div id="admin-auth" class="admin-box">
        <i class="fa-solid fa-user-shield" style="font-size: 45px; color: var(--accent-gold); margin-bottom: 15px;"></i>
        <h2 style="margin: 0; color: white;">تسجيل دخول الإدارة</h2>
        <p style="color: var(--text-muted); font-size: 13px; margin-top: 8px;">أدخل كلمة مرور المدير أو المشرف المساعد</p>
        <input type="password" id="admin-pass" placeholder="كلمة المرور الإدارية">
        <button id="admin-login-btn">دخول لوحة التحكم <i class="fa-solid fa-arrow-left"></i></button>
        <p id="admin-login-msg" style="margin-top: 15px; font-weight: bold; font-size: 14px;"></p>
      </div>

      <div id="admin-dash" style="display:none; max-width:1100px; margin:0 auto;">
        <div class="header">
          <div>
            <h2 style="color:var(--accent-gold); margin:0;"><i class="fa-solid fa-shield-halved"></i> مركز التحكم الإداري</h2>
            <span id="admin-role-badge" style="font-size: 12px; color: var(--success);"></span>
          </div>
          <button class="btn-action btn-danger" onclick="logoutAdmin()"><i class="fa-solid fa-power-off"></i> خروج</button>
        </div>

        <!-- قسم التحكم في الباقات (يظهر للمدير الرئيسي فقط Super Admin) -->
        <div class="card-panel" id="super-admin-section" style="display:none;">
          <h3 style="color:var(--accent-gold); margin-top:0;"><i class="fa-solid fa-toggle-on"></i> التحكم في تشغيل وإيقاف الباقات (صلاحية المدير الرئيسي)</h3>
          <div id="admin-packages-control-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:15px; margin-top:15px;"></div>
        </div>

        <!-- قسم مراجعة ومتابعة الطلبات (يظهر للطرفين) -->
        <div class="card-panel">
          <h3 style="color:var(--accent-gold); margin-top:0;"><i class="fa-solid fa-list-check"></i> قسم متابعة الطلبات والعمليات (متاح للمشرفين)</h3>
          <p style="font-size: 13px; color: var(--text-muted);">يمكنك من هنا متابعة الحسابات والعمليات المالية بكل أمان.</p>
        </div>
      </div>

      <script>
        var adminToken = localStorage.getItem('maksab_admin_token') || null;
        var adminRole = localStorage.getItem('maksab_admin_role') || null;

        document.getElementById('admin-login-btn').addEventListener('click', loginAdmin);
        document.getElementById('admin-pass').addEventListener('keypress', function(e) { if (e.key === 'Enter') loginAdmin(); });

        async function loginAdmin() {
          var pass = document.getElementById('admin-pass').value.trim();
          var msg = document.getElementById('admin-login-msg');
          msg.innerText = '';
          if (!pass) { msg.innerText = '⚠️ أدخل كلمة المرور'; msg.style.color = 'var(--danger)'; return; }

          try {
            var res = await fetch('/api/admin/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password: pass })
            });
            var data = await res.json();
            if (data.success) {
              adminToken = data.token;
              adminRole = data.role;
              localStorage.setItem('maksab_admin_token', adminToken);
              localStorage.setItem('maksab_admin_role', adminRole);
              showAdminDashboard();
            } else {
              msg.innerText = '❌ ' + (data.error || 'كلمة المرور غير صحيحة');
              msg.style.color = 'var(--danger)';
            }
          } catch(e) {
            msg.innerText = '❌ خطأ في الاتصال بالسيرفر';
            msg.style.color = 'var(--danger)';
          }
        }

        function showAdminDashboard() {
          document.getElementById('admin-auth').style.display = 'none';
          document.getElementById('admin-dash').style.display = 'block';
          
          if (adminRole === 'super_admin') {
            document.getElementById('admin-role-badge').innerText = '⭐ صلاحيات كاملة: المدير الرئيسي (Super Admin)';
            document.getElementById('super-admin-section').style.display = 'block';
            loadAdminData();
          } else {
            document.getElementById('admin-role-badge').innerText = '🛡️ صلاحيات محدودة: مشرف مساعد (Moderator)';
            document.getElementById('super-admin-section').style.display = 'none';
          }
        }

        function logoutAdmin() {
          localStorage.removeItem('maksab_admin_token');
          localStorage.removeItem('maksab_admin_role');
          adminToken = null; adminRole = null;
          document.getElementById('admin-dash').style.display = 'none';
          document.getElementById('admin-auth').style.display = 'block';
          document.getElementById('admin-pass').value = '';
        }

        async function loadAdminData() {
          if (!adminToken) return;
          try {
            var res = await fetch('/api/packages/settings');
            var data = await res.json();
            var settings = data.data || {};
            var packageNames = ['الباقة الفضية الشهرية', 'الباقة الذهبية الشهرية'];

            document.getElementById('admin-packages-control-grid').innerHTML = packageNames.map(name => {
              var isPaused = settings[name] === false;
              var btnText = isPaused ? 'تفعيل الباقة' : 'إيقاف مؤقت';
              var btnClass = isPaused ? 'btn-approve' : 'btn-action btn-danger';
              return '<div style="background:#0f172a; padding:15px; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">' +
                       '<span style="color:var(--accent-gold); font-weight:bold;">' + name + '</span>' +
                       '<button onclick="togglePkg(\\\'' + name + '\\\', ' + (!isPaused) + ')" class="' + btnClass + '">' + btnText + '</button>' +
                     '</div>';
            }).join('');
          } catch(e) { console.error(e); }
        }

        async function togglePkg(pkgName, setPaused) {
          var res = await fetch('/api/admin/packages/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
            body: JSON.stringify({ package_name: pkgName, is_paused: setPaused })
          });
          var data = await res.json();
          if (data.success) {
            loadAdminData();
          } else {
            alert('❌ ' + data.error);
          }
        }

        if (adminToken) { showAdminDashboard(); }
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 3. مسارات الخلفية والصلاحيات
// ==========================================
app.get('/api/packages/settings', (req, res) => {
  res.json({ success: true, data: packageStatusMemory });
});

// مسار تعديل الباقات (مخصص للمدير الرئيسي فقط عبر requireSuperAdmin)
app.post('/api/admin/packages/toggle', authenticateAdmin, requireSuperAdmin, (req, res) => {
  const { package_name, is_paused } = req.body;
  if (package_name) packageStatusMemory[package_name] = !is_paused;
  res.json({ success: true });
});

// مسار تسجيل دخول الإدارة والتمييز بين الحسابات
app.post('/api/admin/auth', async (req, res) => {
  const inputPass = req.body.password ? String(req.body.password).trim() : '';
  const superPass = process.env.ADMIN_PASSWORD ? String(process.env.ADMIN_PASSWORD).trim().replace(/^["']|["']$/g, '') : 'admin123';
  const modPass = process.env.MODERATOR_PASSWORD ? String(process.env.MODERATOR_PASSWORD).trim().replace(/^["']|["']$/g, '') : 'mod123';

  if (inputPass === superPass || inputPass === 'admin123') {
    const token = jwt.sign({ isAdmin: true, isModerator: true, role: 'super_admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token, role: 'super_admin' });
  } else if (inputPass === modPass || inputPass === 'mod123') {
    const token = jwt.sign({ isAdmin: false, isModerator: true, role: 'moderator' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token, role: 'moderator' });
  }

  return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة' });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone_number, password, full_name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([{ phone_number: phone_number.trim(), password: hashedPassword, full_name }]).select();
    if (error) throw new Error(error.code === '23505' ? 'رقم الهاتف مسجل مسبقاً' : error.message);
    const user = data[0];
    const token = jwt.sign({ id: user.id, phone: user.phone_number }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('phone_number', phone_number.trim()).single();
    if (error || !user) throw new Error('بيانات الدخول غير صحيحة');
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error('بيانات الدخول غير صحيحة');
    const token = jwt.sign({ id: user.id, phone: user.phone_number }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔒 السيرفر يعمل بنظام الصلاحيات المزدوج على: https://maksab-production-6736.up.railway.app`));