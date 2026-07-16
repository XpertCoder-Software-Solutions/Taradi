# WhatsApp Voice Note Audio Normalization

Outbound CRM voice notes may be recorded by the browser as `audio/webm` or `audio/webm;codecs=opus`. Meta WhatsApp media upload does not accept WebM audio, so the backend converts these files to OGG/Opus immediately before upload.

## Runtime Dependency

Install FFmpeg on Ubuntu hosts that run WhatsApp outbound workers:

```bash
sudo apt update
sudo apt install -y ffmpeg
ffmpeg -version
```

## Conversion

The worker uses FFmpeg to produce:

- container: OGG
- codec: `libopus`
- MIME type: `audio/ogg`
- extension: `.ogg`
- channels: mono
- sample rate: 48 kHz
- bitrate: 32 kbps

Command shape:

```bash
ffmpeg -hide_banner -loglevel error -y -i <input.webm> -vn -ac 1 -ar 48000 -c:a libopus -b:a 32k -f ogg <output.ogg>
```

Converted files are written to a random temporary directory and removed after Meta upload succeeds or fails. Original stored CRM recordings are not deleted.
