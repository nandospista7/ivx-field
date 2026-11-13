/* IV-X Field — Week in Review (shared by the phone app and the manager dashboard) */
(function () {
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addD = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const localDay = iso => { if (!iso) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso; const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 10) : ymd(d); };
  const mondayOf = s => { const d = parse(s); const w = d.getDay(); d.setDate(d.getDate() - (w === 0 ? 6 : w - 1)); return ymd(d); };
  const num = v => parseFloat(v) || 0;
  const money = v => '$' + num(v).toLocaleString('en-US', { minimumFractionDigits: num(v) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => { const d = parse(s); return DAYN[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate(); };
  const fmtLong = s => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  const TERMS = { paid: 'Paid', net15: 'Net 15', net30: 'Net 30', consign: 'Consignment', next: 'Pay next visit' };
  const OUT = { sold: 'Sold', fu: 'Follow up', no: 'No sale', skip: 'Closed / skipped' };

  // Default: the route week that just ended (Fri–Sun show the current week; Mon–Thu show last week)
  function defaultWeek(today) { const t = today || ymd(new Date()); const w = parse(t).getDay(); const m = mondayOf(t); return (w >= 1 && w <= 4) ? addD(m, -7) : m; }

  function compute(inp) {
    const W0 = inp.weekStart, W6 = addD(W0, 6), today = inp.today || ymd(new Date());
    const inW = d => d >= W0 && d <= W6;
    const all = (inp.recs || []).filter(r => r && !r.deleted);
    const when = r => localDay(r.visitAt || r.createdAt || r.at);
    const visits = all.filter(r => r.kind !== 'payment' && r.status);
    const payments = all.filter(r => r.kind === 'payment');
    const wk = visits.filter(r => inW(when(r)));
    const payFor = inv => payments.filter(p => p.invoiceNo && p.invoiceNo === inv);
    const balance = r => { const tot = num(r.orderTotal), paid = num(r.paid) + payFor(r.invoiceNo).reduce((t, p) => t + num(p.amount), 0); return { tot, paid, bal: Math.round((tot - paid) * 100) / 100 }; };

    const agg = list => {
      const a = { sold: 0, fu: 0, no: 0, skip: 0, cases: 0, orders: 0, paidAtSale: 0, samples: 0, freeCases: 0, freeCans: 0 };
      list.forEach(r => { a[r.status] = (a[r.status] || 0) + 1; a.samples += num(r.sampleCost); a.freeCases += num(r.freeCases); a.freeCans += num(r.freeCans);
        if (r.status === 'sold') { a.cases += num(r.cases); a.orders += num(r.orderTotal); a.paidAtSale += Math.min(num(r.paid), num(r.orderTotal) || num(r.paid)); } });
      a.visited = a.sold + a.fu + a.no; a.stops = a.visited + a.skip; return a;
    };
    const retail = wk.filter(r => r.kind !== 'gym'), gym = wk.filter(r => r.kind === 'gym');
    const T = agg(retail), G = agg(gym), A = agg(wk);
    const payWk = payments.filter(p => inW(localDay(p.at)));
    A.paymentsIn = payWk.reduce((t, p) => t + num(p.amount), 0);
    A.collected = A.paidAtSale + A.paymentsIn;

    // first-ever sale per store -> new account vs reorder
    const firstSold = {};
    visits.filter(r => r.status === 'sold').forEach(r => { const d = when(r), k = r.storeKey || r.store; if (!firstSold[k] || d < firstSold[k]) firstSold[k] = d; });
    const sales = wk.filter(r => r.status === 'sold').map(r => { const b = balance(r); return { r, d: when(r), isNew: firstSold[r.storeKey || r.store] === when(r), ...b }; })
      .sort((a, b) => a.d.localeCompare(b.d) || num(b.tot) - num(a.tot));
    const newAccts = sales.filter(s => s.isNew), reorders = sales.filter(s => !s.isNew);

    const byDay = []; for (let i = 0; i < 7; i++) { const d = addD(W0, i); const L = wk.filter(r => when(r) === d); if (!L.length && i > 4) continue;
      const a = agg(L); a.collected = a.paidAtSale + payWk.filter(p => localDay(p.at) === d).reduce((t, p) => t + num(p.amount), 0); byDay.push({ d, ...a }); }
    const reps = {}; wk.forEach(r => { const k = r.by || 'Unassigned'; (reps[k] = reps[k] || []).push(r); });
    const byRep = Object.entries(reps).map(([n, L]) => ({ n, ...agg(L) })).sort((a, b) => b.cases - a.cases || b.visited - a.visited);
    const flav = {}; wk.filter(r => r.status === 'sold').forEach(r => (r.items || []).forEach(i => { flav[i.n] = (flav[i.n] || 0) + num(i.q); }));
    const flavors = Object.entries(flav).sort((a, b) => b[1] - a[1]);
    const why = {}; wk.forEach(r => (r.reasons || []).forEach(x => { why[x] = (why[x] || 0) + 1; }));
    const objections = Object.entries(why).sort((a, b) => b[1] - a[1]);

    // money owed (everything still open, any week)
    const owed = visits.filter(r => r.status === 'sold' && r.invoiceNo && num(r.orderTotal) > 0).map(r => ({ r, ...balance(r) })).filter(x => x.bal > 0.004)
      .map(x => ({ ...x, due: x.r.dueDate || '', overdue: x.r.dueDate && x.r.dueDate < today })).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));

    // follow-ups: latest visit per store
    const latest = {}; visits.forEach(r => { const k = r.storeKey || r.store; if (!latest[k] || String(r.visitAt || r.at) > String(latest[k].visitAt || latest[k].at)) latest[k] = r; });
    const portalBy = {}; (inp.portal || []).forEach(o => { if (o.storeKey) (portalBy[o.storeKey] = portalBy[o.storeKey] || []).push(o); });
    const fus = Object.values(latest).filter(r => r.followUpDate).map(r => {
      let due = r.followUpDate, why = r.status === 'sold' ? 'Reorder check' : r.status === 'fu' ? 'Follow up' : r.status === 'no' ? 'Try again' : 'Revisit';
      const po = (portalBy[r.storeKey] || []).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
      if (po && String(po.at) > String(r.at || '')) { const nd = addD(localDay(po.at), inp.reorderDays || 14); if (nd > due) due = nd; why += ' · reordered in portal ' + fmtLong(localDay(po.at)); }
      return { r, due, why, overdue: due < today };
    }).sort((a, b) => a.due.localeCompare(b.due));
    const nextEnd = addD(today, 7);
    const fuOver = fus.filter(f => f.due < today), fuNext = fus.filter(f => f.due >= today && f.due <= nextEnd), fuLater = fus.filter(f => f.due > nextEnd);

    // route coverage: planned stops never visited
    const seen = new Set(); visits.forEach(r => { seen.add(r.id); if (r.storeKey) seen.add(r.storeKey); });
    const plan = inp.plan || {}, dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri'], dayName = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri' };
    const coverage = dayKeys.filter(k => plan[k] && plan[k].stops).map(k => { const S = plan[k].stops.filter(s => !s.cut); const left = S.filter(s => { const sk = s.storeKey || (inp.keyOf ? inp.keyOf(s.name, s.addr) : ''); return !seen.has(s.id) && !seen.has(sk); });
      return { k, name: dayName[k], label: plan[k].label || '', total: S.length, done: S.length - left.length, left }; });

    const portalWk = (inp.portal || []).filter(o => inW(localDay(o.at)));
    const gymsTotal = (inp.gyms || []).length;

    // highlights
    const hl = [];
    if (A.visited) hl.push(`${A.visited} store visits, ${A.sold} sales — ${pct(A.sold, A.visited)} close rate.`);
    if (A.cases) hl.push(`${A.cases} cases sold for ${money(A.orders)} in orders; ${money(A.collected)} collected.`);
    if (newAccts.length) hl.push(`${newAccts.length} new account${newAccts.length > 1 ? 's' : ''} opened${reorders.length ? `, ${reorders.length} reorder${reorders.length > 1 ? 's' : ''}` : ''}.`);
    const bestDay = byDay.slice().sort((a, b) => b.cases - a.cases || b.sold - a.sold)[0];
    if (bestDay && bestDay.cases) hl.push(`Best day: ${fmt(bestDay.d)} — ${bestDay.sold} sales, ${bestDay.cases} cases.`);
    if (flavors.length) hl.push(`Top flavor: ${flavors[0][0]} (${flavors[0][1]} cases)${flavors[1] ? `, then ${flavors[1][0]} (${flavors[1][1]})` : ''}.`);
    const big = sales.slice().sort((a, b) => b.tot - a.tot)[0]; if (big && big.tot) hl.push(`Biggest order: ${big.r.store} — ${money(big.tot)} (${num(big.r.cases)} cases).`);
    if (objections.length) hl.push(`Most common objection: “${objections[0][0]}” (${objections[0][1]}×).`);
    const owedT = owed.reduce((t, x) => t + x.bal, 0); if (owedT) hl.push(`${money(owedT)} still owed across ${owed.length} invoice${owed.length > 1 ? 's' : ''}${owed.filter(x => x.overdue).length ? ` — ${owed.filter(x => x.overdue).length} overdue` : ''}.`);
    if (fuOver.length || fuNext.length) hl.push(`${fuOver.length + fuNext.length} follow-ups to handle next week${fuOver.length ? ` (${fuOver.length} already overdue)` : ''}.`);
    const left = coverage.reduce((t, c) => t + c.left.length, 0); if (left) hl.push(`${left} planned route stops not visited yet — carry them into next week.`);

    return { W0, W6, today, A, T, G, byDay, byRep, flavors, objections, sales, newAccts, reorders, owed, owedT, fuOver, fuNext, fuLater, coverage, portalWk, gymsTotal, hl, payWk };
  }

  function html(R, opts) {
    opts = opts || {};
    const A = R.A, k = (v, l, c) => `<div class="wr-k"><b${c ? ` style="color:${c}"` : ''}>${v}</b><small>${l}</small></div>`;
    const sec = (t, body, sub) => `<section class="wr-sec"><h3>${t}</h3>${sub ? `<p class="wr-sub">${sub}</p>` : ''}${body}</section>`;
    const tbl = (head, rows) => rows.length ? `<div class="wr-tw"><table class="wr-t"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="wr-empty">Nothing this week.</p>';
    const contact = r => [r.contactName, r.contactPhone || r.phone].filter(Boolean).map(esc).join(' · ');
    let o = `<div class="wr">
    <div class="wr-head"><div><div class="wr-eyebrow">IV-X Field · Week in review</div><h2>${fmtLong(R.W0)} – ${fmtLong(R.W6)}, ${parse(R.W6).getFullYear()}</h2></div>
      <div class="wr-nav wr-noprint"><button data-wr="prev" aria-label="Previous week">‹</button><button data-wr="next" aria-label="Next week">›</button><button data-wr="copy">Copy</button><button data-wr="print">Print</button></div></div>
    <div class="wr-kgrid">${k(A.visited, 'Stores visited')}${k(A.sold, 'Sales', '#15803d')}${k(pct(A.sold, A.visited), 'Close rate')}${k(A.cases, 'Cases')}${k(money(A.orders), 'Order value')}${k(money(A.collected), 'Collected')}${k(R.newAccts.length, 'New accounts', '#15803d')}${k(money(R.owedT), 'Still owed', R.owedT ? '#b45309' : '')}${k(R.fuOver.length + R.fuNext.length, 'Follow-ups due', '#b45309')}${k(money(A.samples), 'Samples & promos')}</div>`;
    if (R.hl.length) o += sec('Highlights', `<ul class="wr-hl">${R.hl.map(h => `<li>${esc(h)}</li>`).join('')}</ul>`);
    o += sec('By day', tbl(['Day', 'Visited', 'Sold', 'Close', 'Cases', 'Orders', 'Collected', 'Follow up', 'No sale'],
      R.byDay.map(d => `<tr><td><b>${fmt(d.d)}</b></td><td>${d.visited}</td><td>${d.sold}</td><td>${pct(d.sold, d.visited)}</td><td>${d.cases}</td><td>${money(d.orders)}</td><td>${money(d.collected)}</td><td>${d.fu}</td><td>${d.no}</td></tr>`)
        .concat([`<tr class="wr-tot"><td>Week</td><td>${A.visited}</td><td>${A.sold}</td><td>${pct(A.sold, A.visited)}</td><td>${A.cases}</td><td>${money(A.orders)}</td><td>${money(A.collected)}</td><td>${A.fu}</td><td>${A.no}</td></tr>`])));
    if (R.byRep.length > 1 || (R.byRep[0] && R.byRep[0].n !== 'Unassigned')) o += sec('By rep', tbl(['Rep', 'Visited', 'Sold', 'Close', 'Cases', 'Orders', 'Samples'],
      R.byRep.map(p => `<tr><td><b>${esc(p.n)}</b></td><td>${p.visited}</td><td>${p.sold}</td><td>${pct(p.sold, p.visited)}</td><td>${p.cases}</td><td>${money(p.orders)}</td><td>${money(p.samples)}</td></tr>`)));
    if (R.flavors.length) { const mx = R.flavors[0][1]; o += sec('Flavors sold', R.flavors.map(([n, q]) => `<div class="wr-bar"><span>${esc(n)}</span><i style="width:${Math.max(6, q / mx * 100)}%"></i><b>${q} cs</b></div>`).join('')); }
    o += sec(`Sales (${R.sales.length})`, tbl(['Day', 'Store', 'Cases', 'Order', 'Terms', 'Balance', 'Type'],
      R.sales.map(s => `<tr><td>${fmt(s.d)}</td><td><b>${esc(s.r.store)}</b>${s.r.kind === 'gym' ? ' <em class="wr-tag">GYM</em>' : ''}${s.r.bought ? `<div class="wr-m">${esc(s.r.bought)}</div>` : ''}${s.r.shopify && s.r.shopify.orderName ? `<div class="wr-m">Shopify ${esc(s.r.shopify.orderName)}</div>` : ''}</td><td>${num(s.r.cases)}</td><td>${money(s.tot)}</td><td>${esc(TERMS[s.r.terms] || s.r.terms || '—')}</td><td>${s.bal > 0.004 ? `<b class="wr-warn">${money(s.bal)}</b>` : 'Paid'}</td><td>${s.isNew ? '<em class="wr-tag wr-new">NEW</em>' : 'Reorder'}</td></tr>`)));
    o += sec(`Money owed (${R.owed.length})`, tbl(['Store', 'Invoice', 'Balance', 'Due', 'Terms'],
      R.owed.map(x => `<tr${x.overdue ? ' class="wr-over"' : ''}><td><b>${esc(x.r.store)}</b><div class="wr-m">${contact(x.r)}</div></td><td>${esc(x.r.invoiceNo)}</td><td><b>${money(x.bal)}</b> <span class="wr-m">of ${money(x.tot)}</span></td><td>${x.due ? fmt(x.due) + (x.overdue ? ' · OVERDUE' : '') : '—'}</td><td>${esc(TERMS[x.r.terms] || x.r.terms || '')}</td></tr>`)), 'All open invoices, not just this week’s.');
    const fuRow = f => `<tr${f.overdue ? ' class="wr-over"' : ''}><td>${fmt(f.due)}${f.overdue ? ' · OVERDUE' : ''}</td><td><b>${esc(f.r.store)}</b><div class="wr-m">${esc(f.r.address || '')}</div></td><td>${esc(f.why)}</td><td>${esc(OUT[f.r.status] || '')}${(f.r.reasons || []).length ? `<div class="wr-m">${esc(f.r.reasons.join(', '))}</div>` : ''}${f.r.notes ? `<div class="wr-m">“${esc(f.r.notes)}”</div>` : ''}</td><td>${contact(f.r)}</td></tr>`;
    o += sec(`Follow-ups — overdue & next 7 days (${R.fuOver.length + R.fuNext.length})`, tbl(['Due', 'Store', 'Why', 'Last visit', 'Contact'], R.fuOver.concat(R.fuNext).map(fuRow)),
      R.fuLater.length ? `${R.fuLater.length} more scheduled after next week.` : '');
    if (R.objections.length) o += sec('Objections heard', R.objections.map(([n, c]) => `<div class="wr-bar wr-bar2"><span>${esc(n)}</span><i style="width:${Math.max(6, c / R.objections[0][1] * 100)}%"></i><b>${c}×</b></div>`).join(''));
    if (R.coverage.length) o += sec('Route coverage', tbl(['Route', 'Visited', 'Not visited yet'],
      R.coverage.map(c => `<tr><td><b>${c.name}</b>${c.label ? ` <span class="wr-m">${esc(c.label)}</span>` : ''}</td><td>${c.done}/${c.total}</td><td>${c.left.length ? `${c.left.length} stops${opts.listLeft !== false ? `<div class="wr-m">${c.left.slice(0, 8).map(s => esc(s.name)).join(', ')}${c.left.length > 8 ? '…' : ''}</div>` : ''}` : 'All done'}</td></tr>`)), 'Planned stops that haven’t had a visit yet — carry these over.');
    const G = R.G; if (G.stops || R.gymsTotal) o += sec('Gyms & studios', `<div class="wr-kgrid wr-k4">${k(G.visited, 'Visited')}${k(G.sold, 'Sold', '#15803d')}${k(G.cases, 'Cases')}${k(money(G.orders), 'Orders')}</div>${R.gymsTotal ? `<p class="wr-sub">${R.gymsTotal} gyms on the list.</p>` : ''}`);
    if (R.portalWk.length) o += sec(`Portal reorders — IV-X Retailer (${R.portalWk.length})`, tbl(['Day', 'Store', 'Cases', 'Total', 'Status'],
      R.portalWk.map(p => `<tr><td>${fmt(localDay(p.at))}</td><td><b>${esc(p.customer || '')}</b></td><td>${num(p.cases)}</td><td>${money(p.total)}</td><td>${p.draft ? 'Invoice sent' : esc(p.paid || '')}</td></tr>`)));
    o += sec('Samples & promos', `<p>${money(A.samples)} given away — ${num(A.freeCases)} free cases, ${num(A.freeCans)} free cans.${A.sold && A.samples ? ` That's ${money(A.samples / A.sold)} per sale.` : ''}</p>`);
    o += `<p class="wr-foot">Generated ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} from IV-X Field check-ins.</p></div>`;
    return o;
  }

  function text(R) {
    const A = R.A, L = [];
    L.push(`IV-X FIELD — WEEK IN REVIEW (${fmtLong(R.W0)} – ${fmtLong(R.W6)})`, '');
    L.push(`Visited ${A.visited} · Sold ${A.sold} (${pct(A.sold, A.visited)}) · ${A.cases} cases · Orders ${money(A.orders)} · Collected ${money(A.collected)} · Owed ${money(R.owedT)} · New accounts ${R.newAccts.length}`, '');
    if (R.hl.length) { L.push('HIGHLIGHTS'); R.hl.forEach(h => L.push('• ' + h)); L.push(''); }
    L.push('BY DAY'); R.byDay.forEach(d => L.push(`${fmt(d.d)}: ${d.visited} visited, ${d.sold} sold, ${d.cases} cs, ${money(d.orders)}`)); L.push('');
    if (R.sales.length) { L.push('SALES'); R.sales.forEach(s => L.push(`${fmt(s.d)} — ${s.r.store}: ${num(s.r.cases)} cs, ${money(s.tot)}, ${TERMS[s.r.terms] || s.r.terms || ''}${s.bal > 0.004 ? `, owes ${money(s.bal)}` : ''}${s.isNew ? ' (NEW)' : ''}`)); L.push(''); }
    if (R.flavors.length) { L.push('FLAVORS'); R.flavors.forEach(([n, q]) => L.push(`${n}: ${q} cs`)); L.push(''); }
    if (R.owed.length) { L.push('MONEY OWED'); R.owed.forEach(x => L.push(`${x.r.store} — ${money(x.bal)} (${x.r.invoiceNo}), due ${x.due ? fmt(x.due) : '—'}${x.overdue ? ' OVERDUE' : ''}`)); L.push(''); }
    const F = R.fuOver.concat(R.fuNext); if (F.length) { L.push('FOLLOW-UPS (overdue + next 7 days)'); F.forEach(f => L.push(`${fmt(f.due)}${f.overdue ? ' OVERDUE' : ''} — ${f.r.store}: ${f.why}${f.r.contactPhone || f.r.phone ? ' · ' + (f.r.contactPhone || f.r.phone) : ''}`)); L.push(''); }
    if (R.objections.length) { L.push('OBJECTIONS'); R.objections.forEach(([n, c]) => L.push(`${n}: ${c}`)); L.push(''); }
    const left = R.coverage.filter(c => c.left.length); if (left.length) { L.push('NOT VISITED YET'); left.forEach(c => L.push(`${c.name}: ${c.left.length} stops — ${c.left.map(s => s.name).join(', ')}`)); L.push(''); }
    if (R.portalWk.length) { L.push('PORTAL REORDERS'); R.portalWk.forEach(p => L.push(`${fmt(localDay(p.at))} — ${p.customer}: ${num(p.cases)} cs, ${money(p.total)}`)); }
    return L.join('\n').trim();
  }

  const CSS = `.wr{--wr-line:#e7e3da;--wr-mut:#6b675f;font-size:14px;color:#111;line-height:1.4}
.wr .wr-head h2{margin:2px 0 0;font:800 22px/1.2 Inter,system-ui,-apple-system,sans-serif;letter-spacing:-.01em;text-transform:none;color:#111}.wr .wr-sec h3{font-family:Inter,system-ui,-apple-system,sans-serif;font-weight:800}.wr-eyebrow{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--wr-mut)}
.wr-head{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:4px 0 12px}
.wr-nav{display:flex;gap:6px}.wr-nav button{border:1px solid var(--wr-line);background:#fff;border-radius:9px;padding:8px 12px;font-weight:700;font-size:13px;color:#111;cursor:pointer}
.wr-kgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:6px}.wr-k4{grid-template-columns:repeat(4,1fr)}
.wr-k{background:#fff;border:1px solid var(--wr-line);border-radius:12px;padding:10px}.wr-k b{display:block;font-size:20px;line-height:1.1}.wr-k small{color:var(--wr-mut);font-size:11.5px;font-weight:600}
.wr-sec{background:#fff;border:1px solid var(--wr-line);border-radius:14px;padding:12px 14px;margin:10px 0;break-inside:avoid}
.wr-sec h3{margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase}.wr-sub{color:var(--wr-mut);font-size:12.5px;margin:-4px 0 8px}
.wr-hl{margin:0;padding-left:18px}.wr-hl li{margin:3px 0}
.wr-tw{overflow-x:auto;-webkit-overflow-scrolling:touch}.wr-t{width:100%;border-collapse:collapse;font-size:13px}
.wr-t th{text-align:left;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--wr-mut);border-bottom:1px solid var(--wr-line);padding:6px 8px;white-space:nowrap}
.wr-t td{border-bottom:1px solid #f1eee8;padding:7px 8px;vertical-align:top}.wr-tot td{font-weight:800;border-top:2px solid var(--wr-line)}
.wr-over td{background:#fff7ed}.wr-m{color:var(--wr-mut);font-size:12px}.wr-warn{color:#b45309}
.wr-tag{font-style:normal;font-size:10.5px;font-weight:800;background:#111;color:#fff;border-radius:5px;padding:1px 5px}.wr-new{background:#15803d}
.wr-bar{display:grid;grid-template-columns:150px 1fr 56px;gap:8px;align-items:center;margin:5px 0;font-size:13px}.wr-bar i{height:10px;border-radius:5px;background:#5eead4}.wr-bar2 i{background:#fdba74}.wr-bar b{text-align:right}
.wr-empty{color:var(--wr-mut);margin:4px 0}.wr-foot{color:var(--wr-mut);font-size:11.5px;text-align:center;margin:12px 0 4px}
@media (max-width:560px){.wr-bar{grid-template-columns:110px 1fr 48px}.wr .wr-head h2{font-size:19px}}
@media print{body.wr-printing *{visibility:hidden!important}body.wr-printing .wr,body.wr-printing .wr *{visibility:visible!important}
 body.wr-printing .wr{position:absolute;left:0;top:0;width:100%}.wr-noprint{display:none!important}.wr-sec,.wr-k{border-color:#ccc}.wr-over td{background:#fff3e0!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;

  function mount(el, getInput, opts) {
    if (!document.getElementById('wr-css')) { const s = document.createElement('style'); s.id = 'wr-css'; s.textContent = CSS; document.head.appendChild(s); }
    let week = el._wrWeek || defaultWeek();
    const draw = () => {
      el._wrWeek = week; const R = compute({ ...getInput(), weekStart: week }); el.innerHTML = html(R, opts);
      el.querySelector('[data-wr=prev]').onclick = () => { week = addD(week, -7); draw(); };
      el.querySelector('[data-wr=next]').onclick = () => { week = addD(week, 7); draw(); };
      el.querySelector('[data-wr=print]').onclick = () => { document.body.classList.add('wr-printing'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('wr-printing'), 500); }, 50); };
      el.querySelector('[data-wr=copy]').onclick = async e => { const t = text(R), b = e.currentTarget;
        try { if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) { await navigator.share({ title: 'IV-X week in review', text: t }); return; } await navigator.clipboard.writeText(t); }
        catch (err) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) {} ta.remove(); }
        b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); };
    };
    draw(); return { redraw: draw };
  }

  window.IVXReview = { compute, html, text, mount, defaultWeek };
})();
