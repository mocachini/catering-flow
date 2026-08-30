const cfg = window.CATERING_CONFIG || {};
const hasSupabase = !!(
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  window.supabase
);

const sb = hasSupabase
  ? window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    )
  : null;


/* =========================================================
   STATE
========================================================= */

const state = {
  page: "dashboard",
  customers: [],
  suppliers: [],
  orders: [],
  date: new Date().toISOString().slice(0, 10),

  filterSupplier: "",
  filterMeal: "",
  filterStatus: "",
  search: ""
};


/* =========================================================
   DEMO DATA
========================================================= */

const demo = {
  suppliers: [
    {
      id: "s1",
      name: "Thenie",
      lunch_quota: 30,
      dinner_quota: 30,
      lunch_buy_price: 55000,
      dinner_buy_price: 60000,
      active: true
    },
    {
      id: "s2",
      name: "Pian Yi",
      lunch_quota: 20,
      dinner_quota: 20,
      lunch_buy_price: 50000,
      dinner_buy_price: 55000,
      active: true
    },
    {
      id: "s3",
      name: "Supplier C",
      lunch_quota: 40,
      dinner_quota: 40,
      lunch_buy_price: 48000,
      dinner_buy_price: 52000,
      active: true
    }
  ],

  customers: [
    {
      id: "c1",
      name: "Jordy",
      whatsapp: "08123456789",
      address: "Terravia Adora BSD City",
      notes: "Tidak pedas",
      default_supplier_id: "s1",

      // CURRENT BALANCE
      lunch_quota: 20,
      dinner_quota: 10,

      lunch_price: 75000,
      dinner_price: 80000,
      active: true
    },

    {
      id: "c2",
      name: "Tio Jason",
      whatsapp: "08129876543",
      address: "Jl. Trimezia VII No. 6, Gading Serpong",
      notes: "Menu siang dan malam sama",
      default_supplier_id: "s2",

      // CURRENT BALANCE
      lunch_quota: 15,
      dinner_quota: 15,

      lunch_price: 70000,
      dinner_price: 70000,
      active: true
    }
  ],

  orders: []
};

let demoMode = !hasSupabase;


/* =========================================================
   BASIC HELPERS
========================================================= */

function el(id) {
  return document.getElementById(id);
}

function esc(v = "") {
  return String(v).replace(
    /[&<>"']/g,
    m => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m])
  );
}

function todayLabel() {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "full"
  }).format(new Date());
}

function fmtDate(d) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(d + "T00:00:00"));
}

function supplierName(id) {
  return (
    state.suppliers.find(x => x.id === id)?.name || "-"
  );
}

function customerName(id) {
  return (
    state.customers.find(x => x.id === id)?.name || "-"
  );
}

function money(n) {
  return Number(n || 0).toLocaleString("id-ID");
}

function customerPrice(customer, meal) {
  return (
    Number(
      meal === "Lunch"
        ? customer?.lunch_price
        : customer?.dinner_price
    ) || 0
  );
}

function supplierPrice(supplier, meal) {
  return (
    Number(
      meal === "Lunch"
        ? supplier?.lunch_buy_price
        : supplier?.dinner_buy_price
    ) || 0
  );
}

function orderRevenue(o) {
  return (
    Number(o.portions || 0) *
    Number(
      o.selling_price ??
      customerPrice(
        state.customers.find(c => c.id === o.customer_id),
        o.meal
      )
    )
  );
}

function orderCost(o) {
  return (
    Number(o.portions || 0) *
    Number(
      o.buying_price ??
      supplierPrice(
        state.suppliers.find(s => s.id === o.supplier_id),
        o.meal
      )
    )
  );
}

function orderProfit(o) {
  return orderRevenue(o) - orderCost(o);
}

function badge(status) {
  return `<span class="badge ${String(status).toLowerCase()}">${esc(status)}</span>`;
}


/* =========================================================
   CUSTOMER QUOTA
   IMPORTANT:
   quota = CURRENT BALANCE ONLY
   Tidak menghitung histori Delivered.
========================================================= */

function customerRemaining(customer, meal) {
  if (!customer) return 0;

  return Number(
    meal === "Lunch"
      ? customer.lunch_quota
      : customer.dinner_quota
  ) || 0;
}


/*
  Ambil field quota customer.
*/
function customerQuotaField(meal) {
  return meal === "Lunch"
    ? "lunch_quota"
    : "dinner_quota";
}


/*
  Mengurangi quota customer setelah order benar-benar Delivered.
*/
async function deductCustomerQuota(order) {
  if (!order) return false;

  const customer = state.customers.find(
    c => c.id === order.customer_id
  );

  if (!customer) {
    alert("Customer tidak ditemukan.");
    return false;
  }

  const field = customerQuotaField(order.meal);

  const currentQuota = Number(customer[field] || 0);
  const portions = Number(order.portions || 0);

  if (portions <= 0) {
    alert("Jumlah porsi tidak valid.");
    return false;
  }

  if (currentQuota < portions) {
    alert(
      `Quota customer ${customer.name} untuk ${order.meal} tidak cukup.\n\n` +
      `Quota sekarang: ${currentQuota}\n` +
      `Porsi order: ${portions}`
    );

    return false;
  }

  const newQuota = currentQuota - portions;

  /*
    DEMO MODE
  */
  if (!sb) {
    customer[field] = newQuota;
    render();
    return true;
  }

  /*
    SUPABASE
  */
  const { error } = await sb
    .from("customers")
    .update({
      [field]: newQuota
    })
    .eq("id", customer.id);

  if (error) {
    alert(
      "Gagal mengurangi quota customer: " +
      error.message
    );
    return false;
  }

  await loadData();

  return true;
}


/*
  Mengembalikan quota customer.
  Dipakai jika suatu saat order Delivered dibatalkan
  atau status dikembalikan sebelum settlement.
*/
async function restoreCustomerQuota(order) {
  if (!order) return false;

  const customer = state.customers.find(
    c => c.id === order.customer_id
  );

  if (!customer) return false;

  const field = customerQuotaField(order.meal);

  const currentQuota = Number(customer[field] || 0);
  const portions = Number(order.portions || 0);

  const newQuota = currentQuota + portions;

  if (!sb) {
    customer[field] = newQuota;
    render();
    return true;
  }

  const { error } = await sb
    .from("customers")
    .update({
      [field]: newQuota
    })
    .eq("id", customer.id);

  if (error) {
    alert(
      "Gagal mengembalikan quota customer: " +
      error.message
    );
    return false;
  }

  await loadData();

  return true;
}


/* =========================================================
   SUPPLIER QUOTA
========================================================= */

function quotaFor(supplier, meal) {
  if (!supplier) return 0;

  return Number(
    meal === "Lunch"
      ? supplier.lunch_quota
      : supplier.dinner_quota
  ) || 0;
}

function usedQuota(
  supplierId,
  meal,
  date,
  statusOnly = false
) {
  return state.orders
    .filter(
      o =>
        o.supplier_id === supplierId &&
        o.meal === meal &&
        o.order_date === date &&
        o.status !== "Cancelled" &&
        (!statusOnly || o.status === "Delivered")
    )
    .reduce(
      (n, o) => n + Number(o.portions || 0),
      0
    );
}

function reservedQuota(
  supplierId,
  meal,
  date
) {
  return state.orders
    .filter(
      o =>
        o.supplier_id === supplierId &&
        o.meal === meal &&
        o.order_date === date &&
        o.status !== "Cancelled"
    )
    .reduce(
      (n, o) => n + Number(o.portions || 0),
      0
    );
}


/* =========================================================
   LOAD DATA
========================================================= */

async function loadData() {
  if (!sb) {
    state.suppliers = demo.suppliers;
    state.customers = demo.customers;
    state.orders = demo.orders;

    if (el("connectionText")) {
      el("connectionText").textContent =
        "Demo mode — local browser";
    }

    return;
  }

  const [s, c, o] = await Promise.all([
    sb
      .from("suppliers")
      .select("*")
      .order("name"),

    sb
      .from("customers")
      .select("*")
      .eq("active", true)
      .order("name"),

    sb
      .from("orders")
      .select("*")
      .order("order_date", {
        ascending: false
      })
  ]);

  if (s.error || c.error || o.error) {
    console.error(
      s.error || c.error || o.error
    );

    alert(
      "Gagal mengambil data Supabase. " +
      "Cek config.js dan SQL schema."
    );

    return;
  }

  state.suppliers = s.data || [];
  state.customers = c.data || [];
  state.orders = o.data || [];

  if (el("connectionText")) {
    el("connectionText").textContent =
      "● Connected to Supabase";
  }
}


/* =========================================================
   GENERIC SAVE
========================================================= */

