import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import axios from 'axios';

dotenv.config();

// ==========================================
// إعداد عميل Supabase (مدموج مباشرة في server.js)
// ==========================================
// استيراد مكتبة ws لتوفير نقل WebSocket لـ realtime على Node.js < 22
// (Node 20 لا يدعم WebSocket أصلياً، ومكتبة supabase-js الحديثة تُهيّئ realtime تلقائياً)

// متغيرات Supabase من ملف .env
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('متغيرات Supabase المطلوبة مفقودة: SUPABASE_URL وSUPABASE_ANON_KEY وSUPABASE_SERVICE_ROLE_KEY.');
}

// إنشاء عميل Supabase
// نمرر ws كنقل (transport) لقناة realtime حتى يعمل العميل على Node.js 20 دون خطأ.
// نُعطّل أيضاً جلسة المصادقة التلقائية لأننا نستخدم JWT خاص بنا.
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    realtime: {
      transport: WebSocket
    }
  }
);
const settingsSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: WebSocket }
});

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin غير مسموح به'));
  },
  credentials: false
}));
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: '8mb' }));

// ==========================================
// إصدار التطبيق — يتغير تلقائياً مع كل Deploy على Railway
// عند ضبط APP_VERSION في متغيرات البيئة يُستخدم، وإلا يُولّد تلقائياً عبر Date.now()
// هذا الإصدار يُضاف كـ ?v= إلى رابط Service Worker لإجبار المتصفح على اكتشاف التحديث
// ==========================================
const APP_VERSION = (process.env.APP_VERSION && process.env.APP_VERSION.trim() !== '')
  ? process.env.APP_VERSION.trim()
  : String(Date.now());

// المتغيرات السرية المأخوذة من ملف .env ونظام الصلاحيات الثنائي
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MODERATOR_PASSWORD = process.env.MODERATOR_PASSWORD;
const EXECUTIVE_DIRECTOR = 'محمود صبحي'; // المدير التنفيذي للمشروع
const JWT_SECRET = process.env.JWT_SECRET;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_NAME = process.env.TELEGRAM_BOT_NAME || 'MaksabBot';
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// مفاتيح OneSignal الإشعارات
const ONE_SIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONE_SIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

// 🟢 كود آمن يمنع انهيار الخادم
const requiredSecrets = ['JWT_SECRET', 'ADMIN_PASSWORD', 'MODERATOR_PASSWORD', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingSecrets = requiredSecrets.filter(name => !process.env[name]);

if (missingSecrets.length) {
  console.log('⚠️ متغيرات غير معرفة:', missingSecrets.join(', '));
} else {
  console.log('✅ تم التحقق من المتغيرات بنجاح');
}
// ذاكرة مؤقتة لحالة الباقات
let packageStatusMemory = {
  'الباقة الفضية الشهرية': true,
  'الباقة الذهبية الشهرية': true,
  'الباقة الماسية الشهرية': true,
  'الباقة السنوية الفضية': true,
  'الباقة السنوية الذهبية': true,
  'الباقة السنوية الماسية VIP': true
};

// ذاكرة مؤقتة لأسعار وعوائد الباقات (قابلة للتعديل من لوحة الإدارة)
let packagePricingMemory = {
  'الباقة الفضية الشهرية': { price: 100000, payout: 120000, months: 1 },
  'الباقة الذهبية الشهرية': { price: 250000, payout: 300000, months: 1 },
  'الباقة الماسية الشهرية': { price: 500000, payout: 600000, months: 1 },
  'الباقة السنوية الفضية': { price: 1000000, payout: 1600000, months: 12 },
  'الباقة السنوية الذهبية': { price: 2500000, payout: 4200000, months: 12 },
  'الباقة السنوية الماسية VIP': { price: 5000000, payout: 9000000, months: 12 }
};

// ذاكرة مؤقتة للشريط الإعلاني للمستثمرين
let announcementMemory = {
  active: true,
  text: '🔥 أهلاً بكم في منصة مَكْسَب الاستثمارية. تم إطلاق باقات استثمارية جديدة كلياً وتفعيل السحب الفوري، استثمر الآن وضاعف أرباحك!'
};

// إعدادات دائمة في Supabase. يحتاج المشروع إلى جدول app_settings (راجع ملف الترحيل المرفق).
const SETTINGS_KEYS = {
  pricing: 'package_pricing',
  packageStatus: 'package_status',
  announcement: 'announcement'
};
let persistentSettingsLoaded = false;
let persistentSettingsLoadPromise = null;

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, ch => String(ch.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, ch => String(ch.charCodeAt(0) - 0x06F0));
}

async function loadPersistentSettings() {
  if (persistentSettingsLoaded) return;
  if (persistentSettingsLoadPromise) return persistentSettingsLoadPromise;
  persistentSettingsLoadPromise = (async () => {
    const { data, error } = await settingsSupabase.from('app_settings').select('key, value').in('key', Object.values(SETTINGS_KEYS));
    if (error) throw new Error(`تعذر تحميل إعدادات المنصة من Supabase: ${error.message}`);
    for (const row of (data || [])) {
      if (row.key === SETTINGS_KEYS.pricing && row.value && typeof row.value === 'object') packagePricingMemory = { ...packagePricingMemory, ...row.value };
      if (row.key === SETTINGS_KEYS.packageStatus && row.value && typeof row.value === 'object') packageStatusMemory = { ...packageStatusMemory, ...row.value };
      if (row.key === SETTINGS_KEYS.announcement && row.value && typeof row.value === 'object') announcementMemory = { ...announcementMemory, ...row.value };
    }
    persistentSettingsLoaded = true;
  })();
  try { await persistentSettingsLoadPromise; } finally { persistentSettingsLoadPromise = null; }
}

