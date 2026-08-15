import { supabase } from '../config/supabaseClient.js';

/**
 * دالة توزيع الأرباح الشهرية المتغيرة على جميع المحافظ
 * @param {string} monthYear - الشهر والسنة بصيغة (YYYY-MM)
 * @param {number} netProfit - صافي أرباح المشاريع الواقعية لهذا الشهر
 * @param {number} investorSharePercentage - النسبة المئوية المخصصة للمستثمرين (مثلاً 10)
 */
export async function distributeMonthlyProfits(monthYear, netProfit, investorSharePercentage) {
  try {
    // 1. حساب المبلغ الإجمالي المخصص للمستثمرين
    const totalInvestorProfit = (netProfit * investorSharePercentage) / 100;

    // 2. جلب جميع المحافظ النشطة من Supabase
    const { data: wallets, error: fetchError } = await supabase
      .from('wallets')
      .select('*')
      .gt('active_capital', 0);

    if (fetchError) throw fetchError;
    if (!wallets || wallets.length === 0) {
      return { success: false, message: 'لا يوجد رؤوس أموال نشطة للتوزيع عليها.' };
    }

    // 3. احتساب إجمالي رأس المال النشط في المنصة
    const totalPlatformCapital = wallets.reduce((sum, wallet) => sum + parseFloat(wallet.active_capital), 0);

    // 4. تحديث أرباح كل مستثمر حسب نسبة مشاركته
    for (const wallet of wallets) {
      const userShareRatio = parseFloat(wallet.active_capital) / totalPlatformCapital;
      const userProfit = totalInvestorProfit * userShareRatio;
      const updatedProfit = parseFloat(wallet.withdrawable_profit || 0) + userProfit;

      const { error: updateError } = await supabase
        .from('wallets')
        .update({ withdrawable_profit: updatedProfit })
        .eq('id', wallet.id);

      if (updateError) console.error(`خطأ أثناء تحديث محفظة المستخدم ${wallet.id}:`, updateError.message);
    }

    // 5. تسجل السجل في جدول الأرباح الشهرية
    await supabase.from('monthly_profits').insert([
      {
        month_year: monthYear,
        net_profit: netProfit,
        investor_share_percentage: investorSharePercentage
      }
    ]);

    return { success: true, message: `تم توزيع مبلغ $${totalInvestorProfit} بنجاح على ${wallets.length} مستثمر.` };

  } catch (err) {
    return { success: false, message: `حدث خطأ: ${err.message}` };
  }
}