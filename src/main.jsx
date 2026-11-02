import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeQuartz } from 'ag-grid-community';
import './style.css';
ModuleRegistry.registerModules([AllCommunityModule]);
const theme = themeQuartz.withParams({ backgroundColor: '#fffefa', foregroundColor: '#1e3532', headerBackgroundColor: '#efeee7', borderColor: '#d9ded6', accentColor: '#23664e', fontFamily: 'inherit', fontSize: 13, headerHeight: 42, rowHeight: 78, wrapperBorderRadius: 12 });
const sample = {
  contract: 'Build a responsive three-page website: Home, About, Contact. One visual revision is included. Additional pages require a separate quote.',
  request: 'Please keep the responsive layout. Add a Portfolio page. Would ongoing support be covered?'
};
const usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const chip = text => <span className={'chip ' + text.toLowerCase()}>{text}</span>;
async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Request failed.'); return data;
}
function App() {
  const [view, setView] = useState('workbench'); const [contract, setContract] = useState(sample.contract); const [request, setRequest] = useState(sample.request);
  const [analysis, setAnalysis] = useState(null); const [rows, setRows] = useState([]); const [selected, setSelected] = useState([]);
  const [approval, setApproval] = useState(null); const [workspace, setWorkspace] = useState({ analyses: [], approvals: [] });
  const [email, setEmail] = useState('demo-buyer@personal.example.com'); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [health, setHealth] = useState(null);
  const grid = useRef(null);
  const sync = async () => setWorkspace(await api('workspace'));
  useEffect(() => { api('health').then(h => { setHealth(h); if (h.sandboxBuyerEmail) setEmail(h.sandboxBuyerEmail); }).catch(e => setError(e.message)); sync().catch(e => setError(e.message)); }, []);
  const action = async (label, fn) => { setBusy(label); setError(''); try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const loadAnalysis = a => { setAnalysis(a); setContract(a.contract); setRequest(a.request); setRows(a.changes.map(c => ({ ...c, quantity: '1.00', rate: '80.00' }))); setSelected([]); setApproval(null); setView('workbench'); };
  const compare = () => action('Comparing the two documents…', async () => { const a = await api('analyze', { contract, request }); loadAnalysis(a); await sync(); });
  const rowSelection = useMemo(() => ({ mode: 'multiRow', isRowSelectable: n => n.data?.classification === 'change', headerCheckbox: false, enableClickSelection: false }), []);
  const columns = useMemo(() => [
    { field: 'title', headerName: 'Requested work', minWidth: 190, flex: 1, wrapText: true },
    { field: 'classification', headerName: 'Scope', width: 112, cellRenderer: p => chip(p.value) },
    { field: 'request_quote', headerName: 'Evidence from request', minWidth: 220, flex: 1.2, wrapText: true },
    { field: 'quantity', headerName: 'Hours', width: 90, editable: p => !approval && p.data.classification === 'change', cellEditor: 'agTextCellEditor' },
    { field: 'rate', headerName: 'USD / hour', width: 112, editable: p => !approval && p.data.classification === 'change', cellEditor: 'agTextCellEditor' }
  ], [approval]);
  const selectedRows = rows.filter(r => selected.includes(r.id));
  const proposedCents = selectedRows.reduce((n, r) => n + Math.round(Math.round(Number(r.quantity) * 100) * Math.round(Number(r.rate) * 100) / 100), 0);
  const approve = () => action('Recording your review…', async () => {
    grid.current?.api.stopEditing();
    const selectedNow = grid.current?.api.getSelectedRows() || [];
    const a = await api('approve', { analysisId: analysis.id, selection: selectedNow.map(r => ({ id: r.id, quantity: String(r.quantity), rate: String(r.rate) })), client: { email } });
    setApproval(a); await sync();
  });
  const invoiceAction = kind => action(kind === 'invoice' ? 'Creating and checking PayPal draft…' : kind === 'publish' ? 'Preparing a sandbox payment link…' : kind === 'reconcile' ? 'Finding the existing invoice in PayPal…' : 'Reading invoice from PayPal…', async () => {
    try { const a = await api('approvals/' + approval.id + '/' + kind, {}); setApproval(a); await sync(); }
    catch (e) { try { const w = await api('workspace'); setWorkspace(w); const current = w.approvals.find(a => a.id === approval.id); if (current) setApproval(current); } catch {} throw e; }
  });
  const paidCents = workspace.approvals.filter(a => a.state === 'PAID').reduce((n, a) => n + a.totalCents, 0);
  const pendingCents = workspace.approvals.filter(a => a.invoice && a.state !== 'PAID' && a.state !== 'CANCELLED').reduce((n, a) => n + a.totalCents, 0);
  const paymentLink = approval?.invoice?.detail?.metadata?.recipient_view_url || approval?.invoice?.links?.find(l => l.rel === 'payer-view')?.href;
  const safePaymentLink = paymentLink && /^https:\/\/(www\.)?sandbox\.paypal\.com\//.test(paymentLink) ? paymentLink : null;
  const invoiceColumns = useMemo(() => [
    { headerName: 'Invoice', valueGetter: p => p.data.invoice?.id || 'Not created', flex: 1, minWidth: 200 },
    { headerName: 'Customer', field: 'recipient', flex: 1, minWidth: 230 },
    { field: 'state', headerName: 'Status', width: 160, cellRenderer: p => chip(p.value) },
    { field: 'totalCents', headerName: 'Amount · USD', width: 150, valueFormatter: p => usd(p.value) },
    { headerName: 'Reviewed', field: 'createdAt', width: 180, valueFormatter: p => new Date(p.value).toLocaleString() }
  ], []);
  const editDocument = (setter, value) => { setter(value); setAnalysis(null); setRows([]); setSelected([]); };
  return <>
    <header className="topbar"><a className="brand" href="#"><span className="mark">S</span><span>ScopeLock<small>THE CHANGE DESK</small></span></a><nav><button className={view === 'workbench' ? 'active' : ''} onClick={() => setView('workbench')}>Workbench</button><button className={view === 'invoices' ? 'active' : ''} onClick={() => setView('invoices')}>Invoice ledger <span>{workspace.approvals.length}</span></button></nav><span className="sandbox"><i />Sandbox · no real money</span></header>
    <main><div className="pagehead"><div><p className="eyebrow">LESS AWKWARD. MORE AGREED.</p><h1>{view === 'workbench' ? 'Keep the extras visible.' : 'Every request, accounted for.'}</h1><p className="muted">{view === 'workbench' ? 'Compare the brief. Review the change. Send a clear payment request.' : 'A live record of reviewed scope and actual PayPal sandbox invoices.'}</p></div><div className="modelbadge"><i />{!health ? 'Connecting…' : health.ai.available ? 'Local AI connected' : 'Local AI unavailable'}<small>{health?.ai.model || 'Ollama'}</small></div></div>
      {error && <div className="notice error" role="alert">{error}</div>}{busy && <div className="notice working" role="status"><span className="spinner" />{busy}</div>}
      {view === 'invoices' ? <>
        <section className="metrics"><article><span>Reviewed requests</span><strong>{workspace.approvals.length}</strong><small>Operator-approved quotes</small></article><article><span>Invoiced · not paid</span><strong>{usd(pendingCents)}</strong><small>Sandbox funds only</small></article><article><span>Paid in sandbox</span><strong>{usd(paidCents)}</strong><small>Read back from PayPal</small></article></section>
        <section className="panel ledger"><div className="sectionhead"><div><p className="eyebrow">PAYPAL INVOICE LEDGER</p><h2>From scope to settlement</h2></div><button className="secondary" disabled={!!busy} onClick={() => action('Refreshing the ledger…', sync)}>Refresh ledger</button></div><div style={{ height: 370 }}><AgGridReact theme={theme} rowData={workspace.approvals} columnDefs={invoiceColumns} defaultColDef={{ sortable: true, filter: true, resizable: true }} getRowId={p => p.data.id} onRowClicked={p => { setApproval(p.data); setView('workbench'); }} overlayNoRowsTemplate="No reviewed requests yet. Start in the workbench." /></div><p className="hint">Select an invoice row to view its approval and refresh its status.</p></section>
      </> : <>
        <div className="steps"><span className={!analysis ? 'current' : ''}><b>01</b> Compare scope</span><span className={analysis && !approval ? 'current' : ''}><b>02</b> Review the change</span><span className={approval ? 'current' : ''}><b>03</b> Request payment</span></div>
        {!approval && <section className="briefs"><article className="panel"><label htmlFor="contract"><span className="eyebrow">THE AGREEMENT</span><h2>What was included?</h2></label><textarea id="contract" value={contract} maxLength={12000} onChange={e => editDocument(setContract, e.target.value)} /><span className="hint">Paste the agreed brief. Keep client details out of sample data.</span></article><article className="panel request"><label htmlFor="request"><span className="eyebrow">THE NEW REQUEST</span><h2>“One more thing…”</h2></label><textarea id="request" value={request} maxLength={12000} onChange={e => editDocument(setRequest, e.target.value)} /><div className="comparebar"><span className="hint">AI compares text; you decide what to quote.</span><button className="primary" disabled={!!busy || !contract.trim() || !request.trim()} onClick={compare}>{analysis ? 'Compare again' : 'Find the changes'} <span>↗</span></button></div></article></section>}
        {analysis && !approval && <section className="panel review"><div className="sectionhead"><div><p className="eyebrow">EVIDENCE BEFORE ESTIMATES</p><h2>Review, then put a number on it.</h2><p>{analysis.summary}</p></div><span className="provenance">{analysis.provenance.model}<small>{(analysis.provenance.elapsedMs / 1000).toFixed(1)}s · actual inference</small></span></div><div className="key"><span>{chip('change')} Can be quoted</span><span>{chip('included')} Stays out</span><span>{chip('unclear')} Clarify first</span></div><div style={{ height: Math.min(500, 80 + rows.length * 78) }}><AgGridReact ref={grid} theme={theme} rowData={rows} columnDefs={columns} rowSelection={rowSelection} getRowId={p => p.data.id} defaultColDef={{ sortable: true, resizable: true }} onSelectionChanged={e => setSelected(e.api.getSelectedRows().map(r => r.id))} onCellValueChanged={e => setRows(old => old.map(r => r.id === e.data.id ? { ...e.data } : r))} singleClickEdit stopEditingWhenCellsLoseFocus /></div><details className="evidence"><summary>See the comparison behind each decision</summary>{analysis.changes.map(c => <article key={c.id}><strong>{c.title}</strong> {chip(c.classification)}<p>{c.reason}</p><blockquote>Request: “{c.request_quote}”</blockquote>{c.contract_quote && <blockquote>Agreement: “{c.contract_quote}”</blockquote>}</article>)}</details><div className="approvalbar"><label>Sandbox customer<input aria-label="Sandbox customer email" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label><div className="estimate"><small>{selected.length} selected · USD</small><strong>{Number.isFinite(proposedCents) ? usd(proposedCents) : 'Review numbers'}</strong></div><button className="primary" disabled={!!busy || !selected.length || !Number.isFinite(proposedCents)} onClick={approve}>Approve this quote →</button></div><p className="hint">Select additional work and edit its hours and rate. Review records your decision; it does not charge the customer.</p></section>}
        {approval && <section className="panel approved"><div className="sectionhead"><div><p className="eyebrow">REVIEW RECORDED</p><h2>{approval.invoice ? 'An invoice with a clear trail.' : 'This is exactly what goes to PayPal.'}</h2><p>{approval.recipient}</p></div>{chip(approval.state)}</div><div className="lockedlines">{approval.items.map(i => <div key={i.id}><span><strong>{i.title}</strong><small>“{i.request_quote}”</small></span><span>{i.quantity} h × ${i.rate}</span><strong>{usd(i.amountCents)}</strong></div>)}</div><div className="approvedtotal"><span>Reviewed total · USD</span><strong>{usd(approval.totalCents)}</strong></div><p className="hash">Review {approval.hash.slice(0, 16)} · {new Date(approval.createdAt).toLocaleString()}</p>{approval.error && <div className="notice error">{approval.error}</div>}{approval.invoice && <div className="receipt"><span>PAYPAL SANDBOX</span><strong>{approval.invoice.id}</strong><p>{approval.verifiedAt ? 'Amount, currency, customer and line items match your recorded review.' : 'Created. Verification still needs attention.'}</p></div>}<div className="invoiceactions">{!approval.invoice && approval.state === 'APPROVED' && <button className="primary" disabled={!!busy} onClick={() => invoiceAction('invoice')}>Create PayPal draft ↗</button>}{['CREATING','REVIEW_REQUIRED'].includes(approval.state) && <button className="primary" disabled={!!busy} onClick={() => invoiceAction('reconcile')}>Reconcile with PayPal ↗</button>}{approval.invoice && <><button className="secondary" disabled={!!busy} onClick={() => invoiceAction('refresh')}>Refresh from PayPal</button>{approval.state === 'DRAFT' && <button className="primary" disabled={!!busy} onClick={() => invoiceAction('publish')}>Make sandbox payment link ↗</button>}{safePaymentLink && approval.state !== 'DRAFT' && <a className="primary buttonlink" href={safePaymentLink} target="_blank" rel="noopener noreferrer">Open sandbox invoice ↗</a>}</>}<button className="textbutton" disabled={!!busy} onClick={() => { setApproval(null); setAnalysis(null); setRows([]); }}>Start another request</button></div><p className="hint">The invoice requests payment through PayPal. Email notifications are disabled. All transactions use fictional sandbox accounts.</p></section>}
        {!analysis && !approval && workspace.analyses.length > 0 && <section className="recent"><p className="eyebrow">CONTINUE A COMPARISON</p>{workspace.analyses.slice(0, 3).map(a => <button key={a.id} className="secondary" onClick={() => loadAnalysis(a)}>{a.changes.length} items · {new Date(a.createdAt).toLocaleTimeString()} →</button>)}</section>}
      </>}
      <footer><span>ScopeLock <b>·</b> Made for the work between “sure” and “sent”.</span><span>PayPal AI Hackathon 2026</span></footer>
    </main>
  </>;
}
createRoot(document.getElementById('root')).render(<App />);
