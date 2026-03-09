const jsonHeaders = { 'Content-Type': 'application/json' };

// ── Format code mappings ────────────────────────────────
const FORMAT_MAP = {
  'D': 'Discussion', 'Di': 'Discussion',
  'SP': 'Speaker', 'S': 'Speaker',
  'ST': 'Step Study',
  'TR': 'Tradition Study',
  'BK': 'Big Book Study', 'BB': 'Big Book Study', 'LIT': 'Literature Study',
  'Be': 'Beginner / Newcomer', 'BT': 'Beginner / Newcomer',
  'Med': 'Meditation / Prayer',
  'QA': 'Q&A',
  'BU': 'Business / Group Conscience',
};

function normalizeMeeting(m) {
  const formats = (m.formats || '').split(',').map(f => f.trim());

  // Day: BMLT 1=Sun...7=Sat → app 0=Sun...6=Sat
  const day = Math.max(0, parseInt(m.weekday_tinyint || '1', 10) - 1);

  // Time: "HH:MM:SS" → "HH:MM"
  const time = (m.start_time || '00:00:00').substring(0, 5);

  // Format
  let format = 'Discussion';
  for (const f of formats) {
    if (FORMAT_MAP[f]) { format = FORMAT_MAP[f]; break; }
  }

  // Access
  const access = formats.includes('C') ? 'Members Only' : 'Anyone Welcome';

  // Gender
  let gender = '';
  if (formats.includes('M')) gender = 'Men';
  else if (formats.includes('W')) gender = 'Women';

  // Location & address
  const loc = m.location_text || m.location_info || '';
  const addrParts = [m.location_street, m.location_city_subsection || m.location_municipality, m.location_province, m.location_postal_code_1].filter(Boolean);
  const address = addrParts.join(', ');

  // Distance
  const distKm = parseFloat(m.distance_in_km) || 0;
  const distMi = (distKm * 0.621371).toFixed(1);

  // Duration
  const dur = m.duration_time || '';
  let durMin = '';
  if (dur) {
    const parts = dur.split(':');
    const h = parseInt(parts[0] || '0', 10);
    const mins = parseInt(parts[1] || '0', 10);
    durMin = (h * 60 + mins) + ' min';
  }

  const noteParts = [`${distMi} mi away`, durMin, m.comments].filter(Boolean);

  return {
    name: m.meeting_name || 'Unnamed Meeting',
    day,
    time,
    fellowship: 'Narcotics Anonymous (NA)',
    format,
    access,
    gender,
    location: loc,
    address,
    notes: noteParts.join(' · '),
    distance_km: distKm
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { location, radiusKm = 16 } = JSON.parse(event.body);

    if (!location || !location.trim()) {
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ success: false, error: 'Please enter a city or zip code.', results: [] }) };
    }

    const startTime = Date.now();
    const locTrimmed = location.trim();

    // ── 1. Geocode (try Census + Nominatim in parallel) ─────
    let lat, lng, displayName;

    const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(locTrimmed)}&benchmark=Public_AR_Current&format=json`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locTrimmed)}&format=json&limit=1&countrycodes=us`;

    const [censusResult, nominatimResult] = await Promise.allSettled([
      fetch(censusUrl, { signal: AbortSignal.timeout(6000) }).then(r => r.json()),
      fetch(nominatimUrl, {
        headers: { 'User-Agent': 'RecoveryCalendar/1.0 (https://recoverycalendar.app)' },
        signal: AbortSignal.timeout(6000)
      }).then(r => r.json())
    ]);

    // Try Census result first
    if (censusResult.status === 'fulfilled') {
      const matches = censusResult.value?.result?.addressMatches;
      if (matches && matches.length > 0) {
        lat = matches[0].coordinates.y;
        lng = matches[0].coordinates.x;
        displayName = matches[0].matchedAddress;
      }
    }

    // Fallback to Nominatim
    if (!lat && nominatimResult.status === 'fulfilled') {
      const geoData = nominatimResult.value;
      if (Array.isArray(geoData) && geoData.length > 0) {
        lat = parseFloat(geoData[0].lat);
        lng = parseFloat(geoData[0].lon);
        displayName = geoData[0].display_name;
      }
    }

    if (!lat || !lng) {
      return { statusCode: 200, headers: jsonHeaders, body: JSON.stringify({ success: false, error: 'Location not found. Try a different city name or zip code.', results: [] }) };
    }

    // ── 2. Fetch from BMLT API ──────────────────────────────
    let bmltMeetings = [];
    try {
      const bmltUrl = `https://tomato.bmltenabled.org/main_server/client_interface/json/?switcher=GetSearchResults&geo_width_km=${radiusKm}&lat_val=${lat}&long_val=${lng}&sort_keys=distance_in_km`;
      const bmltRes = await fetch(bmltUrl, { signal: AbortSignal.timeout(10000) });
      const bmltText = await bmltRes.text();
      try {
        const bmltData = JSON.parse(bmltText);
        if (Array.isArray(bmltData)) {
          bmltMeetings = bmltData.slice(0, 60);
        }
      } catch (e) {
        console.log('BMLT not JSON:', bmltText.substring(0, 200));
      }
    } catch (e) {
      console.log('BMLT fetch error:', e.message);
    }

    if (bmltMeetings.length === 0) {
      return {
        statusCode: 200,
        headers: jsonHeaders,
        body: JSON.stringify({
          success: true,
          results: [],
          location: displayName || locTrimmed,
          stats: { rawFetched: 0, normalized: 0, totalTime: Date.now() - startTime }
        })
      };
    }

    // ── 3. Normalize with plain JS (no AI needed) ───────────
    const normalized = bmltMeetings.map(normalizeMeeting);

    // ── 4. Deduplicate by name + day + time ─────────────────
    const seen = new Set();
    const deduped = normalized.filter(m => {
      const key = `${m.name.toLowerCase()}|${m.day}|${m.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: true,
        results: deduped,
        location: displayName || locTrimmed,
        stats: {
          rawFetched: bmltMeetings.length,
          normalized: deduped.length,
          totalTime: Date.now() - startTime
        }
      })
    };

  } catch (err) {
    console.error('find-meetings error:', err);
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ success: false, error: err.message || 'Server error', results: [] })
    };
  }
};
