const AVAILABLE_LANGS = {
    zh: "中文",
    en: "English",
    ja: '日本語',
    vi: "Tiếng Việt"
};

const DEFAULT_LANG = "zh";
const LANG_STORAGE_KEY = "kano_lang";
let currentLang = DEFAULT_LANG;
let translations = {};

function detectBrowserLang() {
    const lang = navigator.language || navigator.userLanguage;
    const shortLang = lang.slice(0, 2);
    return AVAILABLE_LANGS[shortLang] ? shortLang : DEFAULT_LANG;
}

async function loadLanguage(lang) {
    try {
        const res = await fetch(`/lang/${lang}.json`);
        translations = await res.json();
        currentLang = lang;
        localStorage.setItem(LANG_STORAGE_KEY, lang);
        applyTranslations();
        updateActiveLang(lang);
    } catch (e) {
        console.error(`Failed to load language: ${lang}`, e);
    }
}

function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (translations[key]) {
            el.textContent = translations[key];
        }
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (translations[key]) {
            el.placeholder = translations[key];
        }
    });
}

// 构建语言选择弹窗内的选项列表
function buildLangList() {
    const list = document.querySelector("#langList");
    if (!list) return;
    list.innerHTML = "";
    Object.entries(AVAILABLE_LANGS).forEach(([key, label]) => {
        const row = document.createElement("div");
        row.className = "lang-option";
        row.setAttribute("data-lang", key);
        row.setAttribute("role", "menuitemradio");

        const nameEl = document.createElement("span");
        nameEl.className = "lang-option-label";
        nameEl.textContent = label;

        const checkEl = document.createElement("span");
        checkEl.className = "lang-option-check";
        checkEl.textContent = "✓";

        row.appendChild(nameEl);
        row.appendChild(checkEl);
        row.addEventListener("click", () => {
            loadLanguage(key);
            closeLangModal();
        });
        list.appendChild(row);
    });
    updateActiveLang(currentLang);
}

// 高亮当前语言
function updateActiveLang(lang) {
    const list = document.querySelector("#langList");
    if (!list) return;
    list.querySelectorAll(".lang-option").forEach((row) => {
        row.classList.toggle("active", row.getAttribute("data-lang") === lang);
    });
}

// 打开语言选择弹窗（先关闭右上角用户菜单）
function openLangModal() {
    const menu = document.querySelector("#userMenu");
    if (menu) menu.style.display = "none";
    const btn = document.querySelector("#userMenuBtn");
    if (btn) btn.setAttribute("aria-expanded", "false");
    buildLangList();
    showModal("#langModal");
}

// 关闭语言选择弹窗
function closeLangModal() {
    closeModal("#langModal");
}

function t(key, fallback = "") {
    return translations[key] || fallback || key;
}

// 初始化
(function initI18n() {
    buildLangList();
    const savedLang = localStorage.getItem(LANG_STORAGE_KEY);
    const langToLoad = savedLang || detectBrowserLang();
    loadLanguage(langToLoad);
})();
