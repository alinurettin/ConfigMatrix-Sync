// ConfigMatrix-Sync v2.0.0 Interactive Studio Engine

let flagsCache = [];
let eventSource = null;

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  setupSSE();
  fetchFlags();
  setupEventListeners();
});

// Setup Server-Sent Events (SSE)
function setupSSE() {
  const badge = document.getElementById('sseBadge');
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/events/stream');

  eventSource.onopen = () => {
    badge.textContent = 'SSE: CONNECTED';
    badge.className = 'badge badge-active';
  };

  eventSource.onerror = () => {
    badge.textContent = 'SSE: DISCONNECTED';
    badge.className = 'badge badge-danger';
  };

  eventSource.addEventListener('init', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.flags) {
        flagsCache = data.flags;
        renderFlagsTable(flagsCache);
        updateMetrics(flagsCache);
      }
    } catch (err) {
      console.error('Failed to parse init SSE event:', err);
    }
  });

  eventSource.addEventListener('flag_created', (e) => {
    const flag = JSON.parse(e.data);
    const idx = flagsCache.findIndex(f => f.key === flag.key);
    if (idx >= 0) flagsCache[idx] = flag;
    else flagsCache.push(flag);
    renderFlagsTable(flagsCache);
    updateMetrics(flagsCache);
  });

  eventSource.addEventListener('flag_updated', (e) => {
    const flag = JSON.parse(e.data);
    const idx = flagsCache.findIndex(f => f.key === flag.key);
    if (idx >= 0) flagsCache[idx] = flag;
    else flagsCache.push(flag);
    renderFlagsTable(flagsCache);
    updateMetrics(flagsCache);
  });

  eventSource.addEventListener('flag_deleted', (e) => {
    const data = JSON.parse(e.data);
    flagsCache = flagsCache.filter(f => f.key !== data.key);
    renderFlagsTable(flagsCache);
    updateMetrics(flagsCache);
  });

  eventSource.addEventListener('matrix_reset', () => {
    fetchFlags();
  });
}

// Fetch all flags from REST API
async function fetchFlags() {
  try {
    const res = await fetch('/api/flags');
    const data = await res.json();
    if (data.success && data.flags) {
      flagsCache = data.flags;
      renderFlagsTable(flagsCache);
      updateMetrics(flagsCache);
    }
  } catch (err) {
    console.error('Error fetching flags:', err);
  }
}

// Render Table
function renderFlagsTable(flags) {
  const tbody = document.getElementById('flagsTableBody');
  if (!flags || flags.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No feature flags registered in matrix.</td></tr>';
    return;
  }

  tbody.innerHTML = flags.map(flag => {
    const rulesCount = (flag.rules && flag.rules.length) || 0;
    const rulesSummary = rulesCount > 0 
      ? `<span class="badge badge-info">${rulesCount} rule${rulesCount > 1 ? 's' : ''}</span>`
      : `<span class="text-muted">No rules</span>`;

    return `
      <tr data-key="${flag.key}">
        <td>
          <strong><code>${escapeHtml(flag.key)}</code></strong>
        </td>
        <td>
          <button class="btn btn-sm ${flag.enabled ? 'btn-success' : 'btn-danger'}" onclick="toggleFlag('${flag.key}', ${!flag.enabled})">
            ${flag.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}
          </button>
        </td>
        <td>
          <div class="rollout-slider-box">
            <input type="range" min="0" max="100" value="${flag.rolloutPercentage || 0}" 
              id="slider_${flag.key}" 
              oninput="document.getElementById('lbl_${flag.key}').innerText = this.value + '%'"
              onchange="updateRollout('${flag.key}', this.value)">
            <span class="rollout-lbl" id="lbl_${flag.key}">${flag.rolloutPercentage || 0}%</span>
          </div>
        </td>
        <td><small class="text-muted">${escapeHtml(flag.description || 'N/A')}</small></td>
        <td>${rulesSummary}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="evaluateSingleFlag('${flag.key}')">Test</button>
          <button class="btn btn-sm btn-danger" onclick="deleteFlag('${flag.key}')">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Update Top Metrics
function updateMetrics(flags) {
  const total = flags.length;
  const active = flags.filter(f => f.enabled).length;
  const disabled = total - active;

  document.getElementById('valTotalFlags').textContent = total;
  document.getElementById('valActiveFlags').textContent = active;
  document.getElementById('valDisabledFlags').textContent = disabled;
  document.getElementById('valSubscribers').textContent = (eventSource && eventSource.readyState === EventSource.OPEN) ? '1+' : '0';
}

// Toggle Flag Status
async function toggleFlag(key, newStatus) {
  try {
    const res = await fetch(`/api/flags/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newStatus })
    });
    const data = await res.json();
    if (!data.success) alert(data.error || 'Failed to toggle flag');
  } catch (err) {
    alert('Error toggling flag: ' + err.message);
  }
}

