/* Dashboard UI localization. PRD s8: multi-language including regional Indian languages.
   Add a locale by adding a key here; the picker updates automatically. */

export const LOCALES = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  kn: 'ಕನ್ನಡ',
  ar: 'العربية',
};

/** Right-to-left locales get dir="rtl" on <html>. */
export const RTL = new Set(['ar']);

const STRINGS = {
  en: {
    'nav.operate': 'Operate', 'nav.content': 'Content', 'nav.org': 'Organization', 'nav.platform': 'Platform',
    'nav.overview': 'Overview', 'nav.screens': 'Screens', 'nav.media': 'Media Library',
    'nav.playlists': 'Playlists', 'nav.tickers': 'Flash News', 'nav.schedules': 'Scheduling',
    'nav.branches': 'Branches', 'nav.analytics': 'Analytics', 'nav.team': 'Team & Roles',
    'nav.billing': 'Billing', 'nav.audit': 'Audit Log', 'nav.settings': 'Settings', 'nav.admin': 'Platform Admin',
    'action.signout': 'Sign out', 'action.opentv': 'Open TV player', 'action.skip': 'Skip to main content',
    'common.loading': 'Loading…', 'common.language': 'Language',
    'screens.add': '+ Add New Screen', 'screens.bulk': 'Bulk publish',
    'screens.online': '{n} online', 'screens.offline': '{n} offline',
    'stat.total_screens': 'Total screens', 'stat.online_now': 'Online now',
    'stat.playlists': 'Playlists', 'stat.publishes': 'Publishes (24h)',
  },
  hi: {
    'nav.operate': 'संचालन', 'nav.content': 'सामग्री', 'nav.org': 'संगठन', 'nav.platform': 'प्लेटफ़ॉर्म',
    'nav.overview': 'अवलोकन', 'nav.screens': 'स्क्रीन', 'nav.media': 'मीडिया लाइब्रेरी',
    'nav.playlists': 'प्लेलिस्ट', 'nav.tickers': 'फ्लैश समाचार', 'nav.schedules': 'शेड्यूलिंग',
    'nav.branches': 'शाखाएँ', 'nav.analytics': 'विश्लेषण', 'nav.team': 'टीम और भूमिकाएँ',
    'nav.billing': 'बिलिंग', 'nav.audit': 'ऑडिट लॉग', 'nav.settings': 'सेटिंग्स', 'nav.admin': 'प्लेटफ़ॉर्म एडमिन',
    'action.signout': 'साइन आउट', 'action.opentv': 'टीवी प्लेयर खोलें', 'action.skip': 'मुख्य सामग्री पर जाएँ',
    'common.loading': 'लोड हो रहा है…', 'common.language': 'भाषा',
    'screens.add': '+ नई स्क्रीन जोड़ें', 'screens.bulk': 'बल्क प्रकाशित करें',
    'screens.online': '{n} ऑनलाइन', 'screens.offline': '{n} ऑफ़लाइन',
    'stat.total_screens': 'कुल स्क्रीन', 'stat.online_now': 'अभी ऑनलाइन',
    'stat.playlists': 'प्लेलिस्ट', 'stat.publishes': 'प्रकाशन (24 घंटे)',
  },
  ta: {
    'nav.operate': 'செயல்பாடு', 'nav.content': 'உள்ளடக்கம்', 'nav.org': 'நிறுவனம்', 'nav.platform': 'தளம்',
    'nav.overview': 'மேலோட்டம்', 'nav.screens': 'திரைகள்', 'nav.media': 'ஊடக நூலகம்',
    'nav.playlists': 'பிளேலிஸ்ட்', 'nav.tickers': 'ஃபிளாஷ் செய்திகள்', 'nav.schedules': 'திட்டமிடல்',
    'nav.branches': 'கிளைகள்', 'nav.analytics': 'பகுப்பாய்வு', 'nav.team': 'குழு மற்றும் பணிகள்',
    'nav.billing': 'கட்டணம்', 'nav.audit': 'தணிக்கை பதிவு', 'nav.settings': 'அமைப்புகள்', 'nav.admin': 'தள நிர்வாகம்',
    'action.signout': 'வெளியேறு', 'action.opentv': 'டிவி பிளேயரைத் திற', 'action.skip': 'முதன்மை உள்ளடக்கத்திற்கு செல்',
    'common.loading': 'ஏற்றுகிறது…', 'common.language': 'மொழி',
    'screens.add': '+ புதிய திரை சேர்', 'screens.bulk': 'மொத்த வெளியீடு',
    'screens.online': '{n} இணைப்பில்', 'screens.offline': '{n} இணைப்பில் இல்லை',
    'stat.total_screens': 'மொத்த திரைகள்', 'stat.online_now': 'இப்போது இணைப்பில்',
    'stat.playlists': 'பிளேலிஸ்ட்', 'stat.publishes': 'வெளியீடுகள் (24ம)',
  },
  kn: {
    'nav.operate': 'ಕಾರ್ಯಾಚರಣೆ', 'nav.content': 'ವಿಷಯ', 'nav.org': 'ಸಂಸ್ಥೆ', 'nav.platform': 'ವೇದಿಕೆ',
    'nav.overview': 'ಅವಲೋಕನ', 'nav.screens': 'ಪರದೆಗಳು', 'nav.media': 'ಮಾಧ್ಯಮ ಗ್ರಂಥಾಲಯ',
    'nav.playlists': 'ಪ್ಲೇಪಟ್ಟಿ', 'nav.tickers': 'ಫ್ಲ್ಯಾಶ್ ಸುದ್ದಿ', 'nav.schedules': 'ವೇಳಾಪಟ್ಟಿ',
    'nav.branches': 'ಶಾಖೆಗಳು', 'nav.analytics': 'ವಿಶ್ಲೇಷಣೆ', 'nav.team': 'ತಂಡ ಮತ್ತು ಪಾತ್ರಗಳು',
    'nav.billing': 'ಬಿಲ್ಲಿಂಗ್', 'nav.audit': 'ಲೆಕ್ಕಪರಿಶೋಧನೆ', 'nav.settings': 'ಸಂಯೋಜನೆಗಳು', 'nav.admin': 'ವೇದಿಕೆ ನಿರ್ವಹಣೆ',
    'action.signout': 'ಸೈನ್ ಔಟ್', 'action.opentv': 'ಟಿವಿ ಪ್ಲೇಯರ್ ತೆರೆಯಿರಿ', 'action.skip': 'ಮುಖ್ಯ ವಿಷಯಕ್ಕೆ ಹೋಗಿ',
    'common.loading': 'ಲೋಡ್ ಆಗುತ್ತಿದೆ…', 'common.language': 'ಭಾಷೆ',
    'screens.add': '+ ಹೊಸ ಪರದೆ ಸೇರಿಸಿ', 'screens.bulk': 'ಬೃಹತ್ ಪ್ರಕಟಣೆ',
    'screens.online': '{n} ಆನ್‌ಲೈನ್', 'screens.offline': '{n} ಆಫ್‌ಲೈನ್',
    'stat.total_screens': 'ಒಟ್ಟು ಪರದೆಗಳು', 'stat.online_now': 'ಈಗ ಆನ್‌ಲೈನ್',
    'stat.playlists': 'ಪ್ಲೇಪಟ್ಟಿ', 'stat.publishes': 'ಪ್ರಕಟಣೆಗಳು (24ಗ)',
  },
  ar: {
    'nav.operate': 'التشغيل', 'nav.content': 'المحتوى', 'nav.org': 'المؤسسة', 'nav.platform': 'المنصة',
    'nav.overview': 'نظرة عامة', 'nav.screens': 'الشاشات', 'nav.media': 'مكتبة الوسائط',
    'nav.playlists': 'قوائم التشغيل', 'nav.tickers': 'الأخبار العاجلة', 'nav.schedules': 'الجدولة',
    'nav.branches': 'الفروع', 'nav.analytics': 'التحليلات', 'nav.team': 'الفريق والأدوار',
    'nav.billing': 'الفوترة', 'nav.audit': 'سجل التدقيق', 'nav.settings': 'الإعدادات', 'nav.admin': 'إدارة المنصة',
    'action.signout': 'تسجيل الخروج', 'action.opentv': 'فتح مشغل التلفاز', 'action.skip': 'تخطٍ إلى المحتوى',
    'common.loading': 'جارٍ التحميل…', 'common.language': 'اللغة',
    'screens.add': '+ إضافة شاشة جديدة', 'screens.bulk': 'نشر جماعي',
    'screens.online': '{n} متصل', 'screens.offline': '{n} غير متصل',
    'stat.total_screens': 'إجمالي الشاشات', 'stat.online_now': 'متصل الآن',
    'stat.playlists': 'قوائم التشغيل', 'stat.publishes': 'عمليات النشر (24س)',
  },
};

const stored = () => {
  try { return localStorage.getItem('bc_locale'); } catch { return null; }
};

export let locale = stored() || (typeof navigator !== 'undefined'
  ? (navigator.language || 'en').slice(0, 2) : 'en');
if (!STRINGS[locale]) locale = 'en';

export function setLocale(next) {
  if (!STRINGS[next]) return;
  locale = next;
  try { localStorage.setItem('bc_locale', next); } catch {}
  applyDocumentLocale();
}

export function applyDocumentLocale() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = RTL.has(locale) ? 'rtl' : 'ltr';
}

/** Translate a key, falling back to English then to the key itself. */
export function t(key, vars) {
  let s = STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Locale-aware number/date formatting. */
export const fmtNumber = (n) => new Intl.NumberFormat(locale).format(n ?? 0);