async function save(
  table,
  payload,
  id = null
) {
  if (!sb) {
    const arr = state[table];

    if (id) {
      const index = arr.findIndex(
        x => x.id === id
      );

      if (index >= 0) {
        arr[index] = {
          ...arr[index],
          ...payload
        };
      }
    } else {
      arr.unshift({
        id: crypto.randomUUID(),
        ...payload
      });
    }

    render();

    return true;
  }

  let result;

  if (id) {
    result = await sb
      .from(table)
      .update(payload)
      .eq("id", id);
  } else {
    result = await sb
      .from(table)
      .insert(payload);
  }

  if (result.error) {
    alert(result.error.message);
    return false;
  }

  await loadData();
  render();

  return true;
}


/* =========================================================
   REMOVE ORDER
========================================================= */

async function removeOrder(id) {
  if (
    !confirm(
      "Hapus order ini?"
    )
  ) {
    return;
  }

  const order = state.orders.find(
    x => x.id === id
  );

  if (!order) return;

  if (order.status === "Delivered") {
    alert(
      "Order Delivered tidak boleh dihapus karena quota customer sudah terpakai."
    );
    return;
  }

  if (!sb) {
    state.orders = state.orders.filter(
      x => x.id !== id
    );

    render();

    return;
  }

  const { error } = await sb
    .from("orders")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
  } else {
    await loadData();
    render();
  }
}


/* =========================================================
   DASHBOARD PERIOD STATS
========================================================= */

