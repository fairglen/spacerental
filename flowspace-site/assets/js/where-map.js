/*
 * "Onde estamos" map (V07, reworked in L04). The OpenStreetMap iframe is
 * mounted as soon as the script runs, lazily loaded and referrer-free (the
 * privacy page says openstreetmap.org receives the request). The bounding
 * box is built in ground distance around the pin with the frame's aspect
 * ratio, so the marker sits in the middle of the frame.
 */
(function () {
  'use strict';

  // Half-height of the box in degrees of latitude: a few streets around the door.
  var HALF_HEIGHT = 0.006;
  var DEFAULT_ASPECT = 1.5;

  function bbox(lat, lng, aspect) {
    var safeAspect = isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
    var centreLat = Math.min(90 - HALF_HEIGHT, Math.max(-90 + HALF_HEIGHT, lat));
    var cosLat = Math.max(0.05, Math.cos((centreLat * Math.PI) / 180));
    var halfWidth = Math.min(90, (HALF_HEIGHT * safeAspect) / cosLat);
    var centreLng = Math.min(180 - halfWidth, Math.max(-180 + halfWidth, lng));
    return [centreLng - halfWidth, centreLat - HALF_HEIGHT, centreLng + halfWidth, centreLat + HALF_HEIGHT]
      .map(function (n) { return n.toFixed(6); })
      .join(',');
  }

  function embedUrl(lat, lng, aspect) {
    var params = new URLSearchParams({ bbox: bbox(lat, lng, aspect), layer: 'mapnik', marker: lat + ',' + lng });
    return 'https://www.openstreetmap.org/export/embed.html?' + params.toString();
  }

  function fullMapUrl(lat, lng) {
    return 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lng + '#map=17/' + lat + '/' + lng;
  }

  function init() {
    var map = document.querySelector('.where-map[data-lat][data-lng]');
    if (!map) return;
    var lat = parseFloat(map.getAttribute('data-lat'));
    var lng = parseFloat(map.getAttribute('data-lng'));
    var frame = map.querySelector('.where-map-frame');
    var note = map.querySelector('[data-map-note]');
    if (!frame || isNaN(lat) || isNaN(lng)) return;

    var aspect = frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : DEFAULT_ASPECT;
    var iframe = document.createElement('iframe');
    iframe.setAttribute('title', 'Mapa da localização');
    iframe.setAttribute('src', embedUrl(lat, lng, aspect));
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    frame.innerHTML = '';
    frame.appendChild(iframe);
    if (note) {
      var link = document.createElement('a');
      link.setAttribute('href', fullMapUrl(lat, lng));
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
      link.textContent = 'Abrir o mapa completo';
      note.textContent = '';
      note.appendChild(link);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
