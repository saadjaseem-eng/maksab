import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';

export default function App() {
  const [activeTab, setActiveTab] = useState('client');
  const [deposits, setDeposits] = useState([]);
  
  // بيانات نموذج الإيداع
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [refId, setRefId] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [message, setMessage] = useState('');

  // جلب الإيداعات للوحة التحكم
  const fetchDeposits = async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/admin/deposits`);
      if (res.data.success) {
        setDeposits(res.data.deposits || []);
      }
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err.message);
    }
  };

  useEffect(() => {
    if (activeTab === 'admin') {
      fetchDeposits();
    }
  }, [activeTab]);

  // إرسال طلب إيداع جديد
  const handleDepositSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE_URL}/api/deposits`, {
        phone_number: phone,
        amount: amount,
        transaction_ref: refId,
        receipt_url: receiptUrl || 'https://via.placeholder.com/150'
      });

      if (res.data.success) {
        setMessage('✅ تم إرسال طلب الإيداع بنجاح!');
        setPhone('');
        setAmount('');
        setRefId('');
        setReceiptUrl('');
      }
    } catch (err) {
      setMessage(`❌ خطأ: ${err.message}`);
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', direction: 'rtl', padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      {/* شريط التنقل */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', justifyContent: 'center' }}>
        <button 
          onClick={() => setActiveTab('client')}
          style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'client' ? '#0A2540' : '#e0e0e0', color: activeTab === 'client' ? '#D4AF37' : '#333', cursor: 'pointer', fontWeight: 'bold' }}
        >
          واجهة الزبون (إيداع)
        </button>
        <button 
          onClick={() => setActiveTab('admin')}
          style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'admin' ? '#0A2540' : '#e0e0e0', color: activeTab === 'admin' ? '#D4AF37' : '#333', cursor: 'pointer', fontWeight: 'bold' }}
        >
          لوحة الإدارة (الطلبات)
        </button>
      </div>

      {/* واجهة الزبون */}
      {activeTab === 'client' && (
        <div style={{ backgroundColor: '#f9f9f9', padding: '20px', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2>طلب إيداع جديد - منصة مَكْسَب</h2>
          <form onSubmit={handleDepositSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input type="text" placeholder="رقم الهاتف" value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
            <input type="number" placeholder="المبلغ المودع" value={amount} onChange={(e) => setAmount(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
            <input type="text" placeholder="رقم عملية التحويل (Ref ID)" value={refId} onChange={(e) => setRefId(e.target.value)} required style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
            <input type="text" placeholder="رابط صورة الإشعار (اختياري للتجربة)" value={receiptUrl} onChange={(e) => setReceiptUrl(e.target.value)} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
            <button type="submit" style={{ padding: '12px', backgroundColor: '#0A2540', color: '#D4AF37', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>إرسال الإيداع</button>
          </form>
          {message && <p style={{ marginTop: '15px', fontWeight: 'bold' }}>{message}</p>}
        </div>
      )}

      {/* واجهة الإدارة */}
      {activeTab === 'admin' && (
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', border: '1px solid #ddd' }}>
          <h2>طلبات الإيداع قيد الانتظار ⏳</h2>
          {deposits.length === 0 ? (
            <p>لا توجد طلبات معلقة حالياً.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
              <thead>
                <tr style={{ backgroundColor: '#0A2540', color: '#fff' }}>
                  <th style={{ padding: '8px', textAlign: 'right' }}>الهاتف</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>المبلغ</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>رقم العملية</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {deposits.map((dep) => (
                  <tr key={dep.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>{dep.phone_number}</td>
                    <td style={{ padding: '8px' }}>{dep.amount}</td>
                    <td style={{ padding: '8px' }}>{dep.transaction_ref}</td>
                    <td style={{ padding: '8px', color: 'orange', fontWeight: 'bold' }}>{dep.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}