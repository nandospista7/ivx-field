// IV-X Field <-> Shopify bridge (Supabase Edge Function "shopify")
// Secrets (Supabase > Edge Functions > Secrets):
//   SHOPIFY_SHOP          your-store.myshopify.com
//   SHOPIFY_CLIENT_ID     from the Shopify Dev Dashboard app
//   SHOPIFY_CLIENT_SECRET from the Shopify Dev Dashboard app
// Your Shopify keys stay here on the server. The phone app never sees them.
const API_VERSION = "2025-10";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const env = (k) => (Deno.env.get(k) || "").trim();
const shop = () => env("SHOPIFY_SHOP").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const base = () => env("SHOPIFY_BASE") || `https://${shop()}`; // SHOPIFY_BASE only used for testing
let tok = { value: "", exp: 0 };

async function token() {
  if (tok.value && Date.now() < tok.exp - 120000) return tok.value;
  if (!shop() || !env("SHOPIFY_CLIENT_ID") || !env("SHOPIFY_CLIENT_SECRET")) throw new Error("Shopify isn't set up yet: add SHOPIFY_SHOP, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Supabase secrets.");
  const r = await fetch(`${base()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("SHOPIFY_CLIENT_ID"), client_secret: env("SHOPIFY_CLIENT_SECRET") }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Shopify login failed (" + r.status + "). Check the client ID/secret and that the app is installed on your store. " + (j.error_description || j.error || ""));
  tok = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86399) * 1000 };
  return tok.value;
}

async function gql(query, variables = {}, version = API_VERSION) {
  const r = await fetch(`${base()}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { tok = { value: "", exp: 0 }; }
  if (!r.ok || j.errors) throw new Error("Shopify error: " + (j.errors ? JSON.stringify(j.errors).slice(0, 400) : r.status));
  return j.data;
}
const userErr = (p) => { const e = p && p.userErrors && p.userErrors.length ? p.userErrors : null; if (e) throw new Error(e.map((x) => x.message).join("; ")); };
const q = (s) => String(s || "").replace(/'/g, "");
const money = (n) => ({ amount: Number(n || 0).toFixed(2), currencyCode: "USD" });

async function ping() {
  const d = await gql(`{ shop { name myshopifyDomain currencyCode } }`);
  return d.shop;
}

async function products() {
  const d = await gql(`{ products(first: 100, query: "status:active") { nodes { id title productType variants(first: 30) { nodes { id title sku price inventoryQuantity } } } } }`);
  const out = [];
  for (const p of d.products.nodes) for (const v of p.variants.nodes) out.push({ productId: p.id, variantId: v.id, title: p.title + (v.title && v.title !== "Default Title" ? " – " + v.title : ""), sku: v.sku || "", price: Number(v.price || 0), inventory: v.inventoryQuantity, type: p.productType || "" });
  return out;
}

async function findOrCreateCustomer(store) {
  const tag = "ivxstore-" + q(store.storeKey).slice(0, 60);
  const f = await gql(`query($q: String!) { customers(first: 1, query: $q) { nodes { id tags } } }`, { q: `tag:'${tag}'` });
  if (f.customers.nodes.length) return { id: f.customers.nodes[0].id, portal: (f.customers.nodes[0].tags || []).includes("ivx-retailer") };
  // Reuse the store's IV-X Retailer portal account if it has one (no duplicate customers)
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(store.name);
  if (want.length >= 4) {
    const p = await gql(`query { customers(first: 100, query: "tag:ivx-retailer") { nodes { id displayName defaultAddress { company address1 } } } }`);
    // address words that tell two same-name stores apart (e.g. "34th", "steinway")
    const toks = String(store.address || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => /^\d+(st|nd|rd|th)$/.test(w) || (/^[a-z]{4,}$/.test(w) && !["avenue", "street", "blvd", "boulevard", "astoria", "queens", "york", "states", "united", "road", "place"].includes(w)));
    const cands = [];
    for (const c of p.customers.nodes) {
      const names = [norm(c.displayName), norm(c.defaultAddress && c.defaultAddress.company)].filter(Boolean);
      const exact = names.some((n) => n === want);
      const loose = names.some((n) => Math.min(n.length, want.length) >= 8 && (n.includes(want) || want.includes(n)));
      if (!exact && !loose) continue;
      const hay = names.join(" ") + " " + norm(c.defaultAddress && c.defaultAddress.address1);
      cands.push({ c, exact, score: toks.filter((w) => hay.includes(w)).length });
    }
    cands.sort((a, b) => (b.exact - a.exact) || (b.score - a.score));
    let hit = null;
    if (cands.length === 1 && (cands[0].exact || cands[0].score > 0 || !toks.length || Math.min(want.length, norm(cands[0].c.displayName).length) >= 12)) hit = cands[0].c;
    else if (cands.length > 1 && (cands[0].exact && !cands[1].exact || cands[0].score > cands[1].score)) hit = cands[0].c;
    if (hit) {
      const a = await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`, { id: hit.id, tags: [tag, "IV-X Field"] });
      userErr(a.tagsAdd);
      return { id: hit.id, portal: true };
    }
  }
  const [first, ...rest] = String(store.contactName || "").trim().split(/\s+/);
  const input = {
    firstName: first || store.name,
    lastName: first ? rest.join(" ") || store.name : "(store)",
    tags: [tag, "IV-X Field", store.kind === "gym" ? "Gym" : "Retailer"],
    note: [store.name, store.address, store.phone ? "Store phone: " + store.phone : "", store.contactPhone ? "Contact: " + (store.contactName || "") + " " + store.contactPhone : ""].filter(Boolean).join("\n"),
    addresses: [{ company: store.name, address1: store.address || "", city: store.city || "New York", provinceCode: "NY", countryCode: "US" }],
    taxExempt: true,
  };
  const c = await gql(`mutation($input: CustomerInput!) { customerCreate(input: $input) { customer { id } userErrors { field message } } }`, { input });
  userErr(c.customerCreate);
  return { id: c.customerCreate.customer.id, portal: false };
}

async function pushSale(b) {
  const rec = b.rec || {}, store = b.store || {};
  if (!rec.id) throw new Error("Missing sale id");
  const recTag = "ivxrec-" + q(rec.id).slice(0, 80);
  // already pushed? (never double-create an order)
  const ex = await gql(`query($q: String!) { draftOrders(first: 1, query: $q) { nodes { id status order { id name legacyResourceId } } } }`, { q: `tag:'${recTag}'` });
  let draft = ex.draftOrders.nodes[0];
  if (!draft) {
    const lines = (b.lines || []).filter((l) => l.qty > 0).map((l) => l.variantId
      ? { variantId: l.variantId, quantity: l.qty, priceOverride: money(l.price) }
      : { title: l.title, quantity: l.qty, originalUnitPriceWithCurrency: money(l.price), requiresShipping: false, taxable: false, sku: l.sku || undefined });
    if (!lines.length) throw new Error("No order lines to send");
    const cust = await findOrCreateCustomer(store);
    const customerId = cust.id;
    // Already entered in IV-X Retailer? Link to that order instead of creating a second one.
    if (cust.portal) {
      const when = new Date(rec.at || Date.now()).getTime(), day = 86400000;
      const from = new Date(when - 3 * day).toISOString(), to = new Date(when + 3 * day).toISOString();
      const num = customerId.split("/").pop();
      const o = await gql(`query($q: String!) { orders(first: 20, query: $q) { nodes { id name legacyResourceId totalPriceSet { shopMoney { amount } } } } }`, { q: `customer_id:${num} AND tag:ivx-retailer AND created_at:>='${from}' AND created_at:<='${to}'` });
      const want = Number(rec.orderTotal || 0);
      const m = o.orders.nodes.find((x) => Math.abs(Number(x.totalPriceSet.shopMoney.amount) - want) < 0.01);
      if (m) return { ...out(m, { id: "" }), linked: true };
      const dq = await gql(`query($q: String!) { draftOrders(first: 20, query: $q) { nodes { id name legacyResourceId status totalPriceSet { shopMoney { amount } } order { id name legacyResourceId } } } }`, { q: `customer_id:${num} AND tag:ivx-retailer` });
      const dm = dq.draftOrders.nodes.find((x) => Math.abs(Number(x.totalPriceSet.shopMoney.amount) - want) < 0.01);
      if (dm) {
        if (dm.order) return { ...out(dm.order, { id: dm.id }), linked: true };
        return { orderId: dm.id, orderName: dm.name, draftId: dm.id, linked: true, draft: true, adminUrl: `https://admin.shopify.com/store/${shop().replace(/\.myshopify\.com$/, "")}/draft_orders/${dm.legacyResourceId}` };
      }
    }
    const input = {
      purchasingEntity: { customerId },
      lineItems: lines,
      tags: [recTag, "ivx-field", "IV-X Field", "wholesale", store.kind === "gym" ? "Gym" : "Retail", "Terms: " + (rec.terms || "paid"), rec.by ? "Rep: " + q(rec.by) : ""].filter(Boolean),
      note: [`IV-X Field sale ${rec.invoiceNo || ""}`, `Store: ${store.name} — ${store.address || ""}`, rec.by ? `Rep: ${rec.by}` : "", rec.terms ? `Terms: ${rec.terms}${rec.dueDate ? " (due " + rec.dueDate + ")" : ""}` : "", rec.notes ? `Notes: ${rec.notes}` : "", (Number(rec.freeCases) || Number(rec.freeCans) || Number(rec.discount)) ? `Promo given (not billed): ${rec.freeCases || 0} free cases, ${rec.freeCans || 0} free cans, $${rec.discount || 0} discount` : "", "Delivered in person by the field team."].filter(Boolean).join("\n"),
      poNumber: rec.invoiceNo || undefined,
      taxExempt: true,
    };
    const c = await gql(`mutation($input: DraftOrderInput!) { draftOrderCreate(input: $input) { draftOrder { id } userErrors { field message } } }`, { input });
    userErr(c.draftOrderCreate);
    draft = { id: c.draftOrderCreate.draftOrder.id, order: null };
  }
  let order = draft.order;
  const total = Number(rec.orderTotal || 0), paid = Number(rec.paid || 0);
  if (!order) {
    const fullyPaid = total > 0 && paid >= total - 0.005;
    const d = await gql(`mutation($id: ID!, $pp: Boolean) { draftOrderComplete(id: $id, paymentPending: $pp) { draftOrder { order { id name legacyResourceId } } userErrors { field message } } }`, { id: draft.id, pp: !fullyPaid });
    userErr(d.draftOrderComplete);
    order = d.draftOrderComplete.draftOrder.order;
    if (!fullyPaid && paid > 0) {
      const pr = await recordPayment({ orderId: order.id, amount: paid, method: rec.payMethod, full: false }).catch((e) => ({ warning: String(e.message || e) }));
      if (pr && pr.warning) return { ...out(order, draft), warning: "Order created, but the partial payment couldn't be recorded: " + pr.warning };
    }
  }
  return out(order, draft);
}
const out = (order, draft) => ({ orderId: order.id, orderName: order.name, orderNum: order.legacyResourceId, draftId: draft.id, adminUrl: `https://admin.shopify.com/store/${shop().replace(/\.myshopify\.com$/, "")}/orders/${order.legacyResourceId}` });

async function recordPayment(b) {
  if (!b.orderId) throw new Error("Missing order");
  if (b.full) {
    const r = await gql(`mutation($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } } }`, { input: { id: b.orderId } });
    const pe = r.orderMarkAsPaid.userErrors || [];
    if (pe.length && pe.every((e) => /paid/i.test(e.message))) return { status: "PAID" };
    userErr(r.orderMarkAsPaid);
    return { status: r.orderMarkAsPaid.order.displayFinancialStatus };
  }
  const r = await gql(`mutation($id: ID!, $amount: MoneyInput, $m: String) { orderCreateManualPayment(id: $id, amount: $amount, paymentMethodName: $m) { order { id displayFinancialStatus } userErrors { field message } } }`, { id: b.orderId, amount: money(b.amount), m: b.method || "Cash" });
  userErr(r.orderCreateManualPayment);
  return { status: r.orderCreateManualPayment.order.displayFinancialStatus };
}

async function portalOrders(b) {
  const since = /^\d{4}-\d{2}-\d{2}/.test(b.since || "") ? b.since.slice(0, 10) : new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const d = await gql(`query($q: String!) { orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt tags displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount } } customer { id displayName tags } lineItems(first: 20) { nodes { title quantity } } } } }`, { q: `tag:ivx-retailer AND created_at:>='${since}'` });
  const dr = await gql(`query($q: String!) { draftOrders(first: 100, query: $q, sortKey: UPDATED_AT, reverse: true) { nodes { id name createdAt status totalPriceSet { shopMoney { amount } } customer { id displayName tags } lineItems(first: 20) { nodes { title quantity } } } } }`, { q: `tag:ivx-retailer AND created_at:>='${since}'` });
  const drafts = dr.draftOrders.nodes.filter((o) => o.status !== "COMPLETED").map((o) => ({
    id: o.id, name: o.name, at: o.createdAt, total: Number(o.totalPriceSet.shopMoney.amount || 0), draft: true,
    paid: o.status === "INVOICE_SENT" ? "INVOICE_SENT" : "OPEN", fulfilled: "UNFULFILLED",
    customer: o.customer ? o.customer.displayName : "", customerTags: o.customer ? o.customer.tags : [],
    items: o.lineItems.nodes.map((l) => ({ title: l.title, qty: l.quantity })),
    cases: o.lineItems.nodes.reduce((s, l) => s + (l.quantity || 0), 0),
  }));
  return drafts.concat(d.orders.nodes.map((o) => ({
    id: o.id, name: o.name, at: o.createdAt, total: Number(o.totalPriceSet.shopMoney.amount || 0),
    paid: o.displayFinancialStatus, fulfilled: o.displayFulfillmentStatus,
    customer: o.customer ? o.customer.displayName : "", customerTags: o.customer ? o.customer.tags : [],
    items: o.lineItems.nodes.map((l) => ({ title: l.title, qty: l.quantity })),
    cases: o.lineItems.nodes.reduce((s, l) => s + (l.quantity || 0), 0),
  }))).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

async function cancelOrder(b) {
  // Only cancels orders this app created (tagged ivx-field). Restocks, no refund, no customer email.
  const num = String(b.orderName || "").replace(/[^0-9]/g, "");
  if (!num) throw new Error("Enter an order number, like 1731");
  const f = await gql(`query($q: String!) { orders(first: 5, query: $q) { nodes { id name tags cancelledAt } } }`, { q: `name:${num}` });
  const o = f.orders.nodes.find((x) => x.name.replace(/[^0-9]/g, "") === num);
  if (!o) throw new Error("Order #" + num + " not found");
  if (!o.tags.includes("ivx-field")) throw new Error("Order " + o.name + " wasn't created by IV-X Field, so it can't be canceled from here");
  if (o.cancelledAt) return { name: o.name, already: true };
  const r = await gql(`mutation($id: ID!, $note: String) { orderCancel(orderId: $id, reason: STAFF, restock: true, notifyCustomer: false, staffNote: $note) { job { id } orderCancelUserErrors { message } } }`, { id: o.id, note: String(b.note || "Duplicate - canceled from IV-X Field").slice(0, 250) }, "2026-10");
  const e = r.orderCancel.orderCancelUserErrors || [];
  if (e.length) throw new Error(e.map((x) => x.message).join("; "));
  return { name: o.name, canceled: true };
}

async function signedIn(req) {
  // Confirms the caller is a signed-in IV-X Field user (works with new and legacy Supabase keys)
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(\S+)/);
  if (!m || m[1].split(".").length !== 3) return false; // needs a user session token, not just the public key
  const url = env("SUPABASE_URL");
  const key = req.headers.get("apikey") || env("SUPABASE_ANON_KEY");
  if (!url || !key) return false;
  const r = await fetch(url + "/auth/v1/user", { headers: { Authorization: auth, apikey: key } }).catch(() => null);
  return !!(r && r.ok);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
  try {
    if (!(await signedIn(req))) return reply({ error: "Sign in to the IV-X Field app first." }, 401);
    const b = await req.json().catch(() => ({}));
    if (b.action === "ping") return reply({ ok: true, shop: await ping() });
    if (b.action === "products") return reply({ ok: true, products: await products() });
    if (b.action === "pushSale") return reply({ ok: true, ...(await pushSale(b)) });
    if (b.action === "portalOrders") return reply({ ok: true, orders: await portalOrders(b) });
    if (b.action === "cancelOrder") return reply({ ok: true, ...(await cancelOrder(b)) });
    if (b.action === "payment") return reply({ ok: true, ...(await recordPayment(b)) });
    return reply({ error: "Unknown action" }, 400);
  } catch (e) {
    return reply({ ok: false, error: String((e && e.message) || e) }, 200);
  }
});
