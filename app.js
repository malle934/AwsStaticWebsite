/**
 * AI Tools Directory — app.js
 * All logic: CSV parsing, filtering, sorting, search, URL state, modal, dark mode.
 */

// ── Constants ────────────────────────────────────────────────────────────────

const CSV_PATH = './data/tools.csv';
const DEBOUNCE_MS = 300;

// Map CSS-safe category slugs → SVG logo paths
const CATEGORY_LOGOS = {
  'conversational ai': './assets/logos/conversational-ai.svg',
  'image generation': './assets/logos/image-generation.svg',
  'code assistant': './assets/logos/code-assistant.svg',
  'productivity': './assets/logos/productivity.svg',
  'search & research': './assets/logos/search-research.svg',
};

// Per-tool logo overrides (take precedence over category logos)
const TOOL_LOGOS = {
  'github copilot': './assets/logos/github-copilot.svg',
};

// ── State ────────────────────────────────────────────────────────────────────

let allTools = [];
let activeFilters = { q: '', category: '', pricing: '', sort: 'name-asc' };

// ── DOM refs ─────────────────────────────────────────────────────────────────

const toolsGrid = document.getElementById('toolsGrid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const categorySelect = document.getElementById('categoryFilter');
const pricingSelect = document.getElementById('pricingFilter');
const sortSelect = document.getElementById('sortFilter');
const clearBtn = document.getElementById('clearFilters');
const resultsCount = document.getElementById('resultsCount');
const themeToggle = document.getElementById('themeToggle');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');
const modalCloseBtn = document.getElementById('modalClose');

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('theme', theme);
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  const system = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved || system);
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ── CSV Parser ────────────────────────────────────────────────────────────────

