import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const WIDGET_JS = `(function(){
  'use strict';

  var CHAT_ORIGIN = 'https://huggable-deploy-buddy.lovable.app';

  if (window.__dmChatWidgetLoaded) return;
  window.__dmChatWidgetLoaded = true;

  if (window.location.origin === CHAT_ORIGIN) return;

  var scriptTag = document.currentScript;
  var customBtnColor = scriptTag && scriptTag.getAttribute('data-btn-color');
  var customHeaderColor = scriptTag && scriptTag.getAttribute('data-header-color');
  var customPosition = scriptTag && scriptTag.getAttribute('data-position');
  var customBtnSize = scriptTag && scriptTag.getAttribute('data-btn-size');

  var hostname = window.location.hostname;
  var pathname = window.location.pathname.toLowerCase();

  if (!customBtnColor) {
    if (hostname.includes('foundry')) {
      customBtnColor = '#1a1a2e';
    } else if (pathname.includes('ai-advisor') || pathname.includes('aisovetnik')) {
      customBtnColor = '#ec7528';
    } else if (pathname.includes('ai-transformation') || pathname.includes('aitransformation')) {
      customBtnColor = '#ec7528';
    } else {
      customBtnColor = '#1a1a2e';
    }
  }
  if (!customHeaderColor) customHeaderColor = customBtnColor;

  var btnSize = customBtnSize ? parseInt(customBtnSize, 10) : 56;
  var posRight = customPosition === 'left' ? 'auto' : '24px';
  var posLeft = customPosition === 'left' ? '24px' : 'auto';

  function init() {
    if (document.getElementById('dm-chat-btn')) return;
    if (!document.body) {
      setTimeout(init, 50);
      return;
    }

    var style = document.createElement('style');
    style.textContent = [
      '#dm-chat-btn{position:fixed;bottom:24px;right:' + posRight + ';left:' + posLeft + ';z-index:99999;width:' + btnSize + 'px;height:' + btnSize + 'px;border-radius:9999px;background:' + customBtnColor + ';color:#fff;border:none;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s}',
      '#dm-chat-btn:hover{transform:scale(1.06);box-shadow:0 6px 28px rgba(0,0,0,.4)}',
      '#dm-chat-btn svg{width:24px;height:24px}',
      '#dm-chat-frame{position:fixed;bottom:92px;right:' + posRight + ';left:' + posLeft + ';z-index:99999;width:min(400px,calc(100vw - 24px));height:min(620px,calc(100vh - 120px));border:none;border-radius:16px;box-shadow:0 8px 40px rgba(0,0,0,.25);display:none;background:#fff;opacity:0;transition:opacity .2s}',
      '#dm-chat-frame.dm-open{display:block;opacity:1}',
      '@media(max-width:480px){#dm-chat-frame{width:100vw;height:100vh;bottom:0;right:0;left:0;border-radius:0}}'
    ].join('\\n');
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'dm-chat-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Открыть чат');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

    var iframe = document.createElement('iframe');
    iframe.id = 'dm-chat-frame';
    iframe.setAttribute('allow', 'microphone; clipboard-write');
    iframe.setAttribute('loading', 'lazy');

    function buildSrc() {
      var pageUrl = encodeURIComponent(window.location.href);
      var pageTitle = encodeURIComponent(document.title || '');
      var pageSection = encodeURIComponent(window.location.pathname.replace(/^\\//, '') || 'главная');
      var headerColor = encodeURIComponent(customHeaderColor || '');
      return CHAT_ORIGIN + '/chat-embed?embed=true&pageUrl=' + pageUrl + '&pageTitle=' + pageTitle + '&pageSection=' + pageSection + '&headerColor=' + headerColor;
    }

    var isOpen = false;
    var loaded = false;

    btn.addEventListener('click', function() {
      isOpen = !isOpen;
      if (isOpen && !loaded) {
        iframe.src = buildSrc();
        loaded = true;
      }
      iframe.className = isOpen ? 'dm-open' : '';
      btn.innerHTML = isOpen
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    });

    document.body.appendChild(btn);
    document.body.appendChild(iframe);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;

serve(async (req) => {
  return new Response(WIDGET_JS, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
});