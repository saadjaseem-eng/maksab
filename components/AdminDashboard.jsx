import { useState, useEffect } from 'react';
import { supabase } from '../config/supabaseClient';
import { distributeMonthlyProfits } from '../utils/profitCalculator';

export default function AdminDashboard() {
  const [pendingDeposits, setPendingDeposits] = useState([]);
  const [loading, setLoading] = useState(true);

  // بيانات نموذج توزيع الأرباح
  const [monthYear, setMonthYear] = useState('');
  const [netProfit, setNetProfit] = useState('');
  const [investorRate, setInvestorRate] = useState('');
  const [profitMessage, setProfitMessage] = useState('');

  // جلب الطلبات المعلقة من Supabase
  const fetchPendingDeposits = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('status', 'pending');

    if (!error) setPendingDeposits(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchPendingDeposits();
  }, []);

  // قبول الإيداع وتفعيل رأس مال المشترك
  const handleApprove = async (deposit) => {
    try {
      // 1. تحديث حالة الإيداع إلى مقبول
      await supabase
        .from('deposits')
        .update({ status: 'approved' })
        .eq('id', deposit.id);

      // 2. فحص ما إذا كان للمستخدم محفظة أو إنشاء واحدة
      const { data: wallet } = await supabase
        .from('wallets')
        .select('*')
        .eq('phone_number', deposit.phone_number)
        .single();

      if (wallet) {
        // تحديث رأس المال النشط
        const newCapital = parseFloat(wallet.active_capital) + parseFloat(deposit.amount);
        await supabase
          .from('wallets')
          .update({ active_capital: newCapital })
          .eq('id', wallet.id);
      } else {
        // إنشاء محفظة جديدة
        await supabase.from('wallets').insert([
          {
            user_name: `مستثمر (${deposit.phone_number})`,
            phone_number: deposit.phone_number,
            active_capital: deposit.amount,
            withdrawable_profit: 0
          }
        ]);
      }

      alert('تم قبول الإيداع وتحديث محفظة العميل بنجاح!');
      fetchPendingDeposits();
    } catch (err) {
      alert(`حدث خطأ: ${err.message}`);
    }
  };

  // تشغيل حاسبة الأرباح
  const handleDistribute = async (e) => {
    e.preventDefault();
    setProfitMessage('جاري توزيع الأرباح...');
    const result = await distributeMonthlyProfits(
      monthYear,
      parseFloat(netProfit),
      parseFloat(investorRate)
    );
    setProfitMessage(result.message);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '20px auto', padding: '20px', fontFamily: 'sans-serif', direction: 'rtl' }}>
      <h1 style={{ color: '#0A2540', borderBottom: '2px solid #D4AF37', paddingBottom: '10px' }}>لوحة تحكم إدارة منصة مَكْسَب</h1>

      {/* قسم 1: مراجعة طلبات الإيداع المعلقة */}
      <section style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '30px' }}>
        <h2>طلبات الإيداع قيد الانتظار ⏳</h2>
        {loading ? <p>جاري تحميل الطلبات...</p> : pendingDeposits.length === 0 ? <p>لا توجد طلبات إيداع معلقة حالياً.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right' }}>
            <thead>
              <tr style={{ backgroundColor: '#0A2540', color: '#fff' }}>
                <th style={{ padding: '8px' }}>رقم الهاتف</th>
                <th style={{ padding: '8px' }}>المبلغ</th>
                <th style={{ padding: '8px' }}>رقم العملية</th>
                <th style={{ padding: '8px' }}>الإشعار</th>
                <th style={{ padding: '8px' }}>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {pendingDeposits.map((dep) => (
                <tr key={dep.id} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '8px' }}>{dep.phone_number}</td>
                  <td style={{ padding: '8px' }}>{dep.amount}</td>
                  <td style={{ padding: '8px' }}>{dep.transaction_ref}</td>
                  <td style={{ padding: '8px' }}>
                    <a href={dep.receipt_url} target="_blank" rel="noreferrer" style={{ color: '#0066cc' }}>معاينة الصورة</a>
                  </td>
                  <td style={{ padding: '8px' }}>
                    <button onClick={() => handleApprove(dep)} style={{ backgroundColor: '#107c41', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>قبول وتفعيل</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* قسم 2: توزيع الأرباح الشهري */}
      <section style={{ backgroundColor: '#f0f4f8', padding: '15px', borderRadius: '8px' }}>
        <h2>توزيع الأرباح الشهري المتغير 💰</h2>
        <form onSubmit={handleDistribute}>
          <div style={{ marginBottom: '10px' }}>
            <label>الشهر والسنة (مثال: 2026-08): </label>
            <input type="text" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} required style={{ padding: '6px', marginRight: '5px' }} />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>صافي أرباح جميع المشاريع: </label>
            <input type="number" value={netProfit} onChange={(e) => setNetProfit(e.target.value)} required style={{ padding: '6px', marginRight: '5px' }} />
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label>نسبة أرباح المستثمرين (%): </label>
            <input type="number" value={investorRate} onChange={(e) => setInvestorRate(e.target.value)} required style={{ padding: '6px', marginRight: '5px' }} />
          </div>
          <button type="submit" style={{ backgroundColor: '#0A2540', color: '#D4AF37', border: 'none', padding: '10px 20px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>توزيع الأرباح الآن</button>
        </form>
        {profitMessage && <p style={{ marginTop: '15px', fontWeight: 'bold' }}>{profitMessage}</p>}
      </section>
    </div>
  );
}