// Update Rollout Percentage
async function updateRollout(key, percentage) {
  try {
    const res = await fetch(`/api/flags/${key}/rollout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rolloutPercentage: parseInt(percentage, 10) })
    });
    const data = await res.json();
    if (!data.success) alert(data.error || 'Failed to update rollout');
  } catch (err) {
    alert('Error updating rollout: ' + err.message);
  }
}

// Delete Flag
async function deleteFlag(key) {
  if (!confirm(`Are you sure you want to delete flag "${key}"?`)) return;
  try {
    const res = await fetch(`/api/flags/${key}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) alert(data.error || 'Failed to delete flag');
  } catch (err) {
    alert('Error deleting flag: ' + err.message);
  }
}

// Event Listeners
function setupEventListeners() {
  // Sandbox Form
  document.getElementById('sandboxForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    await runEvaluation();
  });

  // Random User Button
  document.getElementById('btnRandomUser').addEventListener('click', () => {
    const roles = ['user', 'admin', 'beta-tester'];
    const countries = ['US', 'DE', 'GB', 'TR', 'JP', 'FR', 'CA'];
    const randNum = Math.floor(1000 + Math.random() * 9000);
    const randRole = roles[Math.floor(Math.random() * roles.length)];
    const randCountry = countries[Math.floor(Math.random() * countries.length)];

    document.getElementById('inputUserId').value = `usr_test_${randNum}`;
    document.getElementById('inputRole').value = randRole;
    document.getElementById('inputEmail').value = `tester_${randNum}@enterprise.org`;
    document.getElementById('inputCountry').value = randCountry;

    runEvaluation();
  });

  // Create Flag Form
  document.getElementById('createFlagForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = document.getElementById('inputNewKey').value.trim();
    const description = document.getElementById('inputNewDesc').value.trim();
    const rolloutPercentage = parseInt(document.getElementById('inputNewRollout').value, 10);

    try {
      const res = await fetch('/api/flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, description, rolloutPercentage, enabled: true, rules: [] })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('createFlagForm').reset();
        document.getElementById('inputNewRollout').value = 50;
      } else {
        alert(data.error || 'Failed to create flag');
      }
    } catch (err) {
      alert('Error creating flag: ' + err.message);
    }
  });

  // Reset Button
  document.getElementById('btnResetAll').addEventListener('click', async () => {
    if (!confirm('Reset feature flag matrix to factory baseline?')) return;
    try {
      await fetch('/api/flags/reset', { method: 'POST' });
    } catch (err) {
      alert('Error resetting matrix: ' + err.message);
    }
  });

  // Refresh Table Button
  document.getElementById('btnRefreshFlags').addEventListener('click', () => {
    fetchFlags();
  });
}

// Evaluate Context Sandbox
async function runEvaluation() {
  const context = {
    userId: document.getElementById('inputUserId').value.trim(),
    role: document.getElementById('inputRole').value,
    email: document.getElementById('inputEmail').value.trim(),
    country: document.getElementById('inputCountry').value.trim()
  };

  const container = document.getElementById('evalResultsContainer');
  container.innerHTML = '<span class="text-muted">Evaluating context matrix...</span>';

  try {
    const res = await fetch('/api/flags/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context })
    });
    const data = await res.json();

    if (data.success) {
      renderEvaluationResults(data.evaluations, data.context);
    } else {
      container.innerHTML = `<span class="danger">Error: ${escapeHtml(data.error)}</span>`;
    }
  } catch (err) {
    container.innerHTML = `<span class="danger">Network Error: ${escapeHtml(err.message)}</span>`;
  }
}

// Render Evaluation Results
function renderEvaluationResults(evaluations, context) {
  const container = document.getElementById('evalResultsContainer');
  if (!evaluations || Object.keys(evaluations).length === 0) {
    container.innerHTML = '<span class="text-muted">No flags evaluated.</span>';
    return;
  }

  let html = `<div class="eval-header">User: <code>${escapeHtml(context.userId)}</code> (${escapeHtml(context.role)}, ${escapeHtml(context.country)})</div>`;
  html += '<div class="eval-grid">';

  for (const [key, evalRes] of Object.entries(evaluations)) {
    const statusClass = evalRes.enabled ? 'eval-enabled' : 'eval-disabled';
    const statusText = evalRes.enabled ? 'ACTIVE' : 'INACTIVE';
    html += `
      <div class="eval-item ${statusClass}">
        <div class="eval-item-title">
          <code>${escapeHtml(key)}</code>
          <span class="badge ${evalRes.enabled ? 'badge-success' : 'badge-danger'}">${statusText}</span>
        </div>
        <div class="eval-item-reason">${escapeHtml(evalRes.reason || '')}</div>
      </div>
    `;
  }

  html += '</div>';
  container.innerHTML = html;
}

function evaluateSingleFlag(key) {
  runEvaluation();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
