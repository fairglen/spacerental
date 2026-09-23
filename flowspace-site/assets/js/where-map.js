/*
 * "Onde estamos" map (V07). The map is a third-party embed, so it is never
 * loaded on render: the placeholder shows the address and a "Ver mapa" button
 * at the map's size, and the OpenStreetMap iframe mounts only when asked for —
 * no request leaves for openstreetmap.org without that intent. The bounding
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
    var button = map.querySelector('[data-map-show]');
    var note = map.querySelector('[data-map-note]');
    if (!frame || !button || isNaN(lat) || isNaN(lng)) return;

    button.addEventListener('click', function () {
      var aspect = frame.clientHeight > 0 ? frame.clientWidth / frame.clientHeight : DEFAULT_ASPECT;
      var iframe = document.createElement('iframe');
      iframe.setAttribute('title', 'Mapa da localização');
      iframe.setAttribute('src', embedUrl(lat, lng, aspect));
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      frame.innerHTML = '';
      frame.appendChild(iframe);
      if (note) {
        // The same line under the map, so nothing moves: the link replaces the note.
        var link = document.createElement('a');
        link.setAttribute('href', fullMapUrl(lat, lng));
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
        link.textContent = 'Abrir no mapa';
        note.textContent = '';
        note.appendChild(link);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
