import { useState } from 'react';
import { supabase } from '../config/supabaseClient.js';

export default function DepositForm({ userPhone }) {
  const [amount, setAmount] = useState('');
  const [transactionRef, setTransactionRef] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatusMessage('');

    try {
      if (!file) throw new Error('يرجى اختيار صورة إشعار التحويل.');

      // 1. رفع صورة الإشعار إلى قسم Storage في Supabase
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${transactionRef}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // جلب رابط الصورة العام
      const { data: publicUrlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(fileName);

      // 2. تسجيل طلب الإيداع في جدول deposits
      const { error: dbError } = await supabase
        .from('deposits')
        .insert([
          {
            phone_number: userPhone,
            amount: parseFloat(amount),
            transaction_ref: transactionRef,
            receipt_url: publicUrlData.publicUrl,
            status: 'pending'
          }
        ]);

      if (dbError) throw dbError;

      setStatusMessage('✅ تم إرسال طلب الإيداع بنجاح! سيتم مراجعته وتفعيل الرصيد في حسابك.');
      setAmount('');
      setTransactionRef('');
      setFile(null);
    } catch (err) {
      setStatusMessage(`❌ خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '420px', margin: '30px auto', padding: '25px', borderRadius: '12px', backgroundColor: '#ffffff', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', fontFamily: 'sans-serif', direction: 'rtl' }}>
      <h2 style={{ color: '#0A2540', textAlign: 'center', marginBottom: '20px' }}>إيداع جديد - منصة مَكْسَب</h2>
      
      <form onSubmit={handleDepositSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>المبلغ المودع:</label>
          <input 
            type="number" 
            placeholder="أدخل المبلغ"
            value={amount} 
            onChange={(e) => setAmount(e.target.value)} 
            required 
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>رقم عملية التحويل (Ref ID):</label>
          <input 
            type="text" 
            placeholder="رقم العملية من الإشعار"
            value={transactionRef} 
            onChange={(e) => setTransactionRef(e.target.value)} 
            required 
            style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', color: '#333' }}>إشعار التحويل (Mastercard / SuperKey):</label>
          <input 
            type="file" 
            accept="image/*" 
            onChange={(e) => setFile(e.target.files[0])} 
            required 
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <button 
          type="submit" 
          disabled={loading} 
          style={{ width: '100%', padding: '12px', backgroundColor: '#0A2540', color: '#D4AF37', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '16px' }}
        >
          {loading ? 'جاري إرسال الطلب...' : 'تأكيد وإرسال الإيداع'}
        </button>
      </form>

      {statusMessage && (
        <p style={{ marginTop: '20px', padding: '10px', borderRadius: '6px', textAlign: 'center', backgroundColor: statusMessage.includes('✅') ? '#e6fffa' : '#ffebe9', color: statusMessage.includes('✅') ? '#107c41' : '#d13438' }}>
          {statusMessage}
        </p>
      )}
    </div>
  );
}س