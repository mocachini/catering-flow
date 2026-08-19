-- Catering Flow V2 — Supabase schema
create extension if not exists pgcrypto;

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lunch_quota integer not null default 0 check (lunch_quota >= 0),
  dinner_quota integer not null default 0 check (dinner_quota >= 0),
  lunch_buy_price numeric(14,2) not null default 0 check (lunch_buy_price >= 0),
  dinner_buy_price numeric(14,2) not null default 0 check (dinner_buy_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp text,
  address text not null,
  notes text,
  lunch_quota integer not null default 0 check (lunch_quota >= 0),
  dinner_quota integer not null default 0 check (dinner_quota >= 0),
  lunch_price numeric(14,2) not null default 0 check (lunch_price >= 0),
  dinner_price numeric(14,2) not null default 0 check (dinner_price >= 0),
  default_supplier_id uuid references suppliers(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete restrict,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  order_date date not null,
  meal text not null check (meal in ('Lunch','Dinner')),
  portions integer not null default 1 check (portions > 0),
  selling_price numeric(14,2) not null default 0 check (selling_price >= 0),
  buying_price numeric(14,2) not null default 0 check (buying_price >= 0),
  notes text,
  status text not null default 'Scheduled'
    check (status in ('Scheduled','Confirmed','Delivered','Cancelled')),
  delivery_photo_path text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_date_idx on orders(order_date);
create index if not exists orders_supplier_date_idx on orders(supplier_id, order_date);
create index if not exists orders_customer_date_idx on orders(customer_id, order_date);

-- Storage bucket for delivery photos.
insert into storage.buckets (id, name, public)
values ('delivery-proofs','delivery-proofs',true)
on conflict (id) do nothing;

-- Demo rows (optional; delete if you don't want seed data)
insert into suppliers(name,lunch_quota,dinner_quota)
select 'Thenie',30,30 where not exists(select 1 from suppliers where name='Thenie');
insert into suppliers(name,lunch_quota,dinner_quota)
select 'Pian Yi',20,20 where not exists(select 1 from suppliers where name='Pian Yi');
insert into suppliers(name,lunch_quota,dinner_quota)
select 'Supplier C',40,40 where not exists(select 1 from suppliers where name='Supplier C');

-- For a real production app, replace the permissive policies below with auth-based policies.
alter table suppliers enable row level security;
alter table customers enable row level security;
alter table orders enable row level security;

drop policy if exists "demo suppliers all" on suppliers;
create policy "demo suppliers all" on suppliers for all using (true) with check (true);
drop policy if exists "demo customers all" on customers;
create policy "demo customers all" on customers for all using (true) with check (true);
drop policy if exists "demo orders all" on orders;
create policy "demo orders all" on orders for all using (true) with check (true);

drop policy if exists "demo delivery read" on storage.objects;
create policy "demo delivery read" on storage.objects for select using (bucket_id='delivery-proofs');
drop policy if exists "demo delivery upload" on storage.objects;
create policy "demo delivery upload" on storage.objects for insert with check (bucket_id='delivery-proofs');

-- If you already created the table before adding customer quota/pricing, run these:
-- alter table customers add column if not exists lunch_quota integer not null default 0;
-- alter table customers add column if not exists dinner_quota integer not null default 0;
-- alter table customers add column if not exists lunch_price numeric(14,2) not null default 0;
-- alter table customers add column if not exists dinner_price numeric(14,2) not null default 0;

-- If the DB was already created, run:
-- alter table suppliers add column if not exists lunch_buy_price numeric(14,2) not null default 0;
-- alter table suppliers add column if not exists dinner_buy_price numeric(14,2) not null default 0;
-- alter table orders add column if not exists selling_price numeric(14,2) not null default 0;
-- alter table orders add column if not exists buying_price numeric(14,2) not null default 0;
