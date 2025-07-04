// public//plainspace/editor/editor.js
// Lightweight global text editor for builder mode.
import { isValidTag } from '../allowedTags.js';
import { createColorPicker } from './colorPicker.js';

let toolbar = null;
let activeEl = null;
let initPromise = null;
let autoHandler = null;
let currentColor = '#000000';
let colorPicker = null;

// Command history for text edits
const textHistory = [];
const redoHistory = [];
const MAX_HISTORY = 50;

let toggleStyleInternal;
let applyFontInternal;
let applySizeInternal;
let applyColorInternal;
let updateButtonStates = () => {};
let pendingSelectionUpdate = null;

// --------------------------------------------------
//  Remember selection range
//  This is used to restore the selection after applying styles
// --------------------------------------------------
let preservedRange = null;

function saveSelection () {
  const ae = document.activeElement;
  if (ae && (
        ae.closest('.text-block-editor-toolbar') ||
        ae.closest('.text-color-picker')))
    return;

  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    preservedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreSelection() {
  if (preservedRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(preservedRange);
  }
}

// Bei jeder Nutzer-Interaktion merken
document.addEventListener('mouseup',          saveSelection, true);
document.addEventListener('keyup',            saveSelection, true);
document.addEventListener('touchend',         saveSelection, true);
document.addEventListener('selectionchange',  saveSelection, true);


function parseColor(val) {
  val = String(val || '').trim();
  if (val.startsWith('#')) {
    if (val.length === 4) {
      val = '#' + val[1] + val[1] + val[2] + val[2] + val[3] + val[3];
    }
    const int = parseInt(val.slice(1), 16);
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255
    };
  }
  const m = val.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3] };
  }
  return null;
}

function setActiveButtonAppearance(btn, active) {
  if (!btn) return;
  btn.classList.toggle('active', active);
  if (!active) {
    btn.style.color = '';
    return;
  }
  const userColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--user-color')
    .trim();
  const rgb = parseColor(userColor);
  let luminance = 0;
  if (rgb) {
    luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  }
  btn.style.color = luminance > 0.6 ? 'var(--color-text)' : 'var(--color-white)';
}

function styleMatches(val, prop, target, styleObj = null) {
   switch (prop) {

     case 'textDecoration': {
       const hasUnderline = String(val).includes('underline');
       const wavy = styleObj && styleObj.textDecorationStyle === 'wavy';
       return hasUnderline && !wavy;
     }

     case 'fontWeight': {       // „bold“
       const num = parseInt(val, 10);
       return val === 'bold' || (!isNaN(num) && num >= 600);
     }

     case 'fontStyle':          // „italic“
       return /(italic|oblique)/.test(val);

     default:
       return String(val) === String(target);
   }
 }

