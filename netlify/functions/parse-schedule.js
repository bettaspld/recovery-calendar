exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured on server' }) };
  }

  try {
    const { base64, mimeType } = JSON.parse(event.body);

    if (!base64 || !mimeType) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing image data' }) };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this image of a support group or recovery meeting schedule. Extract ALL meetings you can find.

For each meeting, provide:
- name: The meeting/group name
- day: Day of week as a number (0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday)
- time: In 24-hour format "HH:MM"
- fellowship: Best match from: "Alcoholics Anonymous (AA)", "Narcotics Anonymous (NA)", "Cocaine Anonymous (CA)", "Al-Anon / Alateen", "Gamblers Anonymous (GA)", "Nar-Anon", "Co-Dependents Anonymous (CoDA)", "SMART Recovery", "SMART Recovery Family & Friends", "Recovery Dharma", "Yoga of 12-Step Recovery", "Women for Sobriety", "Other"
- format: Best match from: "Discussion", "Step Study", "Big Book Study", "Speaker-Discussion", "Beginner / Newcomer", "Meditation / Prayer", "Other"
- access: "Anyone Welcome" or "Members Only"
- gender: "Women", "Men", "Non-Binary", or "" (empty if not gender-specific)
- location: The venue/location name if visible
- address: The street address if visible
- notes: Any additional details

Return ONLY a JSON array of meeting objects. No markdown, no explanation, just the JSON array. If you can't find any meetings, return [].`
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: 'high'
              }
            }
          ]
        }],
        max_tokens: 4000,
        temperature: 0.1
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: err.error?.message || `OpenAI API error: ${response.status}` })
      };
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: content })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Server error' })
    };
  }
};
