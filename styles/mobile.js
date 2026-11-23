/*
 * mobile.js
 * Copyright (C) 2026 Stefano Natangelo
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Mobile Dashboard (mobileDashboard) – menu button for the OJS 3.5 back end
 * on phones. The layout is done by mobile.css; this script adds the menu
 * button, the backdrop and opening/closing, plus the fixes described below.
 */
(function () {
    'use strict';

    var phone = window.matchMedia('(max-width: 900px)');
    var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>';

    function nav() {
        return document.getElementById('app-nav');
    }

    function isOpen() {
        return document.body.classList.contains('md-nav-open');
    }

    function setOpen(open) {
        var n = nav();
        var button = document.getElementById('mdNavToggle');
        document.body.classList.toggle('md-nav-open', open);
        if (button) {
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        if (n) {
            if (open) {
                n.removeAttribute('inert');
            } else if (phone.matches) {
                n.setAttribute('inert', '');
            }
        }
    }

    /* Vue renders the panel after the page loads and may re-render it:
       the button is (re)added whenever it is missing. */
    function ensureControls() {
        var header = document.querySelector('.app__header');
        var n = nav();
        if (!header || !n) {
            return;
        }
        if (!document.getElementById('mdNavToggle')) {
            var button = document.createElement('button');
            button.id = 'mdNavToggle';
            button.type = 'button';
            button.innerHTML = ICON;
            button.setAttribute('aria-controls', 'app-nav');
            button.setAttribute('aria-label', n.getAttribute('aria-label') || 'Menu');
            button.addEventListener('click', function () {
                setOpen(!isOpen());
            });
            var skip = header.querySelector('.sr-only');
            header.insertBefore(button, skip ? skip.nextSibling : header.firstChild);
        }
        if (!document.getElementById('mdNavBackdrop')) {
            var backdrop = document.createElement('div');
            backdrop.id = 'mdNavBackdrop';
            backdrop.addEventListener('click', function () {
                setOpen(false);
            });
            document.body.appendChild(backdrop);
        }
        if (!n.dataset.mdReady) {
            n.dataset.mdReady = '1';
            // Choosing a page closes the menu; items that only open a
            // submenu (Settings, Statistics… have href="#") leave it open
            n.addEventListener('click', function (e) {
                var link = phone.matches && e.target.closest('a[href]');
                if (link && link.getAttribute('href') !== '#') {
                    setOpen(false);
                }
            });
        }
        setOpen(isOpen());
    }

    /* Another control of the header (journal switcher, help, tasks, user
       menu) opens its own menu: the side menu closes so the two do not
       overlap. Added once on the document, since Vue may redraw the header. */
    document.addEventListener('click', function (e) {
        if (!isOpen() || !e.target.closest) {
            return;
        }
        var control = e.target.closest('.app__header a, .app__header button, .app__header [role="button"]');
        if (control && control.id !== 'mdNavToggle') {
            setOpen(false);
        }
    }, true);

    /* Tables shown as cards (mobile.css): each cell gets its column title
       as a label. Skipped: the name cell, the first column when it is not a
       number, action/menu columns, full-row cells and long texts
       (descriptions), which speak for themselves, and labels that only
       repeat the title or belong to the only column with text. */
    function norm(text) {
        return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // Visible text without the screen-reader-only parts (e.g. "Sort")
    function ownText(el) {
        var copy = el.cloneNode(true);
        copy.querySelectorAll('.sr-only, .-screenReader, .pkp_screen_reader').forEach(function (e) {
            e.remove();
        });
        return copy.textContent.replace(/\s+/g, ' ').trim();
    }

    // Title of the page or of the side panel containing el
    function pageTitle(el) {
        var scope = el.closest('.DialogContent') || el.closest('.app__main') || document;
        var h1 = Array.prototype.find.call(scope.querySelectorAll('h1'), function (h) {
            return h.getClientRects().length;
        });
        return h1 ? norm(ownText(h1)) : '';
    }

    /* A box heading that repeats the title of the page or panel (e.g.
       "Tasks" under "Tasks", "Counter R5 Reports" under "Counter R5 Reports")
       is hidden; if the box header holds nothing else, the whole header. */
    function markDuplicateTitles() {
        document.querySelectorAll('.app__main .pkp_controllers_grid > .header > h4, .DialogContent .pkp_controllers_grid > .header > h4, .app__main .listPanel__header h2, .DialogContent .listPanel__header h2').forEach(function (h) {
            var title = pageTitle(h);
            var dup = !!title && norm(ownText(h)) === title;
            var header = h.closest('.header, .listPanel__header');
            h.classList.toggle('md-dup-title', dup);
            if (header) {
                header.classList.toggle('md-dup-head', dup && !header.querySelector('button, a, input, select'));
            }
        });
        // A tab whose content starts with its own name as a heading (DOIs > Articles)
        document.querySelectorAll('.app__main [role="tabpanel"] > h1:first-child').forEach(function (h) {
            var panel = h.parentElement;
            var box = panel.closest('.pkpTabs');
            var tab = box && Array.prototype.find.call(box.querySelectorAll('[role="tab"]'), function (t) {
                return t.getAttribute('aria-controls') === panel.id;
            });
            h.classList.toggle('md-dup-title', !!tab && norm(ownText(tab)) === norm(ownText(h)));
        });
    }

    /* Navigation menus (Edit, Add Menu): the "Assigned / Unassigned Menu
       Items" headings open and close their list. Assigned starts open,
       Unassigned (the long one) closed. */
    var navListCount = 0;

    function setNavListOpen(column, open) {
        column.classList.toggle('md-nav-closed', !open);
        var header = column.querySelector(':scope > .md-nav-toggle');
        if (header) {
            header.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }

    function ensureNavLists() {
        document.querySelectorAll('.pkp_nav_management > .pkp_nav_assigned, .pkp_nav_management > .pkp_nav_unassigned').forEach(function (column) {
            var header = column.querySelector(':scope > .pkp_nav_management_header');
            var list = column.querySelector(':scope > ul');
            if (!header || !list || header.classList.contains('md-nav-toggle')) {
                return;
            }
            if (!list.id) {
                list.id = 'mdNavList' + (++navListCount);
            }
            header.classList.add('md-nav-toggle');
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            header.setAttribute('aria-controls', list.id);
            header.insertAdjacentHTML('beforeend', CHEVRON);
            header.addEventListener('click', function () {
                setNavListOpen(column, column.classList.contains('md-nav-closed'));
            });
            header.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setNavListOpen(column, column.classList.contains('md-nav-closed'));
                }
            });
            setNavListOpen(column, column.classList.contains('pkp_nav_assigned'));
        });
    }

    /* Statistics charts (Chart.js) on phones: at most 3 dates under the
       chart, and without the year when all the dates share it (it is in the
       date range above the chart), so long dates ("22 October 2026") do not
       overlap. A Chart.js plugin applies it before every drawing, also after
       a resize or new data; above 900 px each chart keeps its own settings. */
    var YEAR = /(^|\s)\d{4}(?=\s|$)/;

    function sameYear(labels) {
        var first = null;
        return labels.length > 0 && labels.every(function (label) {
            var m = String(label).match(YEAR);
            if (!m) {
                return false;
            }
            first = first || m[0].trim();
            return m[0].trim() === first;
        });
    }

    // The chart's own label, without the year when all the dates share it
    function shortTicks(own) {
        return function (value, index, all) {
            var label = typeof own === 'function' ? own.call(this, value, index, all) : this.getLabelForValue(value);
            if (typeof label !== 'string' || !sameYear(this.chart.data.labels || [])) {
                return label;
            }
            return label.replace(YEAR, ' ').replace(/[\s,.]+$/, '').trim() || label;
        };
    }

    var chartsReady = false;
    var tickLimits = window.WeakMap ? new WeakMap() : null;

    function findChart(vnode, depth) {
        if (!vnode || depth > 400) {
            return null;
        }
        var found = null;
        var comp = vnode.component;
        if (comp) {
            var ref = comp.exposed && comp.exposed.chart;
            var chart = ref && (ref.value !== undefined ? ref.value : ref);
            if (chart && chart.constructor && typeof chart.constructor.register === 'function') {
                return chart;
            }
            return findChart(comp.subTree, depth + 1);
        }
        if (Array.isArray(vnode.children)) {
            vnode.children.some(function (child) {
                found = findChart(child, depth + 1);
                return found;
            });
        }
        return found || (vnode.suspense ? findChart(vnode.suspense.activeBranch, depth + 1) : null);
    }

    function phoneTicks(chart) {
        var x = chart.config && chart.config.options && chart.config.options.scales && chart.config.options.scales.x;
        var ticks = x && x.ticks;
        if (!ticks || !tickLimits) {
            return;
        }
        if (phone.matches) {
            if (!tickLimits.has(ticks)) {
                tickLimits.set(ticks, {limit: ticks.maxTicksLimit, callback: ticks.callback, phone: shortTicks(ticks.callback)});
            }
            var mine = tickLimits.get(ticks);
            if (ticks.maxTicksLimit !== 3) {
                ticks.maxTicksLimit = 3;
            }
            if (ticks.callback !== mine.phone) {
                ticks.callback = mine.phone;
            }
        } else if (tickLimits.has(ticks)) {
            var own = tickLimits.get(ticks);
            ticks.maxTicksLimit = own.limit;
            ticks.callback = own.callback;
            tickLimits.delete(ticks);
        }
    }

    function ensureCharts() {
        if (chartsReady || !document.querySelector('.app__main canvas')) {
            return;
        }
        var root = document.getElementById('app');
        var chart = null;
        try {
            chart = root && findChart(root._vnode, 0);
        } catch (e) {
            chart = null;
        }
        if (!chart) {
            return;
        }
        chartsReady = true;
        var Chart = chart.constructor;
        Chart.register({id: 'mdPhoneTicks', beforeUpdate: phoneTicks});
        Object.keys(Chart.instances || {}).forEach(function (id) {
            Chart.instances[id].update();
        });
    }

    function labelTables() {
        document.querySelectorAll('.DialogContent table, .app__main table.border-separate, .app__main .pkp_controllers_grid table').forEach(function (table) {
            var heads = table.querySelectorAll('thead th');
            if (!heads.length) {
                return;
            }
            var names = Array.prototype.map.call(heads, ownText);
            // Titles a label must not repeat: the page and the box heading
            var grid = table.closest('.pkp_controllers_grid');
            var gridHead = grid && grid.querySelector(':scope > .header h4');
            var titles = [pageTitle(table), gridHead ? norm(ownText(gridHead)) : ''];
            // Only one column with text (the others are checkboxes): no labels
            var first = table.querySelector('tbody tr');
            var textColumns = 0;
            if (first) {
                Array.prototype.forEach.call(first.children, function (cell) {
                    if (cell.textContent.trim() || !cell.querySelector('input[type="checkbox"]')) {
                        textColumns++;
                    }
                });
            }
            // Name in the first column and ⋯ menu at the end (e.g. Users & Roles)
            if (first && table.closest('.app__main') && table.classList.contains('border-separate')) {
                var cells = first.children;
                table.classList.toggle('md-named', cells.length > 2
                    && !/^\d+$/.test(cells[0].textContent.trim())
                    && !!cells[cells.length - 1].querySelector('button[aria-haspopup]'));
            }
            table.querySelectorAll('tbody tr').forEach(function (row) {
                Array.prototype.forEach.call(row.children, function (cell, i) {
                    var label = names[i] || '';
                    var text = cell.textContent.trim();
                    if ((i === 0 && !/^\d+$/.test(text)) || cell.hasAttribute('colspan') || cell.getAttribute('scope') === 'row'
                        || /action|azion/i.test(label) || cell.querySelector('button[aria-haspopup="menu"]')
                        || (!text && !cell.querySelector('input')) || cell.querySelector('label')
                        || text.length > 60 || /descri|beschreib/i.test(label)
                        || textColumns < 2 || titles.indexOf(norm(label)) !== -1) {
                        label = '';
                    }
                    if ((cell.getAttribute('data-md-label') || '') !== label) {
                        if (label) {
                            cell.setAttribute('data-md-label', label);
                        } else {
                            cell.removeAttribute('data-md-label');
                        }
                    }
                });
            });
        });
    }

    /* Workflow on phones: the stage menu (Submission, Review…, Publication)
       becomes a "☰ current stage ▾" bar that opens and closes the list. */
    var CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';
    var stageCount = 0;

    function stageName(nav) {
        var active = nav.querySelector('a.bg-selection-dark');
        return active ? active.textContent.replace(/\s+/g, ' ').trim() : '';
    }

    function setStagesOpen(column, open) {
        column.classList.toggle('md-stages-closed', !open);
        var button = column.querySelector(':scope > .mdStagesToggle');
        if (button) {
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }

    function ensureStageMenus() {
        document.querySelectorAll('.DialogContent .pkp-modal-scroll-container nav').forEach(function (nav) {
            var column = nav.parentElement;
            if (!column) {
                return;
            }
            var button = column.querySelector(':scope > .mdStagesToggle');
            if (!button) {
                if (!nav.id) {
                    nav.id = 'mdStages' + (++stageCount);
                }
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'mdStagesToggle';
                button.setAttribute('aria-controls', nav.id);
                button.innerHTML = ICON + '<span class="mdStagesToggle__label"></span>' + CHEVRON;
                button.addEventListener('click', function () {
                    setStagesOpen(column, column.classList.contains('md-stages-closed'));
                });
                column.insertBefore(button, column.firstChild);
                setStagesOpen(column, false);
            }
            var name = stageName(nav) || 'Menu';
            var label = button.querySelector('.mdStagesToggle__label');
            if (label.textContent !== name) {
                label.textContent = name;
            }
        });
    }

    /* Side panels on phones: mobile.css scrolls the whole panel instead of
       the inner .pkp-modal-scroll-container. OJS, however, scrolls that
       container when it brings a field into view ("Go to error"): it reads
       and writes its scrollTop. Here the container's scrollTop is redirected
       to the panel, so OJS picks the field as usual and the scrolling happens
       on the right element. Above 900 px, and outside panels, the container
       behaves as in stock OJS. */
    var nativeScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');

    function bridgeModalScroll() {
        if (!nativeScrollTop || !nativeScrollTop.get || !nativeScrollTop.set) {
            return;
        }
        document.querySelectorAll('.DialogContent .pkp-modal-scroll-container').forEach(function (inner) {
            if (inner.mdScrollBridge) {
                return;
            }
            inner.mdScrollBridge = true;
            // position of the container inside the panel content
            function target() {
                var panel = phone.matches && inner.closest('.DialogContent .shadow-xl');
                if (!panel) {
                    return null;
                }
                var offset = inner.getBoundingClientRect().top - panel.getBoundingClientRect().top
                    + nativeScrollTop.get.call(panel);
                return {panel: panel, offset: offset};
            }
            Object.defineProperty(inner, 'scrollTop', {
                configurable: true,
                get: function () {
                    var t = target();
                    return t ? nativeScrollTop.get.call(t.panel) - t.offset : nativeScrollTop.get.call(inner);
                },
                set: function (value) {
                    var t = target();
                    if (t) {
                        nativeScrollTop.set.call(t.panel, value + t.offset);
                    } else {
                        nativeScrollTop.set.call(inner, value);
                    }
                }
            });
        });
    }

    /* For rich-text fields (Title, Abstract…) OJS looks the field up with
       document.querySelector('[id*="…"]') and finds the textarea hidden
       behind the editor, which has no position: scrolling would end at the
       top of the panel (this also happens on desktop, in stock OJS). On
       phones, inside a panel, when the element found is hidden the visible
       field containing it is returned instead. */
    var nativeQuerySelector = document.querySelector;
    document.querySelector = function (selector) {
        var found = nativeQuerySelector.apply(this, arguments);
        if (found && phone.matches && typeof selector === 'string' && /^\[id\*="[^"]+"\]$/.test(selector)
            && found.offsetParent === null && found.closest('.DialogContent')) {
            var field = found.closest('.pkpFormField');
            if (field && field.offsetParent !== null) {
                return field;
            }
        }
        return found;
    };

    /* Tabs on phones: mobile.css puts them on one row that scrolls sideways
       and keeps it under the header. Here the active tab is brought into
       view; when the tab changes while the row is stuck under the header,
       the page goes back to the start of the new panel; and a sideways
       swipe on a panel opens the next or previous tab, as in phone apps.
       Works for the Vue tabs and for the older jQuery UI ones (Profile). */
    var TAB_BARS = '.app__main .pkpTabs__buttons, .app__main .ui-tabs-nav';
    var PANELS = '.pkpTab[role="tabpanel"], .ui-tabs-panel[role="tabpanel"]';
    // Boxes in the panels that scroll by themselves (see mobile.css)
    var SCROLLERS = ['table', '.pkp_controllers_grid', '.scrollable', '.overflow-auto'].map(function (box) {
        return '.app__main .pkpTab ' + box + ', .app__main .ui-tabs-panel ' + box;
    }).join(', ');
    var lastTab = window.WeakMap ? new WeakMap() : null;
    var swipe = null;
    var swallowClickUntil = 0;

    function reducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function zoomed() {
        return !!window.visualViewport && window.visualViewport.scale > 1.01;
    }

    function tabsOf(bar) {
        return Array.prototype.filter.call(bar.children, function (tab) {
            return tab.getAttribute('role') === 'tab' && tab.getClientRects().length > 0
                && tab.getAttribute('aria-disabled') !== 'true' && !tab.classList.contains('ui-state-disabled');
        });
    }

    function activeTab(bar) {
        return tabsOf(bar).filter(function (tab) {
            return tab.getAttribute('aria-selected') === 'true';
        })[0] || null;
    }

    // The panel of a tab, looked up among the panels of its own tabs: OJS
    // repeats ids (Site Settings: "setup" is Site Setup and Appearance > Setup)
    function panelOf(tab) {
        var id = tab && tab.getAttribute('aria-controls');
        if (!id) {
            return null;
        }
        var box = tab.closest('.pkpTabs, .ui-tabs');
        var own = box && Array.prototype.filter.call(box.querySelectorAll('[role="tabpanel"]'), function (panel) {
            return panel.id === id && panel.parentElement.closest('.pkpTabs, .ui-tabs') === box;
        })[0];
        return own || document.getElementById(id);
    }

    // Outside the panels (the grey page below a short one): the open panel
    // of the page's tabs, the innermost one
    function openPanel() {
        var bar = Array.prototype.filter.call(document.querySelectorAll(TAB_BARS), function (b) {
            return b.getClientRects().length > 0 && !b.parentElement.closest(PANELS);
        })[0];
        var panel = bar ? panelOf(activeTab(bar)) : null;
        while (panel) {
            var inner = Array.prototype.filter.call(panel.querySelectorAll('.pkpTabs__buttons, .ui-tabs-nav'), function (b) {
                return b.getClientRects().length > 0 && b.parentElement.closest(PANELS) === panel;
            })[0];
            var next = inner ? panelOf(activeTab(inner)) : null;
            if (!next || !panel.contains(next)) {
                break;
            }
            panel = next;
        }
        return panel;
    }

    // The tab row of a panel: Vue (also side tabs) or jQuery UI
    function barOf(panel) {
        var box = panel.parentElement && panel.parentElement.closest('.pkpTabs, .ui-tabs');
        return box ? box.querySelector(':scope > .pkpTabs__buttons, :scope > .ui-tabs-nav') : null;
    }

    // Centre the tab in its row (measured on screen: right-to-left too)
    function revealTab(bar, tab, smooth) {
        var b = bar.getBoundingClientRect();
        var t = tab.getBoundingClientRect();
        var delta = (t.left + t.width / 2) - (b.left + b.width / 2);
        if (Math.abs(delta) > 1 && bar.scrollWidth > bar.clientWidth) {
            bar.scrollBy({left: delta, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto'});
        }
    }

    // Row stuck under the header: back to the start of the tabs
    function showPanelTop(bar) {
        var style = getComputedStyle(bar);
        if (style.position !== 'sticky') {
            return;
        }
        var stuckAt = parseFloat(style.top) || 0;
        var top = bar.parentElement.getBoundingClientRect().top;
        if (top < stuckAt - 1) {
            window.scrollBy(0, top - stuckAt);
        }
    }

    function syncTabs() {
        if (!lastTab) {
            return;
        }
        document.querySelectorAll(TAB_BARS).forEach(function (bar) {
            var tab = activeTab(bar);
            if (!tab || lastTab.get(bar) === tab) {
                return;
            }
            var seen = lastTab.has(bar);
            lastTab.set(bar, tab);
            revealTab(bar, tab, seen);
            if (seen) {
                showPanelTop(bar);
            }
        });
        // Boxes wider than the panel scroll sideways under the finger
        document.querySelectorAll(SCROLLERS).forEach(function (box) {
            var wide = box.scrollWidth > box.clientWidth + 1;
            if (box.classList.contains('md-scroll-x') !== wide) {
                box.classList.toggle('md-scroll-x', wide);
            }
        });
    }

    // Something between the finger and the panel that scrolls sideways
    function scrollsSideways(el, panel) {
        for (; el && el !== panel; el = el.parentElement) {
            if (el.scrollWidth > el.clientWidth + 1) {
                var overflow = getComputedStyle(el).overflowX;
                if (overflow === 'auto' || overflow === 'scroll') {
                    return true;
                }
            }
        }
        return false;
    }

    function clearSwipeStyle(panel) {
        panel.style.transform = '';
        panel.style.opacity = '';
        panel.style.transition = '';
        panel.style.willChange = '';
    }

    function swipeDown(e) {
        if (swipe) {
            // a second finger (zoom): the swipe stops
            if (e.pointerType === 'touch' && e.pointerId !== swipe.id) {
                swipeEnd({type: 'pointercancel', pointerId: swipe.id, clientX: swipe.x, timeStamp: e.timeStamp});
            }
            return;
        }
        if (e.pointerType !== 'touch' || !e.isPrimary || !phone.matches || zoomed() || isOpen() || !e.target.closest) {
            return;
        }
        var target = e.target;
        if (target.closest('[role="tablist"], [role="dialog"], input[type="range"], .tox, iframe, canvas, video, audio, [draggable="true"], .-isOrdering, .ui-sortable')
            || e.clientX < 24 || e.clientX > window.innerWidth - 24) {
            return;
        }
        // A text field changes tab too, unless it is the one being typed
        // in: there the finger moves the cursor or selects text
        var field = target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
        if (field && (field === document.activeElement || field.contains(document.activeElement))) {
            return;
        }
        var selection = window.getSelection && window.getSelection();
        if (selection && !selection.isCollapsed && String(selection)) {
            return;
        }
        // The panels under the finger, innermost first, whose row has at
        // least two tabs (e.g. DOIs > Setup): the inner tabs change first,
        // past their last one the outer tabs do
        var levels = [];
        var panel = target.closest(PANELS);
        var outside = !panel;
        if (outside) {
            var page = target === document.body || target === document.documentElement || target.matches('.app, .app__body');
            if ((!page && !target.closest('.app__main')) || target.closest('.pkpTabs, .ui-tabs, a, button, label, [role="button"]')) {
                return;
            }
            panel = openPanel();
        }
        while (panel && panel.closest('.app__main')) {
            var bar = barOf(panel);
            var tabs = bar ? tabsOf(bar) : [];
            var index = bar ? tabs.indexOf(activeTab(bar)) : -1;
            if (tabs.length > 1 && index !== -1 && panelOf(tabs[index]) === panel) {
                levels.push({panel: panel, bar: bar, tabs: tabs, index: index, rtl: getComputedStyle(bar).direction === 'rtl'});
            }
            panel = panel.parentElement && panel.parentElement.closest(PANELS);
        }
        if (!levels.length || scrollsSideways(target, outside ? target.closest('.app__main') || target : levels[levels.length - 1].panel)) {
            return;
        }
        swipe = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            dx: 0,
            locked: false,
            levels: levels,
            level: null,
            track: [{x: e.clientX, t: e.timeStamp}]
        };
    }

    // The tab a sideways movement leads to (dragging left: the next one)
    function swipeTarget(level, dx) {
        var step = (dx < 0 ? 1 : -1) * (level.rtl ? -1 : 1);
        return level.tabs[level.index + step] || null;
    }

    function swipeMove(e) {
        var s = swipe;
        if (!s || e.pointerId !== s.id) {
            return;
        }
        var dx = e.clientX - s.x;
        var dy = e.clientY - s.y;
        if (!s.locked) {
            // Not yet more sideways than up or down: wait. If the page
            // scrolls, the browser cancels the pointer (touch-action: pan-y
            // in mobile.css); a slanted swipe that it leaves to the page,
            // as a thumb often makes, still changes tab
            if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) {
                return;
            }
            s.locked = true;
            s.level = s.levels.filter(function (level) {
                return swipeTarget(level, dx);
            })[0] || s.levels[0];
            s.width = s.level.panel.getBoundingClientRect().width || window.innerWidth;
            s.level.panel.style.transition = 'none';
            s.level.panel.style.willChange = 'transform';
        }
        s.track.push({x: e.clientX, t: e.timeStamp});
        while (s.track.length > 2 && e.timeStamp - s.track[0].t > 100) {
            s.track.shift();
        }
        // no tab that way: the panel resists
        s.dx = swipeTarget(s.level, dx) ? dx : dx / 3;
        s.level.panel.style.transform = 'translateX(' + s.dx + 'px)';
        s.level.panel.style.opacity = String(1 - Math.min(Math.abs(s.dx) / s.width, 1) * .3);
    }

    function swipeEnd(e) {
        var s = swipe;
        if (!s || e.pointerId !== s.id) {
            return;
        }
        swipe = null;
        if (!s.locked) {
            return;
        }
        var level = s.level;
        var dx = s.dx;
        var first = s.track[0];
        var speed = (e.clientX - first.x) / Math.max(e.timeStamp - first.t, 1);
        var next = swipeTarget(level, dx);
        var far = Math.abs(dx) >= s.width * .25;
        var flick = Math.abs(dx) >= 30 && Math.abs(speed) >= .35 && (speed < 0) === (dx < 0);
        clearSwipeStyle(level.panel);
        if (e.type === 'pointerup' && next && (far || flick)) {
            (next.matches('a, button') ? next : next.querySelector('a') || next).click();
            requestAnimationFrame(function () {
                showPanelTop(level.bar);
                var panel = panelOf(activeTab(level.bar));
                if (panel && panel !== level.panel && panel.animate && !reducedMotion()) {
                    panel.animate([
                        {transform: 'translateX(' + ((dx < 0 ? s.width : -s.width) + dx) + 'px)', opacity: .7},
                        {transform: 'none', opacity: 1}
                    ], {duration: 220, easing: 'cubic-bezier(.2, .7, .3, 1)'});
                }
            });
        } else if (dx && level.panel.animate && !reducedMotion()) {
            level.panel.animate([
                {transform: 'translateX(' + dx + 'px)', opacity: 1 - Math.min(Math.abs(dx) / s.width, 1) * .3},
                {transform: 'none', opacity: 1}
            ], {duration: 180, easing: 'ease-out'});
        }
        // the finger lifted after a swipe is not a tap
        swallowClickUntil = performance.now() + 400;
    }

    // Keyboard or finger: OJS focuses a tab after a tap or a swipe too, so
    // mobile.css shows the focus marks of the tabs only after Tab or the
    // arrow keys (md-keyboard) and hides them again at the next touch
    var NAV_KEYS = ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

    function trackKeyboard() {
        var root = document.documentElement;
        document.addEventListener('keydown', function (e) {
            if (NAV_KEYS.indexOf(e.key) !== -1) {
                root.classList.add('md-keyboard');
            }
        }, true);
        document.addEventListener('pointerdown', function () {
            root.classList.remove('md-keyboard');
        }, true);
    }

    function startTabs() {
        trackKeyboard();
        document.addEventListener('pointerdown', swipeDown, true);
        document.addEventListener('pointermove', swipeMove, true);
        document.addEventListener('pointerup', swipeEnd, true);
        document.addEventListener('pointercancel', swipeEnd, true);
        document.addEventListener('click', function (e) {
            if (e.isTrusted && performance.now() < swallowClickUntil) {
                swallowClickUntil = 0;
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
        if (window.visualViewport) {
            var onZoom = function () {
                document.documentElement.classList.toggle('md-zoomed', zoomed());
            };
            window.visualViewport.addEventListener('resize', onZoom);
            onZoom();
        }
        var resizing = false;
        window.addEventListener('resize', function () {
            if (!resizing) {
                resizing = true;
                requestAnimationFrame(function () {
                    resizing = false;
                    if (phone.matches) {
                        syncTabs();
                    }
                });
            }
        });
    }

    function start() {
        ensureControls();
        labelTables();
        markDuplicateTitles();
        bridgeModalScroll();
        startTabs();
        if (phone.matches) {
            ensureStageMenus();
            ensureNavLists();
            ensureCharts();
            syncTabs();
        }
        var pending = false;
        new MutationObserver(function () {
            if (pending) {
                return;
            }
            pending = true;
            requestAnimationFrame(function () {
                pending = false;
                bridgeModalScroll();
                if (phone.matches) {
                    labelTables();
                    markDuplicateTitles();
                    ensureStageMenus();
                    ensureNavLists();
                    ensureCharts();
                    syncTabs();
                }
                if (!document.getElementById('mdNavToggle') || (nav() && !nav().dataset.mdReady)) {
                    ensureControls();
                }
            });
        }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected']});

        /* Workflow on phones: once a stage is chosen, the stage menu closes and
           the panel goes back to the stage bar, with the content right below.
           Items that open a submenu (Workflow, Review, Publication…) close
           nothing. */
        document.addEventListener('click', function (e) {
            if (!phone.matches || !e.target.closest) {
                return;
            }
            var link = e.target.closest('.DialogContent .pkp-modal-scroll-container nav a');
            if (!link || link.closest('[data-pc-section="header"]')) {
                return;
            }
            var item = link.closest('li');
            if (item && item.hasAttribute('aria-expanded')) {
                return;
            }
            var column = link.closest('nav').parentElement;
            var panel = link.closest('.DialogContent .shadow-xl');
            if (!column || !panel) {
                return;
            }
            setStagesOpen(column, false);
            setTimeout(function () {
                ensureStageMenus();
                var offset = column.getBoundingClientRect().top - panel.getBoundingClientRect().top;
                if (offset < 0) {
                    panel.scrollTo({top: panel.scrollTop + offset - 8, behavior: 'smooth'});
                }
            }, 300);
        });

        /* Step bar (decisions, submission wizard): OJS decides whether to
           collapse it into "1/3 steps" by measuring the labels when it opens; if
           the font has not loaded yet the measurement is wrong. When the fonts
           are ready the bar changes width by 1px for an instant, so OJS
           measures it again. */
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                if (!phone.matches) {
                    return;
                }
                document.querySelectorAll('.pkpSteps').forEach(function (steps) {
                    steps.style.paddingRight = '1px';
                    setTimeout(function () {
                        steps.style.paddingRight = '';
                    }, 150);
                });
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) {
                setOpen(false);
                var button = document.getElementById('mdNavToggle');
                if (button) {
                    button.focus();
                }
            }
        });

        var onChange = function () {
            if (!phone.matches) {
                setOpen(false);
                var n = nav();
                if (n) {
                    n.removeAttribute('inert');
                }
            } else {
                setOpen(isOpen());
                // tables, workflow and tabs opened while the screen was wide
                labelTables();
                markDuplicateTitles();
                ensureStageMenus();
                ensureNavLists();
                ensureCharts();
                syncTabs();
            }
        };
        if (phone.addEventListener) {
            phone.addEventListener('change', onChange);
        } else {
            phone.addListener(onChange);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
