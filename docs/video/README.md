# Product overview video

`web/public/media/demand-response-overview.mp4` (1080p30, ~4 min, narrated) is generated from the live product, not drawn by hand.
To regenerate it after UI changes:

1. **Capture the screens** — start the stack with a controlled scenario and run the scripted capture (Playwright + Chromium):
   ```bash
   KSFP_TIME_SCALE=30 KSFP_AUTO_DISTURBANCES=0 uvicorn ksfp.main:app --port 8000   # backend/
   npx vite --port 5173                                                            # web/
   node capture.mjs        # → /tmp/media/shots/*.png (DR event → dispatch → settlement → load-shedding drill)
   ```
2. **Narration** — `script.json` holds each scene's caption and voice-over. Voices are synthesised locally with
   [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) (`pip install kokoro-onnx soundfile`; model files from its GitHub release),
   voice `af_heart`, into `/tmp/media/audio/<scene>.wav`.
3. **Graphics** — `python graphics.py` renders the title, problem and end cards and the lower-third captions (Inter, enterprise palette).
4. **Assemble** — `python build.py`: slow camera moves per scene, captions, crossfades, narration over a generated music bed that ducks
   under the voice, WebVTT captions (`overview.vtt`), and a poster frame.
5. Copy `demand-response-overview.mp4`, `poster.jpg` and `overview.vtt` into `web/public/media/`, and re-encode the WebM fallback:
   `ffmpeg -i demand-response-overview.mp4 -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -c:a libopus -b:a 96k demand-response-overview.webm`.

The scripts use `/tmp/media` as their working folder.
