/* =============================================================================
   遗迹2 · 遗物档案 — theme-boot.js
   首屏主题引导（**经典脚本，必须在 CSS 之前同步执行**，避免闪白/闪黑）。
   与 js/core/theme.js 的分工：
     · 本文件只做一件事：读 localStorage["r2.v2.ui"].theme（auto|light|dark，默认 auto）
       结合系统 prefers-color-scheme，在样式表解析前把 html[data-theme] / color-scheme 落好；
     · 之后所有运行时行为（按钮循环、Alt+T、系统偏好监听、meta theme-color 同步）都在 theme.js。
   偏好键与 theme.js 共用 store 的 r2.v2.ui，不新增 localStorage key。
   ========================================================================== */
(function () {
  'use strict';
  var mode = 'auto';
  try {
    var ui = JSON.parse(localStorage.getItem('r2.v2.ui') || '{}');
    if (ui && (ui.theme === 'light' || ui.theme === 'dark' || ui.theme === 'auto')) mode = ui.theme;
  } catch (e) { /* 隐私模式 / 脏数据：按 auto 处理 */ }
  var dark = true;
  try { dark = !window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { dark = true; }
  var theme = mode === 'auto' ? (dark ? 'dark' : 'light') : mode;
  var el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.themeMode = mode;
  el.style.colorScheme = theme;
})();
