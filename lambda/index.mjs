/**
 * Alexa White Noise Skill — Lambda handler
 *
 * Uses the AudioPlayer interface to stream a looping white noise audio file.
 * Supports voice commands: start (via LaunchRequest), stop, cancel, pause, resume.
 * Loops automatically via PlaybackNearlyFinished enqueue.
 */

const AUDIO_URL = process.env.AUDIO_URL;   // required: HTTPS URL to white noise MP3 on S3
const AUDIO_TOKEN_BASE = 'white-noise';
const RETRY_TOKEN_MARKER = 'retry';
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const SLACK_NOTIFY_ENABLED = (process.env.SLACK_NOTIFY_ENABLED || 'true').toLowerCase() === 'true';
const SLACK_NOTIFY_EVENTS = new Set(
  (process.env.SLACK_NOTIFY_EVENTS || [
    'LaunchRequest',
    'AMAZON.PauseIntent',
    'AMAZON.ResumeIntent',
    'AMAZON.StopIntent',
    'AMAZON.CancelIntent',
    'AudioPlayer.PlaybackStarted',
    'AudioPlayer.PlaybackStopped',
    'AudioPlayer.PlaybackFailed',
    'SessionEndedRequest',
  ].join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const DEVICE_NAME_MAP = safeParseJson(process.env.DEVICE_NAME_MAP_JSON, {});

if (!AUDIO_URL) {
  console.error('[WARN] AUDIO_URL env var is not set — LaunchRequest will fail');
}

export const handler = async (event) => {
  const requestType = event?.request?.type ?? 'unknown';
  const intentName  = event?.request?.intent?.name ?? '';
  const eventType = requestType === 'IntentRequest' && intentName ? intentName : requestType;
  const details = extractEventDetails(event);

  console.log('[alexa-white-noise] type=%s intent=%s device=%s requestId=%s', requestType, intentName, details.deviceName, details.requestId);
  console.log('[alexa-white-noise] details=%s', JSON.stringify(details));

  await maybeNotifySlack(eventType, details);

  // ─── Launch: start playing ───────────────────────────────────────────────
  if (requestType === 'LaunchRequest') {
    return playAudio('REPLACE_ALL', 0, token());
  }

  // ─── Intent handlers ─────────────────────────────────────────────────────
  if (requestType === 'IntentRequest') {

    if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
      return stopAudio('Stopping white noise. Good night.');
    }

    if (intentName === 'AMAZON.PauseIntent') {
      // Some devices/routines can emit Pause unexpectedly.
      // For this skill, keep playback running unless user says stop/cancel.
      return playAudio('REPLACE_ALL', 0, token());
    }

    if (intentName === 'AMAZON.ResumeIntent') {
      return playAudio('REPLACE_ALL', 0, token(), 'Resuming.');
    }

    if (intentName === 'AMAZON.HelpIntent') {
      return speak(
        'White noise is playing. ' +
        'Say stop or cancel to turn it off. ' +
        'Say pause to pause, or resume to continue.'
      );
    }

    if (intentName === 'AMAZON.StartOverIntent') {
      return playAudio('REPLACE_ALL', 0, token());
    }

    // Unknown intents — just keep playing
    return { version: '1.0', response: {} };
  }

  // ─── AudioPlayer events ───────────────────────────────────────────────────

  if (requestType === 'AudioPlayer.PlaybackNearlyFinished') {
    // Enqueue the next loop before the current one ends
    const prevToken = event?.request?.token ?? AUDIO_TOKEN_BASE;
    return {
      version: '1.0',
      response: {
        directives: [
          {
            type: 'AudioPlayer.Play',
            playBehavior: 'ENQUEUE',
            audioItem: {
              stream: {
                url: AUDIO_URL,
                token: token(),
                expectedPreviousToken: prevToken,
                offsetInMilliseconds: 0,
              },
            },
          },
        ],
      },
    };
  }

  // Acknowledge-only events
  if (
    requestType === 'AudioPlayer.PlaybackStarted'   ||
    requestType === 'AudioPlayer.PlaybackFinished'  ||
    requestType === 'AudioPlayer.PlaybackStopped'   ||
    requestType === 'AudioPlayer.PlaybackFailed'    ||
    requestType === 'PlaybackController.NextCommandIssued'  ||
    requestType === 'PlaybackController.PreviousCommandIssued' ||
    requestType === 'SessionEndedRequest'
  ) {
    if (requestType === 'AudioPlayer.PlaybackFailed') {
      console.error('[alexa-white-noise] PlaybackFailed:', JSON.stringify(event?.request?.error));
      if (shouldRetryPlaybackFailure(event?.request)) {
        console.log('[alexa-white-noise] retrying playback after MEDIA_ERROR_UNKNOWN token=%s', event?.request?.token || '');
        return playAudio('REPLACE_ALL', 0, token(RETRY_TOKEN_MARKER));
      }
    }
    return { version: '1.0', response: {} };
  }

  // Fallback
  return { version: '1.0', response: {} };
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function token(marker) {
  return [AUDIO_TOKEN_BASE, Date.now(), marker].filter(Boolean).join('-');
}

function shouldRetryPlaybackFailure(request) {
  const errorType = request?.error?.type || '';
  const requestToken = request?.token || '';
  return errorType === 'MEDIA_ERROR_UNKNOWN' && !requestToken.includes(`-${RETRY_TOKEN_MARKER}`);
}

function playAudio(behavior, offsetMs, tok, speechBefore) {
  const response = {
    directives: [
      {
        type: 'AudioPlayer.Play',
        playBehavior: behavior,
        audioItem: {
          stream: {
            url: AUDIO_URL,
            token: tok,
            offsetInMilliseconds: offsetMs ?? 0,
          },
        },
      },
    ],
    shouldEndSession: true,
  };

  if (speechBefore) {
    response.outputSpeech = { type: 'SSML', ssml: `<speak>${speechBefore}</speak>` };
  }

  return { version: '1.0', response };
}

function stopAudio(speechText) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'SSML', ssml: `<speak>${speechText}</speak>` },
      directives: [{ type: 'AudioPlayer.Stop' }],
      shouldEndSession: true,
    },
  };
}

