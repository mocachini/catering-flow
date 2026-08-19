# Catering Flow V2

Website admin catering dengan:
- Customer CRUD
- Supplier + quota Lunch/Dinner
- Schedule/order per tanggal
- Bulk recurring schedule
- Confirm / Cancel
- Quota guard
- Upload delivery proof
- Delivered tracking
- WhatsApp generator
- Dashboard

## 1. Jalankan lokal
Buka folder ini di VS Code lalu install extension **Live Server**. Klik kanan `index.html` → **Open with Live Server**.

## 2. Mode demo
Kalau `config.js` kosong, website berjalan dalam Demo Mode. Data hanya di browser tab/sesi dan bukan database online.

## 3. Aktifkan database online (Supabase)
1. Buat project Supabase.
2. Buka SQL Editor.
3. Copy semua isi `supabase.sql`, lalu Run.
4. Ambil Project URL dan browser anon/publishable key dari Project Settings → API.
5. Isi `config.js`:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
6. Refresh website.

**Jangan pernah memasukkan `service_role` key ke `config.js`.**

## 4. Catatan keamanan
SQL demo ini memakai policy terbuka agar mudah dites. Sebelum production, tambahkan Supabase Auth dan ubah RLS policy agar hanya user/admin yang login yang boleh membaca/menulis.

## 5. Operasional
- Customer baru: Customers → Add Customer
- Supplier/kuota: Suppliers → Add/Edit
- Jadwal: Schedules / Orders → Add Schedule
- Seminggu: Add Schedule → Generate Schedule
- Cancel H-1: Orders → Cancel
- Delivery: Delivery → Upload Delivery
- WhatsApp: WhatsApp → pilih tanggal/supplier/meal → Copy

## Customer quota & revenue
Set quota and price separately for Lunch and Dinner on each customer.
- Customer quota is reduced only when an order becomes Delivered.
- Cancelled orders do not reduce customer quota.
- A new order is blocked if it exceeds the customer's remaining quota or supplier quota.
- Revenue is calculated from Delivered portions × that customer's price for the meal.
- Dashboard and Delivery/Quota views show revenue.

## Supplier buying price + profit
Each supplier has a separate Lunch/Dinner buying price.
Each order stores a price snapshot:
- selling_price = customer price at booking
- buying_price = supplier cost at booking
This prevents historical orders changing when prices are updated later.
Dashboard calculates Revenue, Cost, Gross Profit and Margin for Delivered orders.
