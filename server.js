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

// المتغيرات السرية المأخوذة من ملف .env ونظام الصلاحيات الثنائي
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MODERATOR_PASSWORD = process.env.MODERATOR_PASSWORD || 'mod123';
const EXECUTIVE_DIRECTOR = 'محمود صبحي'; // المدير التنفيذي للمشروع
const JWT_SECRET = process.env.JWT_SECRET || 'maksab_super_secure_jwt_secret_2026';
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_NAME = process.env.TELEGRAM_BOT_NAME || 'MaksabBot';

// مفاتيح OneSignal الإشعارات
const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

// ==========================================
// 🔄 آلية التحديث التلقائي (PWA Auto-Update)
// ==========================================
// APP_VERSION يتم توليده تلقائياً عبر Date.now() عند كل إقلاع للسيرفر.
// على Railway، مع كل Deploy جديد يتم إعادة تشغيل السيرفر فيتغير هذا الرقم تلقائياً،
// مما يجعل المتصفح يكتشف تغير رابط /sw.js?v=... ويقوم بتحديث التطبيق فوراً.
// يمكن تمرير قيمة ثابتة عبر متغير البيئة APP_VERSION لو أردت التحكم اليدوي.
const APP_VERSION = (process.env.APP_VERSION && process.env.APP_VERSION.trim() !== '')
  ? process.env.APP_VERSION.trim()
  : String(Date.now());

console.log(`📦 إصدار التطبيق الحالي (APP_VERSION): ${APP_VERSION}`);

// ذاكرة مؤقتة لحالة الباقات
let packageStatusMemory = {
  'الباقة الفضية الشهرية': true,
  'الباقة الذهبية الشهرية': true,
  'الباقة الماسية الشهرية': true,
  'الباقة السنوية الفضية': true,
  'الباقة السنوية الذهبية': true,
  'الباقة السنوية الماسية VIP': true
};

// ذاكرة مؤقتة للشريط الإعلاني للمستثمرين
let announcementMemory = {
  active: true,
  text: '🔥 أهلاً بكم في منصة مَكْسَب الاستثمارية. تم إطلاق باقات استثمارية جديدة كلياً وتفعيل السحب الفوري، استثمر الآن وضاعف أرباحك!'
};

// ==========================================
// دالة إرسال إشعارات OneSignal للموبايل
// ==========================================
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

// ==========================================
// المسار الرئيسي (إعادة توجيه تلقائي لواجهة المستثمر /app)
// ==========================================
app.get('/', (req, res) => {
  res.redirect('/app');
});

// ==========================================
// 🔄 مسارات PWA + آلية التحديث التلقائي
// ==========================================

// 1) ملف manifest.json — يُمرر رقم الإصدار كـ query param لإجبار المتصفح على إعادة تحميله
app.get('/manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
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

// 2) Service Worker الديناميكي — يستخدم APP_VERSION كاسم للكاش الجديد
//    ويحذف كل الكاشات القديمة عند activate + skipWaiting + clients.claim
//    لتفعيل التحديث الفوري دون تدخل المستخدم.
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  // منع التخزين المؤقت لملف الـ SW نفسه على مستوى HTTP لضمان جلب النسخة الجديدة دائماً
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(`
    // إصدار التطبيق الحالي (يتغير مع كل Deploy على Railway تلقائياً)
    const APP_VERSION = '${APP_VERSION}';
    // اسم الكاش الجديد مرتبط بالإصدار لضمان عدم الخلط مع الكاشات القديمة
    const CACHE_NAME = 'maksab-cache-v' + APP_VERSION;
    // الموارد الأساسية التي نخزنها للعمل دون اتصال
    const CORE_ASSETS = [
      '/app',
      '/manifest.json?v=' + APP_VERSION,
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
    ];

    // ==========================================
    // حدث التثبيت (Install) — skipWaiting لتثبيت النسخة الجديدة فوراً
    // ==========================================
    self.addEventListener('install', (event) => {
      console.log('[SW] تثبيت إصدار جديد:', APP_VERSION);
      event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
          // نخزن الموارد بشكل متسامح (لا نفشل لو لم يتوفر أحد الموارد)
          return Promise.allSettled(
            CORE_ASSETS.map((url) =>
              fetch(url, { cache: 'no-store' })
                .then((resp) => {
                  if (resp.ok) return cache.put(url, resp);
                })
                .catch(() => {})
            )
          );
        }).then(() => {
          // فرض التثبيت الفوري للنسخة الجديدة دون انتظار إغلاق كل التبويبات
          return self.skipWaiting();
        })
      );
    });

    // ==========================================
    // حدث التفعيل (Activate) — حذف الكاشات القديمة + clients.claim
    // ==========================================
    self.addEventListener('activate', (event) => {
      console.log('[SW] تفعيل إصدار جديد:', APP_VERSION);
      event.waitUntil(
        caches.keys().then((cacheNames) => {
          // حذف كل الكاشات التي لا تطابق اسم الكاش الجديد
          return Promise.all(
            cacheNames.map((cacheName) => {
              if (cacheName !== CACHE_NAME) {
                console.log('[SW] حذف كاش قديم:', cacheName);
                return caches.delete(cacheName);
              }
            })
          );
        }).then(() => {
          // السيطرة الفورية على كل العملاء المفتوحين (التبويبات)
          return self.clients.claim();
        }).then(() => {
          // إعلام كل الصفحات المفتوحة بأن التحديث جاهز
          return self.clients.matchAll({ type: 'window' }).then((clientList) => {
            clientList.forEach((client) => {
              client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION });
            });
          });
        })
      );
    });

    // ==========================================
    // حدث الجلب (Fetch) — استراتيجية Network-First مع التراجع للكاش
    // ==========================================
    self.addEventListener('fetch', (event) => {
      const req = event.request;

      // تجاهل الطلبات غير GET (POST/PATCH/DELETE) — تذهب للشبكة مباشرة
      if (req.method !== 'GET') return;

      // تجاهل طلبات بوت تلجرام / webhooks
      const url = new URL(req.url);
      if (url.origin !== self.location.origin) {
        // للموارد الخارجية (مثل Font Awesome) نستخدم Cache-First
        event.respondWith(
          caches.match(req).then((cached) => {
            return cached || fetch(req).then((resp) => {
              // تخزين الردود الناجحة من مصادر خارجية
              if (resp && resp.status === 200) {
                const respClone = resp.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
              }
              return resp;
            }).catch(() => cached);
          })
        );
        return;
      }

      // للمسارات الداخلية: Network-First (لجلب أحدث نسخة من السيرفر دائماً)
      event.respondWith(
        fetch(req, { cache: 'no-store' })
          .then((resp) => {
            // تخزين الردود الناجحة في الكاش
            if (resp && resp.status === 200 && resp.type === 'basic') {
              const respClone = resp.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
            }
            return resp;
          })
          .catch(() => {
            // عند فقدان الاتصال نرجع للكاش
            return caches.match(req).then((cached) => cached || caches.match('/app'));
          })
      );
    });

    // ==========================================
    // استقبال رسائل من الصفحة (مثل طلب التحديث الفوري)
    // ==========================================
    self.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
      }
      if (event.data && event.data.type === 'CHECK_UPDATE') {
        // إعلام الصفحة بالإصدار الحالي للـ SW
        event.source.postMessage({ type: 'SW_VERSION', version: APP_VERSION });
      }
    });
  `);
});

// 3) مسار يكشف رقم الإصدار الحالي للمقارنة من جانب العميل
app.get('/api/app-version', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({ success: true, version: APP_VERSION });
});

// ==========================================
// دالة إرسال رسائل تلجرام المباشرة
// ==========================================
async function sendTelegramNotification(chatId, text) {
  if (!chatId || !TELEGRAM_BOT_TOKEN) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML'
      })
    });
  } catch (err) {
    console.error('❌ خطأ في إرسال إشعار تلجرام:', err.message);
  }
}

// ==========================================
// دالة الرفع السريعة عبر ImgBB
// ==========================================
async function uploadToStorage(base64Data) {
  if (!base64Data || !base64Data.startsWith('data:image')) return base64Data;

  try {
    if (!IMGBB_API_KEY) {
      throw new Error('مفتاح IMGBB_API_KEY غير موجود في ملف .env');
    }

    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const params = new URLSearchParams();
    params.append('image', cleanBase64);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: 'POST',
      body: params
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error?.message || 'فشل الرفع لـ ImgBB');
    }

    return data.data.url;
  } catch (err) {
    console.error('❌ خطأ رفع الصورة:', err.message);
    throw new Error(`فشل رفع الصورة: ${err.message}`);
  }
}

// ==========================================
// برمجيات التوثيق والحماية والتحقق من الصلاحيات
// ==========================================
const authenticateUser = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'غير مصرح: يرجى تسجيل الدخول' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'جلسة انتهت صلاحيتها، أعد الدخول' });
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

// طبقة الحماية المزدوجة (HTTP Basic Auth للمسار السري)
const executiveShieldAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure Executive Portal"');
    return res.status(401).send('Authentication required.');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  const secureAdminUser = process.env.SECURE_ADMIN_USER || 'executive';
  const secureAdminPass = process.env.SECURE_ADMIN_PASS || 'maksab2026sec';

  if (username === secureAdminUser && password === secureAdminPass) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Secure Executive Portal"');
    return res.status(401).send('Invalid credentials.');
  }
};

