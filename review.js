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
      ${opts.static ? '' : `<div class="wr-nav wr-noprint"><button data-wr="prev" aria-label="Previous week">‹</button><button data-wr="next" aria-label="Next week">›</button><button data-wr="copy">Copy</button><button data-wr="print">Print</button></div>`}</div>
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
    ensureCss();
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


  // ===================== NEXT WEEK: alerts, call sheet, van loading plan, route plan =====================
  const DAYK = ['mon', 'tue', 'wed', 'thu', 'fri'], DAYL = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri' };
  const DEF_LABEL = { mon: 'Astoria · LIC', tue: 'Jackson Hts · Elmhurst · Corona', wed: 'Upper East Side', thu: 'Midtown W → Murray Hill', fri: 'Gramercy · E. Village · LES' };
  const fullA = (addr, name, k) => { const a = String(addr || '').replace(/\s*\(.*?\)/g, '').trim(); if (/,\s*NY\b/i.test(a)) return a; return (a || name) + ', ' + (['mon', 'tue'].includes(k) ? 'Queens, NY' : 'New York, NY'); };
  const navUrl = (addr, name, k, app) => { const d = encodeURIComponent(fullA(addr, name, k)); return app === 'google' ? 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + d : 'https://maps.apple.com/?dirflg=d&daddr=' + d; };
  const telOf = s => { const m = String(s || '').match(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/); return m ? m[0].replace(/[^\d+]/g, '') : ''; };
  const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const TYPE = { reorder: 'Reorder check', fu: 'Follow up', fu2: 'Follow up (again)', retry: 'Try again', revisit: 'Revisit', consign: 'Consignment check', collect: 'Collect payment', new: 'New store' };
  const TYPE_ORDER = ['collect', 'consign', 'reorder', 'fu2', 'fu', 'retry', 'revisit', 'new'];
  const GYM_DAY = { astoria: 'mon', sunny: 'mon', ues: 'wed', mid: 'thu', flat: 'fri', down: 'fri' };
  const hashStr = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const routeMonday = today => { const t = today || ymd(new Date()); const w = parse(t).getDay(); return w === 0 ? addD(t, 1) : w === 6 ? addD(t, 2) : mondayOf(t); };

  function nextWeek(inp) {
    const today = inp.today || ymd(new Date());
    const N0 = inp.nextStart || addD(inp.weekStart || defaultWeek(today), 7), N4 = addD(N0, 4), N6 = addD(N0, 6);
    const asOf = today < N0 ? today : addD(N0, -1), started = today >= N0;
    const keyOf = (n, a) => inp.keyOf ? inp.keyOf(n, a) : String(n || '');
    const kOf = r => r.storeKey || keyOf(r.store, r.address);
    const when = r => localDay(r.visitAt || r.createdAt || r.at);
    const reorderDays = inp.reorderDays || 14, perDay = inp.perDay || 15, app = inp.mapApp || 'apple';
    const all = (inp.recs || []).filter(r => r && !r.deleted);
    const visits = all.filter(r => r.kind !== 'payment' && r.status);
    const before = visits.filter(r => when(r) < N0), during = visits.filter(r => when(r) >= N0 && when(r) <= N6);
    const payments = all.filter(r => r.kind === 'payment');
    const paidFor = inv => payments.filter(p => p.invoiceNo && p.invoiceNo === inv).reduce((t, p) => t + num(p.amount), 0);
    const balOf = r => Math.round((num(r.orderTotal) - num(r.paid) - paidFor(r.invoiceNo)) * 100) / 100;

    // store directory from the route plan (+ gyms)
    const plan = inp.plan || {}, dir = {};
    DAYK.forEach(k => ((plan[k] || {}).stops || []).forEach((s, i) => { if (s.cut) return; const key = s.storeKey || keyOf(s.name, s.addr);
      if (!dir[key]) dir[key] = { key, name: s.name, addr: s.addr || '', contact: s.contact || '', day: k, seq: i, premium: !!s.premium, lr: !!s.lr, kind: s.kind }; }));
    (inp.gyms || []).forEach((g, i) => { const key = 'gym_' + keyOf(g.name, g.addr); if (!dir[key]) dir[key] = { key, name: g.name, addr: g.addr || '', contact: g.contact || '', day: g.near || GYM_DAY[g.area] || '', seq: 900 + i, gym: true, kind: 'gym' }; });

    // history per store (only what happened before the planned week)
    const hist = {}; before.forEach(r => { (hist[kOf(r)] = hist[kOf(r)] || []).push(r); });
    Object.values(hist).forEach(L => L.sort((a, b) => String(a.visitAt || a.at).localeCompare(String(b.visitAt || b.at))));
    const doneNow = {}; during.forEach(r => { const k = kOf(r); if (!doneNow[k] || String(r.at) > String(doneNow[k].at)) doneNow[k] = r; });
    const portalBy = {}; (inp.portal || []).forEach(o => { if (o.storeKey && localDay(o.at) < N0) (portalBy[o.storeKey] = portalBy[o.storeKey] || []).push(o); });
    const lastPortal = k => (portalBy[k] || []).map(o => localDay(o.at)).sort().pop() || '';

    // rates learned from your own check-ins
    const firstV = Object.values(hist).map(L => L.find(r => r.status !== 'skip')).filter(Boolean).filter(r => r.kind !== 'gym');
    const fvSold = firstV.filter(r => r.status === 'sold').length;
    const closeRate = firstV.length >= 5 ? fvSold / firstV.length : 0.3;
    const firstSales = Object.values(hist).map(L => L.find(r => r.status === 'sold')).filter(Boolean);
    const avgFirst = firstSales.length ? firstSales.reduce((t, r) => t + num(r.cases), 0) / firstSales.length : 2;
    let fuN = 0, fuWon = 0; Object.values(hist).forEach(L => L.forEach((r, i) => { if (r.status === 'fu' && i < L.length - 1) { fuN++; if (L.slice(i + 1).some(x => x.status === 'sold')) fuWon++; } }));
    const fuRate = fuN >= 5 ? fuWon / fuN : 0.35;
    const fl = {}; before.filter(r => r.status === 'sold').forEach(r => (r.items || []).forEach(i => { if (i.n) fl[i.n] = (fl[i.n] || 0) + num(i.q); }));
    (inp.products || []).forEach(n => { if (!(n in fl)) fl[n] = 0; });
    const flTot = Object.values(fl).reduce((a, b) => a + b, 0), flN = Object.keys(fl).length;
    const mix = Object.entries(fl).map(([n, q]) => [n, flTot ? q / flTot : 1 / flN]).sort((a, b) => b[1] - a[1]);
    const freeAvg = firstV.length ? firstV.reduce((t, r) => t + num(r.freeCans), 0) / firstV.length : 2;
    const samplesPerNew = Math.max(1, Math.round(freeAvg || 2));

    // ---- call sheet: everyone to see / call next week ----
    const items = {};
    const item = (key, r) => { const d = dir[key] || {}; if (!items[key]) items[key] = { key, name: (r && r.store) || d.name || key, addr: (r && r.address) || d.addr || '', day: d.day || '', seq: d.seq != null ? d.seq : 999,
      premium: d.premium, lr: d.lr, gym: d.gym || (r && r.kind === 'gym'), types: [], due: '9999-12-31', notes: [], contactName: '', phone: d.contact || '', last: null, lastSale: null, owed: [] }; return items[key]; };
    const addType = (it, t, due, note) => { if (!it.types.includes(t)) it.types.push(t); if (due && due < it.due) it.due = due; if (note) it.notes.push(note); };
    Object.entries(hist).forEach(([key, L]) => {
      const last = L[L.length - 1], sales = L.filter(r => r.status === 'sold'), lastSale = sales[sales.length - 1];
      const cn = L.slice().reverse().find(r => r.contactName), cp = L.slice().reverse().find(r => r.contactPhone);
      const mk = () => { const it = item(key, last); it.last = last; it.lastSale = lastSale || null; it.contactName = cn ? cn.contactName : ''; it.phone = (cp && cp.contactPhone) || last.phone || it.phone; it.fuCount = L.filter(r => r.status === 'fu').length; return it; };
      const pDate = lastPortal(key);
      if (last.followUpDate) {
        let due = last.followUpDate, t = last.status === 'sold' ? 'reorder' : last.status === 'fu' ? 'fu' : last.status === 'no' ? 'retry' : 'revisit', note = '';
        if (t === 'fu' && L.filter(r => r.status === 'fu').length >= 2 && !sales.length) t = 'fu2';
        if (pDate && pDate > when(last)) { const nd = addD(pDate, reorderDays); if (nd > due) due = nd; note = 'Reordered in the portal ' + fmtLong(pDate); }
        if (due <= N4) addType(mk(), t, due, note);
      } else if (lastSale && last === lastSale) {
        const base = pDate && pDate > when(lastSale) ? pDate : when(lastSale), due = addD(base, reorderDays);
        if (due <= N4) addType(mk(), 'reorder', due, 'No follow-up date was set');
      }
      sales.forEach(r => { if (!r.invoiceNo || num(r.orderTotal) <= 0) return; const bal = balOf(r); if (bal <= 0.004) return;
        if (r.terms === 'consign') { const dl = r.dueDate || addD(when(r), 28); if (dl <= addD(N4, 7)) { const it = mk(); addType(it, 'consign', dl < N0 ? N0 : dl, `Consignment ${money(bal)} — decide by ${fmtLong(dl)}`); it.owed.push({ inv: r.invoiceNo, bal, due: dl, consign: true }); } }
        else if (r.dueDate && r.dueDate <= N4) { const it = mk(); addType(it, 'collect', r.dueDate, ''); it.owed.push({ inv: r.invoiceNo, bal, due: r.dueDate }); } });
    });
    const callList = Object.values(items).map(it => {
      if (!it.day || !DAYK.includes(it.day)) { const rd = it.last && DAYK.includes(it.last.day) ? it.last.day : ''; const d = it.due < N0 ? N0 : it.due > N4 ? N4 : it.due; it.day = rd || DAYK[Math.min(4, Math.max(0, daysBetween(N0, d)))]; }
      it.types.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b)); it.overdue = it.due < asOf; it.done = doneNow[it.key] || null;
      it.owedT = it.owed.reduce((t, o) => t + o.bal, 0); it.tel = telOf(it.phone); it.nav = navUrl(it.addr, it.name, it.day, app); return it;
    }).sort((a, b) => DAYK.indexOf(a.day) - DAYK.indexOf(b.day) || a.seq - b.seq || a.due.localeCompare(b.due));

    // ---- route plan per day ----
    const frozen = inp.frozen && inp.frozen.w0 === N0 && (inp.frozen.final || started) ? inp.frozen : null;
    const dayLabel = k => (inp.dayLabels && inp.dayLabels[k]) || DEF_LABEL[k] || '';
    const days = DAYK.map((k, di) => {
      const date = addD(N0, di);
      const planStops = ((plan[k] || {}).stops || []).filter(s => !s.cut).map((s, i) => ({ s, key: s.storeKey || keyOf(s.name, s.addr), seq: i }));
      const fixed = callList.filter(it => it.day === k);
      const fresh = planStops.filter(p => !hist[p.key] && !items[p.key]);
      let picked;
      if (frozen && frozen.days && frozen.days[k]) { const want = new Set(frozen.days[k]); picked = fresh.filter(p => want.has(p.key)); }
      else picked = fresh.slice().sort((a, b) => (b.s.premium ? 1 : 0) - (a.s.premium ? 1 : 0) || (b.s.lr ? 1 : 0) - (a.s.lr ? 1 : 0) || a.seq - b.seq).slice(0, Math.max(0, perDay - fixed.length));
      const pickedSet = new Set(picked.map(p => p.key));
      const stops = fixed.map(it => ({ key: it.key, name: it.name, addr: it.addr, seq: it.seq, types: it.types, item: it, premium: it.premium, lr: it.lr, gym: it.gym, done: doneNow[it.key] || null, nav: it.nav, tel: it.tel }))
        .concat(picked.map(p => ({ key: p.key, name: p.s.name, addr: p.s.addr || '', seq: p.seq, types: ['new'], premium: !!p.s.premium, lr: !!p.s.lr, prospect: p.s.kind === 'prospect', done: doneNow[p.key] || null, nav: navUrl(p.s.addr, p.s.name, k, app), tel: telOf(p.s.contact) })))
        .sort((a, b) => a.seq - b.seq);
      const remaining = fresh.filter(p => !pickedSet.has(p.key)).length;
      // van load
      const cnt = t => stops.filter(s => s.types[0] === t).length;
      const reorderCs = stops.filter(s => s.types.includes('reorder')).reduce((t, s) => t + (s.item && s.item.lastSale ? num(s.item.lastSale.cases) || avgFirst : avgFirst) * 0.75, 0);
      const fuCs = stops.filter(s => s.types.some(t => t === 'fu' || t === 'fu2')).length * fuRate * avgFirst;
      const retryCs = stops.filter(s => s.types.some(t => t === 'retry' || t === 'revisit')).length * 0.15 * avgFirst;
      const newCs = cnt('new') * closeRate * avgFirst;
      const expected = reorderCs + fuCs + retryCs + newCs;
      const load = stops.length ? Math.max(2, Math.ceil(expected * 1.25)) : 0;
      // split by flavor (largest remainder)
      let byFlavor = mix.map(([n, p]) => ({ n, x: load * p })); byFlavor.forEach(f => { f.q = Math.floor(f.x); });
      let rem = load - byFlavor.reduce((t, f) => t + f.q, 0); byFlavor.slice().sort((a, b) => (b.x - b.q) - (a.x - a.q)).forEach(f => { if (rem > 0) { f.q++; rem--; } });
      return { k, d: DAYL[k], date, label: dayLabel(k), stops, remaining, calls: fixed.length, newN: cnt('new'), reorderN: stops.filter(s => s.types.includes('reorder')).length,
        fuN: stops.filter(s => s.types.some(t => t === 'fu' || t === 'fu2' || t === 'retry' || t === 'revisit')).length, expected, load, byFlavor, samples: cnt('new') * samplesPerNew,
        doneN: stops.filter(s => s.done).length };
    });

    // ---- alerts ----
    const alerts = [], A = (lvl, title, detail, key) => alerts.push({ lvl, title, detail, key });
    Object.entries(hist).forEach(([key, L]) => L.filter(r => r.status === 'sold' && r.terms === 'consign' && r.invoiceNo).forEach(r => { const bal = balOf(r); if (bal <= 0.004) return;
      const dl = r.dueDate || addD(when(r), 28), left = daysBetween(asOf, dl);
      A(left < 0 ? 'red' : left <= 14 ? 'amber' : 'info', `${r.store}: consignment ${left < 0 ? `was due ${fmtLong(dl)}` : `decision by ${fmtLong(dl)} (${left} days)`}`,
        `${num(r.cases)} cs (${money(bal)}) left on consignment ${fmtLong(when(r))}. If it sold, collect ${money(bal)}; if not, pick it up or write it off. Do a shelf count on the next visit so you know where it stands.`, key); }));
    const owedAll = visits.filter(r => r.status === 'sold' && r.invoiceNo && r.terms !== 'consign' && num(r.orderTotal) > 0).map(r => ({ r, bal: balOf(r) })).filter(x => x.bal > 0.004);
    owedAll.filter(x => x.r.dueDate && x.r.dueDate < asOf).forEach(x => A('red', `${x.r.store}: ${money(x.bal)} overdue`, `Invoice ${x.r.invoiceNo} was due ${fmtLong(x.r.dueDate)} (${daysBetween(x.r.dueDate, asOf)} days ago). Collect on the next visit or call ahead.`, kOf(x.r)));
    const dueSoon = owedAll.filter(x => x.r.dueDate && x.r.dueDate >= asOf && x.r.dueDate <= N4);
    if (dueSoon.length) A('amber', `${money(dueSoon.reduce((t, x) => t + x.bal, 0))} comes due next week`, dueSoon.map(x => `${x.r.store} ${money(x.bal)} (${fmt(x.r.dueDate)})`).join(' · '));
    const over = callList.filter(it => it.overdue && !it.types.every(t => t === 'collect' || t === 'consign'));
    if (over.length) A('red', `${over.length} follow-up${over.length > 1 ? 's are' : ' is'} overdue`, over.slice(0, 8).map(it => `${it.name} (${fmtLong(it.due)})`).join(' · ') + (over.length > 8 ? '…' : '') + '. They’re at the top of the call sheet.');
    Object.entries(hist).forEach(([key, L]) => { const last = L[L.length - 1], sales = L.filter(r => r.status === 'sold'); if (!sales.length) return; const ls = sales[sales.length - 1];
      const since = Math.max(when(ls), lastPortal(key)), age = daysBetween(since > when(ls) ? since : when(ls), asOf);
      if (last === ls && !last.followUpDate && age > reorderDays + 7) A('amber', `${ls.store}: no reorder in ${age} days`, `Last order ${num(ls.cases)} cs on ${fmtLong(when(ls))}. Call ahead, check the shelf, and set a reorder date.`, key); });
    Object.entries(hist).forEach(([key, L]) => { const n = L.filter(r => r.status === 'fu').length; if (n >= 2 && !L.some(r => r.status === 'sold')) { const last = L[L.length - 1];
      A('amber', `${last.store}: followed up ${n} times, no order yet`, `Make the call on the next visit: offer one case or consignment, or mark it closed.${(last.reasons || []).length ? ' Last objection: ' + last.reasons.join(', ') + '.' : ''}`, key); } });
    (inp.portal || []).filter(o => (o.draft || !/^(PAID|REFUNDED|PARTIALLY_REFUNDED|VOIDED)$/i.test(o.paid || '')) && daysBetween(localDay(o.at), asOf) >= 3)
      .forEach(o => A('amber', `${o.customer || 'Portal order'}: portal order ${o.name || ''} not paid`, `${num(o.cases)} cs, ${money(o.total)} placed ${fmtLong(localDay(o.at))} in IV-X Retailer${o.draft ? ' (invoice sent, not paid)' : ''}. Remind them on the next visit.`, o.storeKey || ''));
    const cold = DAYK.filter(k => ((plan[k] || {}).stops || []).some(s => !s.cut) && !before.some(r => r.day === k));
    if (cold.length) { const n = cold.reduce((t, k) => t + ((plan[k] || {}).stops || []).filter(s => !s.cut).length, 0); A('info', `${cold.map(k => DAYL[k]).join(', ')} route${cold.length > 1 ? 's haven’t' : ' hasn’t'} been started`, `${n} planned stops with no visits yet. Next week’s plan includes the top ${perDay} per day (premium and Little Rick stores first).`); }
    const LV = { red: 0, amber: 1, info: 2 }; alerts.sort((a, b) => LV[a.lvl] - LV[b.lvl]);

    const T = { stops: days.reduce((t, d) => t + d.stops.length, 0), calls: callList.length, newN: days.reduce((t, d) => t + d.newN, 0), load: days.reduce((t, d) => t + d.load, 0),
      expected: days.reduce((t, d) => t + d.expected, 0), samples: days.reduce((t, d) => t + d.samples, 0), collect: callList.reduce((t, it) => t + it.owed.filter(o => !o.consign).reduce((s, o) => s + o.bal, 0), 0) };
    T.byFlavor = mix.map(([n]) => [n, days.reduce((t, d) => t + ((d.byFlavor.find(f => f.n === n) || {}).q || 0), 0)]);
    return { N0, N4, today, asOf, started, perDay, days, callList, alerts, T, mix, rates: { closeRate, fuRate, avgFirst, samplesPerNew, firstVisits: firstV.length, firstSales: firstSales.length } };
  }

  function nextHtml(N, opts) {
    opts = opts || {};
    const k = (v, l, c) => `<div class="wr-k"><b${c ? ` style="color:${c}"` : ''}>${v}</b><small>${l}</small></div>`;
    const sec = (t, body, sub, id) => `<section class="wr-sec"${id ? ` id="${id}"` : ''}><h3>${t}</h3>${sub ? `<p class="wr-sub">${sub}</p>` : ''}${body}</section>`;
    const chip = t => `<em class="nx-c nx-${t}">${esc(TYPE[t] || t)}</em>`;
    const flag = s => (s.premium ? '<em class="nx-c nx-prem">Premium</em>' : '') + (s.lr ? '<em class="nx-c nx-lr">Little Rick</em>' : '') + (s.gym ? '<em class="nx-c nx-gym">Gym</em>' : '');
    const red = N.alerts.filter(a => a.lvl === 'red').length;
    let o = `<div class="wr nx">
    <div class="wr-head"><div><div class="wr-eyebrow">IV-X Field · ${N.started ? 'This week’s plan' : 'Plan for next week'}</div><h2>${fmtLong(N.N0)} – ${fmtLong(N.N4)}, ${parse(N.N4).getFullYear()}</h2></div>
      ${opts.static ? '' : '<div class="wr-nav wr-noprint"><button data-nx="copy">Copy</button><button data-nx="print">Print</button></div>'}</div>
    <div class="wr-kgrid">${k(N.T.stops, 'Stops planned')}${k(N.T.calls, 'Follow-ups & checks', '#b45309')}${k(N.T.newN, 'New stores', '#15803d')}${k(N.T.load, 'Cases to load')}${k(money(N.T.collect), 'To collect')}${k(N.alerts.length, 'Alerts', red ? '#b91c1c' : '')}</div>`;
    // alerts
    o += sec(`Alerts (${N.alerts.length})`, N.alerts.length ? `<div class="nx-al">${N.alerts.map(a => `<div class="nx-a nx-${a.lvl}"><b>${esc(a.title)}</b><div>${esc(a.detail)}</div></div>`).join('')}</div>` : '<p class="wr-empty">Nothing needs attention.</p>', '', 'nx-alerts');
    // call sheet
    const cs = N.days.map(d => { const L = N.callList.filter(it => it.day === d.k); if (!L.length) return '';
      return `<div class="nx-dh">${d.d} ${fmtLong(d.date)} <span>${esc(d.label)}</span></div>` + L.map(it => { const l = it.last, ls = it.lastSale;
        return `<div class="nx-row${it.overdue ? ' nx-over' : ''}${it.done ? ' nx-done' : ''}"><div class="nx-main"><b>${esc(it.name)}</b> ${it.types.map(chip).join('')}${flag(it)}${it.done ? `<em class="nx-c nx-ok">✓ ${esc(OUT[it.done.status] || 'Visited')}</em>` : ''}
          <div class="wr-m">${esc(it.addr)}</div>
          <div class="nx-why">${it.overdue ? '<b class="wr-warn">Overdue</b> · ' : ''}Due ${fmt(it.due)}${l ? ` · Last visit ${fmtLong(localDay(l.visitAt || l.at))}: ${esc(OUT[l.status] || '')}` : ''}${ls ? ` · Last order ${num(ls.cases)} cs ${money(ls.orderTotal)}` : ''}${it.owedT ? ` · <b class="wr-warn">Owes ${money(it.owedT)}</b>` : ''}</div>
          ${l && (l.reasons || []).length ? `<div class="wr-m">Objection: ${esc(l.reasons.join(', '))}</div>` : ''}${l && l.notes ? `<div class="wr-m">“${esc(l.notes)}”</div>` : ''}${it.notes.length ? `<div class="wr-m">${esc(it.notes.join(' · '))}</div>` : ''}</div>
          <div class="nx-side">${it.contactName || it.phone ? `<div class="wr-m">${esc([it.contactName, it.phone].filter(Boolean).join(' · '))}</div>` : ''}<div class="nx-acts">${it.tel ? `<a href="tel:${it.tel}">Call</a>` : ''}<a href="${esc(it.nav)}" target="_blank" rel="noopener">Navigate</a></div></div></div>`; }).join(''); }).join('');
    o += sec(`Call sheet (${N.callList.length})`, cs || '<p class="wr-empty">No follow-ups, reorder checks or payments due.</p>', 'Everyone due for a follow-up, reorder check, payment or consignment check, by route day. Call ahead to confirm the owner will be there.', 'nx-calls');
    // van loading plan
    const fl = N.mix.map(m => m[0]);
    const vrow = (h, sub, load, fls, samples, cls) => `<div class="nx-v${cls ? ' ' + cls : ''}"><div class="nx-vh"><div><b>${h}</b><div class="wr-m">${sub}</div></div><div class="nx-load">${load} cs</div></div><div class="nx-fl">${fls.filter(f => f[1]).map(f => `<span><b>${f[1]}</b> ${esc(f[0])}</span>`).join('')}${samples ? `<span class="nx-smp"><b>${samples}</b> sample cans</span>` : ''}</div></div>`;
    o += sec('Van loading plan', N.days.map(d => vrow(`${d.d} ${fmtLong(d.date)}`, `${esc(d.label)} · ${d.stops.length} stops${d.calls ? ` · ${d.calls} follow-up${d.calls > 1 ? 's' : ''}` : ''} · expect ~${d.expected.toFixed(1)} cs sold`, d.load, d.byFlavor.map(f => [f.n, f.q]), d.samples)).join('')
      + vrow('Whole week', `${N.T.stops} stops · expect ~${N.T.expected.toFixed(1)} cs sold`, N.T.load, N.T.byFlavor, N.T.samples, 'nx-vt'),
      `Load = expected sales + 25% so you don’t run out (at least 2 cases on any route day). Based on your numbers so far: ${Math.round(N.rates.closeRate * 100)}% of first visits buy, ${Math.round(N.rates.fuRate * 100)}% of follow-ups close, a first order averages ${N.rates.avgFirst.toFixed(1)} cases, reorders ≈ 75% of the last order. Flavor split follows what stores have bought.`, 'nx-van');
    // route plan
    o += sec('Route plan', N.days.map(d => `<div class="nx-day"><div class="nx-dh">${d.d} ${fmtLong(d.date)} <span>${esc(d.label)} · ${d.stops.length} stops${d.calls ? ` · ${d.calls} follow-ups` : ''}${d.doneN ? ` · ${d.doneN} done` : ''}</span></div>
      ${d.stops.length ? `<ol class="nx-ol">${d.stops.map(s => `<li class="${s.done ? 'nx-done' : ''}"><a href="${esc(s.nav)}" target="_blank" rel="noopener"><b>${esc(s.name)}</b></a> ${s.types.map(chip).join('')}${flag(s)}${s.done ? `<em class="nx-c nx-ok">✓ ${esc(OUT[s.done.status] || 'Visited')}</em>` : ''}<span class="wr-m"> · ${esc(s.addr)}</span></li>`).join('')}</ol>` : '<p class="wr-empty">Nothing planned.</p>'}
      ${d.remaining ? `<p class="wr-m">${d.remaining} more unvisited stop${d.remaining > 1 ? 's' : ''} on this route after these.</p>` : ''}</div>`).join(''),
      `Follow-ups first, then up to ${N.perDay} stops a day: premium and Little Rick stores, then the rest in driving order. Stops are in route order; tap a name to navigate.`, 'nx-route');
    if (!opts.static) o += `<p class="wr-foot">Updates as check-ins come in. ${N.started ? 'The plan was locked in on Monday.' : 'Locked in on Monday morning.'}</p>`;
    return o + '</div>';
  }

  function nextText(N) {
    const L = [`IV-X FIELD — ${N.started ? 'THIS WEEK' : 'NEXT WEEK'} (${fmtLong(N.N0)} – ${fmtLong(N.N4)})`, '',
      `${N.T.stops} stops · ${N.T.calls} follow-ups & checks · ${N.T.newN} new stores · load ${N.T.load} cases · collect ${money(N.T.collect)}`, ''];
    if (N.alerts.length) { L.push('ALERTS'); N.alerts.forEach(a => L.push(`${a.lvl === 'red' ? '!! ' : '• '}${a.title} — ${a.detail}`)); L.push(''); }
    N.days.forEach(d => { L.push(`${d.d.toUpperCase()} ${fmtLong(d.date)} — ${d.label} · ${d.stops.length} stops · load ${d.load} cs (${d.byFlavor.filter(f => f.q).map(f => `${f.q} ${f.n}`).join(', ') || '—'})`);
      d.stops.forEach((s, i) => { const it = s.item; L.push(`${i + 1}. ${s.name} — ${s.types.map(t => TYPE[t]).join(', ')}${it ? `${it.overdue ? ' (OVERDUE)' : ''}${it.owedT ? ` · owes ${money(it.owedT)}` : ''}${it.contactName || it.phone ? ' · ' + [it.contactName, it.phone].filter(Boolean).join(' ') : ''}` : ''}`); }); L.push(''); });
    return L.join('\n').trim();
  }

  const CSS_NX = `.nx-al{display:grid;gap:8px}.nx-a{border:1px solid #e7e3da;border-left:5px solid #94a3b8;border-radius:10px;padding:8px 10px;font-size:13px}.nx-a b{display:block;font-size:13.5px;margin-bottom:2px}
.nx-red{border-left-color:#dc2626;background:#fef2f2}.nx-amber{border-left-color:#f59e0b;background:#fffbeb}.nx-info{border-left-color:#0ea5e9;background:#f0f9ff}
.nx-dh{font-weight:800;font-size:13.5px;margin:12px 0 6px;padding-bottom:4px;border-bottom:2px solid #111}.nx-dh span{font-weight:600;color:#6b675f;font-size:12.5px}.nx-day:first-child .nx-dh,.wr-sec>.nx-dh:first-of-type{margin-top:2px}
.nx-row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid #f1eee8}.nx-main{min-width:0}.nx-side{text-align:right;flex:none;max-width:44%}
.nx-why{font-size:12.5px;margin-top:2px}.nx-over{background:#fff7ed}.nx-done{opacity:.55}
.nx-acts{display:flex;gap:6px;justify-content:flex-end;margin-top:4px}.nx-acts a{border:1px solid #e7e3da;border-radius:8px;padding:5px 10px;font-weight:700;font-size:12.5px;color:#111;text-decoration:none;background:#fff}
.nx-c{font-style:normal;font-size:10.5px;font-weight:800;border-radius:5px;padding:1px 6px;margin-left:3px;white-space:nowrap;background:#e2e8f0;color:#334155;letter-spacing:.02em}
.nx-reorder{background:#dcfce7;color:#166534}.nx-fu,.nx-fu2{background:#fef3c7;color:#92400e}.nx-fu2{background:#fde68a}.nx-retry,.nx-revisit{background:#e0f2fe;color:#075985}.nx-collect,.nx-consign{background:#fee2e2;color:#991b1b}
.nx-new{background:#f1f5f9;color:#475569}.nx-prem{background:#111;color:#fff}.nx-lr{background:#ede9fe;color:#5b21b6}.nx-gym{background:#ccfbf1;color:#115e59}.nx-ok{background:#15803d;color:#fff}
.nx-v{border-bottom:1px solid #f1eee8;padding:8px 0}.nx-vt{border-bottom:0;border-top:2px solid #111;margin-top:4px}.nx-vh{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}.nx-load{font-size:20px;font-weight:800;white-space:nowrap}
.nx-fl{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.nx-fl span{background:#f6f4ef;border:1px solid #e7e3da;border-radius:8px;padding:3px 8px;font-size:12.5px}.nx-fl .nx-smp{background:#fff}
.nx-ol{margin:0;padding-left:22px}.nx-ol li{margin:5px 0;font-size:13px}.nx-ol a{color:#111;text-decoration:none}
@media (max-width:560px){.nx-row{flex-direction:column;gap:4px}.nx-side{text-align:left;max-width:none}.nx-acts{justify-content:flex-start}}`;

  function ensureCss() { if (!document.getElementById('wr-css')) { const s = document.createElement('style'); s.id = 'wr-css'; s.textContent = CSS + CSS_NX; document.head.appendChild(s); } }
  function doPrint() { document.body.classList.add('wr-printing'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('wr-printing'), 500); }, 50); }
  async function copyOut(t, b, label) { try { if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) { await navigator.share({ title: 'IV-X', text: t }); return; } await navigator.clipboard.writeText(t); }
    catch (err) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) {} ta.remove(); }
    b.textContent = 'Copied'; setTimeout(() => { b.textContent = label; }, 1500); }

  function mountNext(el, getInput, opts) {
    ensureCss();
    const draw = () => { const inp = getInput(); const N = nextWeek(inp); el.innerHTML = nextHtml(N, opts);
      const c = el.querySelector('[data-nx=copy]'); if (c) c.onclick = e => copyOut(nextText(N), e.currentTarget, 'Copy');
      const p = el.querySelector('[data-nx=print]'); if (p) p.onclick = doPrint; return N; };
    return { redraw: draw, N: draw() };
  }

  // Full report document (what gets saved on the Reports page)
  function docHtml(R, N) {
    const title = `IV-X Week in Review — ${fmtLong(R.W0)} – ${fmtLong(R.W6)}, ${parse(R.W6).getFullYear()}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;padding:16px;background:#f6f4ef;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}.wrap{max-width:980px;margin:0 auto}.nx{margin-top:26px}a{color:inherit}${CSS}${CSS_NX}@media print{body{background:#fff;padding:0}.nx{break-before:page}}</style></head>
<body><div class="wrap">${html(R, { static: true })}${nextHtml(N, { static: true })}</div></body></html>`;
  }

  // Saves the week's report + locks next week's plan. Safe to call from the app and the dashboard (upserts, only when something changed).
  async function autoSave(sb, getInput, cfg, o) {
    o = o || {}; cfg = cfg || {};
    const today = o.today || ymd(new Date()), W0 = defaultWeek(today), W6 = addD(W0, 6), final = today > W6;
    const meta = cfg.autoreport && cfg.autoreport.weeks ? cfg.autoreport : { weeks: {} }, m = meta.weeks[W0];
    if (m && m.final) return null;
    const inp = getInput(), R = compute({ ...inp, weekStart: W0, today }), N = nextWeek({ ...inp, frozen: null, weekStart: W0, today });
    const body = html(R, { static: true }).replace(/<p class="wr-foot">[\s\S]*?<\/p>/, '') + nextHtml(N, { static: true });
    const h = hashStr(body), at = new Date().toISOString();
    if (m && m.hash === h && !final) return null;
    const rows = [];
    if (!m || m.hash !== h) rows.push({ key: 'report:auto-' + W0, value: { title: `Week of ${fmtLong(W0)} – ${fmtLong(W6)} (auto)`, html: docHtml(R, N), week: W0 + 'T23:59:00', at, by: o.by || 'auto', auto: true } });
    rows.push({ key: 'weekplan:' + N.N0, value: { w0: N.N0, at, final, days: Object.fromEntries(N.days.map(d => [d.k, d.stops.filter(s => s.types[0] === 'new').map(s => s.key)])) } });
    rows.push({ key: 'autoreport', value: { weeks: { ...meta.weeks, [W0]: { hash: h, at, final } } } });
    const res = await sb.from('app_config').upsert(rows.map(r => ({ ...r, updated_at: at })));
    if (res && res.error) throw new Error(res.error.message || 'save failed');
    rows.forEach(r => { cfg[r.key] = r.value; });
    return rows;
  }

  window.IVXReview = { compute, html, text, mount, defaultWeek, nextWeek, nextHtml, nextText, mountNext, docHtml, autoSave, routeMonday, addD, ymd };
})();
