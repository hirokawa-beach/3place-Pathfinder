export const SUPPORTED_LANGUAGES = new Set(["auto", "ja", "en"]);

export const browserLanguage = () =>
  (navigator.languages?.[0] || navigator.language || "en")
    .toLowerCase()
    .startsWith("ja")
    ? "ja"
    : "en";

const readSavedLanguage = () => {
  try {
    const saved = JSON.parse(
      localStorage.getItem("3place-pathfinder-v1") || "null",
    )?.language;
    if (saved === "ja" || saved === "en") return saved;
  } catch {}
  return browserLanguage();
};

export let uiLanguage = readSavedLanguage();

export const setUiLanguage = (language) => {
  uiLanguage =
    language === "ja" || language === "en" ? language : browserLanguage();
};

export const tr = (japanese, english) =>
  uiLanguage === "en" ? english : japanese;
