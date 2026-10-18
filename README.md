# alexa-white-noise

A private Alexa skill that plays white noise all night: "Alexa, open white
noise". An Alexa routine starts it at 8pm and stops it at 8am, across every Echo
in the house.

It is one dependency-free Lambda handler (`lambda/index.mjs`) and a 10-minute
MP3 on S3, in nightly use in our house since spring 2026.

```
Echo ──▶ Alexa (custom skill, invocation "white noise")
           │
           ▼
         Lambda: alexa-white-noise ──▶ AudioPlayer.Play ──▶ S3 (HTTPS) white-noise-10min.mp3
           ▲                                                    │
           └──────── PlaybackNearlyFinished ◀───────────────────┘   (enqueue the next 10 minutes)
```

## What it handles

Playing a sound all night on an Echo was harder than it looked. Each of these
came from a real night:

- **Looping.** Alexa has no "repeat" for a skill's audio stream. When it sends
  `AudioPlayer.PlaybackNearlyFinished`, the handler answers with an `ENQUEUE` of
  the same file and an `expectedPreviousToken` pointing at the current one, so
  playback continues with no gap.
- **Pause is ignored.** Routines and some devices send `AMAZON.PauseIntent` on
  their own, which used to leave a room silent at 2am. In this skill only
  *stop* and *cancel* end playback; pause keeps playing.
- **One retry on `MEDIA_ERROR_UNKNOWN`.** Echo devices occasionally drop the
  stream with this error while S3 and the Lambda are both healthy. The handler
  restarts playback once, marking the new token `-retry` so a stream that keeps
  failing can't loop forever.
- **Volume.** Full-scale white noise was only bearable at device volume 2. The
  generated file sits around −22 dB mean, so normal device volumes work
  (`scripts/make-audio.sh`).
- **Know which room.** Each event is logged with its device. If
  `SLACK_WEBHOOK_URL` is set, it is also posted there, with
  `DEVICE_NAME_MAP_JSON` turning device ids into room names. "It stopped
  overnight" then has an answer: which Echo stopped, when, and with what error.

## Layout

```
lambda/index.mjs                   the whole skill (no dependencies)
skill/interaction-model.en-US.json the Alexa interaction model
scripts/make-audio.sh              generate the 10-minute loop with ffmpeg
scripts/bootstrap.sh               one-time: S3 bucket, audio upload, IAM role, Lambda
scripts/add-alexa-permission.sh    one-time: allow the skill to invoke the Lambda
scripts/deploy.sh                  update the Lambda's code (and optionally AUDIO_URL)
test/handler.test.mjs              node:test coverage of the behaviours above
```

## Setup

You need an AWS account, an [Alexa developer](https://developer.amazon.com/alexa/console/ask)
account linked to the same Amazon account as your Echo devices, the AWS CLI and
ffmpeg.

1. `bash scripts/bootstrap.sh` with credentials that can create an S3 bucket,
   an IAM role and a Lambda. It prints the Lambda ARN.
2. In the Alexa developer console, create a **Custom** skill with
   **Provision your own** hosting:
   - invocation name: `white noise`
   - Interfaces: turn on **Audio Player**
   - Endpoint: the Lambda ARN from step 1
   - Interaction Model → JSON Editor: paste `skill/interaction-model.en-US.json`,
     then save and build
3. `SKILL_ID=amzn1.ask.skill.… bash scripts/add-alexa-permission.sh`
4. "Alexa, open white noise."

A development-stage skill works on every device on your own account without
being published.

For the overnight schedule, create two routines in the Alexa app: at 8:00 PM,
Custom → "open white noise"; at 8:00 AM, Stop.

## Configuration

| Variable | Required | |
|---|---|---|
| `AUDIO_URL` | yes | HTTPS URL of the MP3 (Alexa requires HTTPS) |
| `SLACK_WEBHOOK_URL` | no | Incoming webhook to post playback events to |
| `SLACK_NOTIFY_ENABLED` | no | `false` turns the webhook off (default `true`) |
| `SLACK_NOTIFY_EVENTS` | no | Comma-separated request types/intents to post |
| `DEVICE_NAME_MAP_JSON` | no | `{"amzn1.ask.device.…": "Primary Room Echo"}` |

## Development

```sh
npm test                 # node:test, Node 20+
bash scripts/deploy.sh   # build dist/lambda.zip and update the function
```

The scripts use whatever `AWS_PROFILE` and `AWS_REGION` are in the environment.
After the one-time setup, deploying needs only `lambda:UpdateFunctionCode` (plus
`lambda:UpdateFunctionConfiguration` to change `AUDIO_URL`).
