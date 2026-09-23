/*
 * Room card photo galleries (V02). Reads assets/img/room-photos/manifest.json
 * ({ "<room slug>": ["file", ...] }) and fills every `.room-gallery[data-room]`
 * with a carousel: native scroll-snap does the swiping, the buttons, arrow keys
 * and dots are the pointer and keyboard paths to the same scroll position. No
 * autoplay, no dependency, and the same names screen readers hear in the app:
 * a region "<sala> — fotografias", one "diapositivo" per photo, a "tablist" of
 * dots, "Fotografia anterior/seguinte", and a live region that only speaks
 * after the visitor moved it.
 *
 * Real photos later are a manifest edit (and the files), nothing here changes.
 */
(function () {
  'use strict';

  var MANIFEST_URL = 'assets/img/room-photos/manifest.json';
  var PHOTO_DIR = 'assets/img/room-photos/';
  // The illustrations are 1600×1200; the attributes reserve the space so the
  // card does not jump while they load.
  var WIDTH = 1600;
  var HEIGHT = 1200;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (name) {
      if (name === 'class') node.className = attrs[name];
      else if (name === 'text') node.textContent = attrs[name];
      else node.setAttribute(name, attrs[name]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function reducedMotion() {
    return typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function build(container, label, files) {
    var count = files.length;
    if (count === 0) return;
    var slug = container.getAttribute('data-room');
    var index = 0;

    container.setAttribute('role', 'region');
    container.setAttribute('aria-roledescription', 'carrossel');
    container.setAttribute('aria-label', label + ' — fotografias');
    if (count > 1) container.setAttribute('tabindex', '0');

    var slides = files.map(function (file, i) {
      var img = el('img', {
        src: PHOTO_DIR + file,
        alt: label + ' — fotografia ' + (i + 1) + ' de ' + count,
        width: WIDTH,
        height: HEIGHT,
        loading: i === 0 ? 'eager' : 'lazy',
        decoding: 'async',
        draggable: 'false',
      });
      return el('div', {
        class: 'room-gallery-slide',
        id: slug + '-slide-' + (i + 1),
        role: 'group',
        'aria-roledescription': 'diapositivo',
        'aria-label': 'Fotografia ' + (i + 1) + ' de ' + count,
      }, [img]);
    });
    var track = el('div', { class: 'room-gallery-track' }, slides);
    container.appendChild(track);
    if (count === 1) return;

    var prev = el('button', { type: 'button', class: 'room-gallery-btn prev', 'aria-label': 'Fotografia anterior' });
    prev.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
    var next = el('button', { type: 'button', class: 'room-gallery-btn next', 'aria-label': 'Fotografia seguinte' });
    next.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
    var dots = files.map(function (_, i) {
      var dot = el('button', {
        type: 'button',
        role: 'tab',
        class: 'room-gallery-dot',
        'aria-label': 'Fotografia ' + (i + 1) + ' de ' + count,
        'aria-selected': i === 0 ? 'true' : 'false',
        'aria-controls': slug + '-slide-' + (i + 1),
        tabindex: i === 0 ? '0' : '-1',
      }, [el('span', {})]);
      dot.addEventListener('click', function (event) { event.preventDefault(); goTo(i); });
      return dot;
    });
    var tablist = el('div', { class: 'room-gallery-dots', role: 'tablist', 'aria-label': 'Escolher fotografia' }, dots);
    var live = el('span', { class: 'sr-only', 'aria-live': 'polite', 'data-gallery-announcer': '' });
    container.appendChild(prev);
    container.appendChild(next);
    container.appendChild(tablist);
    container.appendChild(live);

    function render() {
      prev.disabled = index === 0;
      next.disabled = index === count - 1;
      dots.forEach(function (dot, i) {
        dot.setAttribute('aria-selected', i === index ? 'true' : 'false');
        dot.setAttribute('tabindex', i === index ? '0' : '-1');
      });
    }

    function goTo(target) {
      index = Math.min(count - 1, Math.max(0, target));
      live.textContent = 'Fotografia ' + (index + 1) + ' de ' + count;
      render();
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: index * track.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
      } else {
        track.scrollLeft = index * track.clientWidth;
      }
    }

    prev.addEventListener('click', function (event) { event.preventDefault(); goTo(index - 1); });
    next.addEventListener('click', function (event) { event.preventDefault(); goTo(index + 1); });
    container.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      goTo(index + (event.key === 'ArrowRight' ? 1 : -1));
    });
    // A swipe moves the scroll position without telling us; follow it, silently.
    track.addEventListener('scroll', function () {
      if (track.clientWidth === 0) return;
      var seen = Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth)));
      if (seen !== index) { index = seen; render(); }
    }, { passive: true });
    render();
  }

  function init() {
    var containers = Array.prototype.slice.call(document.querySelectorAll('.room-gallery[data-room]'));
    if (containers.length === 0) return;
    fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('manifest ' + response.status);
        return response.json();
      })
      .then(function (manifest) {
        containers.forEach(function (container) {
          var files = manifest[container.getAttribute('data-room')];
          var label = container.getAttribute('data-label') || 'Sala';
          if (Array.isArray(files)) build(container, label, files);
        });
      })
      .catch(function (error) {
        // The cards still read without photos; say why in the console.
        console.error('room-gallery: could not load the photo manifest', error);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
