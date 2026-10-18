import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUDIO_URL = 'https://example.com/white-noise.mp3';
process.env.SLACK_WEBHOOK_URL = '';
const { handler } = await import('../lambda/index.mjs');

const request = (type, extra = {}) => ({
  request: { type, requestId: 'req-1', locale: 'en-US', ...extra },
  context: { System: { device: { deviceId: 'device-1' }, user: { userId: 'user-1' } } },
});
const intent = (name) => request('IntentRequest', { intent: { name } });
const directive = (res) => res.response.directives?.[0];

test('launch starts playback from the top', async () => {
  const d = directive(await handler(request('LaunchRequest')));
  assert.equal(d.type, 'AudioPlayer.Play');
  assert.equal(d.playBehavior, 'REPLACE_ALL');
  assert.equal(d.audioItem.stream.url, process.env.AUDIO_URL);
  assert.equal(d.audioItem.stream.offsetInMilliseconds, 0);
});

test('nearly finished enqueues the next loop behind the current token', async () => {
  const d = directive(await handler(request('AudioPlayer.PlaybackNearlyFinished', { token: 'white-noise-1' })));
  assert.equal(d.playBehavior, 'ENQUEUE');
  assert.equal(d.audioItem.stream.expectedPreviousToken, 'white-noise-1');
  assert.notEqual(d.audioItem.stream.token, 'white-noise-1');
});

test('stop and cancel stop the player', async () => {
  for (const name of ['AMAZON.StopIntent', 'AMAZON.CancelIntent']) {
    const res = await handler(intent(name));
    assert.equal(directive(res).type, 'AudioPlayer.Stop');
    assert.equal(res.response.shouldEndSession, true);
  }
});

test('pause keeps playing, because routines send it unprompted', async () => {
  assert.equal(directive(await handler(intent('AMAZON.PauseIntent'))).type, 'AudioPlayer.Play');
});

test('MEDIA_ERROR_UNKNOWN is retried once', async () => {
  const failed = (token) => request('AudioPlayer.PlaybackFailed', {
    token,
    error: { type: 'MEDIA_ERROR_UNKNOWN', message: 'boom' },
  });

  const retry = directive(await handler(failed('white-noise-1')));
  assert.equal(retry.type, 'AudioPlayer.Play');
  assert.match(retry.audioItem.stream.token, /-retry$/);

  const second = await handler(failed(retry.audioItem.stream.token));
  assert.equal(directive(second), undefined);
});

test('other playback errors are acknowledged, not retried', async () => {
  const res = await handler(request('AudioPlayer.PlaybackFailed', {
    token: 'white-noise-1',
    error: { type: 'MEDIA_ERROR_INVALID_REQUEST' },
  }));
  assert.equal(directive(res), undefined);
});