function speak(text) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'SSML', ssml: `<speak>${text}</speak>` },
      shouldEndSession: false,
    },
  };
}

function extractEventDetails(event) {
  const request = event?.request || {};
  const system = event?.context?.System || {};
  const deviceId = system?.device?.deviceId || 'unknown-device';
  const deviceName = DEVICE_NAME_MAP[deviceId] || deviceId;

  return {
    timestamp: new Date().toISOString(),
    requestType: request.type || 'unknown',
    intentName: request?.intent?.name || '',
    requestId: request.requestId || 'unknown-request',
    locale: request.locale || 'unknown-locale',
    deviceId,
    deviceName,
    userId: system?.user?.userId || 'unknown-user',
    token: request?.token || request?.currentPlaybackState?.token || '',
    offsetInMilliseconds:
      request?.offsetInMilliseconds ??
      request?.currentPlaybackState?.offsetInMilliseconds ??
      null,
    error: request?.error || null,
  };
}

async function maybeNotifySlack(eventType, details) {
  if (!SLACK_NOTIFY_ENABLED || !SLACK_WEBHOOK_URL) return;
  if (!SLACK_NOTIFY_EVENTS.has(eventType)) return;

  const lines = [
    '*Alexa White Noise Event*',
    `event: ${eventType}`,
    `device: ${details.deviceName}`,
    `deviceId: ${details.deviceId}`,
    `requestId: ${details.requestId}`,
    `locale: ${details.locale}`,
  ];

  if (details.offsetInMilliseconds !== null && details.offsetInMilliseconds !== undefined) {
    lines.push(`offsetMs: ${details.offsetInMilliseconds}`);
  }

  if (details.token) {
    lines.push(`token: ${details.token}`);
  }

  if (details.error) {
    lines.push(`error: ${JSON.stringify(details.error)}`);
  }

  await postToSlackWebhook(lines.join('\n'));
}

async function postToSlackWebhook(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[alexa-white-noise] slack webhook failed status=%s body=%s', response.status, body);
    }
  } catch (err) {
    console.error('[alexa-white-noise] slack webhook error:', err?.message || String(err));
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error('[alexa-white-noise] failed to parse DEVICE_NAME_MAP_JSON:', err?.message || String(err));
    return fallback;
  }
}
