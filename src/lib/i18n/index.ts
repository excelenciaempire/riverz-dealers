export {
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NAMES,
  isLocale,
  type Locale,
} from "./config";
export { translate, type TFn, type TVars } from "./translate";
export { detectLocale } from "./detect";
