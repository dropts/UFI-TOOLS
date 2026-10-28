/**
 * 统一图标系统
 *
 * 设计约束：
 * - 全部为 24×24 线性矢量图标，`stroke="currentColor"`，颜色跟随所在元素，
 *   自动与 theme.js 注入的主题色联动，不写死任何色值。
 * - 不含任何 emoji：emoji 在不同 ROM / WebView 上字形差异极大，
 *   且无法跟随主题色、基线对不齐。这里统一改为矢量路径。
 * - kanoIcon() 返回可直接塞进 innerHTML 的字符串；
 *   HTML 静态节点用 data-icon="名字" 占位，加载后自动水合。
 */
(function () {
    'use strict';

    // 图标路径（只放 <path>/<circle>/<rect>/<line>，外壳由 kanoIcon 生成）
    var PATHS = {
        /* ---- 通用操作 ---- */
        'help':
            '<circle cx="12" cy="12" r="8.6"/>' +
            '<path d="M9.5 9.4a2.6 2.6 0 1 1 3.1 2.6c-.6.2-1 .8-1 1.5v.6"/>' +
            '<path d="M11.6 17.1h.01"/>',
        'eye':
            '<path d="M2.5 12S5.9 6 12 6s9.5 6 9.5 6-3.4 6-9.5 6S2.5 12 2.5 12Z"/>' +
            '<circle cx="12" cy="12" r="2.9"/>',
        'eye-off':
            '<path d="M4.2 4.2 19.8 19.8"/>' +
            '<path d="M9.9 6.3A9.4 9.4 0 0 1 12 6c6.1 0 9.5 6 9.5 6a17.6 17.6 0 0 1-3.1 3.9"/>' +
            '<path d="M6.4 7.9A17.2 17.2 0 0 0 2.5 12S5.9 18 12 18a9.4 9.4 0 0 0 3.7-.76"/>' +
            '<path d="M10.1 10.1a2.9 2.9 0 0 0 4 4"/>',
        'arrow-up':
            '<path d="M12 19.2V4.9"/>' +
            '<path d="M5.9 11 12 4.9 18.1 11"/>',
        'arrow-down':
            '<path d="M12 4.8v14.3"/>' +
            '<path d="M5.9 13 12 19.1 18.1 13"/>',
        'refresh':
            '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>' +
            '<path d="M21 3v5h-5"/>',
        'upload':
            '<path d="M12 16.2V4.6"/>' +
            '<path d="M7.5 9.1 12 4.6l4.5 4.5"/>' +
            '<path d="M4.7 15.2v2.7a1.7 1.7 0 0 0 1.7 1.7h11.2a1.7 1.7 0 0 0 1.7-1.7v-2.7"/>',
        'download':
            '<path d="M12 4.6v11.6"/>' +
            '<path d="M7.5 11.7 12 16.2l4.5-4.5"/>' +
            '<path d="M4.7 15.2v2.7a1.7 1.7 0 0 0 1.7 1.7h11.2a1.7 1.7 0 0 0 1.7-1.7v-2.7"/>',
        'ban':
            '<circle cx="12" cy="12" r="8.6"/>' +
            '<path d="M5.9 5.9 18.1 18.1"/>',
        'check':
            '<path d="M4.9 12.8 9.4 17.2 19.1 7.2"/>',
        'check-circle':
            '<circle cx="12" cy="12" r="8.6"/>' +
            '<path d="M8.1 12.4 10.8 15 15.9 9.4"/>',
        'x-circle':
            '<circle cx="12" cy="12" r="8.6"/>' +
            '<path d="M9.1 9.1 14.9 14.9"/>' +
            '<path d="M14.9 9.1 9.1 14.9"/>',
        'alert':
            '<path d="M12 4.5 20.7 19.3H3.3L12 4.5Z"/>' +
            '<path d="M12 9.7v4.2"/>' +
            '<path d="M12 16.6h.01"/>',
        'info':
            '<circle cx="12" cy="12" r="8.6"/>' +
            '<path d="M12 11.2v5.2"/>' +
            '<path d="M12 8.1h.01"/>',
        'lock':
            '<rect x="4.9" y="10.3" width="14.2" height="9.2" rx="2.1"/>' +
            '<path d="M8.4 10.3V7.9a3.6 3.6 0 0 1 7.2 0v2.4"/>',
        'key':
            '<circle cx="8.4" cy="15.6" r="3.5"/>' +
            '<path d="M10.9 13.1 19.2 4.8"/>' +
            '<path d="M16.3 7.7 18.3 9.7"/>' +
            '<path d="M14.3 9.7 16.3 11.7"/>',
        'bulb':
            '<path d="M9.4 16.9h5.2"/>' +
            '<path d="M10.2 19.6h3.6"/>' +
            '<path d="M12 3.9a5.5 5.5 0 0 0-3.1 10v3h6.2v-3A5.5 5.5 0 0 0 12 3.9Z"/>',
        'signal':
            '<path d="M4.6 19.4v-4.2"/>' +
            '<path d="M9.4 19.4v-7.1"/>' +
            '<path d="M14.2 19.4V8.2"/>' +
            '<path d="M19 19.4V5"/>',
        'user':
            '<circle cx="12" cy="8" r="3.6"/>' +
            '<path d="M5 20a7 7 0 0 1 14 0"/>',
        'chevron-down':
            '<path d="M5.5 9.5 12 16 18.5 9.5"/>',
        'power':
            '<path d="M12 3.6v7.2"/>' +
            '<path d="M7.3 6.6a7.4 7.4 0 1 0 9.4 0"/>',
        'restart':
            '<path d="M20.4 12a8.4 8.4 0 1 1-2.5-5.9"/>' +
            '<path d="M20.6 3.9v4.9h-4.9"/>'
    };

    /**
     * 生成一段 SVG 图标标记
     * @param {string} name  图标名，见 PATHS
     * @param {string} [cls] 附加 class
     * @param {string} [size] 尺寸，如 '18px'
     */
    function kanoIcon(name, cls, size) {
        var body = PATHS[name];
        if (!body) return '';
        var klass = 'ico' + (cls ? ' ' + cls : '');
        var style = size ? ' style="width:' + size + ';height:' + size + '"' : '';
        return '<svg class="' + klass + '" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
            'stroke-linejoin="round" aria-hidden="true" focusable="false"' + style + '>' +
            body + '</svg>';
    }

    /**
     * 信号格：level 0~5，亮起的格子为实色，未亮为低透明度。
     * 替代原来用表情方块拼接的信号强度串。
     */
    function kanoSignalBars(level) {
        var n = 5;
        var v = Math.round(Number(level));
        if (!isFinite(v)) v = 0;
        v = Math.max(0, Math.min(n, v));
        var html = '<span class="sigbars" aria-hidden="true">';
        for (var i = 0; i < n; i++) {
            var h = 4 + i * 2.7;
            html += '<i class="' + (i < v ? 'on' : '') + '" style="height:' + h.toFixed(1) + 'px"></i>';
        }
        return html + '</span>';
    }

    /** 状态圆点：ok / warn / off */
    function kanoDot(kind) {
        var map = { ok: 'kano-dot-ok', warn: 'kano-dot-warn', off: 'kano-dot-off', danger: 'kano-dot-danger' };
        return '<i class="kano-dot ' + (map[kind] || 'kano-dot-off') + '"></i>';
    }

    /** 把所有 data-icon 占位节点替换成矢量图标 */
    function hydrateIcons(root) {
        var scope = root || document;
        var nodes = scope.querySelectorAll('[data-icon]');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var name = el.getAttribute('data-icon');
            if (!name) continue;
            el.innerHTML = kanoIcon(name, el.getAttribute('data-icon-cls') || '', el.getAttribute('data-icon-size') || '');
            el.removeAttribute('data-icon');
        }
    }

    window.kanoIcon = kanoIcon;
    window.kanoSignalBars = kanoSignalBars;
    window.kanoDot = kanoDot;
    window.hydrateIcons = hydrateIcons;
    window.KANO_ICON_NAMES = Object.keys(PATHS);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { hydrateIcons(); });
    } else {
        hydrateIcons();
    }
    // scripts 位于 body 末尾，此时 DOM 已解析完，立即再水合一次以覆盖上面的分支
    hydrateIcons();
})();
