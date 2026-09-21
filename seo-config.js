// Central SEO / production domain configuration.
// Used by build-static.js (CommonJS) and available in the browser as window.SEO_CONFIG.
(function (root, factory) {
  var config = {
    SITE: "https://newssrilanka24.com.lk",
    SITE_HOST: "newssrilanka24.com.lk",
    SITE_NAME: "News Sri Lanka 24",
    BRAND: "newssrilanka24.com.lk",
    DEFAULT_TITLE: "News Sri Lanka 24 | සිංහල පුවත් සාරාංශ",
    DEFAULT_DESCRIPTION:
      "ශ්‍රී ලංකාවේ සහ ලෝකයේ නවතම සිංහල පුවත් සාරාංශ — දේශීය, ක්‍රීඩා, තාක්ෂණය, ව්‍යාපාර සහ විනෝදාස්වාදය එකම තැනකින්.",
    OG_TITLE: "News Sri Lanka 24 — සිංහල පුවත්",
    OG_DESCRIPTION: "සැබෑ කාලීන සිංහල පුවත් සාරාංශ. ශ්‍රී ලංකාව සහ ලෝකය.",
    DEFAULT_IMAGE: "https://newssrilanka24.com.lk/og-default.png",
    LOGO_IMAGE: "https://newssrilanka24.com.lk/logo.png",
    LOCALE: "si_LK",
    LOCALE_ALT: "en_GB"
  };
  if (typeof module === "object" && module.exports) {
    module.exports = config;
  }
  root.SEO_CONFIG = config;
})(typeof globalThis !== "undefined" ? globalThis : this);