function periodStats(type) {
  const today = state.date;

  const d = new Date(
    today + "T00:00:00"
  );

  let start;
  let end;

  if (type === "today") {
    start = today;
    end = today;
  }

  else if (type === "month") {
    start =
      `${d.getFullYear()}-` +
      `${String(d.getMonth() + 1).padStart(2, "0")}-01`;

    const next = new Date(
      d.getFullYear(),
      d.getMonth() + 1,
      1
    );

    end =
      `${next.getFullYear()}-` +
      `${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  }

  else {
    start =
      `${d.getFullYear()}-01-01`;

    end =
      `${d.getFullYear() + 1}-01-01`;
  }

  const orders = state.orders.filter(o => {
    if (o.status !== "Delivered") {
      return false;
    }

    if (type === "today") {
      return o.order_date === today;
    }

    return (
      o.order_date >= start &&
      o.order_date < end
    );
  });

  const revenue = orders.reduce(
    (n, o) => n + orderRevenue(o),
    0
  );

  const cost = orders.reduce(
    (n, o) => n + orderCost(o),
    0
  );

  const profit = revenue - cost;

  const portions = orders.reduce(
    (n, o) =>
      n + Number(o.portions || 0),
    0
  );

  return {
    orders: orders.length,
    portions,
    revenue,
    cost,
    profit,
    margin: revenue
      ? (profit / revenue) * 100
      : 0
  };
}


/* =========================================================
   MAIN RENDER
========================================================= */

function render() {
  const pages = {
    dashboard: [
      "Dashboard",
      "Overview operasional catering"
    ],

    customers: [
      "Customers",
      "Data customer & alamat"
    ],

    orders: [
      "Schedules / Orders",
      "Jadwal, konfirmasi, cancel & porsi"
    ],

    suppliers: [
      "Suppliers",
      "Supplier dan kuota Lunch/Dinner"
    ],

    delivery: [
      "Delivery",
      "Upload bukti delivery"
    ],

    quota: [
      "Quota",
      "Reserved vs actual delivered"
    ],

    whatsapp: [
      "WhatsApp",
      "Generate pesan supplier siap paste"
    ]
  };

  if (el("pageTitle")) {
    el("pageTitle").textContent =
      pages[state.page][0];
  }

  if (el("pageSubtitle")) {
    el("pageSubtitle").textContent =
      pages[state.page][1];
  }

  if (el("todayLabel")) {
    el("todayLabel").textContent =
      todayLabel();
  }

  document
    .querySelectorAll(".nav")
    .forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.page === state.page
      );
    });

  const body = {
    dashboard: dashboardPage,
    customers: customersPage,
    orders: ordersPage,
    suppliers: suppliersPage,
    delivery: deliveryPage,
    quota: quotaPage,
    whatsapp: whatsappPage
  }[state.page];

  if (el("app") && body) {
    el("app").innerHTML =
      `<div class="content">${body()}</div>`;
  }

  bindPage();
}


/* =========================================================
   DASHBOARD
========================================================= */

function dashboardPage() {
  const today = state.date;

  const allToday =
    state.orders.filter(
      o => o.order_date === today
    );

  const portions =
    allToday
      .filter(
        o => o.status !== "Cancelled"
      )
      .reduce(
        (n, o) =>
          n + Number(o.portions || 0),
        0
      );

  const delivered =
    allToday
      .filter(
        o => o.status === "Delivered"
      )
      .reduce(
        (n, o) =>
          n + Number(o.portions || 0),
        0
      );

  const cancelled =
    allToday
      .filter(
        o => o.status === "Cancelled"
      )
      .reduce(
        (n, o) =>
          n + Number(o.portions || 0),
        0
      );

  const todayStats =
    periodStats("today");

  const monthStats =
    periodStats("month");

  const yearStats =
    periodStats("year");


  const financeCard =
    (label, stats) => `
      <div class="finance-card">
        <div class="muted">
          ${label}
        </div>

        <div class="finance-row">
          <span>Revenue</span>
          <b>
            Rp ${money(stats.revenue)}
          </b>
        </div>

        <div class="finance-row">
          <span>Cost</span>
          <b>
            Rp ${money(stats.cost)}
          </b>
        </div>

        <div class="finance-row">
          <span>Gross Profit</span>
          <b>
            Rp ${money(stats.profit)}
          </b>
        </div>

        <div class="finance-footer">
          <span>
            ${stats.orders} delivered orders ·
            ${stats.portions} portions
          </span>

          <b>
            Margin ${stats.margin.toFixed(1)}%
          </b>
        </div>
      </div>
    `;


  return `
    <div class="cards">

      <div class="card">
        <div class="muted">
          Customers
        </div>

        <div class="metric">
          ${state.customers.length}
        </div>
      </div>


      <div class="card">
        <div class="muted">
          Today's orders
        </div>

        <div class="metric">
          ${allToday.length}
        </div>
      </div>


      <div class="card">
        <div class="muted">
          Today's portions
        </div>

        <div class="metric">
          ${portions}
        </div>
      </div>


      <div class="card">
        <div class="muted">
          Delivered / Cancelled
        </div>

        <div class="metric">
          ${delivered} / ${cancelled}
        </div>
      </div>

    </div>


    <div class="panel finance-panel">

      <div class="section-title">
        <div>
          <h2>
            Financial Overview
          </h2>

          <div class="hint">
            Revenue, cost & gross profit
            dari order yang sudah Delivered
          </div>
        </div>
      </div>


      <div class="finance-grid">

        ${financeCard(
          "Today",
          todayStats
        )}

        ${financeCard(
          "This Month",
          monthStats
        )}

        ${financeCard(
          "This Year",
          yearStats
        )}

      </div>

    </div>


    <div class="grid2">


      <!-- CUSTOMER QUOTA -->

      <div class="panel">

        <div class="section-title">

          <h2>
            Customer Quota
          </h2>

          <button
            class="mini"
            data-page-go="customers"
          >
            View all
          </button>

        </div>


        ${state.customers
          .slice(0, 8)
          .map(c => `

            <div
              style="
                padding:10px 0;
                border-bottom:1px solid var(--line)
              "
            >

              <b>
                ${esc(c.name)}
              </b>

              <div class="hint">

                Lunch:
                ${customerRemaining(c, "Lunch")}

                ·

                Dinner:
                ${customerRemaining(c, "Dinner")}

                ·

                Revenue:
                Rp ${
                  money(
                    state.orders
                      .filter(
                        o =>
                          o.customer_id === c.id &&
                          o.status === "Delivered"
                      )
                      .reduce(
                        (n, o) =>
                          n + orderRevenue(o),
                        0
                      )
                  )
                }

              </div>

            </div>

          `)
          .join("")}

      </div>


      <!-- TODAY -->

      <div class="panel">

        <div class="section-title">

          <h2>
            Today
          </h2>

          <button
            class="secondary"
            data-action="add-order"
          >
            ＋ Add Schedule
          </button>

        </div>


        <div class="table-wrap">

          ${
            allToday.length

              ? allToday
                  .slice(0, 8)
                  .map(orderRow)
                  .join("")

              : `
                <div class="empty">
                  Belum ada order untuk
                  ${fmtDate(today)}
                </div>
              `
          }

        </div>

      </div>


      <!-- SUPPLIER QUOTA -->

      <div class="panel">

        <div class="section-title">

          <h2>
            Quota Today
          </h2>

          <button
            class="mini"
            data-page-go="quota"
          >
            View all
          </button>

        </div>


        ${state.suppliers
          .filter(s => s.active)
          .map(s => {

            const lunchReserved =
              reservedQuota(
                s.id,
                "Lunch",
                today
              );

            const dinnerReserved =
              reservedQuota(
                s.id,
                "Dinner",
                today
              );

            return `

              <div class="quota-row">

                <b>
                  ${esc(s.name)}
                </b>


                <div>

                  <div class="muted">

                    Lunch
                    ${lunchReserved}
                    /
                    ${s.lunch_quota}

                  </div>


                  <div class="bar">

                    <span
                      style="
                        width:${Math.min(
                          100,
                          lunchReserved /
                          Math.max(
                            1,
                            Number(s.lunch_quota || 0)
                          ) *
                          100
                        )}%
                      "
                    ></span>

                  </div>


                  <div class="hint">

                    Dinner
                    ${dinnerReserved}
                    /
                    ${s.dinner_quota}

                  </div>

                </div>


                <b>
                  ${
                    Math.max(
                      0,
                      Number(s.lunch_quota || 0) -
                      lunchReserved
                    )
                  }
                </b>

              </div>

            `;
          })
          .join("")}

      </div>

    </div>
  `;
}


/* =========================================================
   ORDER ROW
========================================================= */

function orderRow(o) {

  return `
    <tr>

      <td>
        ${fmtDate(o.order_date)}
      </td>


      <td>

        <b>
          ${esc(
            customerName(o.customer_id)
          )}
        </b>

        <div class="muted">
          ${esc(o.notes || "")}
        </div>

      </td>


      <td>
        ${esc(
          supplierName(o.supplier_id)
        )}
      </td>


      <td>
        ${esc(o.meal)}
      </td>


      <td>
        ${Number(o.portions || 0)}
      </td>


      <td>

        ${
          o.status === "Delivered"
            ? `Rp ${money(
                orderRevenue(o)
              )}`
            : "-"
        }

      </td>


      <td>

        ${
          o.status === "Delivered"
            ? `Rp ${money(
                orderCost(o)
              )}`
            : "-"
        }

      </td>


      <td>

        ${
          o.status === "Delivered"
            ? `Rp ${money(
                orderProfit(o)
              )}`
            : "-"
        }

      </td>


      <td>
        ${badge(o.status)}
      </td>


      <td>

        <div class="actions">


          ${
            o.status !== "Delivered" &&
            o.status !== "Cancelled"

              ? `
                <button
                  class="mini"
                  data-action="edit-order"
                  data-id="${o.id}"
                >
                  Edit
                </button>

                <button
                  class="mini"
                  data-action="cancel"
                  data-id="${o.id}"
                >
                  Cancel
                </button>
              `

              : ""
          }


          ${
            o.status === "Confirmed"

              ? `
                <button
                  class="mini"
                  data-action="deliver"
                  data-id="${o.id}"
                >
                  📸 Deliver
                </button>
              `

              : ""
          }


          ${
            o.status === "Scheduled"

              ? `
                <button
                  class="mini"
                  data-action="confirm"
                  data-id="${o.id}"
                >
                  Confirm
                </button>
              `

              : ""
          }

        </div>

      </td>

    </tr>
  `;
}


/* =========================================================
   TABLE HELPER
========================================================= */

function tableWrap(rows, heads) {

  return `
    <div class="table-wrap">

      <table class="table">

        <thead>

          <tr>

            ${heads
              .map(
                h => `<th>${h}</th>`
              )
              .join("")}

          </tr>

        </thead>


        <tbody>

          ${
            rows ||
            `
              <tr>

                <td
                  colspan="${heads.length}"
                  class="empty"
                >
                  Tidak ada data
                </td>

              </tr>
            `
          }

        </tbody>

      </table>

    </div>
  `;
}


/* =========================================================
   CUSTOMERS PAGE
========================================================= */

function customersPage() {

  const q =
    state.search.toLowerCase();

  const data =
    state.customers.filter(c =>
      (
        c.name +
        " " +
        c.address +
        " " +
        (c.whatsapp || "")
      )
        .toLowerCase()
        .includes(q)
    );


  return `

    <div class="panel">

      <div class="section-title">

        <h2>
          Customers
        </h2>

        <button
          class="primary"
          data-action="add-customer"
        >
          ＋ Add Customer
        </button>

      </div>


      <div class="toolbar">

        <input
          class="input"
          id="search"
          placeholder="Cari nama/alamat/WA..."
          value="${esc(state.search)}"
        >

      </div>


      ${tableWrap(

        data
          .map(c => `

            <tr>

              <td>

                <b>
                  ${esc(c.name)}
                </b>

                <div class="muted">
                  ${esc(c.whatsapp || "")}
                </div>

              </td>


              <td>
                ${esc(c.address)}
              </td>


              <td>
                ${esc(
                  supplierName(
                    c.default_supplier_id
                  )
                )}
              </td>


              <td>

                Lunch:
                <b>
                  ${customerRemaining(
                    c,
                    "Lunch"
                  )}
                </b>

                <br>

                Dinner:
                <b>
                  ${customerRemaining(
                    c,
                    "Dinner"
                  )}
                </b>

              </td>


              <td>

                Rp ${money(
                  c.lunch_price ?? 0
                )}

                /

                Rp ${money(
                  c.dinner_price ?? 0
                )}

              </td>


              <td>

                Rp ${
                  money(
                    state.orders
                      .filter(
                        o =>
                          o.customer_id === c.id &&
                          o.status === "Delivered"
                      )
                      .reduce(
                        (n, o) =>
                          n + orderRevenue(o),
                        0
                      )
                  )
                }

              </td>


              <td>

                Rp ${
                  money(
                    state.orders
                      .filter(
                        o =>
                          o.customer_id === c.id &&
                          o.status === "Delivered"
                      )
                      .reduce(
                        (n, o) =>
                          n + orderProfit(o),
                        0
                      )
                  )
                }

              </td>


              <td>
                ${esc(c.notes || "-")}
              </td>


              <td>

                <button
                  class="mini"
                  data-action="edit-customer"
                  data-id="${c.id}"
                >
                  Edit
                </button>

              </td>

            </tr>

          `)
          .join(""),

        [
          "Customer",
          "Alamat",
          "Default Supplier",
          "Quota L/D",
          "Harga L/D",
          "Revenue",
          "Profit",
          "Notes",
          ""
        ]

      )}

    </div>
  `;
}


/* =========================================================
   SUPPLIERS PAGE
========================================================= */

function suppliersPage() {

  return `

    <div class="panel">

      <div class="section-title">

        <h2>
          Suppliers
        </h2>

        <button
          class="primary"
          data-action="add-supplier"
        >
          ＋ Add Supplier
        </button>

      </div>


      ${tableWrap(

        state.suppliers
          .map(s => `

            <tr>

              <td>
                <b>
                  ${esc(s.name)}
                </b>
              </td>


              <td>
                ${s.lunch_quota}
              </td>


              <td>
                ${s.dinner_quota}
              </td>


              <td>

                Rp ${money(
                  s.lunch_buy_price ?? 0
                )}

                /

                Rp ${money(
                  s.dinner_buy_price ?? 0
                )}

              </td>


              <td>

                ${
                  s.active
                    ? "Active"
                    : "Inactive"
                }

              </td>


              <td>

                <button
                  class="mini"
                  data-action="edit-supplier"
                  data-id="${s.id}"
                >
                  Edit
                </button>

              </td>

            </tr>

          `)
          .join(""),

        [
          "Supplier",
          "Lunch quota",
          "Dinner quota",
          "Harga beli L/D",
          "Status",
          ""
        ]

      )}

    </div>
  `;
}


/* =========================================================
   ORDERS PAGE
========================================================= */

function ordersPage() {

  const date =
    state.date;

  let data =
    state.orders.filter(
      o =>
        o.order_date === date
    );


  if (state.filterSupplier) {
    data =
      data.filter(
        o =>
          o.supplier_id ===
          state.filterSupplier
      );
  }


  if (state.filterMeal) {
    data =
      data.filter(
        o =>
          o.meal ===
          state.filterMeal
      );
  }


  if (state.filterStatus) {
    data =
      data.filter(
        o =>
          o.status ===
          state.filterStatus
      );
  }


  return `

    <div class="panel">

      <div class="section-title">

        <h2>
          Orders — ${fmtDate(date)}
        </h2>

        <button
          class="primary"
          data-action="add-order"
        >
          ＋ Add Schedule
        </button>

      </div>


      <div class="toolbar">

        <input
          type="date"
          class="input"
          id="dateFilter"
          value="${date}"
        >


        <select
          class="select"
          id="supplierFilter"
        >

          <option value="">
            All suppliers
          </option>

          ${state.suppliers
            .map(
              s => `
                <option
                  value="${s.id}"
                  ${
                    state.filterSupplier === s.id
                      ? "selected"
                      : ""
                  }
                >
                  ${esc(s.name)}
                </option>
              `
            )
            .join("")}

        </select>


        <select
          class="select"
          id="mealFilter"
        >

          <option value="">
            All meals
          </option>

          <option
            ${
              state.filterMeal === "Lunch"
                ? "selected"
                : ""
            }
          >
            Lunch
          </option>

          <option
            ${
              state.filterMeal === "Dinner"
                ? "selected"
                : ""
            }
          >
            Dinner
          </option>

        </select>


        <select
          class="select"
          id="statusFilter"
        >

          <option value="">
            All status
          </option>

          ${[
            "Scheduled",
            "Confirmed",
            "Delivered",
            "Cancelled"
          ]
            .map(
              x => `
                <option
                  ${
                    state.filterStatus === x
                      ? "selected"
                      : ""
                  }
                >
                  ${x}
                </option>
              `
            )
            .join("")}

        </select>

      </div>


      ${tableWrap(

        data
          .map(orderRow)
          .join(""),

        [
          "Date",
          "Customer",
          "Supplier",
          "Meal",
          "Portions",
          "Revenue",
          "Cost",
          "Profit",
          "Status",
          "Actions"
        ]

      )}

    </div>
  `;
}


/* =========================================================
   DELIVERY PAGE
========================================================= */

function deliveryPage() {

  const data =
    state.orders
      .filter(
        o =>
          o.status === "Confirmed" ||
          o.status === "Delivered"
      )
      .sort(
        (a, b) =>
          a.order_date.localeCompare(
            b.order_date
          )
      );


  return `

    <div class="panel">

      <div class="section-title">

        <h2>
          Delivery
        </h2>

        <span class="muted">
          Upload foto untuk menandai Delivered
        </span>

      </div>


      ${tableWrap(

        data
          .map(o => `

            <tr>

              <td>
                ${fmtDate(o.order_date)}
              </td>


              <td>

                <b>
                  ${esc(
                    customerName(
                      o.customer_id
                    )
                  )}
                </b>

                <div class="muted">
                  ${esc(
                    supplierName(
                      o.supplier_id
                    )
                  )}
                </div>

              </td>


              <td>
                ${o.meal}
              </td>


              <td>
                ${o.portions}
              </td>


              <td>
                Rp ${money(
                  orderRevenue(o)
                )}
              </td>


              <td>
                Rp ${money(
                  orderCost(o)
                )}
              </td>


              <td>
                Rp ${money(
                  orderProfit(o)
                )}
              </td>


              <td>

                ${
                  o.delivery_photo_path
                    ? `
                      <img
                        class="photo"
                        src="${esc(
                          photoUrl(
                            o.delivery_photo_path
                          )
                        )}"
                      >
                    `
                    : "-"
                }

              </td>


              <td>
                ${badge(o.status)}
              </td>


              <td>

                ${
                  o.status === "Confirmed"

                    ? `
                      <button
                        class="mini"
                        data-action="deliver"
                        data-id="${o.id}"
                      >
                        📸 Upload Delivery
                      </button>
                    `

                    : ""
                }

              </td>

            </tr>

          `)
          .join(""),

        [
          "Date",
          "Customer",
          "Meal",
          "Porsi",
          "Revenue",
          "Cost",
          "Profit",
          "Photo",
          "Status",
          ""
        ]

      )}

    </div>
  `;
}


/* =========================================================
   PHOTO URL
========================================================= */

function photoUrl(path) {

  if (!path) {
    return "";
  }

  if (!sb) {
    return path;
  }

  return sb
    .storage
    .from("delivery-proofs")
    .getPublicUrl(path)
    .data
    .publicUrl;
}


/* =========================================================
   QUOTA PAGE
========================================================= */

function quotaPage() {

  const date =
    state.date;

  const dayDelivered =
    state.orders.filter(
      o =>
        o.order_date === date &&
        o.status === "Delivered"
    );


  const dayRevenue =
    dayDelivered.reduce(
      (n, o) =>
        n + orderRevenue(o),
      0
    );


  const dayCost =
    dayDelivered.reduce(
      (n, o) =>
        n + orderCost(o),
      0
    );


  const dayProfit =
    dayRevenue - dayCost;


  return `

    <div class="panel">

      <div class="section-title">

        <h2>
          Quota — ${fmtDate(date)}
        </h2>

        <input
          type="date"
          class="input"
          id="quotaDate"
          value="${date}"
          style="max-width:180px"
        >

      </div>


      <div class="notice success">

        Delivered hari ini —

        Revenue:
        <b>
          Rp ${money(dayRevenue)}
        </b>

        ·

        Cost:
        <b>
          Rp ${money(dayCost)}
        </b>

        ·

        Gross Profit:
        <b>
          Rp ${money(dayProfit)}
        </b>

      </div>


      <div class="notice">

        Reserved = semua order yang belum Cancelled.

        Actual delivered = order yang sudah ada
        bukti delivery.

        Cancel H-1 otomatis membebaskan
        reserved slot supplier.

      </div>


      ${state.suppliers
        .map(
          s => `

            <div
              class="panel"
              style="margin-bottom:12px"
            >

              <h3>
                ${esc(s.name)}
              </h3>


              ${["Lunch", "Dinner"]
                .map(meal => {

                  const reserved =
                    reservedQuota(
                      s.id,
                      meal,
                      date
                    );

                  const delivered =
                    usedQuota(
                      s.id,
                      meal,
                      date,
                      true
                    );

                  const cap =
                    quotaFor(
                      s,
                      meal
                    );

                  const available =
                    Math.max(
                      0,
                      cap - reserved
                    );


                  return `

                    <div class="quota-row">

                      <b>
                        ${meal}
                      </b>


                      <div>

                        <div>

                          <b>
                            ${reserved}/${cap}
                          </b>

                          reserved

                          ·

                          <span class="muted">
                            ${delivered}
                            delivered
                          </span>

                        </div>


                        <div class="bar">

                          <span
                            style="
                              width:${Math.min(
                                100,
                                reserved /
                                Math.max(
                                  1,
                                  cap
                                ) *
                                100
                              )}%
                            "
                          ></span>

                        </div>


                        <div class="hint">

                          ${available}
                          slot available

                        </div>

                      </div>


                      <b>
                        ${available}
                      </b>

                    </div>

                  `;
                })
                .join("")}

            </div>

          `
        )
        .join("")}

    </div>
  `;
}


/* =========================================================
   WHATSAPP PAGE
========================================================= */

function whatsappPage() {

  const date =
    state.date;


  return `

    <div class="panel">

      <div class="section-title">

        <h2>
          WhatsApp Generator
        </h2>

        <button
          class="primary"
          data-action="copy-wa"
        >
          📋 Copy
        </button>

      </div>


      <div class="toolbar">

        <input
          type="date"
          class="input"
          id="waDate"
          value="${date}"
        >


        <select
          class="select"
          id="waSupplier"
        >

          <option value="">
            Pilih supplier
          </option>

          ${state.suppliers
            .map(
              s => `
                <option
                  value="${s.id}"
                  ${
                    state.filterSupplier === s.id
                      ? "selected"
                      : ""
                  }
                >
                  ${esc(s.name)}
                </option>
              `
            )
            .join("")}

        </select>


        <select
          class="select"
          id="waMeal"
        >

          <option value="">
            Lunch + Dinner
          </option>

          <option>
            Lunch
          </option>

          <option>
            Dinner
          </option>

        </select>

      </div>


      <div
        id="waPreview"
        class="wa"
      >
        ${esc(
          makeWA(
            date,
            state.filterSupplier,
            ""
          )
        )}
      </div>

    </div>
  `;
}


/* =========================================================
   WHATSAPP GENERATOR
========================================================= */

function makeWA(
  date,
  supplierId,
  meal
) {

  const orders =
    state.orders.filter(
      o =>
        o.order_date === date &&
        o.status !== "Cancelled" &&
        (!supplierId ||
          o.supplier_id === supplierId) &&
        (!meal ||
          o.meal === meal)
    );


  if (!orders.length) {
    return "Tidak ada order.";
  }


  const suppliers =
    supplierId

      ? state.suppliers.filter(
          s => s.id === supplierId
        )

      : state.suppliers.filter(
          s =>
            orders.some(
              o =>
                o.supplier_id === s.id
            )
        );


  const lines = [
    `CATERING — ${fmtDate(date)}`
  ];


  for (const sup of suppliers) {

    const supplierOrders =
      orders.filter(
        o =>
          o.supplier_id === sup.id
      );


    if (!supplierOrders.length) {
      continue;
    }


    lines.push(
      "",
      `━━━━━━━━━━━━━━━━━━━━`,
      `SUPPLIER: ${sup.name}`,
      `━━━━━━━━━━━━━━━━━━━━`
    );


    for (
      const m of ["Lunch", "Dinner"]
    ) {

      const part =
        supplierOrders.filter(
          o => o.meal === m
        );


      if (!part.length) {
        continue;
      }


      lines.push(
        "",
        `【 ${m.toUpperCase()} 】`,
        ""
      );


      part.forEach(o => {

        const customer =
          state.customers.find(
            c =>
              c.id === o.customer_id
          );


        lines.push(
          `Nama: ${customer?.name || "-"}`,
          `Alamat: ${customer?.address || "-"}`,
          `Note: ${
            o.notes ||
            customer?.notes ||
            "-"
          }`,
          `Porsi: ${o.portions}`,
          ""
        );

      });

    }

  }


  return lines
    .join("\n")
    .trim();
}


/* =========================================================
   MODAL
========================================================= */

function openModal(
  title,
  body
) {

  el("modalTitle").textContent =
    title;

  el("modalBody").innerHTML =
    body;

  el("modal").classList.remove(
    "hidden"
  );
}


function closeModal() {

  el("modal").classList.add(
    "hidden"
  );
}


/* =========================================================
   CUSTOMER FORM
========================================================= */

function customerForm(c = {}) {

  const isEdit =
    !!c.id;


  return `

    <form
      id="customerForm"
      data-id="${c.id || ""}"
    >

      <div class="form-grid">


        <div class="field">

          <label>
            Nama *
          </label>

          <input
            class="input"
            name="name"
            required
            value="${esc(c.name || "")}"
          >

        </div>


        <div class="field">

          <label>
            WhatsApp
          </label>

          <input
            class="input"
            name="whatsapp"
            value="${esc(
              c.whatsapp || ""
            )}"
          >

        </div>


        <div class="field full-row">

          <label>
            Alamat *
          </label>

          <textarea
            class="textarea"
            name="address"
            required
          >${esc(c.address || "")}</textarea>

        </div>


        <div class="field">

          <label>
            Default Supplier
          </label>

          <select
            class="select"
            name="default_supplier_id"
          >

            <option value="">
              -
            </option>

            ${state.suppliers
              .map(
                s => `
                  <option
                    value="${s.id}"
                    ${
                      c.default_supplier_id === s.id
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(s.name)}
                  </option>
                `
              )
              .join("")}

          </select>

        </div>


        ${
          isEdit

            ? `

              <div class="field">

                <label>
                  Lunch Quota Saat Ini
                </label>

                <input
                  class="input"
                  type="number"
                  value="${customerRemaining(
                    c,
                    "Lunch"
                  )}"
                  disabled
                >

              </div>


              <div class="field">

                <label>
                  Top Up Lunch
                </label>

                <input
                  class="input"
                  type="number"
                  min="0"
                  name="lunch_topup"
                  value="0"
                >

                <div class="hint">
                  Tambahkan quota baru ke
                  saldo customer.
                </div>

              </div>


              <div class="field">

                <label>
                  Dinner Quota Saat Ini
                </label>

                <input
                  class="input"
                  type="number"
                  value="${customerRemaining(
                    c,
                    "Dinner"
                  )}"
                  disabled
                >

              </div>


              <div class="field">

                <label>
                  Top Up Dinner
                </label>

                <input
                  class="input"
                  type="number"
                  min="0"
                  name="dinner_topup"
                  value="0"
                >

                <div class="hint">
                  Tambahkan quota baru ke
                  saldo customer.
                </div>

              </div>

            `

            : `

              <div class="field">

                <label>
                  Lunch Quota
                </label>

                <input
                  class="input"
                  type="number"
                  min="0"
                  name="lunch_quota"
                  value="0"
                >

              </div>


              <div class="field">

                <label>
                  Dinner Quota
                </label>

                <input
                  class="input"
                  type="number"
                  min="0"
                  name="dinner_quota"
                  value="0"
                >

              </div>

            `
        }


        <div class="field">

          <label>
            Harga Lunch / porsi
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="lunch_price"
            value="${c.lunch_price ?? 0}"
          >

        </div>


        <div class="field">

          <label>
            Harga Dinner / porsi
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="dinner_price"
            value="${c.dinner_price ?? 0}"
          >

        </div>


        <div class="field full-row">

          <label>
            Notes
          </label>

          <input
            class="input"
            name="notes"
            value="${esc(c.notes || "")}"
          >

        </div>


      </div>


      <button
        class="primary"
        style="margin-top:15px"
      >
        ${
          isEdit
            ? "Save & Update Customer"
            : "Save Customer"
        }
      </button>

    </form>
  `;
}


/* =========================================================
   SUPPLIER FORM
========================================================= */

function supplierForm(
  s = {}
) {

  return `

    <form
      id="supplierForm"
      data-id="${s.id || ""}"
    >

      <div class="form-grid">


        <div class="field full-row">

          <label>
            Nama supplier *
          </label>

          <input
            class="input"
            name="name"
            required
            value="${esc(s.name || "")}"
          >

        </div>


        <div class="field">

          <label>
            Quota Lunch
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="lunch_quota"
            value="${s.lunch_quota ?? 0}"
          >

        </div>


        <div class="field">

          <label>
            Quota Dinner
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="dinner_quota"
            value="${s.dinner_quota ?? 0}"
          >

        </div>


        <div class="field">

          <label>
            Harga beli Lunch / porsi
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="lunch_buy_price"
            value="${s.lunch_buy_price ?? 0}"
          >

        </div>


        <div class="field">

          <label>
            Harga beli Dinner / porsi
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="dinner_buy_price"
            value="${s.dinner_buy_price ?? 0}"
          >

        </div>


      </div>


      <button
        class="primary"
        style="margin-top:15px"
      >
        Save Supplier
      </button>

    </form>
  `;
}


/* =========================================================
   ORDER FORM
========================================================= */

function orderForm(
  o = {}
) {

  return `

    <form
      id="orderForm"
      data-id="${o.id || ""}"
    >

      <div class="form-grid">


        <div class="field">

          <label>
            Customer *
          </label>

          <select
            class="select"
            name="customer_id"
            required
          >

            ${state.customers
              .map(
                c => `
                  <option
                    value="${c.id}"
                    ${
                      o.customer_id === c.id
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(c.name)}
                  </option>
                `
              )
              .join("")}

          </select>

        </div>


        <div class="field">

          <label>
            Supplier *
          </label>

          <select
            class="select"
            name="supplier_id"
            required
          >

            ${state.suppliers
              .filter(s => s.active)
              .map(
                s => `
                  <option
                    value="${s.id}"
                    ${
                      o.supplier_id === s.id
                        ? "selected"
                        : ""
                    }
                  >
                    ${esc(s.name)}
                  </option>
                `
              )
              .join("")}

          </select>

        </div>


        <div class="field">

          <label>
            Tanggal *
          </label>

          <input
            class="input"
            type="date"
            name="order_date"
            required
            value="${
              o.order_date ||
              state.date
            }"
          >

        </div>


        <div class="field">

          <label>
            Meal *
          </label>

          <select
            class="select"
            name="meal"
          >

            <option
              ${
                o.meal === "Lunch"
                  ? "selected"
                  : ""
              }
            >
              Lunch
            </option>

            <option
              ${
                o.meal === "Dinner"
                  ? "selected"
                  : ""
              }
            >
              Dinner
            </option>

          </select>

        </div>


        <div class="field">

          <label>
            Jumlah porsi *
          </label>

          <input
            class="input"
            type="number"
            min="1"
            name="portions"
            value="${o.portions || 1}"
          >

        </div>


        <div class="field">

          <label>
            Harga jual / porsi
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="selling_price"
            value="${
              o.selling_price ??
              customerPrice(
                state.customers.find(
                  c =>
                    c.id === o.customer_id
                ),
                o.meal
              )
            }"
          >

        </div>


        <div class="field">

          <label>
            Harga beli / porsi
          </label>

          <input
            class="input"
            type="number"
            min="0"
            name="buying_price"
            value="${
              o.buying_price ??
              supplierPrice(
                state.suppliers.find(
                  s =>
                    s.id === o.supplier_id
                ),
                o.meal
              )
            }"
          >

        </div>


        <div class="field">

          <label>
            Status
          </label>

          <select
            class="select"
            name="status"
          >

            ${[
              "Scheduled",
              "Confirmed",
              "Delivered",
              "Cancelled"
            ]
              .map(
                x => `
                  <option
                    value="${x}"
                    ${
                      o.status === x
                        ? "selected"
                        : ""
                    }
                    ${
                      x === "Delivered"
                        ? "disabled"
                        : ""
                    }
                  >
                    ${x}
                  </option>
                `
              )
              .join("")}

          </select>

        </div>


        <div class="field full-row">

          <label>
            Notes khusus order
          </label>

          <textarea
            class="textarea"
            name="notes"
          >${esc(o.notes || "")}</textarea>

        </div>


      </div>


      <div class="hint">

        Quota customer dicek saat membuat
        schedule.

        Quota customer baru berkurang
        saat order benar-benar Delivered.

      </div>


      <button
        class="primary"
        style="margin-top:15px"
      >
        Save Schedule
      </button>

    </form>
  `;
}


/* =========================================================
   BULK SCHEDULE FORM
========================================================= */

function scheduleForm() {

  return `

    <form id="bulkForm">

      <div class="form-grid">


        <div class="field">

          <label>
            Customer *
          </label>

          <select
            class="select"
            name="customer_id"
            required
          >

            ${state.customers
              .map(
                c => `
                  <option value="${c.id}">
                    ${esc(c.name)}
                  </option>
                `
              )
              .join("")}

          </select>

        </div>


        <div class="field">

          <label>
            Supplier *
          </label>

          <select
            class="select"
            name="supplier_id"
            required
          >

            ${state.suppliers
              .filter(s => s.active)
              .map(
                s => `
                  <option value="${s.id}">
                    ${esc(s.name)}
                  </option>
                `
              )
              .join("")}

          </select>

        </div>


        <div class="field">

          <label>
            Start date
          </label>

          <input
            class="input"
            type="date"
            name="start"
            value="${state.date}"
            required
          >

        </div>


        <div class="field">

          <label>
            End date
          </label>

          <input
            class="input"
            type="date"
            name="end"
            value="${state.date}"
            required
          >

        </div>


        <div class="field">

          <label>
            Meal
          </label>

          <select
            class="select"
            name="meal"
          >

            <option>
              Lunch
            </option>

            <option>
              Dinner
            </option>

          </select>

        </div>


        <div class="field">

          <label>
            Porsi
          </label>

          <input
            class="input"
            type="number"
            min="1"
            name="portions"
            value="1"
          >

        </div>


        <div class="field full-row">

          <label>
            Hari aktif
            (untuk recurring)
          </label>

          <div class="toolbar">

            ${[
              "0",
              "1",
              "2",
              "3",
              "4",
              "5",
              "6"
            ]
              .map(
                (d, i) => `
                  <label>

                    <input
                      type="checkbox"
                      name="days"
                      value="${d}"
                      ${
                        i >= 1 &&
                        i <= 5
                          ? "checked"
                          : ""
                      }
                    >

                    ${
                      [
                        "Min",
                        "Sen",
                        "Sel",
                        "Rab",
                        "Kam",
                        "Jum",
                        "Sab"
                      ][i]
                    }

                  </label>
                `
              )
              .join("")}

          </div>

        </div>


        <div class="field full-row">

          <label>
            Notes
          </label>

          <textarea
            class="textarea"
            name="notes"
          ></textarea>

        </div>


      </div>


      <div class="notice">

        Kalau pilih Senin–Jumat dan range
        seminggu, sistem membuat order
        terpisah per tanggal.

        Setelah dibuat, setiap tanggal
        bisa dibatalkan sendiri.

      </div>


      <button class="primary">
        Generate Schedule
      </button>

    </form>
  `;
}


/* =========================================================
   SAVE ORDER
========================================================= */

async function saveOrder(
  payload,
  id = null
) {

  const existing =
    id
      ? state.orders.find(
          x => x.id === id
        )
      : null;


  const portions =
    Number(payload.portions || 0);


  if (portions <= 0) {
    alert(
      "Jumlah porsi harus lebih dari 0."
    );

    return false;
  }


  const supplier =
    state.suppliers.find(
      s =>
        s.id === payload.supplier_id
    );


  const customer =
    state.customers.find(
      c =>
        c.id === payload.customer_id
    );


  if (!supplier) {
    alert(
      "Supplier tidak ditemukan."
    );

    return false;
  }


  if (!customer) {
    alert(
      "Customer tidak ditemukan."
    );

    return false;
  }


  /*
    =========================================
    SUPPLIER QUOTA
    =========================================
  */

  const otherSupplierOrders =
    state.orders.filter(
      x =>
        x.id !== id &&
        x.supplier_id ===
          payload.supplier_id &&
        x.meal === payload.meal &&
        x.order_date ===
          payload.order_date &&
        x.status !== "Cancelled"
    );


  const supplierReserved =
    otherSupplierOrders.reduce(
      (n, o) =>
        n + Number(o.portions || 0),
      0
    );


  const supplierCapacity =
    quotaFor(
      supplier,
      payload.meal
    );


  if (
    payload.status !== "Cancelled" &&
    supplierReserved + portions >
      supplierCapacity
  ) {

    alert(
      `Quota supplier ${payload.meal} ${supplier.name} tidak cukup.\n\n` +
      `Available: ${Math.max(
        0,
        supplierCapacity -
          supplierReserved
      )} porsi.`
    );

    return false;
  }


  /*
    =========================================
    CUSTOMER CURRENT QUOTA
    =========================================

    IMPORTANT:

    Tidak pernah menghitung:

    total quota awal
    -
    seluruh histori Delivered

    Yang dipakai cuma:

    CURRENT BALANCE
  */

  const customerField =
    customerQuotaField(
      payload.meal
    );


  const currentCustomerQuota =
    Number(
      customer[customerField] || 0
    );


  /*
    Order aktif lain milik customer
    yang masih reserve.

    Ini untuk mencegah quota yang sama
    dipakai untuk banyak schedule.
  */

  const otherCustomerOrders =
    state.orders.filter(
      x =>
        x.id !== id &&
        x.customer_id ===
          payload.customer_id &&
        x.meal === payload.meal &&
        x.status !== "Cancelled" &&
        x.status !== "Delivered"
    );


  const customerReserved =
    otherCustomerOrders.reduce(
      (n, o) =>
        n + Number(o.portions || 0),
      0
    );


  /*
    Untuk order baru / edit active,
    quota yang sudah di-reserve
    tidak boleh melebihi current balance.
  */

  if (
    payload.status !== "Cancelled" &&
    payload.status !== "Delivered" &&
    customerReserved + portions >
      currentCustomerQuota
  ) {

    alert(
      `Quota customer ${customer.name} untuk ${payload.meal} tidak cukup.\n\n` +
      `Quota saat ini: ${currentCustomerQuota}\n` +
      `Sudah di-reserve: ${customerReserved}\n` +
      `Request baru: ${portions}\n` +
      `Sisa yang bisa digunakan: ${Math.max(
        0,
        currentCustomerQuota -
          customerReserved
      )}`
    );

    return false;
  }


  /*
    Jangan izinkan status Delivered
    lewat form biasa.

    Delivery harus lewat tombol
    Upload Delivery agar quota
    benar-benar dikurangi.
  */

  if (
    payload.status === "Delivered" &&
    existing?.status !== "Delivered"
  ) {

    alert(
      "Untuk menandai Delivered, gunakan tombol 📸 Deliver dan upload bukti delivery."
    );

    return false;
  }


  /*
    Delivered lama tidak diubah
    dari form biasa.
  */

  if (
    existing?.status === "Delivered" &&
    payload.status !== "Delivered"
  ) {

    alert(
      "Order yang sudah Delivered tidak bisa diubah statusnya melalui form."
    );

    return false;
  }


  /*
    =========================================
    SAVE ORDER
    =========================================
  */

  return save(
    "orders",
    {
      ...payload,
      updated_at:
        new Date().toISOString()
    },
    id
  );
}


/* =========================================================
   BIND PAGE
========================================================= */

function bindPage() {

  const search =
    el("search");

  if (search) {

    search.addEventListener(
      "input",
      e => {

        state.search =
          e.target.value;

        render();

      }
    );

  }


  const dateFilter =
    el("dateFilter");

  if (dateFilter) {

    dateFilter.onchange =
      e => {

        state.date =
          e.target.value;

        render();

      };

  }


  const supplierFilter =
    el("supplierFilter");

  if (supplierFilter) {

    supplierFilter.onchange =
      e => {

        state.filterSupplier =
          e.target.value;

        render();

      };

  }


  const mealFilter =
    el("mealFilter");

  if (mealFilter) {

    mealFilter.onchange =
      e => {

        state.filterMeal =
          e.target.value;

        render();

      };

  }


  const statusFilter =
    el("statusFilter");

  if (statusFilter) {

    statusFilter.onchange =
      e => {

        state.filterStatus =
          e.target.value;

        render();

      };

  }


  const quotaDate =
    el("quotaDate");

  if (quotaDate) {

    quotaDate.onchange =
      e => {

        state.date =
          e.target.value;

        render();

      };

  }


  const waDate =
    el("waDate");

  if (waDate) {

    waDate.onchange =
      e => {

        state.date =
          e.target.value;

        render();

      };

  }


  const waSupplier =
    el("waSupplier");

  if (waSupplier) {

    waSupplier.onchange =
      e => {

        state.filterSupplier =
          e.target.value;

        const meal =
          el("waMeal")?.value || "";

        const date =
          el("waDate")?.value ||
          state.date;

        const preview =
          el("waPreview");

        if (preview) {

          preview.textContent =
            makeWA(
              date,
              e.target.value,
              meal
            );

        }

      };

  }


  const waMeal =
    el("waMeal");

  if (waMeal) {

    waMeal.onchange =
      e => {

        const date =
          el("waDate")?.value ||
          state.date;

        const supplier =
          el("waSupplier")?.value ||
          "";

        const preview =
          el("waPreview");

        if (preview) {

          preview.textContent =
            makeWA(
              date,
              supplier,
              e.target.value
            );

        }

      };

  }
}


/* =========================================================
   GLOBAL CLICK HANDLER
========================================================= */

document.addEventListener(
  "click",
  async e => {

    const nav =
      e.target.closest(".nav");

    if (nav) {

      state.page =
        nav.dataset.page;

      render();

      return;
    }


    const go =
      e.target.closest(
        "[data-page-go]"
      );

    if (go) {

      state.page =
        go.dataset.pageGo;

      render();

      return;
    }


    const actionButton =
      e.target.closest(
        "[data-action]"
      );

    if (!actionButton) {
      return;
    }


    const action =
      actionButton.dataset.action;

    const id =
      actionButton.dataset.id;


    /* ADD CUSTOMER */

    if (
      action ===
      "add-customer"
    ) {

      openModal(
        "Add Customer",
        customerForm()
      );

      return;
    }


    /* EDIT CUSTOMER */

    if (
      action ===
      "edit-customer"
    ) {

      const customer =
        state.customers.find(
          x => x.id === id
        );

      if (!customer) {
        alert(
          "Customer tidak ditemukan."
        );

        return;
      }

      openModal(
        "Edit Customer",
        customerForm(customer)
      );

      return;
    }


    /* ADD SUPPLIER */

    if (
      action ===
      "add-supplier"
    ) {

      openModal(
        "Add Supplier",
        supplierForm()
      );

      return;
    }


    /* EDIT SUPPLIER */

    if (
      action ===
      "edit-supplier"
    ) {

      const supplier =
        state.suppliers.find(
          x => x.id === id
        );

      if (!supplier) {
        alert(
          "Supplier tidak ditemukan."
        );

        return;
      }

      openModal(
        "Edit Supplier",
        supplierForm(supplier)
      );

      return;
    }


    /* ADD ORDER */

    if (
      action ===
      "add-order"
    ) {

      openModal(
        "Add Schedule",
        orderForm()
      );

      return;
    }


    /* EDIT ORDER */

    if (
      action ===
      "edit-order"
    ) {

      const order =
        state.orders.find(
          x => x.id === id
        );

      if (!order) {
        alert(
          "Order tidak ditemukan."
        );

        return;
      }


      if (
        order.status ===
        "Delivered"
      ) {

        alert(
          "Order Delivered tidak bisa diedit."
        );

        return;
      }


      openModal(
        "Edit Schedule",
        orderForm(order)
      );

      return;
    }


    /* CONFIRM */

    if (
      action ===
      "confirm"
    ) {

      const order =
        state.orders.find(
          x => x.id === id
        );

      if (!order) return;


      await saveOrder(
        {
          ...order,
          status: "Confirmed"
        },
        id
      );

      return;
    }


    /* CANCEL */

    if (
      action ===
      "cancel"
    ) {

      const order =
        state.orders.find(
          x => x.id === id
        );

      if (!order) return;


      if (
        order.status ===
        "Delivered"
      ) {

        alert(
          "Delivered tidak bisa di-cancel biasa."
        );

        return;
      }


      if (
        !confirm(
          "Cancel order ini?\n\nSlot supplier akan kembali."
        )
      ) {

        return;
      }


      await saveOrder(
        {
          ...order,
          status: "Cancelled"
        },
        id
      );

      return;
    }


    /* DELIVER */

    if (
      action ===
      "deliver"
    ) {

      const order =
        state.orders.find(
          x => x.id === id
        );

      if (!order) return;


      if (
        order.status !==
        "Confirmed"
      ) {

        alert(
          "Hanya order Confirmed yang bisa di-deliver."
        );

        return;
      }


      const customer =
        state.customers.find(
          c =>
            c.id ===
            order.customer_id
        );


      const field =
        customerQuotaField(
          order.meal
        );


      const currentQuota =
        Number(
          customer?.[field] || 0
        );


      if (
        currentQuota <
        Number(order.portions || 0)
      ) {

        alert(
          `Quota customer tidak cukup.\n\n` +
          `Quota sekarang: ${currentQuota}\n` +
          `Porsi delivery: ${order.portions}`
        );

        return;
      }


      el("deliveryFile")
        .dataset.id = id;

      el("deliveryFile").click();

      return;
    }


    /* COPY WA */

    if (
      action ===
      "copy-wa"
    ) {

      const date =
        el("waDate")?.value ||
        state.date;

      const supplier =
        el("waSupplier")?.value ||
        "";

      const meal =
        el("waMeal")?.value ||
        "";


      const text =
        makeWA(
          date,
          supplier,
          meal
        );


      try {

        await navigator
          .clipboard
          .writeText(text);

        alert(
          "Copied! Tinggal paste ke WhatsApp."
        );

      }

      catch (err) {

        alert(
          "Gagal copy otomatis. Silakan copy manual."
        );

      }

      return;
    }


    /* QUICK ADD */

    if (
      action ===
      "quickAdd"
    ) {

      openModal(
        "Add Schedule",
        orderForm()
      );

      return;
    }

  }
);


/* =========================================================
   MODAL EVENTS
========================================================= */

if (el("closeModal")) {

  el("closeModal").onclick =
    closeModal;

}


if (el("modal")) {

  el("modal").addEventListener(
    "click",
    e => {

      if (
        e.target.id ===
        "modal"
      ) {

        closeModal();

      }

    }
  );

}


/* =========================================================
   QUICK ADD BUTTON
========================================================= */

if (el("quickAddBtn")) {

  el("quickAddBtn").onclick =
    () =>
      openModal(
        "Add Schedule",
        orderForm()
      );

}


/* =========================================================
   REFRESH
========================================================= */

if (el("refreshBtn")) {

  el("refreshBtn").onclick =
    async () => {

      await loadData();

      render();

    };

}


/* =========================================================
   MODAL SUBMIT
========================================================= */

if (el("modalBody")) {

  el("modalBody").addEventListener(
    "submit",
    async e => {

      e.preventDefault();


      const form =
        e.target;

      const fd =
        new FormData(form);


      /* =====================================================
         CUSTOMER FORM
      ===================================================== */

      if (
        form.id ===
        "customerForm"
      ) {

        const id =
          form.dataset.id ||
          null;


        const existing =
          id
            ? state.customers.find(
                c => c.id === id
              )
            : null;


        const lunchTopup =
          Math.max(
            0,
            Number(
              fd.get(
                "lunch_topup"
              ) || 0
            )
          );


        const dinnerTopup =
          Math.max(
            0,
            Number(
              fd.get(
                "dinner_topup"
              ) || 0
            )
          );


        /*
          NEW CUSTOMER

          quota langsung dimulai
          dari angka yang diinput.
        */

        /*
          EXISTING CUSTOMER

          quota sekarang +
          top up.

          TIDAK PERNAH:
          quota + histori order.
        */

        const payload = {

          name:
            fd.get("name"),

          whatsapp:
            fd.get("whatsapp"),

          address:
            fd.get("address"),

          notes:
            fd.get("notes"),

          default_supplier_id:
            fd.get(
              "default_supplier_id"
            ) || null,


          lunch_quota:
            existing

              ? Number(
                  existing.lunch_quota ||
                  0
                ) +
                lunchTopup

              : Math.max(
                  0,
                  Number(
                    fd.get(
                      "lunch_quota"
                    ) || 0
                  )
                ),


          dinner_quota:
            existing

              ? Number(
                  existing.dinner_quota ||
                  0
                ) +
                dinnerTopup

              : Math.max(
                  0,
                  Number(
                    fd.get(
                      "dinner_quota"
                    ) || 0
                  )
                ),


          lunch_price:
            Math.max(
              0,
              Number(
                fd.get(
                  "lunch_price"
                ) || 0
              )
            ),


          dinner_price:
            Math.max(
              0,
              Number(
                fd.get(
                  "dinner_price"
                ) || 0
              )
            ),


          active: true

        };


        const ok =
          await save(
            "customers",
            payload,
            id
          );


        if (ok) {
          closeModal();
        }


        return;
      }


      /* =====================================================
         SUPPLIER FORM
      ===================================================== */

      if (
        form.id ===
        "supplierForm"
      ) {

        const id =
          form.dataset.id ||
          null;


        const payload = {

          name:
            fd.get("name"),

          lunch_quota:
            Math.max(
              0,
              Number(
                fd.get(
                  "lunch_quota"
                ) || 0
              )
            ),

          dinner_quota:
            Math.max(
              0,
              Number(
                fd.get(
                  "dinner_quota"
                ) || 0
              )
            ),

          lunch_buy_price:
            Math.max(
              0,
              Number(
                fd.get(
                  "lunch_buy_price"
                ) || 0
              )
            ),

          dinner_buy_price:
            Math.max(
              0,
              Number(
                fd.get(
                  "dinner_buy_price"
                ) || 0
              )
            ),

          active: true

        };


        const ok =
          await save(
            "suppliers",
            payload,
            id
          );


        if (ok) {
          closeModal();
        }


        return;
      }


      /* =====================================================
         ORDER FORM
      ===================================================== */

      if (
        form.id ===
        "orderForm"
      ) {

        const id =
          form.dataset.id ||
          null;


        const customer =
          state.customers.find(
            c =>
              c.id ===
              fd.get("customer_id")
          );


        const supplier =
          state.suppliers.find(
            s =>
              s.id ===
              fd.get("supplier_id")
          );


        const meal =
          fd.get("meal");


        const sellingPrice =
          Number(
            fd.get(
              "selling_price"
            )
          );


        const buyingPrice =
          Number(
            fd.get(
              "buying_price"
            )
          );


        const payload = {

          customer_id:
            fd.get(
              "customer_id"
            ),

          supplier_id:
            fd.get(
              "supplier_id"
            ),

          order_date:
            fd.get(
              "order_date"
            ),

          meal,

          portions:
            Math.max(
              1,
              Number(
                fd.get(
                  "portions"
                ) || 1
              )
            ),


          selling_price:
            sellingPrice > 0
              ? sellingPrice
              : customerPrice(
                  customer,
                  meal
                ),


          buying_price:
            buyingPrice > 0
              ? buyingPrice
              : supplierPrice(
                  supplier,
                  meal
                ),


          status:
            fd.get("status"),


          notes:
            fd.get("notes")

        };


        const ok =
          await saveOrder(
            payload,
            id
          );


        if (ok) {
          closeModal();
        }


        return;
      }


      /* =====================================================
         BULK FORM
      ===================================================== */

      if (
        form.id ===
        "bulkForm"
      ) {

        const days =
          fd.getAll("days");


        const start =
          new Date(
            fd.get("start") +
            "T00:00:00"
          );


        const end =
          new Date(
            fd.get("end") +
            "T00:00:00"
          );


        if (start > end) {

          alert(
            "Start date tidak boleh lebih besar dari End date."
          );

          return;
        }


        let created = 0;


        for (
          let d = new Date(start);
          d <= end;
          d.setDate(
            d.getDate() + 1
          )
        ) {

          const dow =
            String(
              d.getDay()
            );


          if (
            !days.includes(dow)
          ) {
            continue;
          }


          /*
            Hindari masalah timezone
            saat membuat tanggal bulk.
          */

          const year =
            d.getFullYear();

          const month =
            String(
              d.getMonth() + 1
            ).padStart(2, "0");

          const day =
            String(
              d.getDate()
            ).padStart(2, "0");


          const date =
            `${year}-${month}-${day}`;


          const bulkCustomer =
            state.customers.find(
              c =>
                c.id ===
                fd.get(
                  "customer_id"
                )
            );


          const bulkSupplier =
            state.suppliers.find(
              s =>
                s.id ===
                fd.get(
                  "supplier_id"
                )
            );


          const meal =
            fd.get("meal");


          const payload = {

            customer_id:
              fd.get(
                "customer_id"
              ),

            supplier_id:
              fd.get(
                "supplier_id"
              ),

            order_date:
              date,

            meal,

            portions:
              Math.max(
                1,
                Number(
                  fd.get(
                    "portions"
                  ) || 1
                )
              ),

            selling_price:
              customerPrice(
                bulkCustomer,
                meal
              ),

            buying_price:
              supplierPrice(
                bulkSupplier,
                meal
              ),

            status:
              "Scheduled",

            notes:
              fd.get("notes")

          };


          const ok =
            await saveOrder(
              payload
            );


          if (ok) {
            created++;
          }

        }


        closeModal();


        alert(
          `${created} jadwal berhasil dibuat.`
        );


        return;
      }

    }
  );

}


/* =========================================================
   DELIVERY FILE UPLOAD
========================================================= */

if (el("deliveryFile")) {

  el("deliveryFile").addEventListener(
    "change",
    async e => {

      const file =
        e.target.files[0];

      const id =
        e.target.dataset.id;


      if (!file) {
        return;
      }


      const order =
        state.orders.find(
          x => x.id === id
        );


      if (!order) {

        alert(
          "Order tidak ditemukan."
        );

        e.target.value = "";

        return;
      }


      if (
        order.status !==
        "Confirmed"
      ) {

        alert(
          "Order harus berstatus Confirmed."
        );

        e.target.value = "";

        return;
      }


      const customer =
        state.customers.find(
          c =>
            c.id ===
            order.customer_id
        );


      if (!customer) {

        alert(
          "Customer tidak ditemukan."
        );

        e.target.value = "";

        return;
      }


      const quotaField =
        customerQuotaField(
          order.meal
        );


      const currentQuota =
        Number(
          customer[quotaField] || 0
        );


      const portions =
        Number(
          order.portions || 0
        );


      /*
        FINAL QUOTA CHECK

        Sebelum delivery:
        current quota harus cukup.
      */

      if (
        currentQuota <
        portions
      ) {

        alert(
          `Quota customer tidak cukup.\n\n` +
          `Customer: ${customer.name}\n` +
          `Meal: ${order.meal}\n` +
          `Quota sekarang: ${currentQuota}\n` +
          `Porsi: ${portions}`
        );

        e.target.value = "";

        return;
      }


      /*
        =========================================
        DEMO MODE
        =========================================
      */

      if (!sb) {

        const newQuota =
          currentQuota -
          portions;


        /*
          Update order
        */

        order.status =
          "Delivered";

        order.delivered_at =
          new Date().toISOString();

        order.delivery_photo_path =
          URL.createObjectURL(
            file
          );


        /*
          Update CURRENT QUOTA
        */

        customer[quotaField] =
          newQuota;


        render();


        alert(
          `Delivered berhasil.\n\n` +
          `Quota ${order.meal} customer ${customer.name}: ` +
          `${currentQuota} → ${newQuota}`
        );


        e.target.value = "";

        return;
      }


      /*
        =========================================
        SUPABASE
        =========================================
      */

      const extension =
        file.name
          .split(".")
          .pop()
          ?.toLowerCase() ||
        "jpg";


      const path =
        `${order.order_date}/` +
        `${order.id}-` +
        `${Date.now()}.` +
        extension;


      /*
        Upload photo
      */

      const upload =
        await sb
          .storage
          .from(
            "delivery-proofs"
          )
          .upload(
            path,
            file,
            {
              upsert: false
            }
          );


      if (upload.error) {

        alert(
          upload.error.message
        );

        e.target.value = "";

        return;
      }


      /*
        =========================================
        UPDATE CUSTOMER QUOTA FIRST
        =========================================
      */

      const newQuota =
        currentQuota -
        portions;


      const quotaUpdate =
        await sb
          .from("customers")
          .update({
            [quotaField]:
              newQuota
          })
          .eq(
            "id",
            customer.id
          );


      /*
        Kalau update quota gagal,
        jangan lanjut tandai Delivered.
      */

      if (
        quotaUpdate.error
      ) {

        /*
          Coba hapus photo yang
          sudah ter-upload supaya
          tidak meninggalkan file yatim.
        */

        await sb
          .storage
          .from(
            "delivery-proofs"
          )
          .remove([
            path
          ]);


        alert(
          "Quota customer gagal diperbarui: " +
          quotaUpdate.error.message
        );

        e.target.value = "";

        return;
      }


      /*
        =========================================
        UPDATE ORDER
        =========================================
      */

      const orderUpdate =
        await sb
          .from("orders")
          .update({

            status:
              "Delivered",

            delivery_photo_path:
              path,

            delivered_at:
              new Date().toISOString(),

            updated_at:
              new Date().toISOString()

          })
          .eq(
            "id",
            order.id
          );


      /*
        Kalau order gagal di-update,
        restore quota customer.
      */

      if (
        orderUpdate.error
      ) {

        await sb
          .from("customers")
          .update({
            [quotaField]:
              currentQuota
          })
          .eq(
            "id",
            customer.id
          );


        await sb
          .storage
          .from(
            "delivery-proofs"
          )
          .remove([
            path
          ]);


        alert(
          "Order gagal diubah menjadi Delivered: " +
          orderUpdate.error.message
        );

        e.target.value = "";

        return;
      }


      /*
        Semua berhasil.
      */

      await loadData();

      render();


      alert(
        `Delivered berhasil.\n\n` +
        `Quota ${order.meal} customer ${customer.name}: ` +
        `${currentQuota} → ${newQuota}`
      );


      e.target.value = "";

    }
  );

}


/* =========================================================
   INITIAL LOAD
========================================================= */

(async () => {

  await loadData();

  render();

})();
