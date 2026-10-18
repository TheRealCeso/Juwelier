const supportedLanguages = new Set(["de", "en", "tr"]);
const languageSwitcher = document.querySelector(".language-switcher");
const languageTrigger = languageSwitcher?.querySelector(".language-trigger");
const languageMenu = languageSwitcher?.querySelector(".language-menu");
const languageCurrent = languageSwitcher?.querySelector(".language-current");
const languageCurrentFlag = languageSwitcher?.querySelector(".language-current-flag");
const languageOptions = [...(languageMenu?.querySelectorAll("[data-lang]") ?? [])];
const translatedBlocks = [...document.querySelectorAll("[data-i18n-html]")].map(element => ({
  element,
  key: element.dataset.i18nHtml,
  original: element.innerHTML
}));

const textNodes = [];
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode;
  if (!node.nodeValue.trim() || node.parentElement.closest("[data-i18n-html]")) continue;
  textNodes.push({ node, original: node.nodeValue, key: node.nodeValue.trim() });
}

const translatedAttributes = [...document.querySelectorAll("[aria-label], [alt], [placeholder]")].flatMap(element =>
  ["aria-label", "alt", "placeholder"]
    .filter(attribute => element.hasAttribute(attribute))
    .map(attribute => ({ element, attribute, original: element.getAttribute(attribute) }))
);
const titleOriginal = document.title;
const description = document.querySelector('meta[name="description"]');
const descriptionOriginal = description?.content;
const localLinks = [...document.querySelectorAll('a[href^="index.html"], a[href^="produkte.html"], a[href^="login.html"]')]
  .map(element => ({ element, original: element.getAttribute("href") }));

let activeLanguage = "de";
function translateText(source, language = activeLanguage) {
  if (language === "de") return source;
  const index = language === "en" ? 0 : 1;
  return UI_TRANSLATIONS.text[source]?.[index] ?? source;
}
window.translateUiText = translateText;

function applyLanguage(language, rememberChoice = false) {
  activeLanguage = supportedLanguages.has(language) ? language : "de";
  const index = activeLanguage === "en" ? 0 : 1;
  document.documentElement.lang = activeLanguage;

  for (const { node, original, key } of textNodes) {
    node.nodeValue = original.replace(key, translateText(key));
  }
  for (const { element, attribute, original } of translatedAttributes) {
    element.setAttribute(attribute, translateText(original));
  }
  for (const { element, key, original } of translatedBlocks) {
    element.innerHTML = activeLanguage === "de" ? original : UI_TRANSLATIONS.html[key][index];
  }
  if (languageCurrent) languageCurrent.textContent = activeLanguage.toUpperCase();
  if (languageCurrentFlag) languageCurrentFlag.src = `assets/flag-${activeLanguage}.svg`;
  for (const option of languageOptions) {
    option.setAttribute("aria-checked", String(option.dataset.lang === activeLanguage));
  }
  document.title = translateText(titleOriginal);
  if (description) description.content = translateText(descriptionOriginal);

  for (const { element, original } of localLinks) {
    const [page, hash] = original.split("#");
    element.setAttribute("href", page + (activeLanguage === "de" ? "" : `?lang=${activeLanguage}`) + (hash ? `#${hash}` : ""));
  }
  const url = new URL(window.location.href);
  if (activeLanguage === "de") url.searchParams.delete("lang");
  else url.searchParams.set("lang", activeLanguage);
  try { window.history.replaceState(null, "", url); } catch { /* Translation still works in restricted previews. */ }
  if (rememberChoice) {
    try { window.localStorage.setItem("juwelier-goek-language", activeLanguage); } catch { /* Browser storage can be unavailable. */ }
  }
  window.updateMenuLabel?.();
  document.dispatchEvent(new CustomEvent("juwelier-language-change", { detail: { language: activeLanguage } }));
}

const queryLanguage = new URL(window.location.href).searchParams.get("lang");
let storedLanguage;
try { storedLanguage = window.localStorage.getItem("juwelier-goek-language"); } catch { /* Browser storage can be unavailable. */ }
applyLanguage(supportedLanguages.has(queryLanguage) ? queryLanguage : storedLanguage);

function closeLanguageMenu(returnFocus = false) {
  if (!languageMenu || !languageTrigger) return;
  languageMenu.hidden = true;
  languageTrigger.setAttribute("aria-expanded", "false");
  if (returnFocus) languageTrigger.focus();
}

function openLanguageMenu(focusOption = true) {
  if (!languageMenu || !languageTrigger) return;
  languageMenu.hidden = false;
  languageTrigger.setAttribute("aria-expanded", "true");
  if (focusOption) languageOptions.find(option => option.dataset.lang === activeLanguage)?.focus();
}

languageTrigger?.addEventListener("click", () => {
  if (languageMenu.hidden) openLanguageMenu();
  else closeLanguageMenu(true);
});

languageTrigger?.addEventListener("keydown", event => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  openLanguageMenu();
  if (event.key === "ArrowUp") languageOptions.at(-1)?.focus();
});

for (const option of languageOptions) {
  option.addEventListener("click", () => {
    applyLanguage(option.dataset.lang, true);
    closeLanguageMenu(true);
  });
}

languageMenu?.addEventListener("keydown", event => {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const currentIndex = languageOptions.indexOf(document.activeElement);
  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? languageOptions.length - 1
    : event.key === "ArrowDown" ? (currentIndex + 1) % languageOptions.length
    : (currentIndex - 1 + languageOptions.length) % languageOptions.length;
  languageOptions[nextIndex]?.focus();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && languageMenu && !languageMenu.hidden) closeLanguageMenu(true);
});
document.addEventListener("pointerdown", event => {
  if (languageSwitcher && !languageSwitcher.contains(event.target)) closeLanguageMenu();
});
document.addEventListener("focusin", event => {
  if (languageSwitcher && !languageSwitcher.contains(event.target)) closeLanguageMenu();
});
