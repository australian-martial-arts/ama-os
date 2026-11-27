#!/usr/bin/env python3
"""Builds site/camp/summer-2027.js from site/camp/summer-2027.html, for the GoHighLevel page
train.australianmartialarts.com.au/holiday-camp/summer-2027. The GHL page holds one custom code block:
  <div id="ama-camp"></div><script src="https://ama-os.train-ama.com/camp/summer-2027.js"></script>
The page is drawn inside a shadow root so GHL's styles and ours never mix."""
import json, re, sys
src = open('site/camp/summer-2027.html').read()
css = re.search(r'<style>([\s\S]*?)</style>', src).group(1)
body = re.search(r'<body>([\s\S]*?)<script>', src).group(1)
js = re.search(r'<script>([\s\S]*?)</script>\s*</body>', src).group(1)
out = """/* AMA Summer Holiday Camp 2026-27 page for GoHighLevel. Built from site/camp/summer-2027.html by scripts/build-camp.py. */
(function () {
  var host = document.getElementById('ama-camp'); if (!host || host.shadowRoot) return;
  if (!document.querySelector('link[data-ama-font]')) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.setAttribute('data-ama-font', '1'); l.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap'; document.head.appendChild(l); }
  /* hide GoHighLevel's own (empty) sections so the page starts at the top */
  Array.prototype.forEach.call(document.querySelectorAll('[id^="section-"], .c-section, section'), function (el) { if (!el.contains(host)) el.style.display = 'none'; });
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>' + %s + '</style>' + %s;
  window.__AMA_CAMP_ROOT = root;
%s
})();
""" % (json.dumps(css), json.dumps(body), js)
open('site/camp/summer-2027.js', 'w').write(out)
print('built', len(out))