function isSelectionStyled(prop, value) {
  if (!activeEl) return false;
  const sel = window.getSelection();
  if (
    !sel ||
    sel.isCollapsed ||
    !activeEl.contains(sel.anchorNode) ||
    !activeEl.contains(sel.focusNode)
  ) {
    const current = getComputedStyle(activeEl)[prop];
    return styleMatches(current, prop, value);
  }
  const range = sel.getRangeAt(0);
  // 1) Cursor evtl. in Text-Knoten? → Root anheben
  let walkerRoot = range.commonAncestorContainer;
  if (walkerRoot.nodeType === 3) {
    walkerRoot = walkerRoot.parentNode;
  }

  // 2) Walker über walkerRoot aufbauen
  const walker = document.createTreeWalker(
    walkerRoot,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(n) {
        return range.intersectsNode(n)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );
  const carriers = new Set();
  carriers.add(activeEl);
  while (walker.nextNode()) {
    carriers.add(walker.currentNode.parentElement);
  }
  return [...carriers].every(el =>
    styleMatches(getComputedStyle(el)[prop], prop, value)
  );
}

function pushCommand(command) {
  textHistory.push(command);
  if (textHistory.length > MAX_HISTORY) textHistory.shift();
  redoHistory.length = 0;
}

export function undoTextCommand() {
  const cmd = textHistory.pop();
  if (!cmd) return false;
  redoHistory.push(cmd);
  cmd.undo();
  return true;
}

export function redoTextCommand() {
  const cmd = redoHistory.pop();
  if (!cmd) return false;
  textHistory.push(cmd);
  cmd.execute();
  return true;
}

function recordChange(el, prevHtml) {
  const newHtml = el.outerHTML;
  pushCommand({
    execute() {
      el.outerHTML = newHtml;
      el = document.getElementById(el.id) || el;
      updateAndDispatch(el);
    },
    undo() {
      el.outerHTML = prevHtml;
      el = document.getElementById(el.id) || el;
      updateAndDispatch(el);
    }
  });
}

export function toggleStyle(prop, value) {
  if (!activeEl) return;
  const prev = activeEl.outerHTML;
  toggleStyleInternal(prop, value);
  recordChange(activeEl, prev);
}

export function applyFont(font) {
  if (!activeEl) return;
  const prev = activeEl.outerHTML;
  applyFontInternal(font);
  recordChange(activeEl, prev);
}

export function applySize(size) {
  if (!activeEl) return;
  const prev = activeEl.outerHTML;
  applySizeInternal(size);
  recordChange(activeEl, prev);
}

export function applyColor(color) {
  if (!activeEl) return;
  const prev = activeEl.outerHTML;
  applyColorInternal(color);
  recordChange(activeEl, prev);
}

function dispatchHtmlUpdate(el) {
  if (!el) return;
  const widget = findWidget(el);
  const instanceId = widget?.dataset.instanceId;
  if (!instanceId) return;
  const html = el.outerHTML.trim();
  console.log('[DEBUG] dispatchHtmlUpdate', instanceId, html);
  document.dispatchEvent(
    new CustomEvent('widgetHtmlUpdate', {
      detail: { instanceId, html }
    })
  );
}

function updateAndDispatch(el) {
  if (!el) return;
  const html = el.outerHTML.trim();
  el.__onSave?.(html);
  dispatchHtmlUpdate(el);
}


const editableMap = new WeakMap();


export function sanitizeHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('script, style').forEach(el => el.remove());
  div.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (name === 'style') {
        const allowed = [
          'font-size',
          'font-family',
          'text-decoration',
          'font-weight',
          'font-style',
          'color',
          'background-color'
        ];
        const sanitized = attr.value
          .split(';')
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => {
            const [prop, value] = s.split(':').map(p => p.trim());
            if (
              allowed.includes(prop.toLowerCase()) &&
              !/(expression|url\(|javascript)/i.test(value)
            ) {
              return `${prop}:${value}`;
            }
            return null;
          })
          .filter(Boolean)
          .join('; ');
        if (sanitized) {
          el.setAttribute('style', sanitized);
        } else {
          el.removeAttribute('style');
        }
      }
    });
  });
  return div.innerHTML;
}

function isEditableElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const ignore = ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'SVG', 'VIDEO', 'AUDIO', 'CANVAS'];
  if (ignore.includes(el.tagName)) return false;
  if (!el.textContent.trim()) return false;
  const tag = el.tagName.toLowerCase();
  if (isValidTag(tag)) return true;
  if (el.dataset.textEditable !== undefined) return true;
  return el.children.length === 0;
}

function withinGridItem(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.classList && node.classList.contains('canvas-item')) return true;
    node = node.parentElement || (node.getRootNode && node.getRootNode().host);
  }
  return false;
}

function findWidget(node) {
  let n = node;
  while (n && n !== document.body) {
    if (n.classList && n.classList.contains('canvas-item')) return n;
    n = n.parentElement || (n.getRootNode && n.getRootNode().host);
  }
  return null;
}

function findEditable(target) {
  let t = target;
  while (t && t !== document.body) {
    if (isEditableElement(t) && withinGridItem(t)) {
      return t;
    }
    t = t.parentElement || (t.getRootNode && t.getRootNode().host);
  }
  return null;
}

