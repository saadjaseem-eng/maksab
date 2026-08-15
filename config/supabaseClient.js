import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// قراءة ملف .env
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// حماية للتأكد من وجود القيم قبل الاتصال
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ خطأ: لم يتم العثور على SUPABASE_URL أو SUPABASE_ANON_KEY في ملف .env');
}

// إنشاء كائن الاتصال بقاعدة البيانات
export const supabase = createClient(supabaseUrl, supabaseAnonKey);