// ==========================================
// 1. واجهة المستثمر الشاملة
// ==========================================
app.get('/app', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>مَكْسَب الاستثمارية - Fintech</title>
      <link rel="manifest" href="/manifest.json?v=${APP_VERSION}">
      <meta name="theme-color" content="#0f172a">
      <link rel="apple-touch-icon" href="https://img.icons8.com/color/192/000000/gold-bars.png">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <meta name="app-version" content="${APP_VERSION}">
      <style>
        :root { --bg-color: #0f172a; --card-bg: #1e293b; --accent-gold: #d4af37; --text-main: #f8fafc; --text-muted: #94a3b8; --success-green: #10b981; --danger-red: #ef4444; }
        * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; transition: all 0.3s ease; }
        body { background: var(--bg-color); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; }
        .container { max-width: 900px; margin: 0 auto; }
        #sw-update-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); color: #000; padding: 12px 24px; border-radius: 12px; font-weight: bold; font-size: 13px; box-shadow: 0 8px 25px rgba(0,0,0,0.5); z-index: 10000; display: none; align-items: center; gap: 10px; animation: slideUp 0.4s ease; }
        @keyframes slideUp { from { transform: translate(-50%, 100px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
        .announcement-ticker { background: linear-gradient(135deg, rgba(212, 175, 55, 0.2) 0%, rgba(16, 185, 129, 0.2) 100%); border: 1px solid rgba(212, 175, 55, 0.4); padding: 12px 20px; border-radius: 14px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; overflow: hidden; position: relative; box-shadow: 0 4px 15px rgba(212,175,55,0.1); }
        .announcement-icon { color: var(--accent-gold); font-size: 18px; animation: bounce 1.5s infinite; flex-shrink: 0; }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .announcement-text-wrapper { overflow: hidden; width: 100%; white-space: nowrap; }
        .announcement-text { display: inline-block; animation: marquee 25s linear infinite; font-size: 13px; font-weight: bold; color: var(--text-main); }
        @keyframes marquee { 0% { transform: translateX(100%); } 100% { transform: translateX(-100%); } }
        .top-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; background: rgba(30, 41, 59, 0.8); padding: 15px 20px; border-radius: 15px; border: 1px solid rgba(212, 175, 55, 0.2); position: relative; flex-wrap: wrap; gap: 10px; }
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
        .badge-rejected, .badge-completed { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
        .pkg-toggle-bar { display: flex; justify-content: center; gap: 10px; margin-bottom: 20px; }
        .pkg-toggle-btn { background: #0f172a; border: 1px solid #334155; color: var(--text-muted); padding: 8px 20px; border-radius: 20px; cursor: pointer; font-weight: bold; font-size: 13px; }
        .pkg-toggle-btn.active { background: var(--accent-gold); color: black; border-color: var(--accent-gold); }
        .package-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .package-card { background: #0f172a; border: 1px solid var(--accent-gold); border-radius: 15px; padding: 20px; text-align: center; position: relative; overflow: hidden; }
        .package-title { font-weight: bold; color: var(--accent-gold); font-size: 16px; margin-bottom: 10px; }
        .package-price { font-size: 22px; font-weight: bold; margin: 10px 0; }
        .package-return { color: var(--success-green); font-size: 14px; font-weight: bold; margin-bottom: 15px; }
        .notif-bell-container { position: relative; cursor: pointer; }
        .notif-bell-icon { font-size: 20px; color: var(--accent-gold); padding: 8px; border-radius: 50%; background: #0f172a; border: 1px solid rgba(212,175,55,0.3); display: flex; align-items: center; justify-content: center; width: 38px; height: 38px; box-shadow: 0 4px 10px rgba(212,175,55,0.15); }
        .notif-count-badge { position: absolute; top: -5px; right: -5px; background: var(--danger-red); color: white; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 10px; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.15); } 100% { transform: scale(1); } }
        .notif-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); backdrop-filter: blur(5px); z-index: 9999; display: none; justify-content: center; align-items: center; padding: 15px; }
        .notif-modal-content { background: var(--card-bg); border: 2px solid var(--accent-gold); border-radius: 22px; width: 100%; max-width: 520px; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px rgba(0,0,0,0.9); overflow: hidden; animation: zoomIn 0.3s ease; }
        @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        .notif-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 20px 25px; border-bottom: 1px solid rgba(255,255,255,0.08); background: #0f172a; }
        .notif-modal-body { padding: 20px 25px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
        .notif-full-card { background: #0f172a; border: 1px solid rgba(212,175,55,0.25); border-radius: 14px; padding: 16px; border-right: 4px solid var(--accent-gold); position: relative; }
        .notif-full-card.read { border-right-color: #334155; opacity: 0.75; }
        .notif-full-title { font-size: 15px; font-weight: bold; color: var(--accent-gold); margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
        .notif-full-msg { font-size: 13px; color: var(--text-main); line-height: 1.6; word-break: break-word; }
        .notif-full-date { font-size: 11px; color: var(--text-muted); margin-top: 10px; text-align: left; display: block; }
      </style>
    </head>
    <body>
      <div class="container">
        <div id="sw-update-toast"><i class="fa-solid fa-arrows-rotate"></i> جاري تحديث التطبيق للإصدار الجديد...</div>
        <div id="announcement-banner-container" class="announcement-ticker" style="display:none;">
          <div class="announcement-icon"><i class="fa-solid fa-bullhorn"></i></div>
          <div class="announcement-text-wrapper">
            <span class="announcement-text" id="announcement-banner-text"></span>
          </div>
        </div>
        <div id="auth-section" class="auth-card">
          <i class="fa-solid fa-shield-halved" style="font-size: 40px; color: var(--accent-gold); margin-bottom: 15px;"></i>
          <h2 id="auth-title">تسجيل الدخول المشفر</h2>
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 15px;">
            إدارة المنصة: المدير التنفيذي <strong style="color: var(--accent-gold);">${EXECUTIVE_DIRECTOR}</strong>
          </div>
          <div id="ref-alert-box" style="display:none; background:rgba(212,175,55,0.1); border:1px dashed var(--accent-gold); color:var(--accent-gold); padding:10px; border-radius:10px; font-size:12px; margin-bottom:15px;">
            <i class="fa-solid fa-user-check"></i> تسجيل عبر دعوة <input type="hidden" id="ref-code-input">
          </div>
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
          <button class="btn-gold" id="auth-btn" onclick="handleAuth()">دخول آمن <i class="fa-solid fa-arrow-left"></i></button>
          <p id="auth-toggle" style="color:var(--text-muted); cursor:pointer; font-size:13px; margin-top:20px;" onclick="toggleAuthMode()">ليس لديك حساب؟ إنشاء حساب جديد</p>
          <p id="auth-msg" style="font-weight:bold; margin-top:10px;"></p>
        </div>
        <div id="dashboard-section" style="display:none;">
          <div class="top-nav">
            <div>
              <strong style="color:var(--accent-gold);"><span id="user-name"></span></strong>
              <div style="font-size:11px; color:var(--text-muted);" id="kyc-badge-status">غير موثق</div>
              <div style="font-size: 11px; color: var(--accent-gold); margin-top: 2px;">
                <i class="fa-solid fa-circle-check"></i> المدير التنفيذي: <strong>${EXECUTIVE_DIRECTOR}</strong>
              </div>
            </div>
            <div style="display:flex; gap:12px; align-items:center;">
              <div class="notif-bell-container" onclick="openNotifModal()" title="عرض الإشعارات والتنبيهات">
                <div class="notif-bell-icon"><i class="fa-solid fa-bell"></i></div>
                <span class="notif-count-badge" id="notif-badge" style="display:none;">0</span>
              </div>
              <button onclick="logout()" style="background:transparent; color:var(--danger-red); border:none; cursor:pointer; font-size:14px;"><i class="fa-solid fa-power-off"></i> خروج</button>
            </div>
          </div>
          <div class="notif-modal-overlay" id="notif-modal-overlay">
            <div class="notif-modal-content">
              <div class="notif-modal-header">
                <h3 style="margin:0; color:var(--accent-gold); font-size:18px; display:flex; align-items:center; gap:10px;">
                  <i class="fa-solid fa-bell"></i> مركز التنبيهات والإشعارات
                </h3>
                <div style="display:flex; gap:10px; align-items:center;">
                  <button onclick="markAllNotifsRead()" style="background:rgba(212,175,55,0.15); border:1px solid var(--accent-gold); color:var(--accent-gold); padding:5px 12px; border-radius:8px; font-size:11px; cursor:pointer; font-weight:bold;">تحديد الكل كمقروء</button>
                  <button onclick="closeNotifModal()" style="background:transparent; border:none; color:var(--text-muted); font-size:20px; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
                </div>
              </div>
              <div class="notif-modal-body" id="notif-modal-list-container">
                <p style="text-align:center; color:var(--text-muted); font-size:13px;">جاري التحميل...</p>
              </div>
            </div>
          </div>
          <div class="vip-card">
            <div class="card-balance-title">إجمالي الرصيد المتاح لشراء الباقات</div>
            <div class="card-balance" id="net-balance">0</div>
            <div class="wallet-split">
              <div class="wallet-item">
                <p>رأس المال / الشحن <i class="fa-solid fa-vault"></i></p>
                <h4 id="active-capital" style="color:var(--success-green); margin:0;">0</h4>
              </div>
              <div class="wallet-item">
                <p>أرباح الباقات المكتملة <i class="fa-solid fa-coins"></i></p>
                <h4 id="available-profit" style="color:var(--accent-gold); margin:0;">0</h4>
              </div>
            </div>
          </div>
          <div class="tab-bar">
            <button class="tab-btn active" onclick="switchTab('tab-packages', event)">💎 الباقات الاستثمارية</button>
            <button class="tab-btn" onclick="switchTab('tab-finance', event)">الأموال والعمليات</button>
            <button class="tab-btn" onclick="switchTab('tab-account', event)">التوثيق والدعوات</button>
          </div>
          <div id="tab-packages" class="tab-content active">
            <div class="section-card">
              <h3 style="color:var(--accent-gold); text-align:center;"><i class="fa-solid fa-box-open"></i> اختر خطتك الاستثمارية المناسبة</h3>
              <div class="pkg-toggle-bar">
                <button class="pkg-toggle-btn active" id="btn-show-monthly" onclick="togglePackageView('monthly')">📅 باقات شهرية (30 يوماً)</button>
                <button class="pkg-toggle-btn" id="btn-show-annual" onclick="togglePackageView('annual')">📆 باقات سنوية (12 شهراً)</button>
              </div>
              <div class="package-grid" id="grid-monthly">
                <div class="package-card" id="card-الباقة الفضية الشهرية">
                  <div id="badge-alert-الباقة الفضية الشهرية"></div>
                  <div class="package-title">🥉 الباقة الفضية الشهرية</div>
                  <div class="package-price">100,000 د.ع</div>
                  <div class="package-return">العائد بعد شهر: 120,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة الفضية الشهرية" onclick="openPackageModal('الباقة الفضية الشهرية', 100000, 120000, 1)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" id="card-الباقة الذهبية الشهرية" style="border-color: #d4af37; background: rgba(212, 175, 55, 0.05);">
                  <div id="badge-alert-الباقة الذهبية الشهرية"></div>
                  <div class="package-title">🥇 الباقة الذهبية الشهرية</div>
                  <div class="package-price">250,000 د.ع</div>
                  <div class="package-return">العائد بعد شهر: 300,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة الذهبية الشهرية" onclick="openPackageModal('الباقة الذهبية الشهرية', 250000, 300000, 1)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" id="card-الباقة الماسية الشهرية" style="border-color: #3b82f6;">
                  <div id="badge-alert-الباقة الماسية الشهرية"></div>
                  <div class="package-title">💎 الباقة الماسية الشهرية</div>
                  <div class="package-price">500,000 د.ع</div>
                  <div class="package-return">العائد بعد شهر: 600,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة الماسية الشهرية" style="background:linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color:white;" onclick="openPackageModal('الباقة الماسية الشهرية', 500000, 600000, 1)">اشترك الآن 🚀</button>
                </div>
              </div>
              <div class="package-grid" id="grid-annual" style="display:none;">
                <div class="package-card" id="card-الباقة السنوية الفضية">
                  <div id="badge-alert-الباقة السنوية الفضية"></div>
                  <div class="package-title">👑 الباقة السنوية الفضية</div>
                  <div class="package-price">1,000,000 د.ع</div>
                  <div class="package-return">العائد بعد سنة: 1,600,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة السنوية الفضية" onclick="openPackageModal('الباقة السنوية الفضية', 1000000, 1600000, 12)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" id="card-الباقة السنوية الذهبية" style="border-color: #d4af37; background: rgba(212, 175, 55, 0.05);">
                  <div id="badge-alert-الباقة السنوية الذهبية"></div>
                  <div class="package-title">🌟 الباقة السنوية الذهبية</div>
                  <div class="package-price">2,500,000 د.ع</div>
                  <div class="package-return">العائد بعد سنة: 4,200,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة السنوية الذهبية" onclick="openPackageModal('الباقة السنوية الذهبية', 2500000, 4200000, 12)">اشترك الآن 🚀</button>
                </div>
                <div class="package-card" id="card-الباقة السنوية الماسية VIP" style="border-color: #10b981;">
                  <div id="badge-alert-الباقة السنوية الماسية VIP"></div>
                  <div class="package-title">🔥 الباقة السنوية الماسية VIP</div>
                  <div class="package-price">5,000,000 د.ع</div>
                  <div class="package-return">العائد بعد سنة: 9,000,000 د.ع</div>
                  <button class="btn-gold" id="btn-sub-الباقة السنوية الماسية VIP" style="background:linear-gradient(135deg, #10b981 0%, #047857 100%); color:white;" onclick="openPackageModal('الباقة السنوية الماسية VIP', 5000000, 9000000, 12)">اشترك الآن 🚀</button>
                </div>
              </div>
              <div id="package-modal" style="display:none; background:#0f172a; padding:20px; border-radius:12px; border:1px solid var(--accent-gold); margin-top:15px; text-align:center;">
                <h4 id="pkg-modal-title" style="margin-top:0; color:var(--accent-gold);">تأكيد الاشتراك بالباقة</h4>
                <p id="pkg-modal-desc" style="font-size:13px; color:var(--text-muted);"></p>
                <div style="background:#1e293b; padding:12px; border-radius:10px; margin:15px 0; border:1px dashed rgba(212,175,55,0.3);">
                  <span style="font-size:13px; color:var(--text-muted);">رصيد رأس المال المتاح لديك: </span>
                  <strong id="pkg-user-balance" style="color:var(--success-green); font-size:16px;">0</strong>
                </div>
                <button class="btn-gold" id="btn-confirm-pkg" onclick="submitPackageSubscription()">إرسال طلب الاشتراك (بانتظار موافقة الإدارة) 🚀</button>
                <p id="pkg-msg" style="font-size:12px; font-weight:bold; margin-top:10px;"></p>
              </div>
            </div>
            <div class="section-card">
              <h3><i class="fa-solid fa-list-check"></i> باقاتي الاستثمارية الحالية ومتابعة التوقيت</h3>
              <div id="user-packages-list"></div>
            </div>
          </div>
          <div id="tab-finance" class="tab-content">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px;">
              <div class="section-card">
                <h3>شحن رصيد لشراء الباقات</h3>
                <input type="number" id="deposit-amount" placeholder="المبلغ بالدينار العراقي" style="margin-bottom:10px;">
                <input type="text" id="deposit-ref" placeholder="رقم التحويل (Ref ID)" style="margin-bottom:10px;">
                <input type="file" id="deposit-file" accept="image/*" style="margin-bottom:10px;">
                <button class="btn-gold" onclick="submitDeposit()" id="btn-dep">تأكيد شحن الرصيد</button>
                <p id="deposit-msg" style="font-size:12px; font-weight:bold;"></p>
              </div>
              <div class="section-card">
                <h3>سحب الأرباح والأرصدة</h3>
                <input type="number" id="withdraw-amount" placeholder="المبلغ بالدينار العراقي" style="margin-bottom:10px;">
                <select id="withdraw-wallet" style="margin-bottom:10px;">
                  <option value="profit">من محفظة الأرباح (متاح دائماً)</option>
                  <option value="capital">من رأس المال المتاح (غير المستثمر)</option>
                </select>
                <input type="text" id="withdraw-account" placeholder="رقم محفظة المستلم (ZainCash / محفظة)" style="margin-bottom:10px;">
                <button class="btn-gold" style="background:var(--danger-red); color:white;" onclick="submitWithdraw()">طلب السحب المالي</button>
                <p id="withdraw-msg" style="font-size:12px; font-weight:bold;"></p>
              </div>
            </div>
            <div class="section-card">
              <h3>سجل المعاملات الموثقة</h3>
              <div id="user-history"></div>
            </div>
          </div>
          <div id="tab-account" class="tab-content">
            <div class="section-card" style="border:1px solid #0088cc;">
              <h3 style="color:#0088cc;"><i class="fa-brands fa-telegram"></i> إشعارات تلجرام الفورية 📲</h3>
              <p style="font-size:12px; color:var(--text-muted); margin-bottom:15px;">ربط حسابك ببوت تلجرام يُتيح لك استقبال تنبيهات شحن الرصيد، السحب، وصرف أرباح الباقات مباشرة على هاتفك.</p>
              <a id="telegram-link" href="#" target="_blank" class="btn-gold" style="display:inline-block; text-decoration:none; text-align:center; background:#0088cc; color:white; width:100%;">
                <i class="fa-brands fa-telegram"></i> اضغط هنا لتفعيل إشعارات تلجرام فوراً
              </a>
            </div>
            <div class="section-card">
              <h3>توثيق الهوية (KYC Storage)</h3>
              <input type="file" id="kyc-file" accept="image/*" style="margin-bottom:10px;">
              <button class="btn-gold" onclick="uploadKYC()">رفع الهوية بأمان</button>
              <p id="kyc-msg" style="font-size:12px;"></p>
            </div>
            <div class="section-card">
              <h3>رابط الإحالة الخاص بك (2%)</h3>
              <div style="display:flex; gap:8px;">
                <input type="text" id="ref-link" readonly style="color:var(--accent-gold);">
                <button onclick="copyRefLink()" style="background:#0f172a; border:1px solid var(--accent-gold); color:var(--accent-gold); padding:0 15px; border-radius:8px; cursor:pointer;">نسخ</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <script>
        var CURRENT_APP_VERSION = '${APP_VERSION}';
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', function() {
            navigator.serviceWorker.register('/sw.js?v=' + CURRENT_APP_VERSION, { scope: '/' })
              .then(function(reg) {
                reg.addEventListener('updatefound', function() {
                  var newWorker = reg.installing;
                  if (!newWorker) return;
                  newWorker.addEventListener('statechange', function() {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                      newWorker.postMessage({ type: 'SKIP_WAITING' });
                    }
                  });
                });
                setInterval(function() { reg.update().catch(function() {}); }, 60000);
              })
              .catch(function(err) { console.log('SW registration failed: ', err); });
            var refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', function() {
              if (refreshing) return;
              refreshing = true;
              var toast = document.getElementById('sw-update-toast');
              if (toast) toast.style.display = 'flex';
              setTimeout(function() { window.location.reload(); }, 800);
            });
            navigator.serviceWorker.addEventListener('message', function(event) {
              if (event.data && event.data.type === 'SW_UPDATED') {
                var toast = document.getElementById('sw-update-toast');
                if (toast) toast.style.display = 'flex';
              }
            });
          });
        }
        var isRegister = false;
        var authToken = localStorage.getItem('maksab_token') || null;
        var currentUser = JSON.parse(localStorage.getItem('maksab_user')) || null;
        var rawCapital = 0; var rawProfit = 0;
        var selectedPkg = null;
        function formatMoney(amount) { return Number(amount).toLocaleString() + ' د.ع'; }
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
          var refCode = document.getElementById('ref-code-input').value;
          var msg = document.getElementById('auth-msg');
          var endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
          var payload = isRegister ? { phone_number: phone, password: password, full_name: fullName, referred_by: refCode } : { phone_number: phone, password: password };
          try {
            var res = await fetch(endpoint, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            var data = await res.json();
            if (data.success) {
              authToken = data.token;
              currentUser = data.user;
              localStorage.setItem('maksab_token', authToken);
              localStorage.setItem('maksab_user', JSON.stringify(currentUser));
              initDashboard();
            } else { msg.innerText = '❌ ' + data.error; msg.style.color = 'var(--danger-red)'; }
          } catch(e) { msg.innerText = '❌ خطأ في الاتصال بالسيرفر'; msg.style.color = 'var(--danger-red)'; }
        }
        async function fetchSystemSettings() {
          try {
            var res = await fetch('/api/packages/settings');
            var data = await res.json();
            if (data.success) {
              var settings = data.data || {};
              var packageNames = ['الباقة الفضية الشهرية', 'الباقة الذهبية الشهرية', 'الباقة الماسية الشهرية', 'الباقة السنوية الفضية', 'الباقة السنوية الذهبية', 'الباقة السنوية الماسية VIP'];
              packageNames.forEach(function(name) {
                var isPaused = settings[name] === false;
                var btn = document.getElementById('btn-sub-' + name);
                var card = document.getElementById('card-' + name);
                var badgeAlert = document.getElementById('badge-alert-' + name);
                if (btn && card && badgeAlert) {
                  if (isPaused) {
                    btn.disabled = true; btn.innerText = '🚫 متوقفة مؤقتاً';
                    btn.style.background = '#475569'; btn.style.color = '#94a3b8'; btn.style.cursor = 'not-allowed';
                    card.style.opacity = '0.65'; card.style.borderColor = '#ef4444';
                    badgeAlert.innerHTML = '<div style="background:rgba(239, 68, 68, 0.15); border:1px solid #ef4444; color:#ef4444; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:bold; margin-bottom:12px; text-align:center;"><i class="fa-solid fa-triangle-exclamation"></i> عذراً، الباقة متوقفة مؤقتاً من الإدارة</div>';
                  } else {
                    btn.disabled = false; btn.innerText = 'اشترك الآن 🚀';
                    btn.style.background = ''; btn.style.color = ''; btn.style.cursor = 'pointer';
                    card.style.opacity = '1'; card.style.borderColor = ''; badgeAlert.innerHTML = '';
                  }
                }
              });
            }
          } catch(e) { console.error(e); }
        }
        async function fetchAnnouncementBanner() {
          try {
            var res = await fetch('/api/announcement');
            var data = await res.json();
            if (data.success && data.data && data.data.active) {
              var banner = document.getElementById('announcement-banner-container');
              var bannerText = document.getElementById('announcement-banner-text');
              if (banner && bannerText) { bannerText.innerText = data.data.text; banner.style.display = 'flex'; }
            } else {
              var banner = document.getElementById('announcement-banner-container');
              if (banner) banner.style.display = 'none';
            }
          } catch(e) { console.error(e); }
        }
        function initDashboard() {
          if (!authToken) return;
          document.getElementById('auth-section').style.display = 'none';
          document.getElementById('dashboard-section').style.display = 'block';
          document.getElementById('user-name').innerText = currentUser.full_name;
          document.getElementById('ref-link').value = window.location.origin + '/app?ref=' + currentUser.id;
          document.getElementById('telegram-link').href = 'https://t.me/${TELEGRAM_BOT_NAME}?start=' + currentUser.id;
          loadUserData(); loadUserPackages(); loadUserNotifications();
          fetchSystemSettings(); fetchAnnouncementBanner();
          setInterval(fetchSystemSettings, 10000);
          setInterval(fetchAnnouncementBanner, 15000);
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
          var deposits = (dataDep.data || []).map(function(d) { d.cat = 'شحن رصيد'; return d; });
          var withdrawals = (dataWith.data || []).map(function(w) { w.cat = 'سحب مالي'; return w; });
          var allTx = deposits.concat(withdrawals).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
          allTx.forEach(function(t) {
            if (t.status === 'approved') {
              if (t.cat === 'شحن رصيد') { if (t.wallet_type === 'profit') profit += Number(t.amount); else capital += Number(t.amount); }
              else { if (t.wallet_type === 'profit') profit -= Number(t.amount); else capital -= Number(t.amount); }
            }
          });
          rawCapital = capital; rawProfit = profit;
          document.getElementById('net-balance').innerText = formatMoney(capital + profit);
          document.getElementById('active-capital').innerText = formatMoney(capital);
          document.getElementById('available-profit').innerText = formatMoney(profit);
          document.getElementById('user-history').innerHTML = allTx.map(function(t) {
            var walletName = t.wallet_type === 'profit' ? 'أرباح' : 'رأس مال';
            return '<div class="history-item"><div><strong>' + t.cat + ' (' + walletName + ')</strong><br><small>' + formatMoney(t.amount) + '</small></div><span class="badge badge-' + t.status + '">' + t.status + '</span></div>';
          }).join('');
        }
        async function loadUserNotifications() {
          var data = await fetchWithAuth('/api/user/notifications');
          var notifs = data.data || [];
          var unreadCount = notifs.filter(function(n) { return !n.is_read; }).length;
          var badge = document.getElementById('notif-badge');
          if (unreadCount > 0) { badge.innerText = unreadCount; badge.style.display = 'block'; } else { badge.style.display = 'none'; }
          var container = document.getElementById('notif-modal-list-container');
          if (notifs.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:30px;"><i class="fa-regular fa-bell-slash" style="font-size:35px; color:var(--text-muted); margin-bottom:10px;"></i><p style="font-size:13px; color:var(--text-muted);">لا توجد إشعارات أو تنبيهات حالياً</p></div>';
            return;
          }
          container.innerHTML = notifs.map(function(n) {
            var readClass = n.is_read ? 'read' : '';
            var dateStr = new Date(n.created_at).toLocaleString('ar-IQ');
            return '<div class="notif-full-card ' + readClass + '"><div class="notif-full-title"><i class="fa-solid fa-circle-info" style="color:var(--accent-gold);"></i> ' + n.title + '</div><div class="notif-full-msg">' + n.message + '</div><span class="notif-full-date"><i class="fa-regular fa-clock"></i> ' + dateStr + '</span></div>';
          }).join('');
        }
        function openNotifModal() { document.getElementById('notif-modal-overlay').style.display = 'flex'; loadUserNotifications(); }
        function closeNotifModal() { document.getElementById('notif-modal-overlay').style.display = 'none'; }
        async function markAllNotifsRead() { await fetchWithAuth('/api/user/notifications/read', { method: 'POST' }); loadUserNotifications(); }
        function openPackageModal(name, amount, payout, durationMonths) {
          selectedPkg = { name: name, amount: amount, payout: payout, durationMonths: durationMonths };
          document.getElementById('package-modal').style.display = 'block';
          document.getElementById('pkg-modal-title').innerText = 'الاشتراك بـ ' + name;
          document.getElementById('pkg-modal-desc').innerText = 'قيمة الاستثمار: ' + formatMoney(amount) + ' | العائد المكتمل: ' + formatMoney(payout) + ' (المدة: ' + (durationMonths === 12 ? 'سنة واحدة' : 'شهر واحد') + ')';
          document.getElementById('pkg-user-balance').innerText = formatMoney(rawCapital);
          var btn = document.getElementById('btn-confirm-pkg');
          var msg = document.getElementById('pkg-msg');
          msg.innerText = '';
          if (rawCapital < amount) { btn.disabled = true; btn.style.opacity = '0.5'; btn.style.cursor = 'not-allowed'; msg.innerText = '❌ رصيدك غير كافٍ. يرجى شحن رصيدك أولاً من قسم الأموال والعمليات.'; msg.style.color = 'var(--danger-red)'; }
          else { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
        }
        async function submitPackageSubscription() {
          var msg = document.getElementById('pkg-msg');
          msg.innerText = 'جاري إرسال طلب الاشتراك للإدارة...'; msg.style.color = 'var(--accent-gold)';
          try {
            var data = await fetchWithAuth('/api/packages/subscribe', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ plan_name: selectedPkg.name, invested_amount: selectedPkg.amount, expected_payout: selectedPkg.payout, duration_months: selectedPkg.durationMonths }) });
            if (data.success) { msg.innerText = '✅ ' + data.message; msg.style.color = 'var(--success-green)'; setTimeout(function() { document.getElementById('package-modal').style.display = 'none'; loadUserPackages(); loadUserData(); }, 1800); }
            else { msg.innerText = '❌ ' + data.error; msg.style.color = 'var(--danger-red)'; }
          } catch(e) { msg.innerText = 'خطأ في عملية الاشتراك'; msg.style.color = 'var(--danger-red)'; }
        }
        async function loadUserPackages() {
          var res = await fetchWithAuth('/api/user/packages');
          var packages = res.data || [];
          var container = document.getElementById('user-packages-list');
          if (packages.length === 0) { container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">لا توجد لديك باقات حالياً.</p>'; return; }
          container.innerHTML = packages.map(function(p) {
            var timeMarkup = '';
            if (p.status === 'active' && p.end_date) {
              var now = new Date(); var end = new Date(p.end_date); var start = new Date(p.created_at);
              var totalTime = end - start; var remainingTime = end - now;
              if (remainingTime > 0) {
                var days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
                var hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                var pct = Math.min(100, Math.max(0, ((now - start) / totalTime) * 100)).toFixed(1);
                timeMarkup = '<div style="margin-top:12px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.1);"><div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted); margin-bottom:6px;"><span>نسبة الاكتمال: <strong style="color:var(--accent-gold);">' + pct + '%</strong></span><span>⏱️ متبقي: <strong style="color:var(--text-main);">' + days + ' يوم و ' + hours + ' ساعة</strong></span></div><div style="background:#1e293b; border-radius:10px; height:8px; overflow:hidden; border:1px solid rgba(212,175,55,0.2);"><div style="background:linear-gradient(90deg, #d4af37 0%, #10b981 100%); width:' + pct + '%; height:100%; border-radius:10px;"></div></div></div>';
              } else { timeMarkup = '<div style="font-size:12px; color:var(--success-green); margin-top:8px;">🎉 مكتملة المدى المالي (بانتظار صرف العائد)</div>'; }
            } else if (p.status === 'pending') { timeMarkup = '<div style="font-size:12px; color:var(--warning); margin-top:8px;">⏳ الطلب بانتظار موافقة الإدارة وتفعيل الباقة</div>'; }
            var statusBadge = p.status === 'active' ? 'نشطة ⚡' : (p.status === 'completed' ? 'مكتملة ✅' : 'قيد الانتظار ⏳');
            return '<div class="history-item" style="flex-direction:column; align-items:stretch; gap:6px;"><div style="display:flex; justify-content:space-between; align-items:center;"><div><strong>' + p.plan_name + '</strong> - ' + formatMoney(p.invested_amount) + '<br><small style="color:var(--success-green);">العائد المتوقع: ' + formatMoney(p.expected_payout) + '</small></div><span class="badge badge-' + p.status + '">' + statusBadge + '</span></div>' + timeMarkup + '</div>';
          }).join('');
        }
        function convertFileToBase64(file) { return new Promise(function(resolve, reject) { var r = new FileReader(); r.readAsDataURL(file); r.onload = function() { resolve(r.result); }; r.onerror = function(e) { reject(e); }; }); }
        async function submitDeposit() {
          var amount = document.getElementById('deposit-amount').value;
          var ref = document.getElementById('deposit-ref').value;
          var fileInput = document.getElementById('deposit-file');
          var msg = document.getElementById('deposit-msg');
          if (!amount || !ref || fileInput.files.length === 0) { msg.innerText = 'املأ التفاصيل والإشعار'; return; }
          msg.innerText = 'جاري رفع الإشعار...';
          try {
            var b64 = await convertFileToBase64(fileInput.files[0]);
            var data = await fetchWithAuth('/api/deposits', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount: amount, transaction_ref: ref, receipt_url: b64, wallet_type: 'capital' }) });
            if (data.success) { msg.innerText = '✅ تم إرسال طلب الشحن بنجاح'; loadUserData(); } else msg.innerText = '❌ ' + data.error;
          } catch(e) { msg.innerText = 'خطأ في الرفع'; }
        }
        async function submitWithdraw() {
          var amount = document.getElementById('withdraw-amount').value;
          var account = document.getElementById('withdraw-account').value;
          var wallet = document.getElementById('withdraw-wallet').value;
          var msg = document.getElementById('withdraw-msg');
          var data = await fetchWithAuth('/api/withdrawals', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ amount: amount, payment_method: 'ZainCash', account_details: account, wallet_type: wallet }) });
          if (data.success) { msg.innerText = '✅ تم تقديم طلب السحب'; loadUserData(); } else msg.innerText = '❌ ' + data.error;
        }
        async function uploadKYC() {
          var f = document.getElementById('kyc-file'); if (f.files.length === 0) return;
          document.getElementById('kyc-msg').innerText = 'جاري رفع وتشفير الهوية...';
          var b64 = await convertFileToBase64(f.files[0]);
          await fetchWithAuth('/api/user/kyc', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ kyc_doc: b64 }) });
          document.getElementById('kyc-msg').innerText = '✅ تم رفع الهوية بنجاح';
        }
        function copyRefLink() { navigator.clipboard.writeText(document.getElementById('ref-link').value); alert('تم نسخ الرابط!'); }
        function logout() { localStorage.clear(); location.reload(); }
        fetchAnnouncementBanner();
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 2. بوابة الإدارة السرية (Secure Admin Portal)
//    نفس آلية التحديث التلقائي المطبّقة على واجهة المستثمر
// ==========================================
app.get('/secure-portal-exec-9921x', executiveShieldAuth, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.type('text/html');
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="app-version" content="${APP_VERSION}">
  <link rel="manifest" href="/manifest.json?v=${APP_VERSION}">
  <meta name="theme-color" content="#0f172a">
  <title>بوابة الإدارة - مَكْسَب الاستثمارية</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
    body { background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .login-box { max-width: 380px; margin: 80px auto; background: #1e293b; padding: 30px; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
    .login-box h2 { text-align: center; margin-bottom: 20px; color: #fbbf24; }
    .login-box input { width: 100%; padding: 12px; margin: 8px 0; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; }
    .login-box button { width: 100%; padding: 12px; border: none; border-radius: 8px; background: linear-gradient(135deg,#f59e0b,#d97706); color: #fff; font-weight: bold; cursor: pointer; }
    .dashboard { display: none; padding: 20px; max-width: 1200px; margin: auto; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 15px 20px; background: #1e293b; border-radius: 12px; margin-bottom: 20px; }
    .header h1 { color: #fbbf24; font-size: 20px; }
    .header .role-badge { background: #f59e0b; color: #000; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; }
    .tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .tab-btn { padding: 10px 18px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #cbd5e1; cursor: pointer; font-size: 14px; }
    .tab-btn.active { background: #f59e0b; color: #000; border-color: #f59e0b; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .card { background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
    .card h3 { color: #fbbf24; margin-bottom: 12px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: right; border-bottom: 1px solid #334155; font-size: 13px; }
    th { color: #94a3b8; }
    .btn { padding: 6px 12px; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; margin: 2px; }
    .btn-approve { background: #22c55e; color: #fff; }
    .btn-reject { background: #ef4444; color: #fff; }
    .btn-info { background: #3b82f6; color: #fff; }
    .btn-warn { background: #f59e0b; color: #000; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px,1fr)); gap: 12px; margin-bottom: 20px; }
    .stat-card { background: #1e293b; padding: 16px; border-radius: 12px; text-align: center; }
    .stat-card .num { font-size: 28px; color: #fbbf24; font-weight: bold; }
    .stat-card .label { font-size: 12px; color: #94a3b8; }
    .form-row { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
    .form-row input, .form-row select, .form-row textarea { flex: 1; min-width: 150px; padding: 10px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; }
    .badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; }
    .badge-pending { background: #f59e0b; color: #000; }
    .badge-approved { background: #22c55e; color: #fff; }
    .badge-rejected { background: #ef4444; color: #fff; }
    .badge-blocked { background: #7f1d1d; color: #fff; }
    .badge-active { background: #22c55e; color: #fff; }
    .super-only { display: none; }
    #sw-update-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #f59e0b; color: #000; padding: 12px 24px; border-radius: 30px; font-weight: bold; box-shadow: 0 4px 20px rgba(0,0,0,0.5); z-index: 99999; display: none; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
  </style>
</head>
<body>
  <div id="sw-update-toast">🔄 جارٍ تحديث البوابة للإصدار الجديد...</div>

  <div class="login-box" id="login-box">
    <h2><i class="fa-solid fa-shield-halved"></i> بوابة الإدارة</h2>
    <input type="password" id="admin-pass" placeholder="كلمة مرور الإدارة">
    <button onclick="adminLogin()">دخول</button>
    <p id="login-msg" style="color:#ef4444;text-align:center;margin-top:10px;font-size:13px;"></p>
  </div>

  <div class="dashboard" id="dashboard">
    <div class="header">
      <h1><i class="fa-solid fa-chart-line"></i> لوحة تحكم مَكْسَب</h1>
      <div><span class="role-badge" id="role-badge"></span> <button class="btn btn-reject" onclick="adminLogout()">خروج</button></div>
    </div>

    <div class="stat-grid" id="stats-grid"></div>

    <div class="tabs">
      <button class="tab-btn active" onclick="switchTab('deposits')">الشحنات</button>
      <button class="tab-btn" onclick="switchTab('withdrawals')">السحوبات</button>
      <button class="tab-btn" onclick="switchTab('users')">المستثمرون</button>
      <button class="tab-btn" onclick="switchTab('packages')">الباقات</button>
      <button class="tab-btn" onclick="switchTab('broadcast')">إشعار جماعي</button>
      <button class="tab-btn super-only" onclick="switchTab('announcement')">الشريط الإعلاني</button>
    </div>

    <div class="tab-content active" id="tab-deposits">
      <div class="card"><h3>طلبات الشحن</h3><table><thead><tr><th>المستثمر</th><th>المبلغ</th><th>الإيصال</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody id="deposits-body"></tbody></table></div>
    </div>

    <div class="tab-content" id="tab-withdrawals">
      <div class="card"><h3>طلبات السحب</h3><table><thead><tr><th>المستثمر</th><th>المبلغ</th><th>المحفظة</th><th>الحساب</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody id="withdrawals-body"></tbody></table></div>
    </div>

    <div class="tab-content" id="tab-users">
      <div class="card"><h3>قائمة المستثمرين</h3><table><thead><tr><th>الاسم</th><th>الهاتف</th><th>الرصيد</th><th>KYC</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody id="users-body"></tbody></table></div>
    </div>

    <div class="tab-content" id="tab-packages">
      <div class="card"><h3>اشتراكات الباقات</h3><table><thead><tr><th>المستثمر</th><th>الباقة</th><th>المبلغ</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody id="packages-body"></tbody></table></div>
    </div>

    <div class="tab-content" id="tab-broadcast">
      <div class="card"><h3>إرسال إشعار جماعي</h3>
        <div class="form-row"><input type="text" id="bc-title" placeholder="عنوان الإشعار"></div>
        <div class="form-row"><textarea id="bc-msg" placeholder="نص الإشعار" rows="3"></textarea></div>
        <button class="btn btn-approve" onclick="sendBroadcast()">إرسال للجميع</button>
        <p id="bc-result" style="margin-top:10px;"></p>
      </div>
    </div>

    <div class="tab-content super-only" id="tab-announcement">
      <div class="card"><h3>إدارة الشريط الإعلاني</h3>
        <div class="form-row">
          <select id="ann-active"><option value="true">مفعّل</option><option value="false">معطّل</option></select>
          <input type="text" id="ann-text" placeholder="نص الإعلان">
          <button class="btn btn-approve" onclick="updateAnnouncement()">حفظ</button>
        </div>
        <p id="ann-result" style="margin-top:10px;"></p>
      </div>
    </div>
  </div>

  <script>
    // ===== آلية التحديث التلقائي (PWA Auto-Update) =====
    var CURRENT_APP_VERSION = '${APP_VERSION}';
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js?v=' + CURRENT_APP_VERSION, { scope: '/' })
        .then(function(reg) {
          reg.addEventListener('updatefound', function() {
            var newWorker = reg.installing;
            newWorker.addEventListener('statechange', function() {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
          // فحص دوري للتحديث كل 60 ثانية
          setInterval(function() { reg.update().catch(function() {}); }, 60000);
        });
      // عند تغيّر المتحكم (controller) => تحديث تلقائي للصفحة
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (refreshing) return;
        refreshing = true;
        var toast = document.getElementById('sw-update-toast');
        if (toast) toast.style.display = 'block';
        window.location.reload();
      });
      navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'SW_UPDATED') {
          var toast = document.getElementById('sw-update-toast');
          if (toast) toast.style.display = 'block';
        }
      });
    }

    var adminToken = localStorage.getItem('adminToken');
    var adminRole = localStorage.getItem('adminRole');

    async function adminLogin() {
      var pass = document.getElementById('admin-pass').value;
      var msg = document.getElementById('login-msg');
      try {
        var res = await fetch('/api/admin/auth', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ password: pass }) });
        var data = await res.json();
        if (data.success) {
          localStorage.setItem('adminToken', data.token);
          localStorage.setItem('adminRole', data.role);
          adminToken = data.token; adminRole = data.role;
          showDashboard();
        } else { msg.innerText = data.error || 'فشل الدخول'; }
      } catch(e) { msg.innerText = 'خطأ في الاتصال'; }
    }

    function adminLogout() { localStorage.removeItem('adminToken'); localStorage.removeItem('adminRole'); location.reload(); }

    async function adminFetch(url, opts) {
      opts = opts || {};
      opts.headers = opts.headers || {};
      opts.headers['Authorization'] = 'Bearer ' + adminToken;
      var res = await fetch(url, opts);
      return res.json();
    }

    function showDashboard() {
      document.getElementById('login-box').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
      document.getElementById('role-badge').innerText = adminRole === 'super_admin' ? 'مدير رئيسي' : 'مشرف';
      if (adminRole === 'super_admin') {
        document.querySelectorAll('.super-only').forEach(function(el){ el.style.display = 'block'; });
      }
      loadAll();
    }

    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function(c){ c.classList.remove('active'); });
      event.target.classList.add('active');
      document.getElementById('tab-' + name).classList.add('active');
    }

    async function loadAll() {
      loadDeposits(); loadWithdrawals(); loadUsers(); loadPackages(); loadStats();
    }

    async function loadStats() {
      var data = await adminFetch('/api/admin/users');
      if (data.success) {
        var users = data.users || [];
        document.getElementById('stats-grid').innerHTML =
          '<div class="stat-card"><div class="num">' + users.length + '</div><div class="label">إجمالي المستثمرين</div></div>' +
          '<div class="stat-card"><div class="num">' + users.filter(function(u){return !u.is_blocked;}).length + '</div><div class="label">نشط</div></div>' +
          '<div class="stat-card"><div class="num">' + users.filter(function(u){return u.kyc_verified;}).length + '</div><div class="label">موثّق KYC</div></div>' +
          '<div class="stat-card"><div class="num">' + users.reduce(function(s,u){return s + (u.balance||0);},0).toFixed(2) + '</div><div class="label">إجمالي الأرصدة</div></div>';
      }
    }

    async function loadDeposits() {
      var data = await adminFetch('/api/admin/deposits');
      var body = document.getElementById('deposits-body');
      if (data.success && data.deposits) {
        body.innerHTML = data.deposits.map(function(d) {
          return '<tr><td>' + (d.username||d.user_id) + '</td><td>' + (d.amount||0) + '</td><td><a href="' + (d.receipt_url||'#') + '" target="_blank" class="btn btn-info">عرض</a></td><td><span class="badge badge-' + (d.status||'pending') + '">' + (d.status||'pending') + '</span></td><td>' +
            (d.status==='pending' ? '<button class="btn btn-approve" onclick="setDepositStatus(' + d.id + ',\\'approved\\')">قبول</button><button class="btn btn-reject" onclick="setDepositStatus(' + d.id + ',\\'rejected\\')">رفض</button>' : '-') +
            '</td></tr>';
        }).join('');
      }
    }

    async function setDepositStatus(id, status) {
      await adminFetch('/api/admin/deposits/status', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id, status: status }) });
      loadDeposits(); loadStats();
    }

    async function loadWithdrawals() {
      var data = await adminFetch('/api/admin/withdrawals');
      var body = document.getElementById('withdrawals-body');
      if (data.success && data.withdrawals) {
        body.innerHTML = data.withdrawals.map(function(w) {
          return '<tr><td>' + (w.username||w.user_id) + '</td><td>' + (w.amount||0) + '</td><td>' + (w.wallet_type||'-') + '</td><td>' + (w.account_details||'-') + '</td><td><span class="badge badge-' + (w.status||'pending') + '">' + (w.status||'pending') + '</span></td><td>' +
            (w.status==='pending' ? '<button class="btn btn-approve" onclick="setWithdrawStatus(' + w.id + ',\\'approved\\')">قبول</button><button class="btn btn-reject" onclick="setWithdrawStatus(' + w.id + ',\\'rejected\\')">رفض</button>' : '-') +
            '</td></tr>';
        }).join('');
      }
    }

    async function setWithdrawStatus(id, status) {
      await adminFetch('/api/admin/withdrawals/status', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id, status: status }) });
      loadWithdrawals();
    }

    async function loadUsers() {
      var data = await adminFetch('/api/admin/users');
      var body = document.getElementById('users-body');
      if (data.success && data.users) {
        body.innerHTML = data.users.map(function(u) {
          return '<tr><td>' + (u.username||'-') + '</td><td>' + (u.phone||'-') + '</td><td>' + (u.balance||0) + '</td><td>' + (u.kyc_verified ? '<span class="badge badge-approved">موثّق</span>' : '<button class="btn btn-warn" onclick="verifyKyc(\\'' + u.id + '\\')">توثيق</button>') + '</td><td>' + (u.is_blocked ? '<span class="badge badge-blocked">محظور</span>' : '<span class="badge badge-active">نشط</span>') + '</td><td>' +
            (adminRole==='super_admin' ? '<button class="btn btn-warn" onclick="toggleBlock(\\'' + u.id + '\\')">' + (u.is_blocked?'فك الحظر':'حظر') + '</button>' : '') +
            '</td></tr>';
        }).join('');
      }
    }

    async function verifyKyc(userId) {
      await adminFetch('/api/admin/users/verify-kyc', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId: userId }) });
      loadUsers();
    }

    async function toggleBlock(userId) {
      await adminFetch('/api/admin/users/toggle-block', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId: userId }) });
      loadUsers();
    }

    async function loadPackages() {
      var data = await adminFetch('/api/admin/packages');
      var body = document.getElementById('packages-body');
      if (data.success && data.packages) {
        body.innerHTML = data.packages.map(function(p) {
          return '<tr><td>' + (p.username||p.user_id) + '</td><td>' + (p.package_name||'-') + '</td><td>' + (p.amount||0) + '</td><td><span class="badge badge-' + (p.status||'pending') + '">' + (p.status||'pending') + '</span></td><td>' +
            (p.status==='pending' ? '<button class="btn btn-approve" onclick="approvePackage(' + p.id + ')">اعتماد</button><button class="btn btn-info" onclick="payoutPackage(' + p.id + ')">دفع الأرباح</button>' : (p.status==='approved' ? '<button class="btn btn-info" onclick="payoutPackage(' + p.id + ')">دفع الأرباح</button>' : '-')) +
            '</td></tr>';
        }).join('');
      }
    }

    async function approvePackage(id) {
      await adminFetch('/api/admin/packages/approve', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id }) });
      loadPackages();
    }

    async function payoutPackage(id) {
      await adminFetch('/api/admin/packages/payout', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id }) });
      loadPackages(); loadUsers();
    }

    async function sendBroadcast() {
      var title = document.getElementById('bc-title').value;
      var msg = document.getElementById('bc-msg').value;
      var res = document.getElementById('bc-result');
      var data = await adminFetch('/api/admin/broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title: title, message: msg }) });
      res.innerText = data.success ? '✅ تم إرسال الإشعار لـ ' + (data.sent||0) + ' مستثمر' : '❌ ' + (data.error||'فشل');
    }

    async function updateAnnouncement() {
      var active = document.getElementById('ann-active').value === 'true';
      var text = document.getElementById('ann-text').value;
      var res = document.getElementById('ann-result');
      var data = await adminFetch('/api/admin/announcement', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ active: active, text: text }) });
      res.innerText = data.success ? '✅ تم التحديث' : '❌ ' + (data.error||'فشل');
    }

    if (adminToken) showDashboard();
  </script>