/**
 * RFC-4180-compliant CSV parser that handles:
 *  - Commas inside quoted fields
 *  - Escaped quotes ("")
 *  - Windows & Unix line endings
 * Returns array of objects keyed by header row.
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseLine(line);
    if (values.length !== headers.length) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h.trim()] = values[idx]; });
    rows.push(obj);
  }
  return rows;
}

function parseLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;                      // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
    }
  }
  fields.push(field.trim());
  return fields;
}

// ── Data Loading ──────────────────────────────────────────────────────────────

async function loadData() {
  showSpinner();
  try {
    const resp = await fetch(CSV_PATH);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    allTools = parseCSV(text).map(normalizeTool);
    populateCategoryFilter();
    readURLParams();
    renderTools();
  } catch (err) {
    console.error('Failed to load CSV:', err);
    toolsGrid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-secondary)">
        <p style="font-size:1rem;font-weight:600">⚠️ Could not load tools data.</p>
        <p style="font-size:.85rem;margin-top:.5rem">Make sure <code>data/tools.csv</code> is present and you are serving this site over HTTP (not <code>file://</code>).</p>
      </div>`;
  }
}

function normalizeTool(raw) {
  return {
    name: raw.name || '',
    category: raw.category || '',
    description: raw.description || '',
    website: raw.website || '#',
    pricing: raw.pricing || '',
    tags: (raw.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    logo: getToolLogo(raw.name || '', raw.category || ''),
  };
}

function getToolLogo(name, category) {
  const nameKey = name.toLowerCase().trim();
  const categoryKey = category.toLowerCase().trim();
  return TOOL_LOGOS[nameKey] || CATEGORY_LOGOS[categoryKey] || './assets/logos/default.svg';
}

function showSpinner() {
  toolsGrid.innerHTML = `
    <div class="spinner-wrapper" aria-label="Loading tools…">
      <div class="spinner"></div>
    </div>`;
}

// ── Category Filter Population ────────────────────────────────────────────────

function populateCategoryFilter() {
  const cats = [...new Set(allTools.map(t => t.category))].sort();
  categorySelect.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });
}

// ── URL Params ────────────────────────────────────────────────────────────────

function readURLParams() {
  const params = new URLSearchParams(window.location.search);
  activeFilters.q = params.get('q') || '';
  activeFilters.category = params.get('category') || '';
  activeFilters.pricing = params.get('pricing') || '';
  activeFilters.sort = params.get('sort') || 'name-asc';

  searchInput.value = activeFilters.q;
  categorySelect.value = activeFilters.category;
  pricingSelect.value = activeFilters.pricing;
  sortSelect.value = activeFilters.sort;
}

function writeURLParams() {
  const params = new URLSearchParams();
  if (activeFilters.q) params.set('q', activeFilters.q);
  if (activeFilters.category) params.set('category', activeFilters.category);
  if (activeFilters.pricing) params.set('pricing', activeFilters.pricing);
  if (activeFilters.sort && activeFilters.sort !== 'name-asc')
    params.set('sort', activeFilters.sort);

  const url = params.toString() ? `?${params.toString()}` : window.location.pathname;
  history.replaceState(null, '', url);
}

// ── Filter + Sort Logic ───────────────────────────────────────────────────────

function getFilteredSorted() {
  const q = activeFilters.q.toLowerCase();
  let tools = allTools.filter(tool => {
    const matchQ = !q || (
      tool.name.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q) ||
      tool.tags.some(t => t.toLowerCase().includes(q))
    );
    const matchCat = !activeFilters.category || tool.category === activeFilters.category;
    const matchPri = !activeFilters.pricing || tool.pricing.toLowerCase() === activeFilters.pricing.toLowerCase();
    return matchQ && matchCat && matchPri;
  });

  const sort = activeFilters.sort;
  tools = tools.sort((a, b) => {
    if (sort === 'name-asc') return a.name.localeCompare(b.name);
    if (sort === 'name-desc') return b.name.localeCompare(a.name);
    if (sort === 'category') return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    return 0;
  });
  return tools;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderTools() {
  const tools = getFilteredSorted();
  writeURLParams();
  updateResultsCount(tools.length);

  if (tools.length === 0) {
    toolsGrid.innerHTML = '';
    emptyState.classList.add('visible');
    return;
  }
  emptyState.classList.remove('visible');

  toolsGrid.innerHTML = tools.map((tool, i) => buildCardHTML(tool, i)).join('');

  // Attach click handlers
  toolsGrid.querySelectorAll('.tool-card').forEach((card, i) => {
    card.addEventListener('click', (e) => {
      // "Visit" button handles its own event; don't re-open modal
      if (e.target.closest('.visit-btn')) return;
      openModal(tools[i]);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(tools[i]);
      }
    });
  });

  toolsGrid.querySelectorAll('.visit-btn').forEach((btn, i) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });
}

function buildCardHTML(tool, index) {
  const badgeClass = tool.pricing.toLowerCase().replace(/\s+/g, '-');
  const tagsHTML = tool.tags.slice(0, 4).map(t =>
    `<span class="tag">${escapeHTML(t)}</span>`).join('');
  const delay = Math.min(index * 40, 320);

  return `
    <article
      class="tool-card"
      role="button"
      tabindex="0"
      aria-label="View details for ${escapeHTML(tool.name)}"
      style="animation-delay:${delay}ms"
    >
      <div class="card-header">
        <img
          class="card-logo"
          src="${tool.logo}"
          alt="${escapeHTML(tool.name)} logo"
          loading="lazy"
          onerror="this.src='./assets/logos/default.svg'"
        />
        <div class="card-title-block">
          <div class="card-name">${escapeHTML(tool.name)}</div>
          <div class="card-category">${escapeHTML(tool.category)}</div>
        </div>
        <span class="pricing-badge ${badgeClass}" aria-label="Pricing: ${escapeHTML(tool.pricing)}">
          ${escapeHTML(tool.pricing)}
        </span>
      </div>

      <p class="card-description">${escapeHTML(tool.description)}</p>

      <div class="tags-row" aria-label="Tags">
        ${tagsHTML}
      </div>

      <a
        href="${escapeHTML(tool.website)}"
        target="_blank"
        rel="noopener noreferrer"
        class="visit-btn"
        aria-label="Visit ${escapeHTML(tool.name)} website (opens in new tab)"
        onclick="event.stopPropagation()"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Visit Website
      </a>
    </article>`;
}

function updateResultsCount(count) {
  resultsCount.textContent = `${count} tool${count !== 1 ? 's' : ''} found`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

let lastFocusedElement = null;

function openModal(tool) {
  lastFocusedElement = document.activeElement;
  const badgeClass = tool.pricing.toLowerCase().replace(/\s+/g, '-');
  const tagsHTML = tool.tags.map(t => `<span class="tag">${escapeHTML(t)}</span>`).join('');

  modalContent.innerHTML = `
    <div class="modal-header">
      <img
        class="modal-logo"
        src="${tool.logo}"
        alt="${escapeHTML(tool.name)} logo"
        onerror="this.src='./assets/logos/default.svg'"
      />
      <div>
        <div class="modal-title">${escapeHTML(tool.name)}</div>
        <div class="modal-category">${escapeHTML(tool.category)}</div>
      </div>
    </div>

    <div class="modal-meta">
      <span class="pricing-badge ${badgeClass}">${escapeHTML(tool.pricing)}</span>
    </div>

    <div class="modal-section-label">About</div>
    <p class="modal-description">${escapeHTML(tool.description)}</p>

    <div class="modal-section-label">Tags</div>
    <div class="modal-tags">${tagsHTML}</div>

    <div class="modal-section-label">Website</div>
    <p style="font-size:.875rem;color:var(--text-secondary);margin-bottom:1.25rem">
      <a href="${escapeHTML(tool.website)}" target="_blank" rel="noopener noreferrer">
        ${escapeHTML(tool.website)}
      </a>
    </p>

    <a
      href="${escapeHTML(tool.website)}"
      target="_blank"
      rel="noopener noreferrer"
      class="modal-visit-btn"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        <polyline points="15 3 21 3 21 9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      Visit ${escapeHTML(tool.name)}
    </a>
  `;

  modalOverlay.classList.add('open');
  modalOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  // Move focus into modal
  requestAnimationFrame(() => {
    modalCloseBtn.focus();
  });
}

function closeModal() {
  modalOverlay.classList.remove('open');
  modalOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastFocusedElement) lastFocusedElement.focus();
}

modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('open')) {
    closeModal();
  }
});

// Trap focus inside modal
modalOverlay.addEventListener('keydown', (e) => {
  if (!modalOverlay.classList.contains('open') || e.key !== 'Tab') return;
  const focusable = modalOverlay.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) { last.focus(); e.preventDefault(); }
  } else {
    if (document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

// ── Event Listeners ───────────────────────────────────────────────────────────

// Debounce helper
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

searchInput.addEventListener('input', debounce((e) => {
  activeFilters.q = e.target.value.trim();
  renderTools();
}, DEBOUNCE_MS));

categorySelect.addEventListener('change', () => {
  activeFilters.category = categorySelect.value;
  renderTools();
});

pricingSelect.addEventListener('change', () => {
  activeFilters.pricing = pricingSelect.value;
  renderTools();
});

sortSelect.addEventListener('change', () => {
  activeFilters.sort = sortSelect.value;
  renderTools();
});

clearBtn.addEventListener('click', () => {
  activeFilters = { q: '', category: '', pricing: '', sort: 'name-asc' };
  searchInput.value = '';
  categorySelect.value = '';
  pricingSelect.value = '';
  sortSelect.value = 'name-asc';
  renderTools();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

initTheme();
loadData();
