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
    'screens.no_playlist': 'No playlist assigned', 'screens.last_sync': 'Last sync {t}',
    'screens.empty': 'No screens yet.', 'screens.publish_now': 'Publish now', 'screens.rollback': 'Rollback',
    'screens.unpair': 'Unpair', 'common.delete': 'Delete', 'common.edit': 'Edit', 'common.save': 'Save',
    'common.cancel': 'Cancel', 'common.preview': 'Preview', 'common.approve': 'Approve', 'common.export': 'Export CSV',
    'media.upload': '+ Upload media', 'media.link': 'Link CDN URL', 'media.empty': 'No media yet.',
    'media.versions': 'Version history', 'media.restore': 'Restore',
    'playlists.new': '+ New playlist', 'playlists.empty': 'No playlists yet.',
    'tickers.new': '+ New flash news', 'tickers.empty': 'No flash news yet.',
    'branches.new': '+ New branch', 'schedules.new': '+ New schedule', 'schedules.empty': 'No schedules.',
    'team.invite': '+ Invite member', 'team.pending': 'Pending invites',
    'billing.current_plan': 'Current plan', 'billing.active_screens': 'Active screens',
    'billing.next_invoice': 'Next invoice (est.)', 'billing.invoices': 'Invoices', 'billing.upgrade': 'Upgrade',
    'billing.downgrade': 'Downgrade', 'settings.org': 'Organization', 'settings.account': 'Your account',
    'analytics.fleet_uptime': 'Fleet uptime (30d)', 'analytics.screen_uptime': 'Screen uptime',
    'analytics.top_media': 'Top media by plays', 'analytics.playlist_perf': 'Playlist performance',
    'admin.tenants': 'Tenants', 'admin.health': 'Platform health', 'admin.support_login': 'Support login',
    'audit.title': 'Audit log',
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
    'screens.no_playlist': 'कोई प्लेलिस्ट असाइन नहीं', 'screens.last_sync': 'अंतिम सिंक {t}',
    'screens.empty': 'अभी कोई स्क्रीन नहीं।', 'screens.publish_now': 'अभी प्रकाशित करें', 'screens.rollback': 'वापस लें',
    'screens.unpair': 'अनपेयर करें', 'common.delete': 'हटाएँ', 'common.edit': 'संपादित करें', 'common.save': 'सहेजें',
    'common.cancel': 'रद्द करें', 'common.preview': 'पूर्वावलोकन', 'common.approve': 'स्वीकृत करें', 'common.export': 'CSV निर्यात',
    'media.upload': '+ मीडिया अपलोड करें', 'media.link': 'CDN लिंक जोड़ें', 'media.empty': 'अभी कोई मीडिया नहीं।',
    'media.versions': 'संस्करण इतिहास', 'media.restore': 'पुनर्स्थापित करें',
    'playlists.new': '+ नई प्लेलिस्ट', 'playlists.empty': 'अभी कोई प्लेलिस्ट नहीं।',
    'tickers.new': '+ नया फ्लैश समाचार', 'tickers.empty': 'अभी कोई फ्लैश समाचार नहीं।',
    'branches.new': '+ नई शाखा', 'schedules.new': '+ नया शेड्यूल', 'schedules.empty': 'कोई शेड्यूल नहीं।',
    'team.invite': '+ सदस्य आमंत्रित करें', 'team.pending': 'लंबित आमंत्रण',
    'billing.current_plan': 'वर्तमान योजना', 'billing.active_screens': 'सक्रिय स्क्रीन',
    'billing.next_invoice': 'अगला चालान (अनुमानित)', 'billing.invoices': 'चालान', 'billing.upgrade': 'अपग्रेड',
    'billing.downgrade': 'डाउनग्रेड', 'settings.org': 'संगठन', 'settings.account': 'आपका खाता',
    'analytics.fleet_uptime': 'फ्लीट अपटाइम (30 दिन)', 'analytics.screen_uptime': 'स्क्रीन अपटाइम',
    'analytics.top_media': 'शीर्ष मीडिया', 'analytics.playlist_perf': 'प्लेलिस्ट प्रदर्शन',
    'admin.tenants': 'किरायेदार', 'admin.health': 'प्लेटफ़ॉर्म स्वास्थ्य', 'admin.support_login': 'सहायता लॉगिन',
    'audit.title': 'ऑडिट लॉग',
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
    'screens.no_playlist': 'பிளேலிஸ்ட் ஒதுக்கப்படவில்லை', 'screens.last_sync': 'கடைசி ஒத்திசைவு {t}',
    'screens.empty': 'திரைகள் இல்லை.', 'screens.publish_now': 'இப்போது வெளியிடு', 'screens.rollback': 'மீட்டமை',
    'screens.unpair': 'இணைப்பு நீக்கு', 'common.delete': 'நீக்கு', 'common.edit': 'திருத்து', 'common.save': 'சேமி',
    'common.cancel': 'ரத்து', 'common.preview': 'முன்னோட்டம்', 'common.approve': 'ஒப்புதல்', 'common.export': 'CSV ஏற்றுமதி',
    'media.upload': '+ ஊடகம் பதிவேற்று', 'media.link': 'CDN இணைப்பு', 'media.empty': 'ஊடகம் இல்லை.',
    'media.versions': 'பதிப்பு வரலாறு', 'media.restore': 'மீட்டமை',
    'playlists.new': '+ புதிய பிளேலிஸ்ட்', 'playlists.empty': 'பிளேலிஸ்ட் இல்லை.',
    'tickers.new': '+ புதிய ஃபிளாஷ் செய்தி', 'tickers.empty': 'ஃபிளாஷ் செய்தி இல்லை.',
    'branches.new': '+ புதிய கிளை', 'schedules.new': '+ புதிய அட்டவணை', 'schedules.empty': 'அட்டவணை இல்லை.',
    'team.invite': '+ உறுப்பினரை அழை', 'team.pending': 'நிலுவை அழைப்புகள்',
    'billing.current_plan': 'தற்போதைய திட்டம்', 'billing.active_screens': 'செயலில் உள்ள திரைகள்',
    'billing.next_invoice': 'அடுத்த விலைப்பட்டியல்', 'billing.invoices': 'விலைப்பட்டியல்கள்', 'billing.upgrade': 'மேம்படுத்து',
    'billing.downgrade': 'தரம் குறை', 'settings.org': 'நிறுவனம்', 'settings.account': 'உங்கள் கணக்கு',
    'analytics.fleet_uptime': 'மொத்த இயக்க நேரம் (30நா)', 'analytics.screen_uptime': 'திரை இயக்க நேரம்',
    'analytics.top_media': 'சிறந்த ஊடகம்', 'analytics.playlist_perf': 'பிளேலிஸ்ட் செயல்திறன்',
    'admin.tenants': 'குத்தகைதாரர்கள்', 'admin.health': 'தள ஆரோக்கியம்', 'admin.support_login': 'ஆதரவு உள்நுழைவு',
    'audit.title': 'தணிக்கை பதிவு',
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
    'screens.no_playlist': 'ಪ್ಲೇಪಟ್ಟಿ ನಿಗದಿಯಾಗಿಲ್ಲ', 'screens.last_sync': 'ಕೊನೆಯ ಸಿಂಕ್ {t}',
    'screens.empty': 'ಪರದೆಗಳಿಲ್ಲ.', 'screens.publish_now': 'ಈಗ ಪ್ರಕಟಿಸಿ', 'screens.rollback': 'ಹಿಂತಿರುಗಿಸಿ',
    'screens.unpair': 'ಜೋಡಣೆ ತೆಗೆಯಿರಿ', 'common.delete': 'ಅಳಿಸಿ', 'common.edit': 'ಸಂಪಾದಿಸಿ', 'common.save': 'ಉಳಿಸಿ',
    'common.cancel': 'ರದ್ದುಗೊಳಿಸಿ', 'common.preview': 'ಮುನ್ನೋಟ', 'common.approve': 'ಅನುಮೋದಿಸಿ', 'common.export': 'CSV ರಫ್ತು',
    'media.upload': '+ ಮಾಧ್ಯಮ ಅಪ್‌ಲೋಡ್', 'media.link': 'CDN ಲಿಂಕ್', 'media.empty': 'ಮಾಧ್ಯಮವಿಲ್ಲ.',
    'media.versions': 'ಆವೃತ್ತಿ ಇತಿಹಾಸ', 'media.restore': 'ಮರುಸ್ಥಾಪಿಸಿ',
    'playlists.new': '+ ಹೊಸ ಪ್ಲೇಪಟ್ಟಿ', 'playlists.empty': 'ಪ್ಲೇಪಟ್ಟಿ ಇಲ್ಲ.',
    'tickers.new': '+ ಹೊಸ ಫ್ಲ್ಯಾಶ್ ಸುದ್ದಿ', 'tickers.empty': 'ಫ್ಲ್ಯಾಶ್ ಸುದ್ದಿ ಇಲ್ಲ.',
    'branches.new': '+ ಹೊಸ ಶಾಖೆ', 'schedules.new': '+ ಹೊಸ ವೇಳಾಪಟ್ಟಿ', 'schedules.empty': 'ವೇಳಾಪಟ್ಟಿ ಇಲ್ಲ.',
    'team.invite': '+ ಸದಸ್ಯರನ್ನು ಆಹ್ವಾನಿಸಿ', 'team.pending': 'ಬಾಕಿ ಆಹ್ವಾನಗಳು',
    'billing.current_plan': 'ಪ್ರಸ್ತುತ ಯೋಜನೆ', 'billing.active_screens': 'ಸಕ್ರಿಯ ಪರದೆಗಳು',
    'billing.next_invoice': 'ಮುಂದಿನ ಸರಕುಪಟ್ಟಿ', 'billing.invoices': 'ಸರಕುಪಟ್ಟಿಗಳು', 'billing.upgrade': 'ಅಪ್‌ಗ್ರೇಡ್',
    'billing.downgrade': 'ಡೌನ್‌ಗ್ರೇಡ್', 'settings.org': 'ಸಂಸ್ಥೆ', 'settings.account': 'ನಿಮ್ಮ ಖಾತೆ',
    'analytics.fleet_uptime': 'ಫ್ಲೀಟ್ ಅಪ್‌ಟೈಮ್ (30ದಿ)', 'analytics.screen_uptime': 'ಪರದೆ ಅಪ್‌ಟೈಮ್',
    'analytics.top_media': 'ಪ್ರಮುಖ ಮಾಧ್ಯಮ', 'analytics.playlist_perf': 'ಪ್ಲೇಪಟ್ಟಿ ಕಾರ್ಯಕ್ಷಮತೆ',
    'admin.tenants': 'ಬಾಡಿಗೆದಾರರು', 'admin.health': 'ವೇದಿಕೆ ಆರೋಗ್ಯ', 'admin.support_login': 'ಬೆಂಬಲ ಲಾಗಿನ್',
    'audit.title': 'ಲೆಕ್ಕಪರಿಶೋಧನೆ',
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
    'screens.no_playlist': 'لم يتم تعيين قائمة تشغيل', 'screens.last_sync': 'آخر مزامنة {t}',
    'screens.empty': 'لا توجد شاشات.', 'screens.publish_now': 'انشر الآن', 'screens.rollback': 'تراجع',
    'screens.unpair': 'إلغاء الإقران', 'common.delete': 'حذف', 'common.edit': 'تعديل', 'common.save': 'حفظ',
    'common.cancel': 'إلغاء', 'common.preview': 'معاينة', 'common.approve': 'اعتماد', 'common.export': 'تصدير CSV',
    'media.upload': '+ رفع وسائط', 'media.link': 'رابط CDN', 'media.empty': 'لا توجد وسائط.',
    'media.versions': 'سجل الإصدارات', 'media.restore': 'استعادة',
    'playlists.new': '+ قائمة تشغيل جديدة', 'playlists.empty': 'لا توجد قوائم تشغيل.',
    'tickers.new': '+ خبر عاجل جديد', 'tickers.empty': 'لا توجد أخبار عاجلة.',
    'branches.new': '+ فرع جديد', 'schedules.new': '+ جدول جديد', 'schedules.empty': 'لا توجد جداول.',
    'team.invite': '+ دعوة عضو', 'team.pending': 'دعوات معلقة',
    'billing.current_plan': 'الخطة الحالية', 'billing.active_screens': 'الشاشات النشطة',
    'billing.next_invoice': 'الفاتورة التالية', 'billing.invoices': 'الفواتير', 'billing.upgrade': 'ترقية',
    'billing.downgrade': 'تخفيض', 'settings.org': 'المؤسسة', 'settings.account': 'حسابك',
    'analytics.fleet_uptime': 'وقت التشغيل (30ي)', 'analytics.screen_uptime': 'وقت تشغيل الشاشة',
    'analytics.top_media': 'أفضل الوسائط', 'analytics.playlist_perf': 'أداء قائمة التشغيل',
    'admin.tenants': 'المستأجرون', 'admin.health': 'صحة المنصة', 'admin.support_login': 'دخول الدعم',
    'audit.title': 'سجل التدقيق',
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
