/*
 * 自定义下拉框（终端风格）
 * 只接管 <select class="select"> 的展开与选项渲染，不改变任何业务逻辑：
 * 选中后仍然写回原生 select.value 并派发 change 事件，原有 onchange 处理器照常工作。
 */
(() => {
    const SELECTOR = 'select.select';
    const PANEL = 'csel-panel';
    let panel = null;
    let openedFor = null;
    let openedAt = 0;

    const isSelect = (el) => !!el && el.tagName === 'SELECT' && el.classList.contains('select');

    const close = () => {
        if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
        panel = null;
        if (openedFor) openedFor.classList.remove('csel-open');
        openedFor = null;
    };

    const optionText = (opt) => {
        const t = (opt.textContent || '').replace(/\s+/g, ' ').trim();
        return t || opt.label || '';
    };

    const place = (sel) => {
        const r = sel.getBoundingClientRect();
        const width = Math.max(r.width, 132);
        let left = r.left;
        if (left + width > window.innerWidth - 6) left = Math.max(6, window.innerWidth - width - 6);
        // 先放下去，量出真实高度再决定往上还是往下
        panel.style.width = width + 'px';
        panel.style.left = left + 'px';
        panel.style.top = r.bottom + 2 + 'px';
        panel.style.maxHeight = '260px';
        const ph = Math.min(panel.scrollHeight, 260);
        const below = window.innerHeight - r.bottom;
        if (below < ph + 8 && r.top > ph + 8) {
            panel.style.top = Math.max(6, r.top - ph - 2) + 'px';
        }
    };

    const open = (sel) => {
        if (!sel || sel.disabled) return;
        if (panel && openedFor === sel) return;
        close();
        openedFor = sel;
        openedAt = Date.now();
        sel.classList.add('csel-open');

        panel = document.createElement('div');
        panel.className = PANEL;
        panel.setAttribute('role', 'listbox');

        const opts = Array.prototype.slice.call(sel.options || []);
        if (!opts.length) {
            const empty = document.createElement('div');
            empty.className = 'csel-empty';
            empty.textContent = '—';
            panel.appendChild(empty);
        }
        opts.forEach((opt, i) => {
            const row = document.createElement('div');
            row.className = 'csel-opt';
            row.setAttribute('role', 'option');
            if (i === sel.selectedIndex) row.classList.add('is-selected');
            if (opt.disabled) row.classList.add('is-disabled');
            row.dataset.value = opt.value;
            row.dataset.index = String(i);
            const text = document.createElement('span');
            text.className = 'csel-opt-text';
            text.textContent = optionText(opt);
            row.appendChild(text);
            row.addEventListener('mousedown', (e) => e.preventDefault());
            row.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                pick(sel, i);
            });
            panel.appendChild(row);
        });

        document.body.appendChild(panel);
        place(sel);
        panel.style.visibility = 'visible';
        requestAnimationFrame(() => panel && panel.classList.add('is-open'));
        sel.focus({ preventScroll: true });
        const active = panel.querySelector('.is-selected') || panel.querySelector('.csel-opt');
        if (active && panel.scrollHeight > panel.clientHeight) {
            panel.scrollTop = Math.max(0, active.offsetTop - panel.clientHeight / 2);
        }
    };

    const pick = (sel, index) => {
        const opt = sel.options[index];
        if (!opt || opt.disabled) return;
        const changed = sel.selectedIndex !== index;
        sel.selectedIndex = index;
        close();
        if (changed) {
            sel.dispatchEvent(new Event('input', { bubbles: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    const move = (sel, step) => {
        const rows = Array.prototype.slice.call(panel ? panel.querySelectorAll('.csel-opt') : []);
        if (!rows.length) return;
        let cur = rows.findIndex((r) => Number(r.dataset.index) === sel.selectedIndex);
        if (cur < 0) cur = 0;
        let next = cur + step;
        while (next >= 0 && next < rows.length && sel.options[Number(rows[next].dataset.index)].disabled) next += step;
        if (next < 0 || next >= rows.length) return;
        const idx = Number(rows[next].dataset.index);
        sel.selectedIndex = idx;
        rows.forEach((r) => r.classList.toggle('is-selected', Number(r.dataset.index) === idx));
        const row = rows[next];
        if (row.offsetTop < panel.scrollTop) panel.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > panel.scrollTop + panel.clientHeight) {
            panel.scrollTop = row.offsetTop + row.offsetHeight - panel.clientHeight;
        }
    };

    // 触摸设备：拦下 touchstart，避免系统原生选择器弹出
    document.addEventListener('touchstart', (e) => {
        const sel = e.target && e.target.closest ? e.target.closest(SELECTOR) : null;
        if (!sel) return;
        e.preventDefault();
        if (panel && openedFor === sel) close();
        else open(sel);
    }, { capture: true, passive: false });

    document.addEventListener('mousedown', (e) => {
        const sel = e.target && e.target.closest ? e.target.closest(SELECTOR) : null;
        if (sel) {
            e.preventDefault();
            if (panel && openedFor === sel) close();
            else open(sel);
            return;
        }
        if (panel && !e.target.closest('.' + PANEL)) close();
    }, true);

    document.addEventListener('click', (e) => {
        const sel = e.target && e.target.closest ? e.target.closest(SELECTOR) : null;
        if (!sel) return;
        // 鼠标/键盘触发的兜底（触摸已被 touchstart 处理）
        if (Date.now() - openedAt < 400) return;
        e.preventDefault();
        open(sel);
    }, true);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel) {
            const sel = openedFor;
            close();
            sel && sel.focus({ preventScroll: true });
            return;
        }
        const sel = e.target && isSelect(e.target) ? e.target : null;
        if (!sel) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
            if (!panel || openedFor !== sel) {
                if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    open(sel);
                    return;
                }
                return;
            }
            e.preventDefault();
            if (e.key === 'ArrowDown') move(sel, 1);
            else if (e.key === 'ArrowUp') move(sel, -1);
            else { close(); }
        }
    }, true);

    // 滚动 / 尺寸变化时收起，避免面板与触发器脱节
    const onScroll = (e) => {
        if (!panel) return;
        if (e && e.target && e.target.closest && e.target.closest('.' + PANEL)) return;
        close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', () => close());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => close());

    // 页面切换/弹窗关闭时兜底收起
    document.addEventListener('visibilitychange', () => close());

    /*
     * 触发器上的选中文字居中
     *
     * 实测 Blink 会忽略 <select> 自身的 text-align（left / center 渲染逐像素一致），
     * 唯一有效的是 text-indent，所以这里用 canvas 量出当前选项的实际文字宽度，
     * 再按「(内容宽 - 文字宽) / 2」写缩进。CSS 侧已把左右 padding 调成等距，
     * 缩进算出来就是真正的视觉居中。
     */
    const CENTER_SCOPE = '.actions-buttons .select';
    const measureCtx = document.createElement('canvas').getContext('2d');
    const ctxSupportsLetterSpacing = !!(measureCtx && 'letterSpacing' in measureCtx);

    const measureTextWidth = (sel) => {
        const opt = sel.options[sel.selectedIndex];
        const text = opt ? optionText(opt) : '';
        if (!text || !measureCtx) return 0;
        const cs = getComputedStyle(sel);
        measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const ls = parseFloat(cs.letterSpacing) || 0;
        if (ctxSupportsLetterSpacing) measureCtx.letterSpacing = ls ? `${ls}px` : '0px';
        let w = measureCtx.measureText(text).width;
        if (!ctxSupportsLetterSpacing && ls) w += ls * (text.length - 1);
        return w;
    };

    const centerOne = (sel) => {
        const cs = getComputedStyle(sel);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const bw = sel.offsetWidth;                                     // border box
        const bl = parseFloat(cs.borderLeftWidth) || 0;
        const pl = parseFloat(cs.paddingLeft) || 0;
        const avail = bw - bl - (parseFloat(cs.borderRightWidth) || 0)
            - pl - (parseFloat(cs.paddingRight) || 0);                  // 文字可用宽度
        if (avail <= 0) return;
        const w = measureTextWidth(sel);
        // 文字超出内容盒时保持 0，交给 text-overflow 右侧省略
        const raw = w >= avail ? 0 : (bw - w) / 2 - bl - pl;
        const next = Math.max(0, Math.round(raw)) + 'px';
        if (sel.style.textIndent !== next) sel.style.textIndent = next;
    };

    const centerSelects = () => {
        document.querySelectorAll(CENTER_SCOPE).forEach(centerOne);
    };

    let centerTimer = 0;
    const queueCenter = () => {
        if (centerTimer) return;
        // 用 setTimeout 而不是 rAF：后台标签页/无头环境里 rAF 会被完全冻结，
        // 导致语言切换、选项变化后缩进一直停在旧值
        centerTimer = setTimeout(() => {
            centerTimer = 0;
            centerSelects();
        }, 16);
    };

    // 选项数量/文案变化（i18n 回填）、select 被显示隐藏或改宽度时都要重算
    const centerObserver = new MutationObserver(queueCenter);
    const watchCenters = () => {
        document.querySelectorAll(CENTER_SCOPE).forEach((sel) => {
            centerObserver.observe(sel, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        });
    };

    document.addEventListener('change', (e) => {
        const sel = e.target;
        if (isSelect(sel) && sel.closest('.actions-buttons')) queueCenter();
    }, true);
    window.addEventListener('resize', queueCenter);

    const initCenters = () => {
        watchCenters();
        centerSelects();
        // 字体没就绪 / i18n 稍后才回填，补两次
        setTimeout(centerSelects, 300);
        setTimeout(centerSelects, 1200);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCenters);
    } else {
        initCenters();
    }
})();