</body>
</html>`);
});

// ==========================================
// 3. مسارات API العامة (Public API Routes)
// ==========================================

// إعدادات الباقات للمستثمرين
app.get('/api/packages/settings', (req, res) => {
  res.json({
    success: true,
    packages: packageStatusMemory,
    announcement: announcementMemory
  });
});

// الشريط الإعلاني للمستثمرين
app.get('/api/announcement', (req, res) => {
  res.json({ success: true, announcement: announcementMemory });
});

// تحديث الشريط الإعلاني (للمدير الرئيسي فقط)
app.post('/api/admin/announcement', authenticateAdmin, requireSuperAdmin, (req, res) => {
  const { active, text } = req.body;
  if (typeof active !== 'undefined') announcementMemory.active = active;
  if (text) announcementMemory.text = text;
  res.json({ success: true, announcement: announcementMemory });
});

// تفعيل/تعطيل باقة (للمدير الرئيسي فقط)
app.post('/api/admin/packages/toggle', authenticateAdmin, requireSuperAdmin, (req, res) => {
  const { packageName, active } = req.body;
  if (packageName && typeof active !== 'undefined') {
    packageStatusMemory[packageName] = active;
    res.json({ success: true, packages: packageStatusMemory });
  } else {
    res.status(400).json({ success: false, error: 'بيانات ناقصة' });
  }
});

// webhook تيليجرام (ربط البوت)
app.post('/api/telegram-webhook', async (req, res) => {
  const update = req.body;
  try {
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/start') {
        await sendTelegramNotification(chatId, `مرحباً بك في <b>${TELEGRAM_BOT_NAME}</b>!\\nمنصتك الاستثمارية الموثوقة.\\nاستخدم /help لعرض الأوامر.`);
      } else if (text === '/help') {
        await sendTelegramNotification(chatId, 'الأوامر المتاحة:\\n/start - بدء التشغيل\\n/help - المساعدة\\n/about - حول المنصة');
      } else if (text === '/about') {
        await sendTelegramNotification(chatId, `<b>مَكْسَب الاستثمارية</b>\\nمنصة استثمارية موثوقة تقدم باقات أرباح يومية وشهرية وسنوية.`);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('❌ خطأ في webhook تيليجرام:', err.message);
    res.json({ success: true });
  }
});

// ==========================================
// 4. مسارات المصادقة (Auth Routes)
// ==========================================

// مصادقة الإدارة
app.post('/api/admin/auth', async (req, res) => {
  const { password } = req.body;

  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ isAdmin: true, isModerator: true, role: 'super_admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token, role: 'super_admin' });
  }

  if (password === MODERATOR_PASSWORD) {
    const token = jwt.sign({ isAdmin: false, isModerator: true, role: 'moderator' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token, role: 'moderator' });
  }

  res.status(401).json({ success: false, error: 'كلمة مرور خاطئة' });
});

// تسجيل مستثمر جديد
app.post('/api/auth/register', async (req, res) => {
  const { username, phone, password, referrer_code } = req.body;

  if (!username || !phone || !password) {
    return res.status(400).json({ success: false, error: 'يرجى تعبئة جميع الحقول' });
  }

  try {
    // التحقق من عدم تكرار الهاتف
    const { data: existing } = await supabase.from('users').select('id').eq('phone', phone).maybeSingle();
    if (existing) {
      return res.status(409).json({ success: false, error: 'رقم الهاتف مسجل مسبقاً' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newReferrerCode = 'MK' + Date.now().toString().slice(-8);

    // البحث عن المُحيل
    let referrerId = null;
    if (referrer_code) {
      const { data: referrer } = await supabase.from('users').select('id').eq('referrer_code', referrer_code).maybeSingle();
      if (referrer) referrerId = referrer.id;
    }

    const { data: newUser, error } = await supabase.from('users').insert({
      username, phone, password: hashedPassword,
      balance: 0, referrer_code: newReferrerCode,
      referred_by: referrerId,
      kyc_verified: false, is_blocked: false,
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;

    const token = jwt.sign({ id: newUser.id, phone }, JWT_SECRET, { expiresIn: '30d' });

    // إشعار تيليجرام
    if (TELEGRAM_BOT_TOKEN) {
      await sendTelegramNotification(null, `🆕 مستثمر جديد:\\nالاسم: ${username}\\nالهاتف: ${phone}`).catch(()=>{});
    }

    res.json({ success: true, token, user: { id: newUser.id, username, phone, balance: 0, referrer_code: newReferrerCode, kyc_verified: false } });
  } catch (err) {
    console.error('❌ خطأ في التسجيل:', err.message);
    res.status(500).json({ success: false, error: 'فشل التسجيل: ' + err.message });
  }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, error: 'يرجى إدخال الهاتف وكلمة المرور' });
  }

  try {
    const { data: user } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();

    if (!user) {
      return res.status(404).json({ success: false, error: 'الحساب غير موجود' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ success: false, error: 'تم حظر هذا الحساب. تواصل مع الإدارة.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'كلمة مرور خاطئة' });
    }

    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });
    res.json({
      success: true, token,
      user: { id: user.id, username: user.username, phone: user.phone, balance: user.balance, referrer_code: user.referrer_code, kyc_verified: user.kyc_verified }
    });
  } catch (err) {
    console.error('❌ خطأ في الدخول:', err.message);
    res.status(500).json({ success: false, error: 'فشل تسجيل الدخول' });
  }
});

// ==========================================
// 5. مسارات الباقات (Packages Routes)
// ==========================================

// الاشتراك في باقة
app.post('/api/packages/subscribe', authenticateUser, async (req, res) => {
  const { package_name, amount, wallet_type } = req.body;
  const userId = req.user.id;

  if (!package_name || !amount) {
    return res.status(400).json({ success: false, error: 'بيانات الباقة ناقصة' });
  }

  // التحقق من تفعيل الباقة
  if (packageStatusMemory[package_name] === false) {
    return res.status(403).json({ success: false, error: 'هذه الباقة غير متاحة حالياً' });
  }

  try {
    const { data, error } = await supabase.from('user_packages').insert({
      user_id: userId, package_name, amount,
      wallet_type: wallet_type || 'capital',
      status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    res.json({ success: true, package: data });
  } catch (err) {
    console.error('❌ خطأ في الاشتراك:', err.message);
    res.status(500).json({ success: false, error: 'فشل الاشتراك' });
  }
});

// اعتماد اشتراك باقة (إدارة)
app.post('/api/admin/packages/approve', authenticateAdmin, async (req, res) => {
  const { id } = req.body;

  try {
    const { data: pkg, error: e1 } = await supabase.from('user_packages').select('*').eq('id', id).maybeSingle();
    if (e1 || !pkg) throw new Error('الباقة غير موجودة');

    const { error: e2 } = await supabase.from('user_packages').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id);
    if (e2) throw e2;

    res.json({ success: true });
  } catch (err) {
    console.error('❌ خطأ في اعتماد الباقة:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// دفع أرباح الباقة (إدارة)
app.post('/api/admin/packages/payout', authenticateAdmin, async (req, res) => {
  const { id } = req.body;

  try {
    const { data: pkg, error: e1 } = await supabase.from('user_packages').select('*').eq('id', id).maybeSingle();
    if (e1 || !pkg) throw new Error('الباقة غير موجودة');

    // حساب الأرباح (مثال: 20% من المبلغ)
    const profit = parseFloat(pkg.amount) * 0.20;

    // إضافة الأرباح لرصيد المستثمر
    const { data: user } = await supabase.from('users').select('balance, phone').eq('id', pkg.user_id).maybeSingle();
    if (user) {
      const newBalance = parseFloat(user.balance || 0) + profit;
      await supabase.from('users').update({ balance: newBalance }).eq('id', pkg.user_id);

      // إشعار
      await supabase.from('notifications').insert({
        user_id: pkg.user_id, title: 'دفع أرباح', message: `تم دفع ${profit} أرباح الباقة ${pkg.package_name}`,
        read: false, created_at: new Date().toISOString()
      });
    }

    res.json({ success: true, profit });
  } catch (err) {
    console.error('❌ خطأ في دفع الأرباح:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. مسارات الإشعارات (Notifications)
// ==========================================

// جلب إشعارات المستثمر
app.get('/api/user/notifications', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase.from('notifications')
      .select('*').eq('user_id', req.user.id)
      .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    res.json({ success: true, notifications: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تعليم إشعار كمقروء
app.post('/api/user/notifications/read', authenticateUser, async (req, res) => {
  const { id } = req.body;
  try {
    await supabase.from('notifications').update({ read: true }).eq('id', id).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// باقات المستثمر
app.get('/api/user/packages', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase.from('user_packages').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, packages: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. مسارات الشحن والسحب (Deposits & Withdrawals)
// ==========================================

// إنشاء طلب شحن
app.post('/api/deposits', authenticateUser, async (req, res) => {
  const { amount, transaction_ref, receipt_url, wallet_type } = req.body;
  const userId = req.user.id;

  if (!amount || !receipt_url) {
    return res.status(400).json({ success: false, error: 'المبلغ والإيصال مطلوبان' });
  }

  try {
    // رفع الإيصال على ImgBB
    let finalReceiptUrl = receipt_url;
    try {
      finalReceiptUrl = await uploadToStorage(receipt_url);
    } catch (uploadErr) {
      console.error('⚠️ تعذّر رفع الإيصال، سيُستخدم base64:', uploadErr.message);
    }

    const { data, error } = await supabase.from('deposits').insert({
      user_id: userId, amount: parseFloat(amount),
      transaction_ref: transaction_ref || null,
      receipt_url: finalReceiptUrl,
      wallet_type: wallet_type || 'capital',
      status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    res.json({ success: true, deposit: data });
  } catch (err) {
    console.error('❌ خطأ في طلب الشحن:', err.message);
    res.status(500).json({ success: false, error: 'فشل إنشاء طلب الشحن' });
  }
});

// إنشاء طلب سحب
app.post('/api/withdrawals', authenticateUser, async (req, res) => {
  const { amount, payment_method, account_details, wallet_type } = req.body;
  const userId = req.user.id;

  if (!amount || !account_details) {
    return res.status(400).json({ success: false, error: 'المبلغ وتفاصيل الحساب مطلوبان' });
  }

  try {
    // التحقق من الرصيد
    const { data: user } = await supabase.from('users').select('balance').eq('id', userId).maybeSingle();
    if (!user || parseFloat(user.balance || 0) < parseFloat(amount)) {
      return res.status(400).json({ success: false, error: 'الرصيد غير كافٍ' });
    }

    const { data, error } = await supabase.from('withdrawals').insert({
      user_id: userId, amount: parseFloat(amount),
      payment_method: payment_method || 'ZainCash',
      account_details, wallet_type: wallet_type || 'profits',
      status: 'pending',
      created_at: new Date().toISOString()
    }).select().single();

    if (error) throw error;
    res.json({ success: true, withdrawal: data });
  } catch (err) {
    console.error('❌ خطأ في طلب السحب:', err.message);
    res.status(500).json({ success: false, error: 'فشل إنشاء طلب السحب' });
  }
});

// رفع وثيقة KYC
app.post('/api/user/kyc', authenticateUser, async (req, res) => {
  const { kyc_doc } = req.body;
  const userId = req.user.id;

  if (!kyc_doc) {
    return res.status(400).json({ success: false, error: 'الوثيقة مطلوبة' });
  }

  try {
    let finalUrl = kyc_doc;
    try {
      finalUrl = await uploadToStorage(kyc_doc);
    } catch (e) {
      console.error('⚠️ تعذّر رفع وثيقة KYC:', e.message);
    }

    await supabase.from('users').update({ kyc_doc_url: finalUrl, kyc_verified: false }).eq('id', userId);
    res.json({ success: true, message: 'تم رفع الوثيقة، بانتظار المراجعة' });
  } catch (err) {
    console.error('❌ خطأ في KYC:', err.message);
    res.status(500).json({ success: false, error: 'فشل رفع الوثيقة' });
  }
});

// شحنات المستثمر
app.get('/api/user/deposits', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase.from('deposits').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, deposits: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// سحوبات المستثمر
app.get('/api/user/withdrawals', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await supabase.from('withdrawals').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, withdrawals: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 8. مسارات الإدارة (Admin API Routes)
// ==========================================

// جميع الشحنات (إدارة)
app.get('/api/admin/deposits', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('deposits').select('*, users(username, phone)').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const deposits = (data || []).map(function(d) { d.username = d.users ? d.users.username : null; delete d.users; return d; });
    res.json({ success: true, deposits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تحديث حالة الشحن (إدارة)
app.post('/api/admin/deposits/status', authenticateAdmin, async (req, res) => {
  const { id, status } = req.body;

  try {
    const { data: dep, error: e1 } = await supabase.from('deposits').select('*').eq('id', id).maybeSingle();
    if (e1 || !dep) throw new Error('طلب الشحن غير موجود');

    const { error: e2 } = await supabase.from('deposits').update({ status, processed_at: new Date().toISOString() }).eq('id', id);
    if (e2) throw e2;

    // إذا تمت الموافقة، أضف المبلغ للرصيد
    if (status === 'approved') {
      const { data: user } = await supabase.from('users').select('balance').eq('id', dep.user_id).maybeSingle();
      if (user) {
        const newBalance = parseFloat(user.balance || 0) + parseFloat(dep.amount);
        await supabase.from('users').update({ balance: newBalance }).eq('id', dep.user_id);
      }
      await supabase.from('notifications').insert({
        user_id: dep.user_id, title: 'تمت الموافقة على الشحن', message: `تم اعتماد شحنك بمبلغ ${dep.amount}`,
        read: false, created_at: new Date().toISOString()
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ خطأ في تحديث حالة الشحن:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// جميع السحوبات (إدارة)
app.get('/api/admin/withdrawals', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('withdrawals').select('*, users(username, phone)').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const withdrawals = (data || []).map(function(w) { w.username = w.users ? w.users.username : null; delete w.users; return w; });
    res.json({ success: true, withdrawals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تحديث حالة السحب (إدارة)
app.post('/api/admin/withdrawals/status', authenticateAdmin, async (req, res) => {
  const { id, status } = req.body;

  try {
    const { data: wd, error: e1 } = await supabase.from('withdrawals').select('*').eq('id', id).maybeSingle();
    if (e1 || !wd) throw new Error('طلب السحب غير موجود');

    const { error: e2 } = await supabase.from('withdrawals').update({ status, processed_at: new Date().toISOString() }).eq('id', id);
    if (e2) throw e2;

    // إذا تمت الموافقة، اخصم المبلغ من الرصيد
    if (status === 'approved') {
      const { data: user } = await supabase.from('users').select('balance').eq('id', wd.user_id).maybeSingle();
      if (user) {
        const newBalance = parseFloat(user.balance || 0) - parseFloat(wd.amount);
        await supabase.from('users').update({ balance: newBalance }).eq('id', wd.user_id);
      }
      await supabase.from('notifications').insert({
        user_id: wd.user_id, title: 'تمت الموافقة على السحب', message: `تم اعتماد سحبك بمبلغ ${wd.amount}`,
        read: false, created_at: new Date().toISOString()
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('❌ خطأ في تحديث حالة السحب:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// جميع المستثمرين (إدارة)
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('id, username, phone, balance, kyc_verified, is_blocked, created_at, referrer_code').order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, users: data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// جميع اشتراكات الباقات (إدارة)
app.get('/api/admin/packages', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('user_packages').select('*, users(username)').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const packages = (data || []).map(function(p) { p.username = p.users ? p.users.username : null; delete p.users; return p; });
    res.json({ success: true, packages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// توثيق KYC (إدارة)
app.post('/api/admin/users/verify-kyc', authenticateAdmin, async (req, res) => {
  const { userId } = req.body;
  try {
    const { error } = await supabase.from('users').update({ kyc_verified: true }).eq('id', userId);
    if (error) throw error;
    await supabase.from('notifications').insert({
      user_id: userId, title: 'تم توثيق هويتك', message: 'تمت الموافقة على وثيقة KYC الخاصة بك',
      read: false, created_at: new Date().toISOString()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// حظر/فك حظر مستثمر (مدير رئيسي فقط)
app.post('/api/admin/users/toggle-block', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  const { userId } = req.body;
  try {
    const { data: user } = await supabase.from('users').select('is_blocked').eq('id', userId).maybeSingle();
    if (!user) throw new Error('المستثمر غير موجود');
    const { error } = await supabase.from('users').update({ is_blocked: !user.is_blocked }).eq('id', userId);
    if (error) throw error;
    res.json({ success: true, is_blocked: !user.is_blocked });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// تعديل رصيد مستثمر (مدير رئيسي فقط)
app.post('/api/admin/users/adjust-balance', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  const { userId, amount, action } = req.body;
  try {
    const { data: user } = await supabase.from('users').select('balance').eq('id', userId).maybeSingle();
    if (!user) throw new Error('المستثمر غير موجود');
    let newBalance = parseFloat(user.balance || 0);
    if (action === 'add') newBalance += parseFloat(amount);
    else if (action === 'subtract') newBalance -= parseFloat(amount);
    else newBalance = parseFloat(amount);
    const { error } = await supabase.from('users').update({ balance: newBalance }).eq('id', userId);
    if (error) throw error;
    res.json({ success: true, balance: newBalance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// إشعار جماعي (إدارة)
app.post('/api/admin/broadcast', authenticateAdmin, async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ success: false, error: 'العنوان والرسالة مطلوبان' });
  }
  try {
    const { data: users } = await supabase.from('users').select('id');
    if (!users || users.length === 0) {
      return res.json({ success: true, sent: 0 });
    }
    const inserts = users.map(function(u) {
      return { user_id: u.id, title: title, message: message, read: false, created_at: new Date().toISOString() };
    });
    const { error } = await supabase.from('notifications').insert(inserts);
    if (error) throw error;
    res.json({ success: true, sent: users.length });
  } catch (err) {
    console.error('❌ خطأ في الإشعار الجماعي:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// حذف مستثمر (مدير رئيسي فقط)
app.delete('/api/admin/users/:userId', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  const { userId } = req.params;
  try {
    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 9. تشغيل الخادم (Start Server)
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 خادم مَكْسَب الاستثمارية يعمل على المنفذ ${PORT}`);
  console.log(`📦 إصدار التطبيق: ${APP_VERSION}`);
  console.log(`🔐 بوابة الإدارة: /secure-portal-exec-9921x`);
  console.log(`👤 واجهة المستثمر: /app`);
  console.log(`🌐 الرابط المحلي: http://localhost:${PORT}\n`);
});
