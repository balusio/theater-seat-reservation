export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Theater Reservation — Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; color: #e2e8f0; font-family: system-ui, sans-serif; font-size: 14px; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid #1e2535; }
    header h1 { font-size: 18px; font-weight: 600; letter-spacing: .3px; }
    .meta { display: flex; align-items: center; gap: 12px; color: #94a3b8; font-size: 12px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
    .dot.up { background: #22c55e; }
    .dot.down { background: #ef4444; }
    main { padding: 24px; display: flex; flex-direction: column; gap: 24px; }
    .cards { display: flex; flex-wrap: wrap; gap: 16px; }
    .card { background: #1a1f2e; border: 1px solid #1e2535; border-radius: 10px; padding: 20px; min-width: 220px; flex: 1; }
    .card h2 { font-size: 12px; font-weight: 500; color: #64748b; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 16px; }
    .card h3 { font-size: 13px; font-weight: 600; color: #e2e8f0; margin-bottom: 10px; }
    .card h3 .event-status { font-size: 10px; font-weight: 500; padding: 2px 6px; border-radius: 3px; margin-left: 8px; }
    .card h3 .event-status.OPEN { background: #1a3a2a; color: #4ade80; }
    .card h3 .event-status.SCHEDULED { background: #1e3a5f; color: #60a5fa; }
    .card h3 .event-status.CLOSED { background: #3a1a1a; color: #f87171; }
    .event-block { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #1e2535; }
    .event-block:last-child { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
    .stat-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
    .stat-label { color: #94a3b8; }
    .stat-value { font-weight: 600; font-size: 16px; }
    .total { color: #e2e8f0; }
    .pending { color: #f59e0b; }
    .confirmed { color: #22c55e; }
    .cancelled { color: #94a3b8; }
    .rejected { color: #ef4444; }
    .available { color: #22c55e; }
    .held { color: #f59e0b; }
    .booked { color: #3b82f6; }
    .seat-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 8px; background: #0f1117; }
    .seat-bar-seg { height: 100%; transition: width .4s; }
    .mem-bar { background: #0f1117; border-radius: 4px; height: 6px; margin-top: 6px; overflow: hidden; }
    .mem-bar-fill { height: 100%; background: #3b82f6; border-radius: 4px; transition: width .4s; }
    section h2 { font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; background: #1a1f2e; border: 1px solid #1e2535; border-radius: 10px; overflow: hidden; }
    th { text-align: left; padding: 10px 14px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #1e2535; }
    td { padding: 10px 14px; border-bottom: 1px solid #1e2535; color: #cbd5e1; font-size: 12px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #1e2535; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
    .tag-api { background: #1e3a5f; color: #60a5fa; }
    .tag-worker { background: #1a3a2a; color: #4ade80; }
    .tag-cron { background: #3a2a1a; color: #fb923c; }
    .tag-dlq { background: #3a1a1a; color: #f87171; }
    .empty { color: #475569; text-align: center; padding: 32px; }
  </style>
</head>
<body>
  <header>
    <h1>Theater Reservation Dashboard</h1>
    <div class="meta">
      <span class="dot" id="dot"></span>
      <span id="last-updated">—</span>
    </div>
  </header>
  <main>
    <div class="cards">
      <div class="card" id="card-reservations">
        <h2>Reservations</h2>
        <div class="empty">Loading…</div>
      </div>
      <div class="card" id="card-events">
        <h2>Seats by Event</h2>
        <div class="empty">Loading…</div>
      </div>
      <div class="card" id="card-memory">
        <h2>Memory</h2>
        <div class="empty">Loading…</div>
      </div>
    </div>
    <section>
      <h2>Recent Activity</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Reservation</th>
            <th>Transition</th>
            <th>Triggered by</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody id="activity-body"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
      </table>
    </section>
  </main>
  <script>
    function mb(bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB'; }
    function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
    function shortId(id) { return id ? id.slice(0, 8) + '…' : '—'; }
    function timeAgo(iso) {
      var s = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      return Math.floor(s / 3600) + 'h ago';
    }
    function triggerTag(t) {
      return '<span class="tag tag-' + t + '">' + t + '</span>';
    }
    function renderReservations(r) {
      return '<div class="stat-row"><span class="stat-label">Pending</span><span class="stat-value pending">' + r.pending + '</span></div>'
        + '<div class="stat-row"><span class="stat-label">Confirmed</span><span class="stat-value confirmed">' + r.confirmed + '</span></div>'
        + '<div class="stat-row"><span class="stat-label">Cancelled</span><span class="stat-value cancelled">' + r.cancelled + '</span></div>'
        + '<div class="stat-row"><span class="stat-label">Rejected</span><span class="stat-value rejected">' + r.rejected + '</span></div>'
        + '<div class="stat-row"><span class="stat-label">Total</span><span class="stat-value total">' + r.total + '</span></div>';
    }
    function renderEvents(events) {
      if (!events || !events.length) return '<div class="empty">No events with seats</div>';
      return events.map(function(e) {
        var bar = '';
        if (e.total > 0) {
          bar = '<div class="seat-bar">'
            + '<div class="seat-bar-seg" style="width:' + pct(e.available, e.total) + '%;background:#22c55e"></div>'
            + '<div class="seat-bar-seg" style="width:' + pct(e.held, e.total) + '%;background:#f59e0b"></div>'
            + '<div class="seat-bar-seg" style="width:' + pct(e.booked, e.total) + '%;background:#3b82f6"></div>'
            + '</div>';
        }
        return '<div class="event-block">'
          + '<h3>' + e.title + '<span class="event-status ' + e.eventStatus + '">' + e.eventStatus + '</span></h3>'
          + '<div class="stat-row"><span class="stat-label">Available</span><span class="stat-value available">' + e.available + '</span></div>'
          + '<div class="stat-row"><span class="stat-label">Held</span><span class="stat-value held">' + e.held + '</span></div>'
          + '<div class="stat-row"><span class="stat-label">Booked</span><span class="stat-value booked">' + e.booked + '</span></div>'
          + '<div class="stat-row"><span class="stat-label">Total</span><span class="stat-value total">' + e.total + '</span></div>'
          + bar
          + '</div>';
      }).join('');
    }
    function renderMemory(m) {
      var p = pct(m.heapUsed, m.heapTotal);
      return '<div class="stat-row"><span class="stat-label">RSS</span><span class="stat-value total">' + mb(m.rss) + '</span></div>'
        + '<div class="stat-row"><span class="stat-label">Heap used</span><span class="stat-value total">' + mb(m.heapUsed) + '</span></div>'
        + '<div class="stat-row"><span class="stat-label">Heap total</span><span class="stat-value total">' + mb(m.heapTotal) + '</span></div>'
        + '<div class="mem-bar"><div class="mem-bar-fill" style="width:' + p + '%"></div></div>';
    }
    function renderActivity(rows) {
      if (!rows.length) return '<tr><td colspan="5" class="empty">No activity yet</td></tr>';
      return rows.map(function(a) {
        var transition = a.previousStatus
          ? '<span style="color:#64748b">' + a.previousStatus + '</span> → ' + (a.newStatus || '—')
          : (a.newStatus || '—');
        return '<tr>'
          + '<td>' + a.action + '</td>'
          + '<td style="font-family:monospace">' + shortId(a.reservationId) + '</td>'
          + '<td>' + transition + '</td>'
          + '<td>' + triggerTag(a.triggeredBy) + '</td>'
          + '<td>' + timeAgo(a.timestamp) + '</td>'
          + '</tr>';
      }).join('');
    }
    function poll() {
      fetch('/monitoring/stats')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          document.getElementById('dot').className = 'dot up';
          document.getElementById('last-updated').textContent = 'Updated ' + timeAgo(data.timestamp);
          document.getElementById('card-reservations').innerHTML = '<h2>Reservations</h2>' + renderReservations(data.reservations);
          document.getElementById('card-events').innerHTML = '<h2>Seats by Event</h2>' + renderEvents(data.events);
          document.getElementById('card-memory').innerHTML = '<h2>Memory</h2>' + renderMemory(data.memory);
          document.getElementById('activity-body').innerHTML = renderActivity(data.recentActivity);
        })
        .catch(function() {
          document.getElementById('dot').className = 'dot down';
        })
        .finally(function() {
          setTimeout(poll, 2000);
        });
    }
    poll();
  </script>
</body>
</html>`;