function findEditableFromEvent(ev) {
  if (typeof ev.composedPath === 'function') {
    const path = ev.composedPath();
    for (const node of path) {
      if (node instanceof Element && isEditableElement(node) && withinGridItem(node)) {
        return node;
      }
    }
  }
  return findEditable(ev.target);
}

async function init() {
  console.log('[TBE] init() called');
  if (initPromise) {
    await initPromise;
    return;
  }
  initPromise = (async () => {
    try {
      // Ensure toolbar is a singleton to avoid duplicate event listeners
      toolbar =
        toolbar || document.body.querySelector('.text-block-editor-toolbar');
      if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'text-block-editor-toolbar';
        toolbar.style.display = 'none';
        toolbar.innerHTML = [
        '<div class="font-family-control">' +
          '<div class="ff-dropdown">' +
            '<button type="button" class="ff-btn"><span class="ff-label">Font</span></button>' +
            '<div class="ff-options"></div>' +
          '</div>' +
        '</div>',
        '<button type="button" class="tb-btn" data-cmd="bold">' + window.featherIcon('bold') + '</button>',
        '<button type="button" class="tb-btn" data-cmd="italic">' + window.featherIcon('italic') + '</button>',
        '<button type="button" class="tb-btn" data-cmd="underline">' + window.featherIcon('underline') + '</button>',
        '<select class="heading-select" style="display:none">' +
          ['h1','h2','h3','h4','h5','h6'].map(h => `<option value="${h}">${h.toUpperCase()}</option>`).join('') +
        '</select>',
        '<div class="font-size-control">' +
          '<button type="button" class="tb-btn fs-dec">-</button>' +
          '<div class="fs-dropdown">' +
            '<button type="button" class="fs-btn"><span>' +
              '<input type="number" class="fs-input" value="16" min="1" max="800" step="0.1" pattern="\\d*" tabindex="-1" placeholder="--" />' +
            '</span></button>' +
            '<div class="fs-options">' +
              [12,14,16,18,24,36].map(s => `<span data-size="${s}">${s}</span>`).join('') +
            '</div>' +
          '</div>' +
          '<button type="button" class="tb-btn fs-inc">+</button>' +
        '</div>'
      ].join('');
        document.body.appendChild(toolbar);
      }
      toolbar.style.display = 'none';

    // ---- Globaler Focus‑Stopper --------------------------
    toolbar.addEventListener('pointerdown', ev => {
      saveSelection();           // Range sichern
      ev.preventDefault();       // Fokuswechsel unterbinden
      ev.stopPropagation();      // kein weiteres Bubbling
    }, true);


    toolbar.addEventListener('click', ev => {           
      const btn = ev.target.closest('button[data-cmd]');
      });

    function splitRangeBoundaries(range) {
      // Start
      if (range.startContainer.nodeType === 3) {
        const txt = range.startContainer;
        if (range.startOffset > 0 && range.startOffset < txt.length) {
          txt.splitText(range.startOffset);
          range.setStart(txt.nextSibling, 0);
        }
      }
      // End
      if (range.endContainer.nodeType === 3) {
        const txt = range.endContainer;
        if (range.endOffset > 0 && range.endOffset < txt.length) {
          txt.splitText(range.endOffset);
        }
      }
    }

    //
    /* ============================================================
   applyStyleInternal – applies a style to the active element or the selected range
   ============================================================ */
function applyStyleInternal(prop, value) {

  /* DBG-0: Funktionsaufruf + Parameter */
  console.log('%c[DBG-0] applyStyleInternal →', 'color:#f06',
              { prop, value });

  restoreSelection();
  if (!activeEl) {
    console.warn('[DBG-0] activeEl ist null → Abbruch');
    return;
  }

  /* ----------------------------------------------------------------
     1) check selction and range
     ---------------------------------------------------------------- */
  const sel = window.getSelection();
  console.log('%c[DBG-1] sel =', 'color:#0af', sel && sel.toString());

  let range = null;

  if (sel && sel.rangeCount &&
      !sel.isCollapsed &&
      activeEl.contains(sel.anchorNode) &&
      activeEl.contains(sel.focusNode)) {

    range = sel.getRangeAt(0);
    console.log('%c[DBG-2] Range aus sel genommen', 'color:#0af', range);

  } else if (preservedRange && !preservedRange.collapsed) {

    range = preservedRange.cloneRange();
    sel.removeAllRanges();
    sel.addRange(range);
    console.log('%c[DBG-2] Range aus preservedRange wiederhergestellt',
                'color:#0af', range);

  } else {
    console.warn('[DBG-2] KEINE gültige Range --> ganze Box wird formatiert');
  }

  const hasRange = !!range;
  const normalizeSize = v => parseFloat(v).toFixed(2);

  /* ----------------------------------------------------------------
     2) Helper „touch“ – applied in every node
     ---------------------------------------------------------------- */
  const touch = el => {
    const computedVal = getComputedStyle(el)[prop];
    const inlineVal   = el.style[prop];
    let isAlreadySet;

    if (prop === 'fontSize') {
      isAlreadySet = normalizeSize(computedVal) === normalizeSize(value);
    } else {
      isAlreadySet = inlineVal === value || computedVal === value;
    }

    console.log('%c[DBG-3] touch', 'color:#e69500',
                { el, computedVal, inlineVal, isAlreadySet });

    if (isAlreadySet) {
      el.style[prop] = '';
    } else {
      el.style[prop] = value;
    }

    /* leere <span> entsorgen */
    if (el.tagName === 'SPAN' && !el.getAttribute('style')) {
      el.replaceWith(...el.childNodes);
      console.log('%c[DBG-3] leerer <span> entfernt', 'color:#e69500');
    }
  };

  /* ----------------------------------------------------------------
     3) pick nodes in range and format them
     ---------------------------------------------------------------- */
  if (hasRange) {
    splitRangeBoundaries(range);

    let walkerRoot = range.commonAncestorContainer;
    if (walkerRoot.nodeType === 3) {
      walkerRoot = walkerRoot.parentNode;
    }

   const walker = document.createTreeWalker(
      walkerRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: n => range.intersectsNode(n)
                       ? NodeFilter.FILTER_ACCEPT
                       : NodeFilter.FILTER_REJECT
      }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    console.log('%c[DBG-4] Textknoten gefunden:', 'color:#07a', nodes.length, nodes);

    nodes.forEach(text => {
      let carrier = text.parentElement;
      if (carrier.tagName !== 'SPAN') {
        const span = document.createElement('span');
        carrier.insertBefore(span, text);
        span.appendChild(text);
        carrier = span;
        console.log('%c[DBG-4] Neuer <span> angelegt', 'color:#07a', carrier);
      }
      touch(carrier);
    });

  /* ----------------------------------------------------------------
     4)  no range - formate the box itself
     ---------------------------------------------------------------- */
  } else {
    touch(activeEl);
  }

  updateAndDispatch(activeEl);
  updateButtonStates();
  if (!hasRange) {         
   preservedRange = null; 
    } else {
      preservedRange = range.cloneRange();
      saveSelection(); 
    }
 
  console.log('%c[DBG-5] applyStyleInternal ENDE', 'color:#f06');
}




    updateButtonStates = function () {
      if (!toolbar || !activeEl) return;
      const map = {
        bold: ['fontWeight', 'bold'],
        italic: ['fontStyle', 'italic'],
        underline: ['textDecoration', 'underline']
      };
      for (const [cmd, [prop, val]] of Object.entries(map)) {
        const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
        if (!btn) continue;
        const active = isSelectionStyled(prop, val);
        setActiveButtonAppearance(btn, active);
      }

      updateFontSizeInput();
    };

    function updateFontSizeInput() {
      if (!activeEl || !fsInput) return;

      const computedSize = window.getComputedStyle(activeEl).fontSize;
      fsInput.value = parseFloat(computedSize);
    }


    document.addEventListener('selectionchange', () => {
      if (pendingSelectionUpdate) return;
      pendingSelectionUpdate = requestAnimationFrame(() => {
        updateButtonStates();
        pendingSelectionUpdate = null;
      });
    });

    // Unified mapping – these functions are used to apply styles
    toggleStyleInternal = applyStyleInternal;
    applyFontInternal   = font  => applyStyleInternal('fontFamily', font);
    applySizeInternal   = size  => applyStyleInternal('fontSize', parseFloat(size) + 'px');
    applyColorInternal  = color => applyStyleInternal('color', color);


    toolbar.addEventListener('click', ev => {
      const btn = ev.target.closest('button[data-cmd]');
      if (!btn) return;
      ev.preventDefault();
      if (!activeEl || !document.body.contains(activeEl)) {
        const w = document.querySelector('.canvas-item.selected');
        activeEl = w ? getRegisteredEditable(w) : null;
      }
      if (!activeEl) return;
      const cmd = btn.dataset.cmd;
      if (cmd === 'bold') toggleStyle('fontWeight', 'bold');
      if (cmd === 'italic') toggleStyle('fontStyle', 'italic');
      if (cmd === 'underline') toggleStyle('textDecoration', 'underline');
    });

    const colorWrapper = document.createElement('div');
    colorWrapper.className = 'text-color-picker';
    const colorBtn = document.createElement('button');
    colorBtn.type = 'button';
    colorBtn.className = 'color-picker-toggle tb-btn';
    const colorIcon = document.createElement('span');
    colorIcon.className = 'color-icon';
    colorIcon.textContent = 'A';
    colorIcon.style.textDecorationColor = currentColor;
    colorBtn.appendChild(colorIcon);
    const themeColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-color')
      .trim();
    colorPicker = createColorPicker({
      presetColors: [
        '#FF0000', '#FF4040', '#FFC0CB', '#FF00FF', '#800080', '#8A2BE2',
        '#00CED1', '#00FFFF', '#40E0D0', '#ADD8E6', '#4169E1', '#0047AB',
        '#008000', '#7CFC00', '#BFFF00', '#FFFF00', '#FFDAB9', '#FFA500',
        '#000000', '#A9A9A9', '#808080'
      ],
      themeColors: themeColor ? [themeColor] : [],
      initialColor: currentColor,
      onSelect: c => {
        applyColor(c);
        colorIcon.style.textDecorationColor = c;
        /* Picker offen lassen – schließen erst über X/Widgetwechsel */
      },
      onClose: () => colorBtn.focus()
    });
    colorPicker.el.classList.add('floating', 'hidden');
    document.body.appendChild(colorPicker.el);
    colorPicker.el.addEventListener('pointerdown', ev => {
    if (ev.target.classList.contains('swatch')) {
        saveSelection();
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, true);
    colorBtn.addEventListener('click', () => {
      saveSelection();
      if (colorPicker.el.classList.contains('hidden')) {
        const rect = colorBtn.getBoundingClientRect();
        colorPicker.showAt(
          rect.left + window.scrollX,
          rect.bottom + window.scrollY
        );
      } else {
        colorPicker.hide();
      }
    });

    document.addEventListener('selected', () => colorPicker.hide());
    colorWrapper.appendChild(colorBtn);
    toolbar.appendChild(colorWrapper);

    const ffControl = toolbar.querySelector('.font-family-control');
    const ffDropdown = toolbar.querySelector('.ff-dropdown');
    const ffOptions = toolbar.querySelector('.ff-options');
    const ffBtn = toolbar.querySelector('.ff-btn');
    const ffLabel = toolbar.querySelector('.ff-label');
    const fsInput = toolbar.querySelector('.fs-input');
    const fsDropdown = toolbar.querySelector('.fs-dropdown');
    const fsOptions = toolbar.querySelector('.fs-options');
    const fsBtn = toolbar.querySelector('.fs-btn');

    const populateFonts = () => {
      const fonts = Array.isArray(window.AVAILABLE_FONTS) ? window.AVAILABLE_FONTS : [];
      ffOptions.innerHTML = fonts
        .map(f => `<span data-font="${f}" style="font-family:'${f}'">${f}</span>`)
        .join('');
      if (fonts.length) ffLabel.textContent = fonts[0];
    };
    populateFonts();
    document.addEventListener('fontsUpdated', populateFonts);

    
    toolbar.querySelector('.fs-inc').addEventListener('click', () => {
      saveSelection();
      const newSize = (parseFloat(fsInput.value) || 16) + 1;
      fsInput.value = newSize;
      applySize(newSize);

      if (activeEl) updateAndDispatch(activeEl); // <- HTML-Update triggern
    });

    toolbar.querySelector('.fs-dec').addEventListener('click', () => {
      saveSelection();
      const newSize = Math.max((parseFloat(fsInput.value) || 16) - 1, 1);
      fsInput.value = newSize;
      applySize(newSize);

      if (activeEl) updateAndDispatch(activeEl); // <- HTML-Update triggern
    });


    const filterOptions = val => {
      fsOptions.querySelectorAll('span[data-size]')
                .forEach(span => {
                span.style.display = !val || span.textContent.startsWith(val)
                                      ? 'block' : 'none';
              });
    };

    fsBtn.addEventListener('click', () => {
      fsDropdown.classList.toggle('open');
      fsInput.focus();
    });

    ffBtn.addEventListener('click', () => {
      ffControl.classList.toggle('open');
    });

    document.addEventListener('click', ev => {
      if (!ffControl.contains(ev.target)) ffControl.classList.remove('open');
    });

    ffOptions.addEventListener('click', ev => {
      const opt = ev.target.closest('span[data-font]');
      if (!opt) return;
      applyFont(opt.dataset.font);
      ffControl.classList.remove('open');
    });

    ['pointerdown', 'click'].forEach(evt => {
      fsInput.addEventListener(evt, ev => ev.stopPropagation());
    });

    fsInput.addEventListener('focus', () => {
      fsDropdown.classList.add('open');
      filterOptions(fsInput.value);
    });
    fsInput.addEventListener('input', () => {
      fsDropdown.classList.add('open');
      filterOptions(fsInput.value);
    });
    fsInput.addEventListener('change', () => applySize(fsInput.value));
    fsInput.addEventListener('blur', () => {
      setTimeout(() => fsDropdown.classList.remove('open'), 150);
    });

    fsOptions.addEventListener('click', ev => {
      const opt = ev.target.closest('span[data-size]');
      if (!opt) return;
      applySize(opt.dataset.size);
      fsDropdown.classList.remove('open');
    });

    toolbar.addEventListener('input', e => {
      const target = e.target;
      if (!activeEl) return;
      if (target.matches('.fs-input')) {
        if (activeEl.getAttribute('contenteditable') !== 'true') {
          applyToolbarChange(activeEl, 'fontSize', target.value + 'px');
        }
      }
    });
      console.log('[TBE] init() finished OK');
    } catch (err) {
      console.error('[TBE] init() failed', err);
      throw err;
    }
  })();
  await initPromise;
}


function setCaretFromEvent(el, ev) {
  if (!el || !ev) return;
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  if (range) {
    range.collapse(true);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

export function editElement(el, onSave, clickEvent = null) {
  const widget = el.closest('.canvas-item');
  if (!widget) return;

  const getHitLayer = w =>
    w.querySelector('.hit-layer') ||
    w.querySelector('.canvas-item-content .hit-layer') ||
    null;

  const hitLayer = getHitLayer(widget);

  const prevLayer = +widget.dataset.layer || 0;
  widget.dataset.layer = 9999;
  widget.style.zIndex = '9999';
  widget.classList.add('editing');
  widget.dispatchEvent(new Event('editStart'));

  //lock the widget to prevent moving/resizing while editing
  widget.setAttribute('gs-locked', 'true');
  const grid = widget.closest('.canvas-grid')?.__grid;
  grid?.update(widget, { locked: true, noMove: true, noResize: true });

  if (hitLayer) hitLayer.style.pointerEvents = 'none';

  el.setAttribute('contenteditable', 'true');
  el.focus();
  if (clickEvent) {
    setCaretFromEvent(el, clickEvent);
  }
  activeEl = el;

  const inputHandler = () => dispatchHtmlUpdate(el);
  el.addEventListener('input', inputHandler);
  el.__inputHandler = inputHandler;

  showToolbar();

  function finish(save) {
    if (save) {
      el.innerHTML = sanitizeHtml(el.innerHTML.trim());
      updateAndDispatch(el);
    }
    activeEl = null;

    el.removeAttribute('contenteditable');

    widget.dataset.layer = prevLayer;
    widget.style.zIndex = String(prevLayer);
    widget.setAttribute('gs-locked', 'false');
    grid?.update(widget, { locked: false, noMove: false, noResize: false });
    if (el.__inputHandler) {
      el.removeEventListener('input', el.__inputHandler);
      delete el.__inputHandler;
    }

    if (hitLayer) hitLayer.style.pointerEvents = 'auto';

    widget.classList.remove('editing');
    widget.dispatchEvent(new Event('editEnd'));
    if (widget.classList.contains('selected')) {
      showToolbar();
    } else {
      hideToolbar();
    }
    document.removeEventListener('mousedown', outsideClick, true);
  }

  // Finish editing when clicking outside the widget, its bounding box or the toolbar
  const outsideClick = ev => {
    if (
      widget.contains(ev.target) ||
      grid?.bbox?.contains(ev.target) ||
      toolbar?.contains(ev.target)
    ) return;
    finish(true);
  };
  document.addEventListener('mousedown', outsideClick, true);
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
}

export function registerElement(editable, onSave) {
  if (!editable) return;
  if (!editable.id || (document.getElementById(editable.id) && document.getElementById(editable.id) !== editable)) {
    editable.id = `editable-${Math.random().toString(36).slice(2,8)}`;
  }
  if (editable.__registered) return;
  editable.__registered = true;
  editable.__onSave = onSave;
  const widget = findWidget(editable);
  if (widget) {
    editableMap.set(widget, editable);
  }
  console.log('[DEBUG] registerElement:', editable, 'for widget:', widget);
}

export function getRegisteredEditable(widget) {
  return editableMap.get(widget) || null;
}

export function enableAutoEdit() {
  if (autoHandler) return;
  autoHandler = ev => {
    if (!document.body.classList.contains('builder-mode')) return;
    if (toolbar && toolbar.contains(ev.target)) return;
    const widget = findWidget(ev.target);
    if (!widget || !widget.classList.contains('selected')) return;
    let el = findEditableFromEvent(ev);
    if (!el) el = getRegisteredEditable(widget);
    /*  Neu:  Ist noch nichts registriert?  ->  kurz warten und neu triggern  */
    if (!el) {
      setTimeout(() => widget.dispatchEvent(new Event('dblclick')), 30);
      return;
    }
    ev.stopPropagation();
    ev.preventDefault();
    editElement(el, el.__onSave, ev);
  };
  document.addEventListener('dblclick', autoHandler, true);
}

export async function initTextEditor() {
  await init().catch(err => console.error('[globalTextEditor] init failed', err));
  enableAutoEdit();
}

export function setActiveElement(el) {
  activeEl = el;
  if (activeEl) {
    console.log('[DEBUG] activeEl set to:', activeEl);
  }
}

export function applyToolbarChange(el, styleProp, value) {
  if (!el) return;
  console.log('[DEBUG] Applying toolbar style:', styleProp, value, 'to element:', el);
  el.style[styleProp] = value;
  updateAndDispatch(el);
}

function showToolbar() {
  if (!toolbar) return;
  toolbar.style.display = 'flex';
  updateButtonStates();
}

function hideToolbar() {
  if (!toolbar) return;
  toolbar.style.display = 'none';
  const headingSelect = toolbar.querySelector('.heading-select');
  if (headingSelect) {
    headingSelect.style.display = 'none';
    headingSelect.onchange = null;
  }
}

document.addEventListener('selected', () => hideToolbar());

export { showToolbar, hideToolbar };

if (document.body.classList.contains('builder-mode')) {
  initTextEditor();
}