async function savePersistentSetting(key, value) {
  const { error } = await settingsSupabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(`تعذر حفظ الإعداد في Supabase: ${error.message}`);
  persistentSettingsLoaded = true;
}

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
// الصفحة الرئيسية — صفحة هبوط تسويقية
// ==========================================
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>مَكْسَب الاستثمارية | منصة الاستثمار الذكية</title>
      <meta name="description" content="مَكْسَب الاستثمارية — منصة استثمار عراقية توفر باقات استثمارية شهرية وسنوية بعوائد مضمونة. ابدأ رحلة استثمارك اليوم.">
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Cairo', sans-serif; background: #0a0e1a; color: #e2e8f0; overflow-x: hidden; }
        :root {
          --accent-gold: #d4af37;
          --accent-gold-light: #e8c860;
          --success: #10b981;
          --bg-dark: #0a0e1a;
          --bg-card: #111827;
          --border: #1e293b;
        }
        a { text-decoration: none; }
        .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }

        /* Navbar */
        nav { position: fixed; top: 0; right: 0; left: 0; z-index: 100; background: rgba(10, 14, 26, 0.95); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); padding: 15px 0; }
        .nav-inner { display: flex; justify-content: space-between; align-items: center; }
        .logo { font-size: 22px; font-weight: 900; color: var(--accent-gold); display: flex; align-items: center; gap: 8px; }
        .logo i { font-size: 26px; }
        .nav-links { display: flex; gap: 25px; align-items: center; }
        .nav-links a { color: #94a3b8; font-size: 14px; font-weight: 600; transition: color 0.3s; }
        .nav-links a:hover { color: var(--accent-gold); }
        .nav-cta { background: linear-gradient(135deg, var(--accent-gold) 0%, var(--accent-gold-light) 100%); color: #0a0e1a !important; padding: 10px 25px; border-radius: 30px; font-weight: 700; transition: transform 0.3s; }
        .nav-cta:hover { transform: scale(1.05); color: #0a0e1a !important; }

        /* Hero */
        .hero { min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; position: relative; padding: 100px 20px 60px; }
        .hero-bg { position: absolute; top: 0; right: 0; left: 0; bottom: 0; background: radial-gradient(ellipse at 50% 0%, rgba(212, 175, 55, 0.12) 0%, transparent 60%); pointer-events: none; }
        .hero-content { position: relative; z-index: 2; max-width: 800px; }
        .hero-badge { display: inline-block; background: rgba(212, 175, 55, 0.1); border: 1px solid rgba(212, 175, 55, 0.3); color: var(--accent-gold); padding: 8px 20px; border-radius: 30px; font-size: 13px; font-weight: 600; margin-bottom: 25px; }
        .hero h1 { font-size: 52px; font-weight: 900; line-height: 1.3; margin-bottom: 20px; background: linear-gradient(135deg, #fff 0%, var(--accent-gold) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .hero p { font-size: 18px; color: #94a3b8; line-height: 1.8; margin-bottom: 35px; }
        .hero-buttons { display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; }
        .btn-primary { background: linear-gradient(135deg, var(--accent-gold) 0%, var(--accent-gold-light) 100%); color: #0a0e1a; padding: 16px 40px; border-radius: 30px; font-weight: 700; font-size: 16px; transition: transform 0.3s, box-shadow 0.3s; display: inline-flex; align-items: center; gap: 10px; }
        .btn-primary:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(212, 175, 55, 0.3); }
        .btn-secondary { background: transparent; color: #e2e8f0; border: 2px solid var(--border); padding: 16px 40px; border-radius: 30px; font-weight: 700; font-size: 16px; transition: border-color 0.3s; display: inline-flex; align-items: center; gap: 10px; }
        .btn-secondary:hover { border-color: var(--accent-gold); }

        /* Stats Bar */
        .stats-bar { background: var(--bg-card); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 40px 0; }
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 30px; text-align: center; }
        .stat-item .num { font-size: 36px; font-weight: 900; color: var(--accent-gold); }
        .stat-item .label { font-size: 13px; color: #94a3b8; margin-top: 5px; }

        /* Section */
        .section { padding: 80px 0; }
        .section-header { text-align: center; margin-bottom: 50px; }
        .section-header h2 { font-size: 36px; font-weight: 900; margin-bottom: 15px; }
        .section-header h2 span { color: var(--accent-gold); }
        .section-header p { font-size: 16px; color: #94a3b8; max-width: 600px; margin: 0 auto; }

        /* Packages */
        .packages-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px; }
        .pkg-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; padding: 35px 30px; text-align: center; transition: transform 0.3s, border-color 0.3s; position: relative; }
        .pkg-card:hover { transform: translateY(-8px); border-color: var(--accent-gold); }
        .pkg-card.featured { border-color: var(--accent-gold); background: linear-gradient(180deg, rgba(212, 175, 55, 0.05) 0%, var(--bg-card) 100%); }
        .pkg-card .ribbon { position: absolute; top: -12px; right: 50%; transform: translateX(50%); background: linear-gradient(135deg, var(--accent-gold) 0%, var(--accent-gold-light) 100%); color: #0a0e1a; padding: 5px 20px; border-radius: 20px; font-size: 12px; font-weight: 700; }
        .pkg-icon { font-size: 40px; margin-bottom: 15px; }
        .pkg-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
        .pkg-price { font-size: 32px; font-weight: 900; color: var(--accent-gold); margin: 15px 0; }
        .pkg-price small { font-size: 14px; font-weight: 400; color: #94a3b8; }
        .pkg-return { background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--success); padding: 12px; border-radius: 12px; font-weight: 600; margin: 15px 0; }
        .pkg-card .btn-primary { width: 100%; justify-content: center; padding: 12px; font-size: 14px; }

        /* How it works */
        .steps-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
        .step-card { text-align: center; padding: 30px 20px; }
        .step-num { width: 60px; height: 60px; background: linear-gradient(135deg, var(--accent-gold) 0%, var(--accent-gold-light) 100%); color: #0a0e1a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 900; margin: 0 auto 20px; }
        .step-card h4 { font-size: 16px; font-weight: 700; margin-bottom: 10px; }
        .step-card p { font-size: 13px; color: #94a3b8; line-height: 1.7; }

        /* Features */
        .features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px; }
        .feature-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 30px; transition: border-color 0.3s; }
        .feature-card:hover { border-color: rgba(212, 175, 55, 0.5); }
        .feature-icon { width: 50px; height: 50px; background: rgba(212, 175, 55, 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: var(--accent-gold); font-size: 22px; margin-bottom: 18px; }
        .feature-card h4 { font-size: 17px; font-weight: 700; margin-bottom: 10px; }
        .feature-card p { font-size: 14px; color: #94a3b8; line-height: 1.7; }

        /* CTA */
        .cta-section { padding: 80px 0; text-align: center; background: linear-gradient(135deg, rgba(212, 175, 55, 0.08) 0%, transparent 100%); }
        .cta-section h2 { font-size: 36px; font-weight: 900; margin-bottom: 20px; }
        .cta-section p { font-size: 17px; color: #94a3b8; margin-bottom: 35px; }

        /* Footer */
        footer { background: #060912; border-top: 1px solid var(--border); padding: 50px 0 30px; }
        .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 40px; margin-bottom: 30px; }
        .footer-col h4 { font-size: 16px; font-weight: 700; margin-bottom: 15px; color: var(--accent-gold); }
        .footer-col p, .footer-col a { font-size: 14px; color: #94a3b8; line-height: 2; display: block; }
        .footer-col a:hover { color: var(--accent-gold); }
        .footer-bottom { text-align: center; padding-top: 25px; border-top: 1px solid var(--border); font-size: 13px; color: #64748b; }

        @media (max-width: 768px) {
          .hero h1 { font-size: 32px; }
          .hero p { font-size: 15px; }
          .nav-links a:not(.nav-cta) { display: none; }
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .packages-grid { grid-template-columns: 1fr; }
          .steps-grid { grid-template-columns: repeat(2, 1fr); }
          .features-grid { grid-template-columns: 1fr; }
          .footer-grid { grid-template-columns: 1fr; }
          .section-header h2 { font-size: 26px; }
        }
      </style>
    </head>
    <body>

      <!-- Navbar -->
      <nav>
        <div class="container nav-inner">
          <a href="/" class="logo"><i class="fa-solid fa-chart-line"></i> مَكْسَب</a>
          <div class="nav-links">
            <a href="#packages">الباقات</a>
            <a href="#how">كيف تعمل</a>
            <a href="#features">المزايا</a>
            <a href="/app" class="nav-cta">دخول المستثمر</a>
          </div>
        </div>
      </nav>

      <!-- Hero -->
      <section class="hero">
        <div class="hero-bg"></div>
        <div class="hero-content">
          <span class="hero-badge"><i class="fa-solid fa-shield-halved"></i> منصة استثمار عراقية موثوقة</span>
          <h1>استثمر بذكاء<br>اكسب بثقة</h1>
          <p>مَكْسَب الاستثمارية تقدم باقات استثمارية شهرية وسنوية بعوائد مضمونة، مع نظام إشعارات فوري وتحكم كامل في أموالك عبر منصة آمنة وسهلة الاستخدام.</p>
          <div class="hero-buttons">
            <a href="/app" class="btn-primary"><i class="fa-solid fa-rocket"></i> ابدأ الاستثمار الآن</a>
            <a href="#packages" class="btn-secondary"><i class="fa-solid fa-eye"></i> استعرض الباقات</a>
          </div>
        </div>
      </section>

      <!-- Stats -->
      <section class="stats-bar">
        <div class="container">
          <div class="stats-grid">
            <div class="stat-item">
              <div class="num">6</div>
              <div class="label">باقات استثمارية</div>
            </div>
            <div class="stat-item">
              <div class="num">2%</div>
              <div class="label">عمولة إحالة</div>
            </div>
            <div class="stat-item">
              <div class="num">24/7</div>
              <div class="label">إشعارات فورية</div>
            </div>
            <div class="stat-item">
              <div class="num">100%</div>
              <div class="label">الشفافية والأمان</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Packages -->
      <section class="section" id="packages">
        <div class="container">
          <div class="section-header">
            <h2>باقاتنا <span>الاستثمارية</span></h2>
            <p>اختر الباقة التي تناسب أهدافك المالية — باقات شهرية سريعة العائد وباقات سنوية بعوائد أعلى</p>
          </div>
          <div class="packages-grid">
            <div class="pkg-card" data-package="الباقة الفضية الشهرية">
              <div class="pkg-icon">الباقة الفضية الشهرية</div>
              <h3>الباقة الفضية</h3>
              <div class="pkg-price">100,000 <small>د.ع</small></div>
              <div class="pkg-return">عائد شهري: 120,000 د.ع</div>
              <a href="/app" class="btn-primary">اشترك الآن</a>
            </div>
            <div class="pkg-card featured" data-package="الباقة الذهبية الشهرية">
              <div class="ribbon">الأكثر شعبية</div>
              <div class="pkg-icon">الباقة الذهبية الشهرية</div>
              <h3>الباقة الذهبية</h3>
              <div class="pkg-price">250,000 <small>د.ع</small></div>
              <div class="pkg-return">عائد شهري: 300,000 د.ع</div>
              <a href="/app" class="btn-primary">اشترك الآن</a>
            </div>
            <div class="pkg-card" data-package="الباقة الماسية الشهرية">
              <div class="pkg-icon">الباقة الماسية الشهرية</div>
              <h3>الباقة الماسية</h3>
              <div class="pkg-price">500,000 <small>د.ع</small></div>
              <div class="pkg-return">عائد شهري: 600,000 د.ع</div>
              <a href="/app" class="btn-primary">اشترك الآن</a>
            </div>
            <div class="pkg-card" data-package="الباقة السنوية الفضية">
              <div class="pkg-icon">الباقة السنوية الفضية</div>
              <h3>الباقة السنوية الفضية</h3>
              <div class="pkg-price">1,000,000 <small>د.ع</small></div>
              <div class="pkg-return">عائد سنوي: 1,600,000 د.ع</div>
              <a href="/app" class="btn-primary">اشترك الآن</a>
            </div>
            <div class="pkg-card" data-package="الباقة السنوية الذهبية">
              <div class="pkg-icon">الباقة السنوية الذهبية</div>
              <h3>الباقة السنوية الذهبية</h3>
              <div class="pkg-price">2,500,000 <small>د.ع</small></div>
              <div class="pkg-return">عائد سنوي: 4,200,000 د.ع</div>
              <a href="/app" class="btn-primary">اشترك الآن</a>
            </div>
            <div class="pkg-card featured" data-package="الباقة السنوية الماسية VIP">
              <div class="ribbon">VIP</div>
              <div class="pkg-icon">الباقة السنوية الماسية VIP</div>
              <h3>الباقة الماسية VIP</h3>
              <div class="pkg-price">5,000,000 <small>د.ع</small></div>
              <div class="pkg-return">عائد سنوي: 9,000,000 د.ع</div>
              <a href="/app" class="btn-primary">اشترك الآن</a>
            </div>
          </div>
        </div>
      </section>

      <!-- How it works -->
      <section class="section" id="how" style="background: #0d1220;">
        <div class="container">
          <div class="section-header">
            <h2>كيف <span>تعمل</span> المنصة؟</h2>
            <p>أربع خطوات بسيطة تفصلك عن بداية رحلة استثمارك</p>
          </div>
          <div class="steps-grid">
            <div class="step-card">
              <div class="step-num">1</div>
              <h4>إنشاء حساب</h4>
              <p>سجل في المنصة برقم هاتفك وكلمة مرور خاصة بك في أقل من دقيقة.</p>
            </div>
            <div class="step-card">
              <div class="step-num">2</div>
              <h4>شحن الرصيد</h4>
              <p>استانف رصيدك بعملية تحويل بسيطة مع إرفاق إشعار الدفع.</p>
            </div>
            <div class="step-card">
              <div class="step-num">3</div>
              <h4>اختيار باقة</h4>
              <p>اختر الباقة المناسبة لك من بين باقاتنا الشهرية والسنوية وابدأ الاستثمار.</p>
            </div>
            <div class="step-card">
              <div class="step-num">4</div>
              <h4>استلام العائد</h4>
              <p>عند اكتمال مدة الباقة، تتم إداع أرباحك مباشرة إلى رصيدك مع إشعار فوري.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Features -->
      <section class="section" id="features">
        <div class="container">
          <div class="section-header">
            <h2>لماذا <span>مَكْسَب</span>؟</h2>
            <p>مزايا تجعل استثمارك آمنا ومريحا</p>
          </div>
          <div class="features-grid">
            <div class="feature-card">
              <div class="feature-icon"><i class="fa-solid fa-shield-halved"></i></div>
              <h4>أمان وحماية</h4>
              <p>نظام حماية متعدد الطبقات مع تشفير كامل للبيانات وتوثيق الهوية (KYC) لضمان أمان حسابك.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon"><i class="fa-solid fa-bell"></i></div>
              <h4>إشعارات فورية</h4>
              <p>تلقي تنبيهات فورية عبر تلجرام وتطبيق الموقع عن كل عملية في حسابك مباشرة.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon"><i class="fa-solid fa-share-nodes"></i></div>
              <h4>نظام الإحالات</h4>
              <p>احصل على عمولة 2% من أول شحن لكل مستثمر يسجل عبر رابطك الخاص.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon"><i class="fa-solid fa-chart-line"></i></div>
              <h4>متابعة مستمرة</h4>
              <p>شاهد تقدم باقاتك بالزمن مع عداد تنازلي ونسبة اكتمال لكل باقة نشطة.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon"><i class="fa-solid fa-mobile-screen"></i></div>
              <h4>تطبيق محمول (PWA)</h4>
              <p>ثبت المنصة على هاتفك للوصول السريع وتجربة أصلية بدون متصفح مع تحديثات تلقائية.</p>
            </div>
            <div class="feature-card">
              <div class="feature-icon"><i class="fa-solid fa-clock"></i></div>
              <h4>إشعار قبل الاكتمال</h4>
              <p>نظام ذكي ينبهك قبل 24 ساعة من اكتمال مدة باقتك لتكون على اطلاع دائم.</p>
            </div>
          </div>
        </div>
      </section>

      <!-- CTA -->
      <section class="cta-section">
        <div class="container">
          <h2>جاهز لبدء رحلتك؟</h2>
          <p>انضم إلى مَكْسَب الاستثمارية اليوم وابدأ في تحقيق أهدافك المالية</p>
          <a href="/app" class="btn-primary"><i class="fa-solid fa-rocket"></i> دخول منصة المستثمر</a>
        </div>
      </section>

      <!-- Footer -->
      <footer>
        <div class="container">
          <div class="footer-grid">
            <div class="footer-col">
              <h4>مَكْسَب الاستثمارية</h4>
              <p>منصة استثمار عراقية توفر باقات استثمارية بعوائد مضمونة، مع نظام أمن متطور وإشعارات فورية.</p>
            </div>
            <div class="footer-col">
              <h4>روابط سريعة</h4>
              <a href="/app">دخول المستثمر</a>
              <a href="/#packages">الباقات</a>
              <a href="/#how">كيف تعمل</a>
              <a href="/#features">المزايا</a>
            </div>
            <div class="footer-col">
              <h4>الدعم</h4>
              <a href="/app">تفعيل إشعارات تلجرام</a>
              <a href="/app">رفع وثيقة الهوية</a>
              <a href="/app">شبكة الإحالات</a>
            </div>
          </div>
          <div class="footer-bottom">
            &copy; 2026 مَكْسَب الاستثمارية — جميع الحقوق محفوظة
          </div>
        </div>
      </footer>

      <script>
        (async function refreshPublicPackagePricing() {
          try {
            const response = await fetch('/api/packages/pricing?ts=' + Date.now(), { cache: 'no-store' });
            const result = await response.json();
            if (!result.success || !result.data) return;
            document.querySelectorAll('[data-package]').forEach(function(card) {
              const packageName = card.getAttribute('data-package');
              const packageData = result.data[packageName];
              if (!packageData) return;
              const price = Number(packageData.price);
              const payout = Number(packageData.payout);
              const priceEl = card.querySelector('.pkg-price');
              const returnEl = card.querySelector('.pkg-return');
              const period = Number(packageData.months) === 12 ? 'سنوي' : 'شهري';
              if (priceEl && Number.isFinite(price)) priceEl.innerHTML = price.toLocaleString() + ' <small>د.ع</small>';
              if (returnEl && Number.isFinite(payout)) returnEl.textContent = 'عائد ' + period + ': ' + payout.toLocaleString() + ' د.ع';
            });
          } catch (error) {
            console.error('تعذر تحميل أسعار الباقات المحدثة:', error);
          }
        })();
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// مسارات PWA (تطبيق الويب التقدمي)
// ==========================================
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
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(`
    const CACHE_VERSION = '${APP_VERSION}';
    const CACHE_NAME = 'maksab-cache-v' + CACHE_VERSION;

    // تثبيت: ننشئ كاش جديد بإصدار جديد ونستدعي skipWaiting ليصبح نشطاً فوراً
    self.addEventListener('install', function(event) {
      event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
          return cache.addAll(['/app']).catch(function() {});
        }).then(function() {
          return self.skipWaiting();
        })
      );
    });

    // تفعيل: نحذف كل الكاشات القديمة ونستدعي clients.claim للسيطرة الفورية
    self.addEventListener('activate', function(event) {
      event.waitUntil(
        caches.keys().then(function(cacheNames) {
          return Promise.all(
            cacheNames.filter(function(name) {
              return name !== CACHE_NAME;
            }).map(function(name) {
              return caches.delete(name);
            })
          );
        }).then(function() {
          return self.clients.claim();
        }).then(function() {
          // إعلام كل الصفحات بأن Service Worker تم تحديثه
          return self.clients.matchAll({ type: 'window' });
        }).then(function(clients) {
          clients.forEach(function(client) {
            client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
          });
        })
      );
    });

    // جلب: Network-First للروابط الداخلية، Cache-First للخارجية
    self.addEventListener('fetch', function(event) {
      var url = new URL(event.request.url);
      if (url.origin === self.location.origin) {
        // طلبات داخلية — نحاول الشبكة أولاً ثم الكاش
        event.respondWith(
          fetch(event.request).then(function(response) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone).catch(function() {});
            });
            return response;
          }).catch(function() {
            return caches.match(event.request).then(function(r) {
              return r || new Response('Offline', { status: 503 });
            });
          })
        );
      } else {
        // طلبات خارجية (Font Awesome, أيقونات) — الكاش أولاً
        event.respondWith(
          caches.match(event.request).then(function(r) {
            return r || fetch(event.request).then(function(response) {
              var clone = response.clone();
              caches.open(CACHE_NAME).then(function(cache) {
                cache.put(event.request, clone).catch(function() {});
              });
              return response;
            });
          })
        );
      }
    });
  `);
});

// ==========================================
// مسار إصدار التطبيق
// ==========================================
app.get('/api/app-version', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
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
// ==========================================
// دالة الرفع الآمن المباشر إلى Supabase Storage
// ==========================================
async function uploadToStorage(base64Data, folderName = 'receipts') {
  // إذا كانت البيانات رابطاً جاهزاً وليست Base64، يتم إرجاعها كما هي
  if (!base64Data || !base64Data.startsWith('data:image')) return base64Data;

  // التحقق من الحجم (أقل من 6 ميجابايت)
  if (typeof base64Data !== 'string' || base64Data.length > 8 * 1024 * 1024) {
    throw new Error('حجم الصورة يتجاوز الحد المسموح (6MB).');
  }

  // فحص نوع الصورة وتفكيك صيغتها
  const matches = base64Data.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!matches) {
    throw new Error('نوع الصورة غير مسموح. استخدم PNG أو JPEG أو WebP.');
  }

  const mimeType = matches[1];
  const ext = matches[2] === 'jpeg' ? 'jpg' : matches[2];
  const base64Content = matches[3];

  // تحويل Base64 إلى Buffer متوافق مع خادم Node.js
  const fileBuffer = Buffer.from(base64Content, 'base64');

  // توليد اسم ملف فريد ومعزول لمنع التداخل والتعارض
  const fileName = `${folderName}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
  const bucketName = 'maksab-uploads';

  try {
    // الرفع باستخدام عميل settingsSupabase المحمي بـ Service Role Key
    const { data, error } = await settingsSupabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: mimeType,
        upsert: false
      });

    if (error) {
      throw new Error(`خطأ Supabase Storage: ${error.message}`);
    }

    // جلب الرابط العام المباشر للملف المرفوع
    const { data: publicUrlData } = settingsSupabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    if (!publicUrlData || !publicUrlData.publicUrl) {
      throw new Error('تعذر جلب رابط الملف المرفوع.');
    }

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('❌ خطأ أثناء رفع الملف إلى Supabase Storage:', err.message);
    throw new Error(`فشل رفع الصورة للتخزين: ${err.message}`);
  }
}

// ==========================================
// برمجيات التوثيق والحماية والتحقق من الصلاحيات
// ==========================================
// أدوات حماية عامة: تحديد المعدل، تنظيف Telegram، والتحقق من الأرقام.
const rateBuckets = new Map();
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) return res.status(429).json({ success: false, error: 'طلبات كثيرة، يرجى المحاولة لاحقاً.' });
    next();
  };
}
function positiveAmount(value, max = Number.MAX_SAFE_INTEGER) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= max ? amount : null;
}
function escapeTelegram(value) {
  return String(value ?? '').replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

const authenticateUser = (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ success: false, error: 'غير مصرح: يرجى تسجيل الدخول' });

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err || !user?.id) return res.status(403).json({ success: false, error: 'جلسة انتهت صلاحيتها، أعد الدخول' });
    const { data: currentUser, error } = await supabase.from('users').select('id, phone_number, is_blocked').eq('id', user.id).single();
    if (error || !currentUser) return res.status(401).json({ success: false, error: 'الحساب غير موجود.' });
    if (currentUser.is_blocked) return res.status(403).json({ success: false, error: 'تم تجميد حسابك بقرار إداري.' });
    req.user = { ...user, id: currentUser.id, phone: currentUser.phone_number };
    next();
  });
};

const authenticateAdmin = (req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
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

  const secureAdminUser = process.env.SECURE_ADMIN_USER;
  const secureAdminPass = process.env.SECURE_ADMIN_PASS;
  if (!secureAdminUser || !secureAdminPass) return res.status(503).send('Executive portal is not configured.');

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
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
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
      <style>
        :root { --bg-color: #0f172a; --card-bg: #1e293b; --accent-gold: #d4af37; --text-main: #f8fafc; --text-muted: #94a3b8; --success-green: #10b981; --danger-red: #ef4444; }
        * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; transition: all 0.3s ease; }
        body { background: var(--bg-color); color: var(--text-main); margin: 0; padding: 20px; min-height: 100vh; }
        .container { max-width: 900px; margin: 0 auto; }
        
        /* الشريط الإعلاني المتحرك للمستثمرين */
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
        
        <!-- الشريط الإعلاني المتحرك -->
        <div id="announcement-banner-container" class="announcement-ticker" style="display:none;">
          <div class="announcement-icon"><i class="fa-solid fa-bullhorn"></i></div>
          <div class="announcement-text-wrapper">
            <span class="announcement-text" id="announcement-banner-text"></span>
          </div>
        </div>

        <!-- شاشة الدخول -->
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

        <!-- اللوحة الرئيسية -->
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

          <!-- نافذة الإشعارات المركزية الجذابة -->
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
            <div style="margin-top:12px; padding:10px 14px; background:rgba(212,175,55,0.1); border:1px solid rgba(212,175,55,0.3); border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
              <div style="font-size:13px; color:var(--text-muted);"><i class="fa-solid fa-chart-line"></i> إجمالي الأرباح المحققة منذ بداية الحساب</div>
              <div id="total-realized-profit" style="font-size:18px; font-weight:bold; color:var(--accent-gold);">0</div>
            </div>
          </div>

          <div class="tab-bar">
            <button class="tab-btn active" onclick="switchTab('tab-packages', event)">💎 الباقات الاستثمارية</button>
            <button class="tab-btn" onclick="switchTab('tab-finance', event)">الأموال والعمليات</button>
            <button class="tab-btn" onclick="switchTab('tab-account', event)">التوثيق والدعوات</button>
          </div>

          <!-- تبويب 0: الباقات الاستثمارية -->
          <div id="tab-packages" class="tab-content active">
            <div class="section-card">
              <h3 style="color:var(--accent-gold); text-align:center;"><i class="fa-solid fa-box-open"></i> اختر خطتك الاستثمارية المناسبة</h3>
              
              <div class="pkg-toggle-bar">
                <button class="pkg-toggle-btn active" id="btn-show-monthly" onclick="togglePackageView('monthly')">📅 باقات شهرية (30 يوماً)</button>
                <button class="pkg-toggle-btn" id="btn-show-annual" onclick="togglePackageView('annual')">📆 باقات سنوية (12 شهراً)</button>
              </div>

              <!-- الباقات الشهرية -->
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

              <!-- الباقات السنوية -->
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

              <!-- نافذة الاشتراك المباشر -->
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

          <!-- تبويب 1: العمليات -->
          <div id="tab-finance" class="tab-content">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px;">
              <div class="section-card">
                <h3>شحن رصيد لشراء الباقات</h3>
                <input type="number" id="deposit-amount" placeholder="المبلغ بالدينار العراقي" min="100000" max="1000000" style="margin-bottom:5px;">
                <p style="font-size:11px; color:var(--text-muted); margin:0 0 10px 0;">📊 الحد الأدنى للشحن: <strong style="color:var(--accent-gold);">100,000 د.ع</strong> — الحد الأقصى: <strong style="color:var(--accent-gold);">1,000,000 د.ع</strong></p>
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
              <h3><i class="fa-solid fa-list-check"></i> السجل الموحد لجميع المعاملات</h3>
              <div style="margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap;">
                <select id="tx-filter" onchange="renderTxList()" style="flex:1; min-width:150px; padding:8px; background:#0f172a; border:1px solid var(--border-color); color:var(--text-light); border-radius:8px;">
                  <option value="all">جميع المعاملات</option>
                  <option value="deposit">الشحنات فقط</option>
                  <option value="withdrawal">السحوبات فقط</option>
                  <option value="package">الباقات الاستثمارية فقط</option>
                </select>
              </div>
              <div id="user-history"></div>
            </div>
          </div>

          <!-- تبويب 2: التوثيق وربط تلجرام -->
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

            <div class="section-card">
              <h3><i class="fa-solid fa-share-nodes"></i> شبكة الإحالات</h3>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:15px;">
                <div style="background:#0f172a; padding:15px; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
                  <div style="font-size:26px; font-weight:bold; color:var(--accent-gold);" id="ref-count">0</div>
                  <div style="font-size:12px; color:var(--text-muted);">عدد المستثمرين المحالين</div>
                </div>
                <div style="background:#0f172a; padding:15px; border-radius:12px; border:1px solid var(--border-color); text-align:center;">
                  <div style="font-size:26px; font-weight:bold; color:var(--success-green);" id="ref-commissions">0 د.ع</div>
                  <div style="font-size:12px; color:var(--text-muted);">إجمالي عمولات الإحالة (2%)</div>
                </div>
              </div>
              <div id="ref-network-list" style="max-height:300px; overflow-y:auto;"></div>
            </div>

            <div class="section-card" style="border:1px solid var(--accent-gold);">
              <h3><i class="fa-solid fa-mobile-screen"></i> تثبيت التطبيق على جهازك</h3>
              <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">ثبّت تطبيق مكسب الاستثمارية على هاتفك للوصول السريع وتجربة أصلية بدون متصفح.</p>
              <button id="pwa-install-btn" class="btn-gold" style="display:none; width:100%;"><i class="fa-solid fa-download"></i> تثبيت التطبيق الآن</button>
              <p id="pwa-install-status" style="font-size:12px; color:var(--text-muted); margin-top:8px; text-align:center;"></p>
            </div>
          </div>
        </div>
      </div>

      <script>
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js?v=${APP_VERSION}').then(function(reg) {
            // عند اكتشاف SW جديد — ننتظر تثبيته ثم نُحدّث الصفحة تلقائياً
            reg.addEventListener('updatefound', function() {
              var newWorker = reg.installing;
              newWorker.addEventListener('statechange', function() {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // SW جديد جاهز — يصبح نشطاً ثم يُحدّث الصفحة
                  location.reload();
                }
              });
            });
            // فحص دوري للتحديثات كل 5 دقائق
            setInterval(function() { reg.update(); }, 300000);
          }).catch(function(err) {
            console.log('SW registration failed: ', err);
          });
          // عند تغيير المتحكم (controllerchange) — يعني SW جديد أصبح نشطاً → تحديث الصفحة
          navigator.serviceWorker.addEventListener('controllerchange', function() {
            location.reload();
          });
        }

        // PWA Install Prompt — التقاط حدث beforeinstallprompt وعرض زر التثبيت
        var deferredInstallPrompt = null;
        window.addEventListener('beforeinstallprompt', function(e) {
          e.preventDefault();
          deferredInstallPrompt = e;
          var btn = document.getElementById('pwa-install-btn');
          var status = document.getElementById('pwa-install-status');
          if (btn) {
            btn.style.display = 'block';
            btn.onclick = function() {
              if (!deferredInstallPrompt) return;
              deferredInstallPrompt.prompt();
              deferredInstallPrompt.userChoice.then(function(choice) {
                if (choice.outcome === 'accepted') {
                  if (status) status.innerText = '✅ تم تثبيت التطبيق بنجاح!';
                } else {
                  if (status) status.innerText = 'تم رفض التثبيت. يمكنك المحاولة لاحقاً.';
                }
                deferredInstallPrompt = null;
                btn.style.display = 'none';
              });
            };
          }
          if (status) status.innerText = 'التطبيق متاح للتثبيت على هذا الجهاز';
        });
        window.addEventListener('appinstalled', function() {
          var btn = document.getElementById('pwa-install-btn');
          var status = document.getElementById('pwa-install-status');
          if (btn) btn.style.display = 'none';
          if (status) status.innerText = '✅ تم تثبيت التطبيق بنجاح!';
        });

        var isRegister = false;
        var authToken = localStorage.getItem('maksab_token') || null;
        var currentUser = JSON.parse(localStorage.getItem('maksab_user')) || null;
        var rawCapital = 0; var rawProfit = 0;
        var selectedPkg = null;

        function formatMoney(amount) {
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
            } else {
              msg.innerText = '❌ ' + data.error; msg.style.color = 'var(--danger-red)';
            }
          } catch(e) {
            msg.innerText = '❌ خطأ في الاتصال بالسيرفر'; msg.style.color = 'var(--danger-red)';
          }
        }

        async function fetchSystemSettings() {
          try {
            var res = await fetch('/api/packages/settings');
            var data = await res.json();
            if (data.success) {
              var settings = data.data || {};
              var packageNames = [
                'الباقة الفضية الشهرية', 'الباقة الذهبية الشهرية', 'الباقة الماسية الشهرية',
                'الباقة السنوية الفضية', 'الباقة السنوية الذهبية', 'الباقة السنوية الماسية VIP'
              ];

              packageNames.forEach(function(name) {
                var isPaused = settings[name] === false;
                var btn = document.getElementById('btn-sub-' + name);
                var card = document.getElementById('card-' + name);
                var badgeAlert = document.getElementById('badge-alert-' + name);

                if (btn && card && badgeAlert) {
                  if (isPaused) {
                    btn.disabled = true;
                    btn.innerText = '🚫 متوقفة مؤقتاً';
                    btn.style.background = '#475569';
                    btn.style.color = '#94a3b8';
                    btn.style.cursor = 'not-allowed';
                    card.style.opacity = '0.65';
                    card.style.borderColor = '#ef4444';
                    badgeAlert.innerHTML = '<div style="background:rgba(239, 68, 68, 0.15); border:1px solid #ef4444; color:#ef4444; padding:6px 10px; border-radius:8px; font-size:11px; font-weight:bold; margin-bottom:12px; text-align:center;"><i class="fa-solid fa-triangle-exclamation"></i> عذراً، الباقة متوقفة مؤقتاً من الإدارة</div>';
                  } else {
                    btn.disabled = false;
                    btn.innerText = 'اشترك الآن 🚀';
                    btn.style.background = '';
                    btn.style.color = '';
                    btn.style.cursor = 'pointer';
                    card.style.opacity = '1';
                    card.style.borderColor = '';
                    badgeAlert.innerHTML = '';
                  }
                }
              });
            }
          } catch(e) { console.error(e); }
        }

        async function fetchPackagePricing() {
          try {
            var res = await fetch('/api/packages/pricing');
            var data = await res.json();
            if (!data.success || !data.data) return;
            var pricing = data.data;
            var pkgNames = Object.keys(pricing);

            pkgNames.forEach(function(name) {
              var p = pricing[name];
              var card = document.getElementById('card-' + name);
              if (!card) return;

              var priceEl = card.querySelector('.package-price');
              var returnEl = card.querySelector('.package-return');
              var btn = document.getElementById('btn-sub-' + name);

              if (priceEl) priceEl.innerText = Number(p.price).toLocaleString() + ' \u062f.\u0639';
              if (returnEl) {
                var period = p.months === 12 ? '\u0633\u0646\u0629' : '\u0634\u0647\u0631';
                returnEl.innerText = '\u0627\u0644\u0639\u0627\u0626\u062f \u0628\u0639\u062f ' + period + ': ' + Number(p.payout).toLocaleString() + ' \u062f.\u0639';
              }
              if (btn) {
                btn.setAttribute('onclick', "openPackageModal('" + name + "', " + p.price + ", " + p.payout + ", " + p.months + ")");
              }
            });
          } catch(e) { console.error('pricing fetch error', e); }
        }

        async function fetchAnnouncementBanner() {
          try {
            var res = await fetch('/api/announcement');
            var data = await res.json();
            if (data.success && data.data && data.data.active) {
              var banner = document.getElementById('announcement-banner-container');
              var bannerText = document.getElementById('announcement-banner-text');
              if (banner && bannerText) {
                bannerText.innerText = data.data.text;
                banner.style.display = 'flex';
              }
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

          loadUserData();
          loadUserPackages();
          loadUserNotifications();
          loadReferralNetwork();
          fetchSystemSettings();
          fetchPackagePricing();
          fetchAnnouncementBanner();
          setInterval(fetchSystemSettings, 10000);
          setInterval(fetchPackagePricing, 15000);
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

        var allUserTransactions = [];

        async function loadUserData() {
          var dataDep = await fetchWithAuth('/api/user/deposits');
          var dataWith = await fetchWithAuth('/api/user/withdrawals');

          var capital = 0; var profit = 0;
          var deposits = (dataDep.data || []).map(function(d) { d.cat = 'شحن رصيد'; return d; });
          var withdrawals = (dataWith.data || []).map(function(w) { w.cat = 'سحب مالي'; return w; });
          var allTx = deposits.concat(withdrawals).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

          allTx.forEach(function(t) {
            if (t.status === 'approved') {
              if (t.cat === 'شحن رصيد') {
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

          // تحميل السجل الموحد + إجمالي الأرباح المحققة
          try {
            var txData = await fetchWithAuth('/api/user/transactions');
            allUserTransactions = txData.data || [];
            var totalRealized = txData.total_profit || 0;
            var profitEl = document.getElementById('total-realized-profit');
            if (profitEl) profitEl.innerText = formatMoney(totalRealized);
            renderTxList();
          } catch(e) {
            console.log('transactions load error', e);
          }
        }

        function renderTxList() {
          var filter = document.getElementById('tx-filter');
          var filterVal = filter ? filter.value : 'all';
          var filtered = filterVal === 'all' ? allUserTransactions : allUserTransactions.filter(function(t) { return t.type === filterVal; });

          if (filtered.length === 0) {
            document.getElementById('user-history').innerHTML = '<div style="text-align:center; padding:25px; color:var(--text-muted); font-size:13px;"><i class="fa-regular fa-folder-open" style="font-size:30px; margin-bottom:8px; display:block;"></i>لا توجد معاملات لعرضها</div>';
            return;
          }

          document.getElementById('user-history').innerHTML = filtered.map(function(t) {
            var typeIcon = t.type === 'deposit' ? 'fa-arrow-down' : (t.type === 'withdrawal' ? 'fa-arrow-up' : 'fa-box-archive');
            var typeColor = t.type === 'deposit' ? 'var(--success-green)' : (t.type === 'withdrawal' ? 'var(--danger-red)' : 'var(--accent-gold)');
            var statusText = t.status === 'approved' ? '✅ مقبول' : (t.status === 'completed' ? '🎉 مكتملة' : (t.status === 'active' ? '⚡ نشطة' : (t.status === 'pending' ? '⏳ قيد الانتظار' : t.status)));
            var amountLabel = '';
            if (t.type === 'package') {
              amountLabel = formatMoney(t.amount) + ' → متوقع: ' + formatMoney(t.expected_payout);
            } else {
              var walletName = t.wallet_type === 'profit' ? 'أرباح' : 'رأس مال';
              amountLabel = formatMoney(t.amount) + ' (' + walletName + ')';
            }
            var dateStr = t.created_at ? new Date(t.created_at).toLocaleDateString('ar-EG') : '';
            return '<div class="history-item">' +
                   '<div style="display:flex; align-items:center; gap:10px;">' +
                     '<i class="fa-solid ' + typeIcon + '" style="color:' + typeColor + '; font-size:16px;"></i>' +
                     '<div><strong>' + t.label + '</strong><br><small style="color:var(--text-muted);">' + amountLabel + ' • ' + dateStr + '</small></div>' +
                   '</div>' +
                   '<span class="badge badge-' + t.status + '">' + statusText + '</span>' +
                   '</div>';
          }).join('');
        }

        async function loadUserNotifications() {
          var data = await fetchWithAuth('/api/user/notifications');
          var notifs = data.data || [];
          var unreadCount = notifs.filter(function(n) { return !n.is_read; }).length;

          var badge = document.getElementById('notif-badge');
          if (unreadCount > 0) {
            badge.innerText = unreadCount;
            badge.style.display = 'block';
          } else {
            badge.style.display = 'none';
          }

          var container = document.getElementById('notif-modal-list-container');
          if (notifs.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:30px;"><i class="fa-regular fa-bell-slash" style="font-size:35px; color:var(--text-muted); margin-bottom:10px;"></i><p style="font-size:13px; color:var(--text-muted);">لا توجد إشعارات أو تنبيهات حالياً</p></div>';
            return;
          }

          container.innerHTML = notifs.map(function(n) {
            var readClass = n.is_read ? 'read' : '';
            var dateStr = new Date(n.created_at).toLocaleString('ar-IQ');
            return '<div class="notif-full-card ' + readClass + '">' +
                   '<div class="notif-full-title"><i class="fa-solid fa-circle-info" style="color:var(--accent-gold);"></i> ' + n.title + '</div>' +
                   '<div class="notif-full-msg">' + n.message + '</div>' +
                   '<span class="notif-full-date"><i class="fa-regular fa-clock"></i> ' + dateStr + '</span>' +
                   '</div>';
          }).join('');
        }

        function openNotifModal() {
          document.getElementById('notif-modal-overlay').style.display = 'flex';
          loadUserNotifications();
        }

        function closeNotifModal() {
          document.getElementById('notif-modal-overlay').style.display = 'none';
        }

        async function markAllNotifsRead() {
          await fetchWithAuth('/api/user/notifications/read', { method: 'POST' });
          loadUserNotifications();
        }

        function openPackageModal(name, amount, payout, durationMonths) {
          selectedPkg = { name: name, amount: amount, payout: payout, durationMonths: durationMonths };
          document.getElementById('package-modal').style.display = 'block';
          document.getElementById('pkg-modal-title').innerText = 'الاشتراك بـ ' + name;
          document.getElementById('pkg-modal-desc').innerText = 'قيمة الاستثمار: ' + formatMoney(amount) + ' | العائد المكتمل: ' + formatMoney(payout) + ' (المدة: ' + (durationMonths === 12 ? 'سنة واحدة' : 'شهر واحد') + ')';
          
          document.getElementById('pkg-user-balance').innerText = formatMoney(rawCapital);
          
          var btn = document.getElementById('btn-confirm-pkg');
          var msg = document.getElementById('pkg-msg');
          msg.innerText = '';

          if (rawCapital < amount) {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            msg.innerText = '❌ رصيدك غير كافٍ. يرجى شحن رصيدك أولاً من قسم الأموال والعمليات.';
            msg.style.color = 'var(--danger-red)';
          } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
          }
        }

        async function submitPackageSubscription() {
          var msg = document.getElementById('pkg-msg');
          msg.innerText = 'جاري إرسال طلب الاشتراك للإدارة...';
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
              }, 1800);
            } else { 
              msg.innerText = '❌ ' + data.error;
              msg.style.color = 'var(--danger-red)';
            }
          } catch(e) { 
            msg.innerText = 'خطأ في عملية الاشتراك'; 
            msg.style.color = 'var(--danger-red)';
          }
        }

        async function loadUserPackages() {
          var res = await fetchWithAuth('/api/user/packages');
          var packages = res.data || [];
          var container = document.getElementById('user-packages-list');

          if (packages.length === 0) {
            container.innerHTML = '<p style="font-size:12px; color:var(--text-muted);">لا توجد لديك باقات حالياً.</p>';
            return;
          }

          container.innerHTML = packages.map(function(p) {
            var timeMarkup = '';
            if (p.status === 'active' && p.end_date) {
              var now = new Date();
              var end = new Date(p.end_date);
              var start = new Date(p.created_at);
              var totalTime = end - start;
              var remainingTime = end - now;

              if (remainingTime > 0) {
                var days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
                var hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                var pct = Math.min(100, Math.max(0, ((now - start) / totalTime) * 100)).toFixed(1);

                timeMarkup = '<div style="margin-top:12px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.1);">' +
                             '<div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-muted); margin-bottom:6px;">' +
                                '<span>نسبة الاكتمال: <strong style="color:var(--accent-gold);">' + pct + '%</strong></span>' +
                                '<span>⏱️ متبقي: <strong style="color:var(--text-main);">' + days + ' يوم و ' + hours + ' ساعة</strong></span>' +
                             '</div>' +
                             '<div style="background:#1e293b; border-radius:10px; height:8px; overflow:hidden; border:1px solid rgba(212,175,55,0.2);">' +
                                '<div style="background:linear-gradient(90deg, #d4af37 0%, #10b981 100%); width:' + pct + '%; height:100%; border-radius:10px;"></div>' +
                             '</div>' +
                           '</div>';
              } else {
                timeMarkup = '<div style="font-size:12px; color:var(--success-green); margin-top:8px;">🎉 مكتملة المدى المالي (بانتظار صرف العائد)</div>';
              }
            } else if (p.status === 'pending') {
              timeMarkup = '<div style="font-size:12px; color:var(--warning); margin-top:8px;">⏳ الطلب بانتظار موافقة الإدارة وتفعيل الباقة</div>';
            }

            var statusBadge = p.status === 'active' ? 'نشطة ⚡' : (p.status === 'completed' ? 'مكتملة ✅' : 'قيد الانتظار ⏳');
            return '<div class="history-item" style="flex-direction:column; align-items:stretch; gap:6px;">' +
                     '<div style="display:flex; justify-content:space-between; align-items:center;">' +
                        '<div>' +
                          '<strong>' + p.plan_name + '</strong> - ' + formatMoney(p.invested_amount) + '<br>' +
                          '<small style="color:var(--success-green);">العائد المتوقع: ' + formatMoney(p.expected_payout) + '</small>' +
                        '</div>' +
                        '<span class="badge badge-' + p.status + '">' + statusBadge + '</span>' +
                     '</div>' +
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

          if (!amount || !ref || fileInput.files.length === 0) { msg.innerText = 'أملأ التفاصيل والإشعار'; msg.style.color = 'var(--danger-red)'; return; }
          var numAmount = parseFloat(amount);
          if (numAmount < 100000) { msg.innerText = '❌ الحد الأدنى للشحن هو 100,000 د.ع'; msg.style.color = 'var(--danger-red)'; return; }
          if (numAmount > 1000000) { msg.innerText = '❌ الحد الأقصى للشحن هو 1,000,000 د.ع'; msg.style.color = 'var(--danger-red)'; return; }
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

        async function loadReferralNetwork() {
          try {
            var data = await fetchWithAuth('/api/user/referrals');
            if (!data.success) return;

            document.getElementById('ref-count').innerText = data.referral_count || 0;
            document.getElementById('ref-commissions').innerText = Number(data.total_commissions || 0).toLocaleString() + ' د.ع';

            var list = document.getElementById('ref-network-list');
            var referrals = data.data || [];

            if (referrals.length === 0) {
              list.innerHTML = '<div style="text-align:center; padding:25px; color:var(--text-muted); font-size:13px;"><i class="fa-solid fa-user-plus" style="font-size:28px; margin-bottom:8px; display:block; opacity:0.5;"></i>لا يوجد مستثمرين محالين بعد. شارك رابطك لكسب عمولات 2% من أول شحن لكل مستثمر جديد.</div>';
              return;
            }

            list.innerHTML = referrals.map(function(r) {
              var kycBadge = r.kyc_status === 'verified' ? '<span style="color:var(--success-green); font-size:11px;">✅ موثق</span>' : (r.kyc_status === 'pending' ? '<span style="color:var(--warning); font-size:11px;">⏳ بانتظار</span>' : '<span style="color:var(--text-muted); font-size:11px;">لم يوثق</span>');
              var dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : '';
              var displayName = r.full_name || ('مستثمر #' + r.id);
              return '<div class="history-item">' +
                       '<div style="display:flex; align-items:center; gap:10px;">' +
                         '<i class="fa-solid fa-user" style="color:var(--accent-gold); font-size:14px;"></i>' +
                         '<div><strong>' + displayName + '</strong><br><small style="color:var(--text-muted);">' + dateStr + '</small></div>' +
                       '</div>' +
                       kycBadge +
                     '</div>';
            }).join('');
          } catch(e) { console.error('referral load error', e); }
        }

        function logout() { localStorage.clear(); location.reload(); }

        // التحقق التلقائي عند تحميل الصفحة: إذا كان المستثمر مسجلاً مسبقاً، انتقل مباشرة للوحة التحكم
        if (authToken && currentUser) {
          initDashboard();
        }
        fetchAnnouncementBanner();
      </script>
    </body>
    </html>
  `);
});

// ==========================================
// 2. لوحة الإدارة الشاملة (المسار المخفي والمحمي بحماية مزدوجة)
// ==========================================
app.get('/secure-portal-exec-9921x', executiveShieldAuth, (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>مَكْسَب - لوحة الإدارة التنفيذية</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
        :root {
          --admin-bg: #0b0f19;
          --card-bg: #151e2e;
          --accent-gold: #d4af37;
          --accent-gold-hover: #b89528;
          --text-main: #f8fafc;
          --text-muted: #94a3b8;
          --success: #10b981;
          --warning: #f59e0b;
          --danger: #ef4444;
          --info: #3b82f6;
          --border-color: rgba(255, 255, 255, 0.08);
        }
        * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; transition: all 0.2s ease; }
        body { background: var(--admin-bg); color: var(--text-main); margin: 0; padding: 25px; min-height: 100vh; }
        
        .admin-box { background: var(--card-bg); max-width: 420px; margin: 80px auto; padding: 40px 30px; border-radius: 20px; border: 1px solid var(--border-color); text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
        .admin-box input { width: 100%; padding: 14px 18px; margin: 15px 0 20px 0; border-radius: 12px; border: 1px solid var(--border-color); background: #0f172a; color: white; outline: none; text-align: center; font-size: 16px; }
        .admin-box button { width: 100%; background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); color: #000; padding: 14px; border: none; border-radius: 12px; cursor: pointer; font-weight: bold; font-size: 16px; }

        .header { display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 20px 30px; border-radius: 18px; border: 1px solid var(--border-color); margin-bottom: 25px; box-shadow: 0 8px 20px rgba(0,0,0,0.3); flex-wrap: wrap; gap: 15px; }
        .header h2 { margin: 0; font-size: 20px; color: var(--accent-gold); display: flex; align-items: center; gap: 12px; }

        .btn-action { background: #0f172a; border: 1px solid var(--border-color); color: var(--text-main); padding: 10px 18px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; gap: 8px; position: relative; }
        .btn-action:hover { border-color: var(--accent-gold); color: var(--accent-gold); }
        .btn-danger { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3); }
        .btn-danger:hover { background: var(--danger); color: white; }

        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px; margin-bottom: 25px; }
        .stat-card { background: var(--card-bg); padding: 22px; border-radius: 16px; border: 1px solid var(--border-color); display: flex; align-items: center; gap: 18px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
        .stat-icon { width: 52px; height: 52px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }
        .stat-info p { margin: 0 0 4px 0; font-size: 12px; color: var(--text-muted); font-weight: 600; }
        .stat-info h3 { margin: 0; font-size: 22px; font-weight: 800; font-family: monospace; }

        .admin-nav { display: flex; gap: 10px; margin-bottom: 25px; background: var(--card-bg); padding: 8px; border-radius: 16px; border: 1px solid var(--border-color); overflow-x: auto; }
        .nav-btn { flex: 1; padding: 12px 18px; border: none; background: transparent; color: var(--text-muted); font-weight: bold; font-size: 13px; border-radius: 10px; cursor: pointer; white-space: nowrap; display: flex; align-items: center; justify-content: center; gap: 8px; position: relative; }
        .nav-btn.active { background: #0f172a; color: var(--accent-gold); border: 1px solid rgba(212, 175, 55, 0.3); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }

        .admin-pulse-dot { position: absolute; top: 8px; right: 12px; width: 10px; height: 10px; background-color: var(--danger); border-radius: 50%; box-shadow: 0 0 0 0 rgba(239, 68, 68, 1); animation: adminPulse 1.5s infinite; display: none; }
        @keyframes adminPulse { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }

        .admin-tab { display: none; }
        .admin-tab.active { display: block; }

        .card-panel { background: var(--card-bg); border-radius: 18px; border: 1px solid var(--border-color); padding: 25px; margin-bottom: 25px; box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
        .card-panel h3 { margin-top: 0; margin-bottom: 20px; font-size: 16px; color: var(--accent-gold); display: flex; align-items: center; gap: 10px; }

        .btn-gold-action { background: linear-gradient(135deg, #d4af37 0%, #aa7c11 100%); color: #000; font-weight: bold; border: none; padding: 12px 20px; border-radius: 10px; cursor: pointer; width: 100%; font-size: 14px; }
        .btn-gold-action:hover { opacity: 0.9; }

        .table-responsive { width: 100%; overflow-x: auto; border-radius: 14px; border: 1px solid var(--border-color); }
        table { width: 100%; border-collapse: collapse; text-align: right; font-size: 13px; }
        th { background: #0f172a; color: var(--text-muted); padding: 14px 16px; font-weight: 700; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
        td { padding: 14px 16px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: rgba(255, 255, 255, 0.02); }

        .badge-status { padding: 5px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; }
        .status-pending { background: rgba(245, 158, 11, 0.15); color: var(--warning); border: 1px solid rgba(245, 158, 11, 0.3); }
        .status-approved, .status-active { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
        .status-completed { background: rgba(59, 130, 246, 0.15); color: var(--info); border: 1px solid rgba(59, 130, 246, 0.3); }

        .link-view { color: var(--accent-gold); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; background: rgba(212, 175, 55, 0.1); padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(212, 175, 55, 0.2); }
        .link-view:hover { background: var(--accent-gold); color: black; }

        .btn-approve { background: var(--success); color: black; border: none; padding: 6px 14px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 12px; }
        .btn-approve:hover { opacity: 0.85; }
      </style>
    </head>
    <body>
      <div id="admin-auth" class="admin-box">
        <i class="fa-solid fa-user-shield" style="font-size: 45px; color: var(--accent-gold); margin-bottom: 15px;"></i>
        <h2 style="margin: 0; color: white;">لوحة الإدارة المحصنة</h2>
        <p style="color: var(--text-muted); font-size: 13px; margin-top: 8px;">أدخل كلمة المرور (للمدير أو المشرف المساعد)</p>
        <input type="password" id="admin-pass" placeholder="كلمة المرور">
        <button id="admin-login-btn">تسجيل الدخول <i class="fa-solid fa-arrow-left"></i></button>
        <p id="admin-login-msg" style="margin-top: 15px; font-weight: bold; font-size: 14px; margin-bottom: 0;"></p>
      </div>

      <div id="admin-dash" style="display:none; max-width:1200px; margin:0 auto;">
        
        <div class="header">
          <div>
            <h2><i class="fa-solid fa-shield-halved"></i> مركز التحكم والمدفوعات - مَكْسَب</h2>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              المدير التنفيذي للمشروع: <strong style="color: var(--accent-gold);">${EXECUTIVE_DIRECTOR}</strong> | <span id="admin-role-badge" style="color: var(--success); font-weight: bold;"></span>
            </div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <button class="btn-action" id="btn-refresh-data"><i class="fa-solid fa-arrows-rotate"></i> تحديث البيانات</button>
            <button class="btn-action btn-danger" id="btn-admin-logout"><i class="fa-solid fa-power-off"></i> خروج</button>
          </div>
        </div>

        <div id="admin-live-alert-banner" style="display:none; background:rgba(239, 68, 68, 0.15); border:1px solid var(--danger); padding:12px 20px; border-radius:14px; margin-bottom:20px; align-items:center; justify-content:space-between; animation: pulse 2s infinite;">
          <div style="display:flex; align-items:center; gap:10px; color:var(--danger); font-weight:bold; font-size:14px;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:18px;"></i>
            <span id="admin-banner-text">تنبيه: توجد طلبات جديدة بانتظار المراجعة والاعتماد!</span>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon" style="background: rgba(16, 185, 129, 0.15); color: var(--success);"><i class="fa-solid fa-vault"></i></div>
            <div class="stat-info">
              <p>رأس المال النشط بالباقات</p>
              <h3 id="stat-cap" style="color: var(--success);">0</h3>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background: rgba(212, 175, 55, 0.15); color: var(--accent-gold);"><i class="fa-solid fa-coins"></i></div>
            <div class="stat-info">
              <p>أرباح الباقات الموزعة</p>
              <h3 id="stat-prof" style="color: var(--accent-gold);">0</h3>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background: rgba(239, 68, 68, 0.15); color: var(--danger);"><i class="fa-solid fa-hand-holding-dollar"></i></div>
            <div class="stat-info">
              <p>إجمالي السحوبات</p>
              <h3 id="stat-with" style="color: var(--danger);">0</h3>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background: rgba(59, 130, 246, 0.15); color: var(--info);"><i class="fa-solid fa-users"></i></div>
            <div class="stat-info">
              <p>المستثمرين المسجلين</p>
              <h3 id="stat-users" style="color: var(--info);">0</h3>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background: rgba(16, 185, 129, 0.15); color: var(--success);"><i class="fa-solid fa-box-archive"></i></div>
            <div class="stat-info">
              <p>الباقات النشطة</p>
              <h3 id="stat-active-pkgs" style="color: var(--success);">0</h3>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon" style="background: rgba(168, 85, 247, 0.15); color: #a855f7;"><i class="fa-solid fa-money-bill-wave"></i></div>
            <div class="stat-info">
              <p>إجمالي الشحنات المقبولة</p>
              <h3 id="stat-total-deposits" style="color: #a855f7;">0</h3>
            </div>
          </div>
        </div>

        <div class="section-card" style="margin-bottom:20px;">
          <h3><i class="fa-solid fa-chart-column"></i> نظرة عامة سريعة</h3>
          <div id="admin-chart-bars" style="display:flex; flex-direction:column; gap:12px; margin-top:10px;"></div>
        </div>

        <div class="admin-nav">
          <button class="nav-btn active" data-tab="tab-dash"><i class="fa-solid fa-chart-pie"></i> الرئيسية والتحكم</button>
          <button class="nav-btn" data-tab="tab-deposits"><i class="fa-solid fa-file-invoice-dollar"></i> طلبات شحن الرصيد <span class="admin-pulse-dot" id="dot-deposits"></span></button>
          <button class="nav-btn" data-tab="tab-packages"><i class="fa-solid fa-box-archive"></i> الباقات الاستثمارية <span class="admin-pulse-dot" id="dot-packages"></span></button>
          <button class="nav-btn" data-tab="tab-withdrawals"><i class="fa-solid fa-money-bill-transfer"></i> طلبات السحب <span class="admin-pulse-dot" id="dot-withdrawals"></span></button>
          <button class="nav-btn" data-tab="tab-users"><i class="fa-solid fa-id-card"></i> المستثمرين و KYC</button>
        </div>

        <div id="tab-dash" class="admin-tab active">
          
          <!-- 📢 لوحة التحكم في الشريط الإعلاني المتحرك للمستثمرين -->
          <div class="card-panel">
            <h3><i class="fa-solid fa-bullhorn"></i> إدارة الشريط الإعلاني للمستثمرين (Ticker Announcement)</h3>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:15px;">اكتب نص الإعلان أو التحديث الجديد ليظهر فوراً بشكل متحرك أعلى واجهة جميع المستثمرين بالموقع.</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">حالة الشريط الإعلاني:</label>
                <select id="admin-announcement-active" style="width:100%; padding:10px; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px;">
                  <option value="true">🟢 تفعيل وإظهار الشريط للمستثمرين</option>
                  <option value="false">🔴 إيقاف وإخفاء الشريط تماماً</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">نص الإعلان أو التحديث:</label>
                <textarea id="admin-announcement-text" rows="2" style="width:100%; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px; padding:11px 14px; outline:none; font-family:inherit;" placeholder="اكتب الإعلان الجديد هنا..."></textarea>
              </div>
              <div style="display:flex; align-items:center; gap:15px;">
                <button id="btn-save-announcement" class="btn-gold-action" style="max-width:280px;">
                  <i class="fa-solid fa-floppy-disk"></i> حفظ وتحديث الشريط الإعلاني 🚀
                </button>
                <span id="announcement-msg" style="font-size:13px; font-weight:bold;"></span>
              </div>
            </div>
          </div>

          <div class="card-panel" id="admin-pricing-section" style="display:none;">
            <h3><i class="fa-solid fa-tags"></i> إدارة أسعار وعوائد الباقات (صلاحية المدير الرئيسي)</h3>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">قم بتعديل سعر اشتراك كل باقة والعائد المتوقع منها. سيتم تحديث بطاقات الباقات لدى المستثمرين تلقائيًا.</p>
            <div id="admin-pricing-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:15px; margin-bottom:20px;"></div>
            <div style="display:flex; align-items:center; gap:15px;">
              <button id="btn-save-pricing" class="btn-gold-action" style="max-width:280px;"><i class="fa-solid fa-floppy-disk"></i> حفظ التعديلات</button>
              <span id="pricing-msg" style="font-size:13px; font-weight:bold;"></span>
            </div>
          </div>

          <div class="card-panel" id="super-admin-section">
            <h3><i class="fa-solid fa-toggle-on"></i> التحكم في تشغيل وإيقاف الباقات يدوياً (صلاحية المدير الرئيسي)</h3>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:20px;">قم بإيقاف أي باقة مؤقتاً لتظهر للمستثمرين كمتوقفة ولا يمكن الاشتراك بها، ثم أعد تفعيلها متى شئت.</p>
            <div id="admin-packages-control-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:15px;"></div>
          </div>

          <div class="card-panel">
            <h3><i class="fa-solid fa-gift"></i> صرف أرباح الباقات المكتملة تلقائياً</h3>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:15px;">يفحص النظام الباقات النشطة التي انتهت مدتها ويقوم بإيداع أرباحها مباشرة مع إرسال إشعار للموقع وتلجرام تلقائياً.</p>
            <div style="display:flex; align-items:center; gap:15px;">
              <button class="btn-gold-action" style="max-width:280px;" id="btn-trigger-payouts"><i class="fa-solid fa-rocket"></i> تنفيذ صرف الباقات المكتملة الآن</button>
              <span id="payout-msg" style="font-size:13px; font-weight:bold;"></span>
            </div>
          </div>

          <div class="card-panel">
            <h3><i class="fa-solid fa-bullhorn"></i> إرسال إعلان عام / تحديث لجميع المستثمرين (Broadcast)</h3>
            <p style="font-size:13px; color:var(--text-muted); margin-bottom:15px;">أرسل تنبيهاً عن باقة جديدة، تحديث في المنصة، أو تنبيه عام لجميع المستثمرين عبر تلجرام وجرس الإشعارات بالموقع بضغطة زر.</p>
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">عنوان الإعلان:</label>
                <input type="text" id="broadcast-title" placeholder="مثال: إطلاق الباقة الذهبية المباشرة" style="width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--border-color); background:#0f172a; color:white; outline:none;">
              </div>
              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">نص الإعلان:</label>
                <textarea id="broadcast-msg-text" rows="3" style="width:100%; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px; padding:11px 14px; outline:none; font-family:inherit;" placeholder="اكتب تفاصيل الباقة أو الإعلان هنا..."></textarea>
              </div>
              <div style="display:flex; align-items:center; gap:15px;">
                <button id="btn-send-broadcast" class="btn-gold-action" style="max-width:280px;">
                  <i class="fa-solid fa-paper-plane"></i> إرسال الإعلان للجميع 📢
                </button>
                <span id="broadcast-msg" style="font-size:13px; font-weight:bold;"></span>
              </div>
            </div>
          </div>
        </div>

        <div id="tab-deposits" class="admin-tab">
          <div class="card-panel">
            <h3><i class="fa-solid fa-file-invoice-dollar"></i> طلبات شحن الرصيد والاشتراكات</h3>
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>المستثمر (الهاتف)</th>
                    <th>المبلغ</th>
                    <th>نوع المحفظة</th>
                    <th>إشعار التحويل</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody id="dep-table"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="tab-packages" class="admin-tab">
          <div class="card-panel">
            <h3><i class="fa-solid fa-box-archive"></i> الباقات الاستثمارية للمشتركين (بانتظار الموافقة أو النشطة)</h3>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:15px; flex-wrap:wrap;">
              <label style="color:var(--text-muted); font-size:13px; font-weight:bold;"><i class="fa-solid fa-filter"></i> تصفية حسب المستثمر:</label>
              <select id="pkg-investor-filter" onchange="filterPackagesByInvestor()" style="background:#0f172a; color:white; border:1px solid var(--border-color); padding:8px 15px; border-radius:8px; font-size:13px; cursor:pointer; min-width:200px;">
                <option value="">عرض جميع المستثمرين</option>
              </select>
              <span id="pkg-filter-count" style="color:var(--accent-gold); font-size:12px; font-weight:bold;"></span>
            </div>
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>المستثمر (الهاتف)</th>
                    <th>اسم الباقة</th>
                    <th>المبلغ المستثمر</th>
                    <th>العائد المتوقع</th>
                    <th>تاريخ الانتهاء</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody id="pkg-table"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="tab-withdrawals" class="admin-tab">
          <div class="card-panel">
            <h3><i class="fa-solid fa-money-bill-transfer"></i> طلبات السحب المالي</h3>
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>المستثمر (الهاتف)</th>
                    <th>المبلغ</th>
                    <th>خصم من</th>
                    <th>وسيلة الدفع / رقم الحساب</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody id="with-table"></tbody>
              </table>
            </div>
          </div>
        </div>

        <div id="tab-users" class="admin-tab">
          <div class="card-panel">
            <h3><i class="fa-solid fa-id-card"></i> إدارة المستثمرين وتوثيق الهويات (KYC & Referrals)</h3>
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>اسم المستثمر</th>
                    <th>رقم الهاتف</th>
                    <th>المُحيل (الداعي)</th>
                    <th>وثيقة الهوية</th>
                    <th>حالة التوثيق</th>
                    <th>الإجراءات والتحكم</th>
                  </tr>
                </thead>
                <tbody id="users-table"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- 🎛️ نافذة تعديل الرصيد اليدوي -->
        <div id="balance-modal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;">
          <div style="background:var(--card-bg); border:1px solid var(--accent-gold); border-radius:18px; padding:30px; width:90%; max-width:450px;">
            <h3 style="margin-top:0; color:var(--accent-gold);"><i class="fa-solid fa-sliders"></i> تعديل رصيد المستثمر</h3>
            <p id="modal-user-info" style="font-size:13px; color:var(--text-muted); font-weight:bold;"></p>
            <input type="hidden" id="modal-user-id">

            <div style="display:flex; flex-direction:column; gap:12px; margin-top:15px;">
              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">نوع العملية:</label>
                <select id="modal-action-type" style="width:100%; padding:10px; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px;">
                  <option value="add">➕ إضافة رصيد (مكافأة / شحن)</option>
                  <option value="deduct">➖ خصم رصيد (تسوية / تصحيح)</option>
                </select>
              </div>

              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">المحفظة المستهدفة:</label>
                <select id="modal-wallet-type" style="width:100%; padding:10px; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px;">
                  <option value="capital">رأس المال النشط</option>
                  <option value="profit">محفظة الأرباح والعمولات</option>
                </select>
              </div>

              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">المبلغ (بالدينار):</label>
                <input type="number" id="modal-amount" placeholder="مثال: 50000" style="width:100%; padding:10px; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px;">
              </div>

              <div>
                <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:5px;">السبب / الملاحظات (تظهر للمستثمر):</label>
                <input type="text" id="modal-reason" placeholder="مثال: مكافأة تميز، أو تسوية شحن" style="width:100%; padding:10px; background:#0f172a; border:1px solid var(--border-color); color:white; border-radius:10px;">
              </div>

              <div style="display:flex; gap:10px; margin-top:10px;">
                <button id="btn-submit-balance" class="btn-gold-action">تأكيد التعديل 🚀</button>
                <button id="btn-close-balance" class="btn-action btn-danger" style="width:auto;">إلغاء</button>
              </div>
              <span id="modal-msg" style="font-size:12px; font-weight:bold;"></span>
            </div>
          </div>
        </div>

      </div>

      <script>
        var adminToken = localStorage.getItem('maksab_admin_token') || null;
        function normalizeDigits(value) { return String(value || '').replace(/[٠-٩]/g, function(ch) { return String(ch.charCodeAt(0) - 1632); }).replace(/[۰-۹]/g, function(ch) { return String(ch.charCodeAt(0) - 1776); }); }
        var pricingEditing = false;
        var pricingSaveInFlight = false;
        var adminRefreshTimer = null;
        var adminRole = localStorage.getItem('maksab_admin_role') || null;
        var allPackagesData = [];

        document.addEventListener('DOMContentLoaded', function() {
          var loginBtn = document.getElementById('admin-login-btn');
          var passInput = document.getElementById('admin-pass');
          
          if (loginBtn) loginBtn.addEventListener('click', loginAdmin);
          if (passInput) passInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') loginAdmin(); });

          document.getElementById('btn-refresh-data').addEventListener('click', loadAdminData);
          document.getElementById('btn-admin-logout').addEventListener('click', logoutAdmin);
          document.getElementById('btn-trigger-payouts').addEventListener('click', triggerPackagePayouts);
          document.getElementById('btn-send-broadcast').addEventListener('click', sendBroadcastMessage);
          document.getElementById('btn-save-announcement').addEventListener('click', saveAnnouncementSettings);
          document.getElementById('btn-save-pricing').addEventListener('click', savePricingSettings);
          document.getElementById('btn-submit-balance').addEventListener('click', submitBalanceAdjustment);
          document.getElementById('btn-close-balance').addEventListener('click', closeBalanceModal);

          document.querySelectorAll('.admin-nav .nav-btn').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
              document.querySelectorAll('.admin-nav .nav-btn').forEach(function(b) { b.classList.remove('active'); });
              document.querySelectorAll('.admin-tab').forEach(function(c) { c.classList.remove('active'); });
              btn.classList.add('active');
              document.getElementById(btn.dataset.tab).classList.add('active');
            });
          });

          document.addEventListener('click', function(e) {
            var target = e.target.closest('button');
            if (!target) return;

            if (target.classList.contains('act-dep-approve')) approveDep(target.dataset.id);
            if (target.classList.contains('act-with-approve')) approveWith(target.dataset.id);
            if (target.classList.contains('act-pkg-approve')) approvePkg(target.dataset.id);
            if (target.classList.contains('act-pkg-cancel')) cancelPkg(target.dataset.id, target.dataset.name);
            if (target.classList.contains('act-open-modal')) openBalanceModal(target.dataset.id, target.dataset.name);
            if (target.classList.contains('act-toggle-block')) toggleBlockUser(target.dataset.id, target.dataset.blocked === 'true', target.dataset.name);
            if (target.classList.contains('act-delete-user')) deleteUser(target.dataset.id, target.dataset.name);
            if (target.classList.contains('act-toggle-pkg')) togglePackageStatus(target.dataset.pkg, target.dataset.paused === 'true');
          });

          if (adminToken) {
            showAdmin();
            startAdminRefresh();
          }
        });

        function startAdminRefresh() {
          if (adminRefreshTimer) return;
          adminRefreshTimer = setInterval(function() {
            loadAdminData();
          }, 6000);
        }

        document.addEventListener('focusin', function(event) {
          if (event.target.closest && event.target.closest('#admin-pricing-grid')) pricingEditing = true;
        });
        document.addEventListener('focusout', function(event) {
          if (event.target.closest && event.target.closest('#admin-pricing-grid')) {
            setTimeout(function() {
              var active = document.activeElement;
              pricingEditing = !!(active && active.closest && active.closest('#admin-pricing-grid'));
            }, 100);
          }
        });

        async function loginAdmin() {
          var passInput = document.getElementById('admin-pass');
          var pass = passInput ? passInput.value.trim() : '';
          var btn = document.getElementById('admin-login-btn');
          var msg = document.getElementById('admin-login-msg');

          if (msg) msg.innerText = '';
          if (!pass) {
            if (msg) { msg.innerText = '❌ يرجى إدخال كلمة المرور أولاً'; msg.style.color = 'var(--danger)'; }
            return;
          }

          if (btn) { btn.disabled = true; btn.innerText = 'جاري التحقق... ⏳'; }

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
              showAdmin();
              startAdminRefresh();
            } else {
              if (msg) { msg.innerText = '❌ ' + (data.error || 'كلمة المرور غير صحيحة'); msg.style.color = 'var(--danger)'; }
            }
          } catch (err) {
            if (msg) { msg.innerText = '❌ خطأ في الاتصال بالسيرفر: ' + err.message; msg.style.color = 'var(--danger)'; }
          } finally {
            if (btn) {
              btn.disabled = false;
              btn.innerHTML = 'تسجيل الدخول <i class="fa-solid fa-arrow-left"></i>';
            }
          }
        }

        async function loadAnnouncementFormData() {
          try {
            var res = await fetch('/api/announcement');
            var data = await res.json();
            if (data.success && data.data) {
              document.getElementById('admin-announcement-active').value = String(data.data.active);
              document.getElementById('admin-announcement-text').value = data.data.text || '';
            }
          } catch(e) { console.error(e); }
        }

        async function saveAnnouncementSettings() {
          var active = document.getElementById('admin-announcement-active').value === 'true';
          var text = document.getElementById('admin-announcement-text').value.trim();
          var msgEl = document.getElementById('announcement-msg');

          msgEl.innerText = 'جاري حفظ وحفظ إعدادات الشريط...';
          msgEl.style.color = 'var(--warning)';

          try {
            var res = await fetch('/api/admin/announcement', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
              body: JSON.stringify({ active: active, text: text })
            });
            var data = await res.json();
            if (data.success) {
              msgEl.innerText = '✅ ' + data.message;
              msgEl.style.color = 'var(--success)';
              pricingEditing = false;
              pricingSaveInFlight = false;
              await loadPricingSettings();
            } else {
              msgEl.innerText = '❌ ' + data.error;
              msgEl.style.color = 'var(--danger)';
            }
          } catch(e) {
            msgEl.innerText = '❌ خطأ في الاتصال بالسيرفر';
            msgEl.style.color = 'var(--danger)';
          }
        }

        var adminPricingNames = [
          'الباقة الفضية الشهرية', 'الباقة الذهبية الشهرية', 'الباقة الماسية الشهرية',
          'الباقة السنوية الفضية', 'الباقة السنوية الذهبية', 'الباقة السنوية الماسية VIP'
        ];

        async function loadPricingSettings() {
          try {
            var res = await fetch('/api/packages/pricing');
            var data = await res.json();
            if (!data.success || !data.data) return;
            var pricing = data.data;

            document.getElementById('admin-pricing-grid').innerHTML = adminPricingNames.map(function(name) {
              var p = pricing[name] || { price: 0, payout: 0 };
              return '<div style="background:#0f172a; padding:15px; border-radius:12px; border:1px solid var(--border-color);">' +
                       '<strong style="color:var(--accent-gold); font-size:13px; display:block; margin-bottom:12px;">' + name + '</strong>' +
                       '<label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px;">سعر الاشتراك (د.ع)</label>' +
                       '<input type="number" data-pkg="' + name + '" data-field="price" value="' + p.price + '" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--border-color); background:#1e293b; color:white; outline:none; margin-bottom:10px;">' +
                       '<label style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:4px;">العائد المتوقع (د.ع)</label>' +
                       '<input type="number" data-pkg="' + name + '" data-field="payout" value="' + p.payout + '" style="width:100%; padding:8px 10px; border-radius:8px; border:1px solid var(--border-color); background:#1e293b; color:white; outline:none;">' +
                     '</div>';
            }).join('');
          } catch(e) { console.error('pricing load error', e); }
        }

        async function savePricingSettings() {
          var msgEl = document.getElementById('pricing-msg');
          var inputs = document.querySelectorAll('#admin-pricing-grid input[data-pkg]');
          var pricing = {};

          inputs.forEach(function(inp) {
            var pkg = inp.getAttribute('data-pkg');
            var field = inp.getAttribute('data-field');
            if (!pricing[pkg]) pricing[pkg] = {};
            pricing[pkg][field] = normalizeDigits(inp.value);
          });

          pricingSaveInFlight = true;
          msgEl.innerText = 'جاري حفظ الأسعار...';
          msgEl.style.color = 'var(--warning)';

          try {
            var res = await fetch('/api/admin/packages/pricing', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
              body: JSON.stringify({ pricing: pricing })
            });
            var data = await res.json();
            if (data.success) {
              msgEl.innerText = '✅ ' + data.message;
              msgEl.style.color = 'var(--success)';
            } else {
              msgEl.innerText = '❌ ' + data.error;
              msgEl.style.color = 'var(--danger)';
              pricingSaveInFlight = false;
            }
          } catch(e) {
            pricingSaveInFlight = false;
            msgEl.innerText = '❌ خطأ في الاتصال';
            msgEl.style.color = 'var(--danger)';
          }
        }

        function showAdmin() {
          document.getElementById('admin-auth').style.display = 'none';
          document.getElementById('admin-dash').style.display = 'block';

          if (adminRole === 'super_admin') {
            document.getElementById('admin-role-badge').innerText = 'صلاحيات كاملة: المدير الرئيسي (Super Admin)';
            document.getElementById('super-admin-section').style.display = 'block';
            document.getElementById('admin-pricing-section').style.display = 'block';
          } else {
            document.getElementById('admin-role-badge').innerText = 'صلاحيات محدودة: مشرف مساعد (Moderator)';
            document.getElementById('super-admin-section').style.display = 'none';
            document.getElementById('admin-pricing-section').style.display = 'none';
          }

          loadAdminData();
          loadAnnouncementFormData();
        }

        function logoutAdmin() {
          localStorage.removeItem('maksab_admin_token');
          localStorage.removeItem('maksab_admin_role');
          adminToken = null; adminRole = null;
          document.getElementById('admin-dash').style.display = 'none';
          document.getElementById('admin-auth').style.display = 'block';
          var msg = document.getElementById('admin-login-msg');
          if (msg) msg.innerText = '';
        }

        async function loadAdminData() {
          if (!adminToken) { logoutAdmin(); return; }
          var headers = { 'Authorization': 'Bearer ' + adminToken };
          
          try {
            if (adminRole === 'super_admin') {
              var resSettings = await fetch('/api/packages/settings');
              var dataSettings = await resSettings.json();
              var settings = dataSettings.data || {};

              var packageNames = [
                'الباقة الفضية الشهرية', 'الباقة الذهبية الشهرية', 'الباقة الماسية الشهرية',
                'الباقة السنوية الفضية', 'الباقة السنوية الذهبية', 'الباقة السنوية الماسية VIP'
              ];

              document.getElementById('admin-packages-control-grid').innerHTML = packageNames.map(function(name) {
                var isPaused = settings[name] === false;
                var btnClass = isPaused ? 'btn-approve' : 'btn-action btn-danger';
                var btnText = isPaused ? '<i class="fa-solid fa-play"></i> تفعيل الباقة' : '<i class="fa-solid fa-pause"></i> إيقاف مؤقت';
                var statusBadge = isPaused ? '<span style="color:var(--danger); font-size:12px;">🚫 متوقفة</span>' : '<span style="color:var(--success); font-size:12px;">✅ مفعلة</span>';

                return '<div style="background:#0f172a; padding:15px; border-radius:12px; border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">' +
                         '<div>' +
                           '<strong style="color:var(--accent-gold); font-size:14px;">' + name + '</strong><br>' +
                           statusBadge +
                         '</div>' +
                         '<button data-pkg="' + name + '" data-paused="' + (!isPaused) + '" class="btn-action ' + btnClass + ' act-toggle-pkg" style="padding:6px 12px; font-size:12px;">' +
                           btnText +
                         '</button>' +
                       '</div>';
              }).join('');

              if (!pricingEditing && !pricingSaveInFlight) loadPricingSettings();
            }

            var resDep = await fetch('/api/admin/deposits', { headers: headers });
            if (resDep.status === 401 || resDep.status === 403) {
              var errData = await resDep.json().catch(function(){ return {}; });
              alert('❌ انتهت الجلسة أو صلاحيات غير كافية: ' + (errData.error || 'أعد الدخول'));
              logoutAdmin();
              return;
            }
            var dataDep = await resDep.json();
            var deposits = dataDep.data || [];

            var resWith = await fetch('/api/admin/withdrawals', { headers: headers });
            var dataWith = await resWith.json();
            var withdrawals = dataWith.data || [];

            var resPkg = await fetch('/api/admin/packages', { headers: headers });
            var dataPkg = await resPkg.json();
            var packages = dataPkg.data || [];

            var resU = await fetch('/api/admin/users', { headers: headers });
            var dataU = await resU.json();
            var users = dataU.data || [];

            var pendingDepositsCount = deposits.filter(function(d) { return d.status === 'pending'; }).length;
            var pendingWithdrawalsCount = withdrawals.filter(function(w) { return w.status === 'pending'; }).length;
            var pendingPackagesCount = packages.filter(function(p) { return p.status === 'pending'; }).length;
            var totalPending = pendingDepositsCount + pendingWithdrawalsCount + pendingPackagesCount;

            var banner = document.getElementById('admin-live-alert-banner');
            var bannerText = document.getElementById('admin-banner-text');

            if (totalPending > 0) {
              banner.style.display = 'flex';
              bannerText.innerHTML = 'تنبيه عاجل: توجد (' + totalPending + ') طلبات جديدة بحاجة لمراجعتك واعتمادها (شحن: ' + pendingDepositsCount + ' | سحب: ' + pendingWithdrawalsCount + ' | باقات: ' + pendingPackagesCount + ')';
            } else {
              banner.style.display = 'none';
            }

            document.getElementById('dot-deposits').style.display = pendingDepositsCount > 0 ? 'block' : 'none';
            document.getElementById('dot-withdrawals').style.display = pendingWithdrawalsCount > 0 ? 'block' : 'none';
            document.getElementById('dot-packages').style.display = pendingPackagesCount > 0 ? 'block' : 'none';

            var activeCap = 0; var totalProf = 0; var withCap = 0;
            deposits.forEach(function(d) {
              if(d.status === 'approved'){
                if(d.wallet_type === 'profit') totalProf += Number(d.amount);
                else activeCap += Number(d.amount);
              }
            });
            withdrawals.forEach(w => {
              if(w.status === 'approved'){
                if(w.wallet_type === 'profit') totalProf -= Number(w.amount);
                else { activeCap -= Number(w.amount); withCap += Number(w.amount); }
              }
            });

            document.getElementById('stat-cap').innerText = activeCap.toLocaleString() + ' د.ع';
            document.getElementById('stat-prof').innerText = totalProf.toLocaleString() + ' د.ع';
            document.getElementById('stat-with').innerText = withCap.toLocaleString() + ' د.ع';
            document.getElementById('stat-users').innerText = users.length;

            // بطاقات إحصائية إضافية: الباقات النشطة + إجمالي الشحنات المقبولة
            var activePkgCount = packages.filter(function(p) { return p.status === 'active'; }).length;
            var completedPkgCount = packages.filter(function(p) { return p.status === 'completed'; }).length;
            var totalApprovedDeposits = deposits.filter(function(d) { return d.status === 'approved'; }).reduce(function(acc, d) { return acc + Number(d.amount); }, 0);
            var elActivePkg = document.getElementById('stat-active-pkgs');
            var elTotalDep = document.getElementById('stat-total-deposits');
            if (elActivePkg) elActivePkg.innerText = activePkgCount + ' (' + completedPkgCount + ' مكتملة)';
            if (elTotalDep) elTotalDep.innerText = totalApprovedDeposits.toLocaleString() + ' د.ع';

            // رسم مخطط شريطي بسيط للنظرة العامة
            var chartData = [
              { label: 'رأس المال النشط', value: activeCap, color: 'var(--success)' },
              { label: 'الأرباح الموزعة', value: totalProf, color: 'var(--accent-gold)' },
              { label: 'إجمالي السحوبات', value: withCap, color: 'var(--danger)' },
              { label: 'إجمالي الشحنات', value: totalApprovedDeposits, color: '#a855f7' }
            ];
            var maxVal = Math.max.apply(null, chartData.map(function(c) { return c.value; })) || 1;
            var chartEl = document.getElementById('admin-chart-bars');
            if (chartEl) {
              chartEl.innerHTML = chartData.map(function(c) {
                var pct = Math.round((c.value / maxVal) * 100);
                return '<div>' +
                         '<div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:12px;">' +
                           '<span style="color:var(--text-light);">' + c.label + '</span>' +
                           '<span style="color:' + c.color + '; font-weight:bold;">' + c.value.toLocaleString() + ' د.ع</span>' +
                         '</div>' +
                         '<div style="background:#0f172a; border-radius:8px; height:10px; overflow:hidden;">' +
                           '<div style="width:' + pct + '%; height:100%; background:' + c.color + '; border-radius:8px; transition:width 0.5s ease;"></div>' +
                         '</div>' +
                       '</div>';
              }).join('');
            }

            document.getElementById('dep-table').innerHTML = deposits.map(function(d) {
              var walletText = d.wallet_type === 'profit' ? '<span style="color:var(--accent-gold);">أرباح/عمولة</span>' : 'رأس مال';
              var receiptText = d.receipt_url ? '<a href="' + d.receipt_url + '" target="_blank" class="link-view"><i class="fa-solid fa-eye"></i> معاينة الإشعار</a>' : (d.transaction_ref || '-');
              var statusText = d.status === 'approved' ? '✅ مقبول' : '⏳ قيد الانتظار';
              var actionBtn = d.status === 'pending' ? '<button data-id="' + d.id + '" class="btn-approve act-dep-approve"><i class="fa-solid fa-check"></i> قبول الشحن</button>' : '-';

              return '<tr>' +
                       '<td><strong>' + d.phone_number + '</strong></td>' +
                       '<td><strong style="color:var(--success);">' + Number(d.amount).toLocaleString() + ' د.ع</strong></td>' +
                       '<td>' + walletText + '</td>' +
                       '<td>' + receiptText + '</td>' +
                       '<td><span class="badge-status status-' + d.status + '">' + statusText + '</span></td>' +
                       '<td>' + actionBtn + '</td>' +
                     '</tr>';
            }).join('');

            // تخزين الباقات وعرضها عبر دالة موحدة (تدعم التصنيف حسب المستثمر)
            renderPackagesTable(packages);

            document.getElementById('with-table').innerHTML = withdrawals.map(function(w) {
              var walletText = w.wallet_type === 'profit' ? 'من الأرباح' : 'من رأس المال';
              var statusText = w.status === 'approved' ? '✅ مقبول' : '⏳ قيد الانتظار';
              var actionBtn = w.status === 'pending' ? '<button data-id="' + w.id + '" class="btn-approve act-with-approve"><i class="fa-solid fa-check"></i> موافقة على السحب</button>' : '-';

              return '<tr>' +
                       '<td><strong>' + w.phone_number + '</strong></td>' +
                       '<td><strong style="color:var(--danger);">' + Number(w.amount).toLocaleString() + ' د.ع</strong></td>' +
                       '<td>' + walletText + '</td>' +
                       '<td>' + w.payment_method + ': <code>' + w.account_details + '</code></td>' +
                       '<td><span class="badge-status status-' + w.status + '">' + statusText + '</span></td>' +
                       '<td>' + actionBtn + '</td>' +
                     '</tr>';
            }).join('');

            document.getElementById('users-table').innerHTML = users.map(function(u) {
              var refUser = users.find(function(x) { return x.id === u.referred_by; });
              var isBlocked = u.is_blocked || false;
              var blockedBadge = isBlocked ? '<span style="color:var(--danger); font-size:11px;">(حساب مجمد 🛑)</span>' : '';
              var refName = refUser ? refUser.full_name : '-';
              var kycDocText = u.kyc_doc ? '<a href="' + u.kyc_doc + '" target="_blank" class="link-view"><i class="fa-solid fa-eye"></i> معاينة</a>' : 'غير مرفوع';
              var kycStatusText = u.kyc_status === 'approved' ? '🔰 موثق' : '⏳ غير موثق';
              var toggleBlockIcon = isBlocked ? '<i class="fa-solid fa-lock-open"></i>' : '<i class="fa-solid fa-ban"></i>';
              var blockBtnClass = isBlocked ? 'btn-approve' : 'btn-danger';
              var safeName = (u.full_name || '').replace(/"/g, '&quot;');

              var adminActions = adminRole === 'super_admin' ? 
                '<div style="display:flex; gap:6px;">' +
                  '<button data-id="' + u.id + '" data-name="' + safeName + '" class="btn-action act-open-modal" style="padding:4px 8px; font-size:11px; border-color:var(--accent-gold); color:var(--accent-gold);" title="تعديل الرصيد">' +
                    '<i class="fa-solid fa-sliders"></i> الرصيد' +
                  '</button>' +
                  '<button data-id="' + u.id + '" data-blocked="' + (!isBlocked) + '" data-name="' + safeName + '" class="btn-action ' + blockBtnClass + ' act-toggle-block" style="padding:4px 8px; font-size:11px;" title="حظر / فك حظر">' +
                    toggleBlockIcon +
                  '</button>' +
                  '<button data-id="' + u.id + '" data-name="' + safeName + '" class="btn-action btn-danger act-delete-user" style="padding:4px 8px; font-size:11px; background:rgba(239, 68, 68, 0.3);" title="حذف الحساب نهائياً">' +
                    '<i class="fa-solid fa-trash-can"></i>' +
                  '</button>' +
                '</div>' : '<span style="color:var(--text-muted); font-size:11px;">صلاحية مدير رئيسي</span>';

              return '<tr>' +
                       '<td><strong>' + u.full_name + '</strong> ' + blockedBadge + '</td>' +
                       '<td>' + u.phone_number + '</td>' +
                       '<td>' + refName + '</td>' +
                       '<td>' + kycDocText + '</td>' +
                       '<td><span class="badge-status status-' + u.kyc_status + '">' + kycStatusText + '</span></td>' +
                       '<td>' + adminActions + '</td>' +
                     '</tr>';
            }).join('');
          } catch (err) {
            console.error('خطأ في جلب بيانات الإدارة:', err);
          }
        }

        async function togglePackageStatus(pkgName, setPaused) {
          try {
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
          } catch(e) {
            alert('❌ خطأ في الاتصال بالسيرفر');
          }
        }

        async function approveDep(id) {
          await fetch('/api/admin/deposits/status', { method: 'PATCH', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer ' + adminToken}, body: JSON.stringify({ id: id, status: 'approved' }) });
          loadAdminData();
        }

        async function approveWith(id) {
          await fetch('/api/admin/withdrawals/status', { method: 'PATCH', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer ' + adminToken}, body: JSON.stringify({ id: id, status: 'approved' }) });
          loadAdminData();
        }

        async function approvePkg(id) {
          var res = await fetch('/api/admin/packages/approve', { method: 'PATCH', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer ' + adminToken}, body: JSON.stringify({ id: id }) });
          var data = await res.json();
          if (data.success) {
            loadAdminData();
          } else {
            alert('❌ ' + data.error);
          }
        }

        async function cancelPkg(id, pkgName) {
          if (!confirm('⚠️ هل أنت متأكد من إلغاء الباقة: ' + (pkgName || '') + '؟\\nسيتم حذف الباقة واسترجاع المبلغ المستثمر إلى رصيد المستثمر.')) return;
          var res = await fetch('/api/admin/packages/cancel', { method: 'DELETE', headers: {'Content-Type':'application/json', 'Authorization': 'Bearer ' + adminToken}, body: JSON.stringify({ id: id }) });
          var data = await res.json();
          if (data.success) {
            alert('✅ ' + data.message);
            loadAdminData();
          } else {
            alert('❌ ' + data.error);
          }
        }

        // دالة موحدة لعرض الباقات مع دعم التصنيف حسب المستثمر
        function renderPackagesTable(packages) {
          allPackagesData = packages;
          var filterSelect = document.getElementById('pkg-investor-filter');
          var currentFilter = filterSelect ? filterSelect.value : '';

          // تعبئة قائمة الفلترة بأسماء المستثمرين (رقم الهاتف)
          if (filterSelect) {
            var uniqueInvestors = {};
            packages.forEach(function(p) {
              if (p.phone_number && !uniqueInvestors[p.phone_number]) {
                uniqueInvestors[p.phone_number] = true;
              }
            });
            var investorOptions = '<option value="">عرض جميع المستثمرين</option>';
            Object.keys(uniqueInvestors).sort().forEach(function(phone) {
              var pkgCount = packages.filter(function(p) { return p.phone_number === phone; }).length;
              investorOptions += '<option value="' + phone + '"' + (currentFilter === phone ? ' selected' : '') + '>' + phone + ' (' + pkgCount + ' باقة)</option>';
            });
            filterSelect.innerHTML = investorOptions;
            if (currentFilter) filterSelect.value = currentFilter;
          }

          // تصفية الباقات حسب المستثمر المختار
          var filteredPackages = currentFilter ? packages.filter(function(p) { return p.phone_number === currentFilter; }) : packages;
          var countLabel = document.getElementById('pkg-filter-count');
          if (countLabel) countLabel.innerText = currentFilter ? 'عرض ' + filteredPackages.length + ' باقة لهذا المستثمر' : '';

          // ترتيب الباقات: تجميعها حسب المستثمر ثم حسب الحالة (pending أولاً ثم active ثم completed)
          filteredPackages.sort(function(a, b) {
            if (a.phone_number !== b.phone_number) {
              return a.phone_number < b.phone_number ? -1 : 1;
            }
            var orderA = a.status === 'pending' ? 0 : (a.status === 'active' ? 1 : 2);
            var orderB = b.status === 'pending' ? 0 : (b.status === 'active' ? 1 : 2);
            return orderA - orderB;
          });

          document.getElementById('pkg-table').innerHTML = filteredPackages.map(function(p) {
            var dateFormatted = p.end_date ? new Date(p.end_date).toLocaleDateString('ar-IQ') : '-';
            var statusText = p.status === 'active' ? '⚡ نشطة' : (p.status === 'completed' ? '🎉 مكتملة' : '⏳ قيد الانتظار للموافقة');
            var cancelBtn = '<button data-id="' + p.id + '" data-name="' + (p.plan_name || '') + '" class="btn-action btn-danger act-pkg-cancel" style="padding:4px 10px; font-size:11px; margin-top:5px;"><i class="fa-solid fa-rotate-left"></i> إلغاء الباقة</button>';
            var actionBtn = p.status === 'pending'
              ? '<button data-id="' + p.id + '" class="btn-approve act-pkg-approve"><i class="fa-solid fa-check"></i> موافقة وتفعيل</button><br>' + cancelBtn
              : (p.status === 'active' ? cancelBtn : '-');

            return '<tr>' +
                     '<td><strong>' + p.phone_number + '</strong></td>' +
                     '<td><strong style="color:var(--accent-gold);">' + p.plan_name + '</strong></td>' +
                     '<td>' + Number(p.invested_amount).toLocaleString() + ' د.ع</td>' +
                     '<td><strong style="color:var(--success);">' + Number(p.expected_payout).toLocaleString() + ' د.ع</strong></td>' +
                     '<td>' + dateFormatted + '</td>' +
                     '<td><span class="badge-status status-' + p.status + '">' + statusText + '</span></td>' +
                     '<td>' + actionBtn + '</td>' +
                   '</tr>';
          }).join('');
        }

        // دالة تصفية الباقات عند تغيير القائمة المنسدلة
        function filterPackagesByInvestor() {
          if (allPackagesData && allPackagesData.length > 0) {
            renderPackagesTable(allPackagesData);
          }
        }

        async function triggerPackagePayouts() {
          document.getElementById('payout-msg').innerText = 'جاري فحص وصرف أرباح الباقات...';
          var res = await fetch('/api/admin/packages/payout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken } });
          var data = await res.json();
          document.getElementById('payout-msg').innerText = data.success ? '✅ ' + data.message : '❌ ' + data.error;
          document.getElementById('payout-msg').style.color = data.success ? 'var(--success)' : 'var(--danger)';
          loadAdminData();
        }

        async function sendBroadcastMessage() {
          var title = document.getElementById('broadcast-title').value.trim();
          var message = document.getElementById('broadcast-msg-text').value.trim();
          var msgEl = document.getElementById('broadcast-msg');

          if (!title || !message) return alert('يرجى أدخال عنوان الإعلان ونصه قبل الإرسال!');
          if (!confirm('هل أنت متأكد من إرسال هذا الإعلان لجميع المستثمرين عبر تلجرام والموقع؟')) return;

          msgEl.innerText = 'جاري إرسال الإشعار لجميع المستثمرين...';
          msgEl.style.color = 'var(--warning)';

          try {
            var res = await fetch('/api/admin/broadcast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
              body: JSON.stringify({ title: title, message: message })
            });

            var data = await res.json();
            msgEl.innerText = data.success ? '✅ ' + data.message : '❌ ' + data.error;
            msgEl.style.color = data.success ? 'var(--success)' : 'var(--danger)';

            if (data.success) {
              document.getElementById('broadcast-title').value = '';
              document.getElementById('broadcast-msg-text').value = '';
            }
          } catch (e) {
            msgEl.innerText = '❌ خطأ أثناء عملية الإرسال';
            msgEl.style.color = 'var(--danger)';
          }
        }

        function openBalanceModal(userId, userName) {
          document.getElementById('modal-user-id').value = userId;
          document.getElementById('modal-user-info').innerText = 'المستثمر: ' + userName;
          document.getElementById('modal-amount').value = '';
          document.getElementById('modal-reason').value = '';
          document.getElementById('modal-msg').innerText = '';
          document.getElementById('balance-modal').style.display = 'flex';
        }

        function closeBalanceModal() {
          document.getElementById('balance-modal').style.display = 'none';
        }

        async function submitBalanceAdjustment() {
          var userId = document.getElementById('modal-user-id').value;
          var actionType = document.getElementById('modal-action-type').value;
          var walletType = document.getElementById('modal-wallet-type').value;
          var amount = document.getElementById('modal-amount').value;
          var reason = document.getElementById('modal-reason').value;
          var msg = document.getElementById('modal-msg');

          if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً!');

          msg.innerText = 'جاري تعديل الرصيد...';
          msg.style.color = 'var(--warning)';

          try {
            var res = await fetch('/api/admin/users/adjust-balance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
              body: JSON.stringify({ userId: userId, actionType: actionType, walletType: walletType, amount: amount, reason: reason })
            });

            var data = await res.json();
            msg.innerText = data.success ? '✅ ' + data.message : '❌ ' + data.error;
            msg.style.color = data.success ? 'var(--success)' : 'var(--danger)';

            if (data.success) {
              setTimeout(function() { closeBalanceModal(); loadAdminData(); }, 1200);
            }
          } catch (e) {
            msg.innerText = '❌ حدث خطأ أثناء التعديل';
            msg.style.color = 'var(--danger)';
          }
        }

        async function toggleBlockUser(userId, isBlocked, userName) {
          var actionText = isBlocked ? 'حظر وتجميد' : 'فك حظر';
          if (!confirm('هل أنت متأكد من (' + actionText + ') حساب المستثمر ' + userName + '؟')) return;

          try {
            var res = await fetch('/api/admin/users/toggle-block', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
              body: JSON.stringify({ userId: userId, isBlocked: isBlocked })
            });

            var data = await res.json();
            if (data.success) {
              alert('✅ ' + data.message);
              loadAdminData();
            } else {
              alert('❌ ' + data.error);
            }
          } catch (e) {
            alert('❌ حدث خطأ أثناء تنفيذ الإجراء');
          }
        }

        async function deleteUser(userId, userName) {
          var msg = 'تحذير هام! هل أنت متأكد من حذف حساب المستثمر (' + userName + ')؟ سيتم مسح جميع بياناته نهائياً.';
          if (!confirm(msg)) return;

          try {
            var res = await fetch('/api/admin/users/' + userId, {
              method: 'DELETE',
              headers: { 'Authorization': 'Bearer ' + adminToken }
            });

            var data = await res.json();

            if (data.success) {
              alert('✅ ' + data.message);
              loadAdminData();
            } else {
              alert('❌ ' + data.error);
            }
          } catch (e) {
            alert('❌ حدث خطأ أثناء تنفيذ عملية الحذف');
          }
        }
      </script>
      <script>
        // تسجيل Service Worker للوحة الإدارة — تحديث تلقائي
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.register('/sw.js?v=${APP_VERSION}').then(function(reg) {
            reg.addEventListener('updatefound', function() {
              var newWorker = reg.installing;
              newWorker.addEventListener('statechange', function() {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  location.reload();
                }
              });
            });
            setInterval(function() { reg.update(); }, 300000);
          }).catch(function(err) {
            console.log('SW registration failed: ', err);
          });
          navigator.serviceWorker.addEventListener('controllerchange', function() {
            location.reload();
          });
        }
      </script>
    </body>
    </html>
  `);
});


// ==========================================
// 3. المسارات الخلفية والمحمية (Secured APIs & Role System)
// ==========================================

app.get('/api/packages/settings', async (req, res) => {
  try { await loadPersistentSettings(); res.json({ success: true, data: packageStatusMemory }); } catch (err) { res.status(503).json({ success: false, error: err.message }); }
});

// ==========================================
// API: جلب أسعار وعوائد الباقات (عام للمستثمرين)
// ==========================================
app.get('/api/packages/pricing', async (req, res) => {
  try { await loadPersistentSettings(); res.json({ success: true, data: packagePricingMemory }); } catch (err) { res.status(503).json({ success: false, error: err.message }); }
});

// ==========================================
// API: حفظ أسعار وعوائد الباقات (Super Admin فقط)
// ==========================================
app.post('/api/admin/packages/pricing', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { pricing } = req.body;
    await loadPersistentSettings();
    if (!pricing || typeof pricing !== 'object') {
      return res.status(400).json({ success: false, error: 'بيانات الأسعار غير صحيحة.' });
    }
    for (const [pkgName, vals] of Object.entries(pricing)) {
      if (packagePricingMemory[pkgName]) {
        const price = Number(normalizeDigits(vals?.price));
        const payout = Number(normalizeDigits(vals?.payout));
        if (Number.isFinite(price) && price > 0 && Number.isFinite(payout) && payout >= price) {
          packagePricingMemory[pkgName] = { price, payout, months: packagePricingMemory[pkgName].months };
        } else {
          return res.status(400).json({ success: false, error: `قيمة غير صحيحة للباقة: ${pkgName}. يجب أن يكون السعر والعائد أرقاماً موجبة وأن يكون العائد أكبر أو مساوياً للسعر.` });
        }
      }
    }
    await savePersistentSetting(SETTINGS_KEYS.pricing, packagePricingMemory);
    res.json({ success: true, message: 'تم تحديث أسعار وعوائد الباقات وحفظها بشكل دائم في Supabase!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/announcement', async (req, res) => {
  try { await loadPersistentSettings(); res.json({ success: true, data: announcementMemory }); } catch (err) { res.status(503).json({ success: false, error: err.message }); }
});

app.post('/api/admin/announcement', authenticateAdmin, async (req, res) => {
  try {
    const { active, text } = req.body;
    announcementMemory = { active: Boolean(active), text: String(text || '').slice(0, 1000) };
    await savePersistentSetting(SETTINGS_KEYS.announcement, announcementMemory);
    res.json({ success: true, message: 'تم تحديث الشريط الإعلاني بنجاح وسيظهر للمستثمرين فوراً!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/packages/toggle', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { package_name, is_paused } = req.body;
    if (package_name) {
      await loadPersistentSettings();
      packageStatusMemory[package_name] = !is_paused;
      await savePersistentSetting(SETTINGS_KEYS.packageStatus, packageStatusMemory);
    }
    res.json({ success: true, message: 'تم تحديث حالة الباقة بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    if (TELEGRAM_WEBHOOK_SECRET && req.get('x-telegram-bot-api-secret-token') !== TELEGRAM_WEBHOOK_SECRET) return res.sendStatus(403);
    const update = req.body;
    if (update && update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.trim();

      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        if (parts.length > 1) {
          const userId = parts[1].trim();

          const { data, error } = await supabase
            .from('users')
            .update({ telegram_chat_id: chatId })
            .eq('id', userId)
            .select();

          if (!error && data && data.length > 0) {
            await sendTelegramNotification(
              chatId,
              `✅ <b>أهلاً بك ${data[0].full_name}!</b>\n\nتم ربط حسابك في منصة <b>مَكْسَب الاستثمارية</b> بنجاح 🚀.\nستصلك جميع إشعارات الإيداع، السحب، واكتمال الباقات هنا فوراً.`
            );
          } else {
            await sendTelegramNotification(chatId, `❌ عذراً، لم نتمكن من العثور على حسابك. يرجى إعادة محاولة الضغط على الزر داخل المنصة.`);
          }
        } else {
          await sendTelegramNotification(chatId, `مرحباً بك في بوت منصة <b>مَكْسَب الاستثمارية</b> 🌟.\nلربط حسابك، يرجى الضغط على زر "تفعيل إشعارات تلجرام" من داخل حسابك بالمنصة.`);
        }
      }
    }
  } catch (err) {
    console.error('Webhook Error:', err.message);
  }
  res.sendStatus(200);
});

// مسار تسجيل دخول الإدارة المطور (يدعم المدير الرئيسي والمشرف المساعد)
app.post('/api/admin/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const rawInput = req.body.password ? String(req.body.password).trim() : '';
    const superPass = String(ADMIN_PASSWORD).trim();
    const modPass = String(MODERATOR_PASSWORD).trim();

    if (rawInput === superPass) {
      const token = jwt.sign({ isAdmin: true, isModerator: true, role: 'super_admin' }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ success: true, token, role: 'super_admin' });
    } else if (rawInput === modPass) {
      const token = jwt.sign({ isAdmin: false, isModerator: true, role: 'moderator' }, JWT_SECRET, { expiresIn: '12h' });
      return res.json({ success: true, token, role: 'moderator' });
    } else {
      return res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), async (req, res) => {
  try {
    const { phone_number, password, full_name, referred_by } = req.body;
    if (!phone_number || String(phone_number).trim().length < 6 || !password || String(password).length < 8 || !full_name || String(full_name).trim().length < 2) {
      return res.status(400).json({ success: false, error: 'الاسم ورقم الهاتف وكلمة المرور (8 أحرف على الأقل) مطلوبة.' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    let validRef = (referred_by && referred_by.trim() !== '' && referred_by !== 'null') ? referred_by.trim() : null;

    const { data, error } = await supabase.from('users').insert([{
      phone_number: phone_number.trim(),
      password: hashedPassword,
      full_name,
      kyc_status: 'pending',
      referred_by: validRef
    }]).select();

    if (error) throw new Error(error.code === '23505' ? 'رقم الهاتف مسجل مسبقاً' : error.message);

    const user = data[0];
    const token = jwt.sign({ id: user.id, phone: user.phone_number }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name, phone_number: user.phone_number } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// نظام تحديد محاولات تسجيل الدخول الفاشلة (5 محاولات → قفل مؤقت 15 دقيقة)
const loginAttemptsMap = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 دقيقة

app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), async (req, res) => {
  try {
    const { phone_number, password } = req.body;
    const phoneKey = phone_number ? phone_number.trim() : '';
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const lockKey = phoneKey + '|' + clientIp;

    // فحص القفل المؤقت
    const attemptData = loginAttemptsMap.get(lockKey);
    if (attemptData && attemptData.lockedUntil && Date.now() < attemptData.lockedUntil) {
      const remainingMin = Math.ceil((attemptData.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ success: false, error: 'تم قفل الحساب مؤقتاً بسبب محاولات دخول خاطئة متكررة. يرجى المحاولة بعد ' + remainingMin + ' دقيقة.' });
    }

    const { data: user, error } = await supabase.from('users').select('id, full_name, phone_number, kyc_status, kyc_doc, is_blocked, referred_by, telegram_chat_id, onesignal_player_id, created_at').eq('phone_number', phoneKey).single();

    if (error || !user) throw new Error('بيانات الدخول غير صحيحة');

    if (user.is_blocked) {
      return res.status(403).json({ success: false, error: 'تم تجميد حسابك بقرار إداري. يرجى مراجعة الدعم الفني.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // تسجيل محاولة فاشلة
      var current = loginAttemptsMap.get(lockKey) || { count: 0, lockedUntil: 0 };
      current.count += 1;
      if (current.count >= MAX_LOGIN_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
        current.count = 0;
        loginAttemptsMap.set(lockKey, current);
        return res.status(429).json({ success: false, error: 'تم تجاوز الحد الأقصى لمحاولات الدخول الخاطئة. تم قفل الحساب مؤقتاً لمدة 15 دقيقة.' });
      }
      loginAttemptsMap.set(lockKey, current);
      var remaining = MAX_LOGIN_ATTEMPTS - current.count;
      throw new Error('بيانات الدخول غير صحيحة. محاولات متبقية: ' + remaining);
    }

    // تسجيل دخول ناجح → إعادة تعيين المحاولات
    loginAttemptsMap.delete(lockKey);

    const token = jwt.sign({ id: user.id, phone: user.phone_number }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, user: { id: user.id, full_name: user.full_name, phone_number: user.phone_number } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/packages/subscribe', authenticateUser, async (req, res) => {
  try {
    await loadPersistentSettings();
    const { plan_name, invested_amount, expected_payout, duration_months } = req.body;

    if (packageStatusMemory[plan_name] === false) {
      return res.status(400).json({ success: false, error: 'عذراً، هذه الباقة متوقفة مؤقتاً من قبل الإدارة حالياً.' });
    }

    const configuredPlan = packagePricingMemory[plan_name];
    if (!configuredPlan) return res.status(400).json({ success: false, error: 'الباقة غير معروفة.' });
    const amountNeeded = Number(configuredPlan.price);
    const payoutAmount = Number(configuredPlan.payout);
    const duration = Number(configuredPlan.months);

    const { data: deps } = await supabase.from('deposits').select('amount').eq('user_id', req.user.id).eq('status', 'approved').eq('wallet_type', 'capital');
    const { data: withs } = await supabase.from('withdrawals').select('amount').eq('user_id', req.user.id).eq('status', 'approved').eq('wallet_type', 'capital');

    let totalCapital = (deps || []).reduce((acc, d) => acc + Number(d.amount), 0);
    let totalWithdrawnCapital = (withs || []).reduce((acc, w) => acc + Number(w.amount), 0);
    let availableCapital = totalCapital - totalWithdrawnCapital;

    if (availableCapital < amountNeeded) {
      return res.status(400).json({
        success: false,
        error: `رصيدك المتاح (${availableCapital.toLocaleString()} د.ع) غير كافٍ للاشتراك بهذه الباقة.`
      });
    }

    const isAnnual = duration === 12;
    const endDate = new Date();
    if (isAnnual) {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const { error: pkgErr } = await supabase.from('investment_packages').insert([{
      user_id: req.user.id,
      phone_number: req.user.phone,
      plan_name,
      invested_amount: amountNeeded,
      expected_payout: payoutAmount,
      status: 'pending',
      end_date: endDate.toISOString()
    }]);

    if (pkgErr) throw pkgErr;

    await supabase.from('notifications').insert([{
      user_id: req.user.id,
      title: '⏳ طلب اشتراك قيد المراجعة',
      message: `تم تقديم طلب الاشتراك بـ (${plan_name}) بمبلغ ${amountNeeded.toLocaleString()} د.ع وهو بانتظار موافقة الإدارة.`
    }]);

    res.json({ success: true, message: 'تم إرسال طلب الاشتراك بنجاح وهو الآن بانتظار موافقة وتفعيل الإدارة.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/admin/packages/approve', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    const { data: pkg } = await supabase.from('investment_packages').select('*').eq('id', id).single();

    if (!pkg) return res.status(404).json({ success: false, error: 'الباقة غير موجودة' });
    if (pkg.status !== 'pending') return res.status(409).json({ success: false, error: 'لا يمكن اعتماد الباقة من حالتها الحالية.' });

    await supabase.from('withdrawals').insert([{
      user_id: pkg.user_id,
      phone_number: pkg.phone_number,
      amount: pkg.invested_amount,
      payment_method: 'تخصيص لباقة استثمارية',
      account_details: pkg.plan_name,
      status: 'approved',
      wallet_type: 'capital'
    }]);

    await supabase.from('investment_packages').update({ status: 'active' }).eq('id', id);

    await supabase.from('notifications').insert([{
      user_id: pkg.user_id,
      title: '🚀 تفعيل باقتك الاستثمارية',
      message: `تمت الموافقة على طلب اشتراكك بـ (${pkg.plan_name}) وتفعيلها بنجاح!`
    }]);

    const { data: usr } = await supabase.from('users').select('telegram_chat_id, onesignal_player_id').eq('id', pkg.user_id).single();
    if (usr) {
      if (usr.onesignal_player_id) {
        await sendOneSignalNotification([usr.onesignal_player_id], "🚀 تفعيل باقتك الاستثمارية", `تمت الموافقة على اشتراكك بـ (${pkg.plan_name}) وتفعيلها بنجاح.`);
      }
      if (usr.telegram_chat_id) {
        await sendTelegramNotification(usr.telegram_chat_id, `🚀 <b>تفعيل الباقة الاستثمارية!</b>\n\nتمت الموافقة على طلب اشتراكك بـ <b>${pkg.plan_name}</b> وتفعيلها بنجاح.`);
      }
    }

    res.json({ success: true, message: 'تمت الموافقة على الباقة وتفعيلها بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// إلغاء باقة استثمارية نشطة واسترجاع المبلغ للمستثمر
app.delete('/api/admin/packages/cancel', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    const { data: pkg } = await supabase.from('investment_packages').select('*').eq('id', id).single();

    if (!pkg) return res.status(404).json({ success: false, error: 'الباقة غير موجودة' });

    // إذا كانت الباقة نشطة، نحذف سجل السحب المرتبط بها (تخصيص لباقة استثمارية) لاسترجاع المبلغ
    if (pkg.status === 'active') {
      await supabase.from('withdrawals')
        .delete()
        .eq('user_id', pkg.user_id)
        .eq('phone_number', pkg.phone_number)
        .eq('amount', pkg.invested_amount)
        .eq('wallet_type', 'capital')
        .eq('payment_method', 'تخصيص لباقة استثمارية')
        .eq('account_details', pkg.plan_name);
    }

    // حذف الباقة نهائياً
    await supabase.from('investment_packages').delete().eq('id', id);

    // إشعار المستثمر بإلغاء الباقة
    await supabase.from('notifications').insert([{
      user_id: pkg.user_id,
      title: '↩️ إلغاء باقة استثمارية',
      message: `تم إلغاء باقتك (${pkg.plan_name}) بمبلغ ${Number(pkg.invested_amount).toLocaleString()} د.ع وتم استرجاع المبلغ إلى رصيدك.`
    }]);

    const { data: usr } = await supabase.from('users').select('telegram_chat_id, onesignal_player_id').eq('id', pkg.user_id).single();
    if (usr) {
      if (usr.onesignal_player_id) {
        await sendOneSignalNotification([usr.onesignal_player_id], "↩️ إلغاء باقة استثمارية", `تم إلغاء باقتك (${pkg.plan_name}) واسترجاع مبلغ ${Number(pkg.invested_amount).toLocaleString()} د.ع إلى رصيدك.`);
      }
      if (usr.telegram_chat_id) {
        await sendTelegramNotification(usr.telegram_chat_id, `↩️ <b>إلغاء باقة استثمارية</b>\n\nتم إلغاء باقتك <b>${pkg.plan_name}</b> وتم استرجاع مبلغ <b>${Number(pkg.invested_amount).toLocaleString()} د.ع</b> إلى رصيدك بنجاح.`);
      }
    }

    res.json({ success: true, message: 'تم إلغاء الباقة واسترجاع المبلغ للمستثمر بنجاح!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/user/notifications', authenticateUser, async (req, res) => {
  const { data } = await supabase.from('notifications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(20);
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

const MIN_DEPOSIT_AMOUNT = 100000;
const MAX_DEPOSIT_AMOUNT = 1000000;

app.post('/api/deposits', authenticateUser, async (req, res) => {
  try {
    const { amount, transaction_ref, receipt_url, wallet_type } = req.body;
    const numAmount = positiveAmount(amount, MAX_DEPOSIT_AMOUNT);

    if (!numAmount) {
      return res.status(400).json({ success: false, error: 'يرجى إدخال مبلغ صحيح.' });
    }
    if (numAmount < MIN_DEPOSIT_AMOUNT) {
      return res.status(400).json({ success: false, error: `الحد الأدنى للشحن هو ${MIN_DEPOSIT_AMOUNT.toLocaleString()} د.ع.` });
    }
    if (!transaction_ref || String(transaction_ref).length > 200) return res.status(400).json({ success: false, error: 'مرجع المعاملة غير صحيح.' });

    // 🟢 الرفع إلى مجلد الإشعارات في Supabase Storage
    const publicUrl = await uploadToStorage(receipt_url, 'receipts');

    const { error } = await supabase.from('deposits').insert([{
      user_id: req.user.id,
      phone_number: req.user.phone,
      amount: numAmount,
      transaction_ref,
      receipt_url: publicUrl,
      status: 'pending',
      wallet_type: ['capital', 'profit'].includes(wallet_type) ? wallet_type : 'capital'
    }]);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/withdrawals', authenticateUser, rateLimit({ windowMs: 60 * 60 * 1000, max: 10 }), async (req, res) => {
  try {
    const { amount, payment_method, account_details, wallet_type } = req.body;
    const numAmount = positiveAmount(amount, 100000000);
    if (!numAmount || !payment_method || !account_details || !['capital', 'profit'].includes(wallet_type || 'capital')) return res.status(400).json({ success: false, error: 'بيانات السحب غير صحيحة.' });
    const selectedWallet = wallet_type || 'capital';
    const { data: depRows } = await supabase.from('deposits').select('amount').eq('user_id', req.user.id).eq('status', 'approved').eq('wallet_type', selectedWallet);
    const { data: withRows } = await supabase.from('withdrawals').select('amount').eq('user_id', req.user.id).eq('status', 'approved').eq('wallet_type', selectedWallet);
    const available = (depRows || []).reduce((a, x) => a + Number(x.amount), 0) - (withRows || []).reduce((a, x) => a + Number(x.amount), 0);
    if (numAmount > available) return res.status(400).json({ success: false, error: 'الرصيد المتاح لا يكفي لتنفيذ السحب.' });
    const { error } = await supabase.from('withdrawals').insert([{
      user_id: req.user.id,
      phone_number: req.user.phone,
      amount: numAmount,
      payment_method,
      account_details,
            status: 'pending',
      wallet_type: selectedWallet
    }]);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/user/kyc', authenticateUser, async (req, res) => {
  try {
    // 🟢 الرفع إلى مجلد الهويات في Supabase Storage
    const publicUrl = await uploadToStorage(req.body.kyc_doc, 'kyc-documents');
    
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

// API موحد: سجل جميع المعاملات (شحن + سحب + باقات) + إجمالي الأرباح المحققة
app.get('/api/user/transactions', authenticateUser, async (req, res) => {
  try {
    const [depRes, withRes, pkgRes] = await Promise.all([
      supabase.from('deposits').select('*').eq('user_id', req.user.id),
      supabase.from('withdrawals').select('*').eq('user_id', req.user.id),
      supabase.from('investment_packages').select('*').eq('user_id', req.user.id)
    ]);

    const deposits = (depRes.data || []).map(function(d) {
      return { id: 'dep_' + d.id, type: 'deposit', amount: Number(d.amount), wallet_type: d.wallet_type, status: d.status, created_at: d.created_at, label: 'شحن رصيد', ref: d.transaction_ref || '' };
    });
    const withdrawals = (withRes.data || []).map(function(w) {
      return { id: 'with_' + w.id, type: 'withdrawal', amount: Number(w.amount), wallet_type: w.wallet_type, status: w.status, created_at: w.created_at, label: 'سحب مالي', ref: w.account_details || '' };
    });
    const packages = (pkgRes.data || []).map(function(p) {
      return { id: 'pkg_' + p.id, type: 'package', amount: Number(p.invested_amount), expected_payout: Number(p.expected_payout), status: p.status, created_at: p.created_at, label: 'باقة استثمارية: ' + p.plan_name, ref: '' };
    });

    const allTransactions = deposits.concat(withdrawals).concat(packages)
      .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });

    // إجمالي الأرباح المحققة = مجموع (expected_payout - invested_amount) للباقات المكتملة
    let totalRealizedProfit = 0;
    (pkgRes.data || []).forEach(function(p) {
      if (p.status === 'completed') {
        totalRealizedProfit += (Number(p.expected_payout) - Number(p.invested_amount));
      }
    });

    res.json({ success: true, data: allTransactions, total_profit: totalRealizedProfit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// API: شبكة الإحالات — قائمة المسجلين عبر رابط المستثمر + إجمالي العمولات
// ==========================================
app.get('/api/user/referrals', authenticateUser, async (req, res) => {
  try {
    const { data: referredUsers } = await supabase.from('users')
      .select('id, full_name, phone_number, kyc_status, created_at')
      .eq('referred_by', req.user.id)
      .order('created_at', { ascending: false });

    const { data: commissionDeposits } = await supabase.from('deposits')
      .select('amount, status')
      .eq('user_id', req.user.id)
      .like('transaction_ref', 'COMMISSION_%');

    let totalCommissions = 0;
    (commissionDeposits || []).forEach(function(d) {
      if (d.status === 'approved') totalCommissions += Number(d.amount);
    });

    res.json({
      success: true,
      data: referredUsers || [],
      total_commissions: totalCommissions,
      referral_count: (referredUsers || []).length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/deposits', authenticateAdmin, async (req, res) => {
  const { data } = await supabase.from('deposits').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.get('/api/admin/withdrawals', authenticateAdmin, async (req, res) => {
  const { data } = await supabase.from('withdrawals').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.get('/api/admin/users', verifyAdminToken, async (req, res) => {
  try {
    // 1. جلب كافة الحسابات من جدول public.users
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('*');

    if (error) throw error;

    return res.json({
      success: true,
      data: users
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/packages', authenticateAdmin, async (req, res) => {
  const { data } = await supabase.from('investment_packages').select('*').order('created_at', { ascending: false });
  res.json({ success: true, data: data || [] });
});

app.patch('/api/admin/users/verify-kyc', authenticateAdmin, async (req, res) => {
  await supabase.from('users').update({ kyc_status: 'approved' }).eq('id', req.body.userId);
  res.json({ success: true });
});

app.patch('/api/admin/withdrawals/status', authenticateAdmin, async (req, res) => {
  const { id, status } = req.body;
  await supabase.from('withdrawals').update({ status }).eq('id', id);

  if (status === 'approved') {
    const { data: withItem } = await supabase.from('withdrawals').select('*').eq('id', id).single();
    if (withItem) {
      const { data: usr } = await supabase.from('users').select('telegram_chat_id, onesignal_player_id').eq('id', withItem.user_id).single();
      if (usr) {
        if (usr.onesignal_player_id) {
          await sendOneSignalNotification([usr.onesignal_player_id], "💸 موافقة على السحب", `تمت الموافقة على سحب مبلغ ${Number(withItem.amount).toLocaleString()} د.ع.`);
        }
        if (usr.telegram_chat_id) {
          await sendTelegramNotification(usr.telegram_chat_id, `💸 <b>موافقة على طلب السحب!</b>\n\nتمت الموافقة على طلب سحب مبلغ <b>${Number(withItem.amount).toLocaleString()} د.ع</b> وتحويله لحسابك.`);
        }
      }
    }
  }

  res.json({ success: true });
});

app.patch('/api/admin/deposits/status', authenticateAdmin, async (req, res) => {
  try {
    const { id, status } = req.body;
    await supabase.from('deposits').update({ status }).eq('id', id);

    if (status === 'approved') {
      const { data: dep } = await supabase.from('deposits').select('*').eq('id', id).single();

      if (dep && dep.wallet_type === 'capital') {
        await supabase.from('notifications').insert([{
          user_id: dep.user_id,
          title: '✅ تأكيد شحن الرصيد',
          message: `تم قبول شحن رصيدك بمبلغ ${Number(dep.amount).toLocaleString()} د.ع بنجاح.`
        }]);

        const { data: usr } = await supabase.from('users').select('telegram_chat_id, onesignal_player_id').eq('id', dep.user_id).single();
        if (usr) {
          if (usr.onesignal_player_id) {
            await sendOneSignalNotification([usr.onesignal_player_id], "✅ تأكيد شحن الرصيد", `تم قبول شحن رصيدك بمبلغ ${Number(dep.amount).toLocaleString()} د.ع بنجاح.`);
          }
          if (usr.telegram_chat_id) {
            await sendTelegramNotification(usr.telegram_chat_id, `✅ <b>تم شحن الرصيد!</b>\n\nتم تأكيد وإضافة مبلغ <b>${Number(dep.amount).toLocaleString()} د.ع</b> إلى رصيدك المتاح لشراء الباقات.`);
          }
        }

        const { data: userDeps } = await supabase.from('deposits').select('id').eq('user_id', dep.user_id).eq('status', 'approved').eq('wallet_type', 'capital');
        if (userDeps && userDeps.length === 1) {
          const { data: usrData } = await supabase.from('users').select('referred_by').eq('id', dep.user_id).single();
          if (usrData && usrData.referred_by) {
            const { data: refUser } = await supabase.from('users').select('phone_number, telegram_chat_id, onesignal_player_id').eq('id', usrData.referred_by).single();
            const commission = Number(dep.amount) * 0.02;
            if (refUser && commission > 0) {
              await supabase.from('deposits').insert([{
                user_id: usrData.referred_by, phone_number: refUser.phone_number, amount: commission, transaction_ref: 'COMMISSION_' + dep.user_id, receipt_url: 'AUTO_COMMISSION', status: 'approved', wallet_type: 'profit'
              }]);

              await supabase.from('notifications').insert([{
                user_id: usrData.referred_by,
                title: '🎁 مكافأة إحالة جديدة (2%)',
                message: `تم إضافة عمولة بمبلغ ${commission.toLocaleString()} د.ع لحسابك نتيجة تسجيل مستثمر جديد عبر رابطك.`
              }]);

              if (refUser.onesignal_player_id) {
                await sendOneSignalNotification([refUser.onesignal_player_id], "🎁 مكافأة إحالة جديدة (2%)", `تم إضافة عمولة 2% بقيمة ${commission.toLocaleString()} د.ع لرصيد أرباحك.`);
              }
              if (refUser.telegram_chat_id) {
                await sendTelegramNotification(refUser.telegram_chat_id, `🎁 <b>مكافأة إحالة جديدة!</b>\n\nتم إضافة عمولة 2% بقيمة <b>${commission.toLocaleString()} د.ع</b> لرصيد أرباحك نتيجة شحن مستثمر جديد عبر رابطك.`);
              }
            }
          }
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/packages/payout', authenticateAdmin, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const { data: expiredPackages } = await supabase
      .from('investment_packages')
      .select('*')
      .eq('status', 'active')
      .lte('end_date', now);

    let count = 0;
    for (let pkg of (expiredPackages || [])) {
      const payoutRef = 'PAYOUT_PKG_' + pkg.id;
      const { data: existingPayout } = await supabase.from('deposits').select('id').eq('transaction_ref', payoutRef).limit(1);
      if (existingPayout && existingPayout.length) {
        await supabase.from('investment_packages').update({ status: 'completed' }).eq('id', pkg.id).eq('status', 'active');
        continue;
      }
      await supabase.from('deposits').insert([{
        user_id: pkg.user_id,
        phone_number: pkg.phone_number,
        amount: pkg.expected_payout,
        transaction_ref: payoutRef,
        receipt_url: 'AUTO_PACKAGE_PAYOUT',
        status: 'approved',
        wallet_type: 'profit'
      }]);

      await supabase.from('investment_packages').update({ status: 'completed' }).eq('id', pkg.id);

      await supabase.from('notifications').insert([{
        user_id: pkg.user_id,
        title: '🎉 اكتمال الباقة وصرف العائد',
        message: `تم اكتمال مدة (${pkg.plan_name}) بنجاح، وتحويل العائد قدره ${Number(pkg.expected_payout).toLocaleString()} د.ع إلى محفظة أرباحك!`
      }]);

      const { data: usr } = await supabase.from('users').select('telegram_chat_id, onesignal_player_id').eq('id', pkg.user_id).single();
      if (usr) {
        if (usr.onesignal_player_id) {
          await sendOneSignalNotification([usr.onesignal_player_id], "🎉 اكتمال الباقة وصرف العائد", `تم اكتمال مدة (${pkg.plan_name}) وصرف العائد بقيمة ${Number(pkg.expected_payout).toLocaleString()} د.ع.`);
        }
        if (usr.telegram_chat_id) {
          await sendTelegramNotification(
            usr.telegram_chat_id,
            `🎉 <b>اكتمال الباقة الاستثمارية!</b>\n\nنود إعلامك باكتمل مدة <b>${pkg.plan_name}</b> وصرف عائد قدره <b>${Number(pkg.expected_payout).toLocaleString()} د.ع</b> إلى محفظة أرباحك.`
          );
        }
      }

      count++;
    }

    res.json({ success: true, message: `تم صرف أرباح ${count} باقة مكتملة وإرسال التنبيهات للمستثمرين بنجاح!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/broadcast', authenticateAdmin, async (req, res) => {
  try {
    const { title, message } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'العنوان والنص مطلوبان' });
    }

    const { data: users, error } = await supabase.from('users').select('id, telegram_chat_id, onesignal_player_id');
    if (error) throw error;

    let telegramSentCount = 0;
    let pushSentCount = 0;
    const notifInserts = [];

    for (const u of (users || [])) {
      notifInserts.push({
        user_id: u.id,
        title: title,
        message: message
      });

      if (u.onesignal_player_id) {
        await sendOneSignalNotification([u.onesignal_player_id], title, message);
        pushSentCount++;
      }

      if (u.telegram_chat_id) {
        await sendTelegramNotification(
          u.telegram_chat_id,
          `📢 <b>${title}</b>\n\n${message}`
        );
        telegramSentCount++;
      }
    }

    if (notifInserts.length > 0) {
      await supabase.from('notifications').insert(notifInserts);
    }

    res.json({
      success: true,
      message: `تم إرسال الإعلان لـ (${users.length}) مستثمر بالموقع، (${pushSentCount}) عبر الموبايل، و (${telegramSentCount}) عبر تلجرام بنجاح! 🚀`
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/admin/users/toggle-block', authenticateAdmin, async (req, res) => {
  try {
    const { userId, isBlocked } = req.body;

    const { data: user, error } = await supabase
      .from('users')
      .update({ is_blocked: isBlocked })
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    if (isBlocked && user.telegram_chat_id) {
      await sendTelegramNotification(
        user.telegram_chat_id,
        `⚠️ <b>تنبيه إداري:</b> تم تجميد حسابك في المنصة مؤقتاً. يرجى التواصل مع الإدارة لمزيد من التفاصيل.`
      );
    }

    res.json({
      success: true,
      message: isBlocked ? `تم حظر حساب المستثمر (${user.full_name})` : `تم إلغاء حظر حساب (${user.full_name})`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/users/adjust-balance', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { userId, actionType, walletType, amount, reason } = req.body;
    const numAmount = parseFloat(amount);

    if (!userId || !numAmount || numAmount <= 0) {
      return res.status(400).json({ success: false, error: 'جميع البيانات مطلوبة وبقيمة صحيحة' });
    }

    const { data: user } = await supabase.from('users').select('phone_number, telegram_chat_id, onesignal_player_id, full_name').eq('id', userId).single();
    if (!user) return res.status(404).json({ success: false, error: 'المستخدم غير موجود' });

    const note = reason ? `تسوية إدارية: ${reason}` : 'تسوية إدارية مباشرة';

    if (actionType === 'add') {
      await supabase.from('deposits').insert([{
        user_id: userId,
        phone_number: user.phone_number,
        amount: numAmount,
        transaction_ref: 'ADMIN_CREDIT',
        receipt_url: 'INTERNAL_ADJUSTMENT',
        status: 'approved',
        wallet_type: walletType || 'capital'
      }]);
    } else {
      await supabase.from('withdrawals').insert([{
        user_id: userId,
        phone_number: user.phone_number,
        amount: numAmount,
        payment_method: 'خصم إداري',
        account_details: note,
        status: 'approved',
        wallet_type: walletType || 'capital'
      }]);
    }

    const walletName = walletType === 'profit' ? 'محفظة الأرباح' : 'محفظة رأس المال';
    const actionText = actionType === 'add' ? 'إضافة' : 'خصم';

    await supabase.from('notifications').insert([{
      user_id: userId,
      title: `⚙️ تعديل رصيد (${actionText})`,
      message: `تم ${actionText} مبلغ ${numAmount.toLocaleString()} د.ع في ${walletName}. (${note})`
    }]);

    if (user.onesignal_player_id) {
      await sendOneSignalNotification([user.onesignal_player_id], `⚙️ تعديل رصيد (${actionText})`, `تم ${actionText} مبلغ ${numAmount.toLocaleString()} د.ع في ${walletName}.`);
    }
    if (user.telegram_chat_id) {
      await sendTelegramNotification(
        user.telegram_chat_id,
        `⚙️ <b>إشعار تعديل رصيد:</b>\n\nتم <b>${actionText}</b> مبلغ <b>${numAmount.toLocaleString()} د.ع</b> في ${walletName}.\n<b>ملاحظة:</b> ${note}`
      );
    }

    res.json({
      success: true,
      message: `تمت عملية الـ (${actionText}) بمبلغ ${numAmount.toLocaleString()} د.ع لـ (${user.full_name}) بنجاح!`
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/users/:userId', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    await supabase.from('notifications').delete().eq('user_id', userId);
    await supabase.from('investment_packages').delete().eq('user_id', userId);
    await supabase.from('deposits').delete().eq('user_id', userId);
    await supabase.from('withdrawals').delete().eq('user_id', userId);

    const { error } = await supabase.from('users').delete().eq('id', userId);

    if (error) throw error;

    res.json({
      success: true,
      message: 'تم حذف حساب المستثمر وكافة بياناته المالية نهائياً!'
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// إشعار قبل اكتمال الباقة بـ 24 ساعة (فحص دوري كل ساعة)
// ==========================================
// ==========================================
// إشعار قبل اكتمال الباقة بـ 24 ساعة (مع حماية التكرار)
// ==========================================
async function checkPreCompletionPackages() {
  try {
    const now = new Date();
    const twentyFourHoursLater = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const { data: activePackages } = await supabase.from('investment_packages')
      .select('id, user_id, plan_name, invested_amount, expected_payout, end_date')
      .eq('status', 'active')
      .not('end_date', 'is', null);

    if (!activePackages || activePackages.length === 0) return;

    for (const pkg of activePackages) {
      const endDate = new Date(pkg.end_date);
      if (endDate > now && endDate <= twentyFourHoursLater) {
        
        // 🟢 الفحص المباشر في قاعدة البيانات: هل أُرسل إشعار مسبق لهذه الباقة؟
        const notifTitle = '⏰ باقتك على وشك الاكتمال';
        const { data: existingNotif } = await supabase.from('notifications')
          .select('id')
          .eq('user_id', pkg.user_id)
          .eq('title', notifTitle)
          .like('message', `%(${pkg.plan_name})%`)
          .limit(1);

        if (existingNotif && existingNotif.length > 0) continue; // تم الإشعار مسبقاً

        const { data: usr } = await supabase.from('users')
          .select('phone_number, telegram_chat_id, onesignal_player_id')
          .eq('id', pkg.user_id)
          .single();

        if (usr) {
          const notifMsg = `باقتك (${pkg.plan_name}) ستكتمل خلال 24 ساعة. العائد المتوقع: ${Number(pkg.expected_payout).toLocaleString()} د.ع. تابع لوحة التحكم لمتابعة الصرف.`;

          await supabase.from('notifications').insert([{
            user_id: pkg.user_id,
            title: notifTitle,
            message: notifMsg
          }]);

          if (usr.onesignal_player_id) {
            await sendOneSignalNotification([usr.onesignal_player_id], notifTitle, notifMsg);
          }
          if (usr.telegram_chat_id) {
            await sendTelegramNotification(usr.telegram_chat_id, `⏰ <b>باقتك على وشك الاكتمال!</b>\n\nباقتك <b>${pkg.plan_name}</b> ستكتمل خلال 24 ساعة.\nالعائد المتوقع: <b>${Number(pkg.expected_payout).toLocaleString()} د.ع</b>\n\nتابع لوحة التحكم لمتابعة عملية الصرف.`);
          }

          console.log(`🔔 تم إرسال إشعار قبل الاكتمال للباقة ${pkg.id} (${pkg.plan_name})`);
        }
      }
    }
  } catch (err) {
    console.error('❌ خطأ في فحص إشعارات قبل الاكتمال:', err.message);
  }
}
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});