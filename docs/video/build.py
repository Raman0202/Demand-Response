"""Assemble the presentation video: Ken-Burns scenes + captions + crossfades, narration over a ducked music bed."""
import json
import os
import subprocess

import numpy as np
import soundfile as sf

M = '/tmp/media'
FPS, W, H = 30, 1920, 1080
LEAD, TAIL, XF = 0.7, 1.0, 0.6
SR = 24000
os.makedirs(f'{M}/clips', exist_ok=True)
scenes = json.load(open(f'{M}/script.json'))


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-2000:])


# ---------------------------------------------------------------- visuals
durs = []
for s in scenes:
    a, _ = sf.read(f"{M}/audio/{s['id']}.wav")
    d = LEAD + len(a) / SR + TAIL
    durs.append(d)
    n = int(round(d * FPS))
    img = f"{M}/shots/{s['img']}.png" if s['kind'] == 'shot' else f"{M}/gfx/{s['id']}.png"
    cx, cy = s.get('zoom', [0.5, 0.5])
    zmax = 0.10 if s['kind'] == 'shot' else 0.04
    zp = (
        f"scale=3840:2160:flags=lanczos,"
        f"zoompan=z='1+{zmax}*on/{n}':x='(iw-iw/zoom)*{cx}':y='(ih-ih/zoom)*{cy}':d={n}:s={W}x{H}:fps={FPS},"
        f"format=yuv420p"
    )
    out = f"{M}/clips/{s['id']}.mp4"
    ok = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], capture_output=True, text=True)
    if ok.returncode == 0 and ok.stdout.strip() and abs(float(ok.stdout) - d) < 0.2:
        print('clip', s['id'], 'cached')
        continue
    if s['kind'] == 'shot':
        cap = f"{M}/gfx/{s['id']}-cap.png"
        fc = f"[0:v]{zp}[bg];[1:v]format=rgba,fade=in:st=0.5:d=0.6:alpha=1[c];[bg][c]overlay=0:0:shortest=1,format=yuv420p[v]"
        run(['ffmpeg', '-y', '-loop', '1', '-i', img, '-loop', '1', '-i', cap, '-filter_complex', fc, '-map', '[v]', '-t', f'{d:.3f}', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out])
    else:
        run(['ffmpeg', '-y', '-loop', '1', '-i', img, '-vf', zp, '-t', f'{d:.3f}', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', out])
    print('clip', s['id'], round(d, 1))

# crossfade chain
inputs, fc, prev, t = [], [], '0:v', 0.0
for i, s in enumerate(scenes):
    inputs += ['-i', f"{M}/clips/{s['id']}.mp4"]
starts = [0.0]
for i in range(1, len(scenes)):
    t += durs[i - 1] - XF
    starts.append(t)
    lab = f'x{i}'
    fc.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={XF}:offset={t:.3f}[{lab}]")
    prev = lab
total = starts[-1] + durs[-1]
fc.append(f"[{prev}]fade=in:st=0:d=0.8,fade=out:st={total - 1.2:.3f}:d=1.2,format=yuv420p[v]")
run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(fc), '-map', '[v]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', f'{M}/video_noaudio.mp4'])
print('video', round(total, 1))

# ---------------------------------------------------------------- audio: narration timeline
N = int(total * SR) + SR
voice = np.zeros(N)
subs = []
for s, st in zip(scenes, starts):
    a, _ = sf.read(f"{M}/audio/{s['id']}.wav")
    i0 = int((st + LEAD) * SR)
    voice[i0 : i0 + len(a)] += a
    subs.append((st + LEAD, st + LEAD + len(a) / SR, s['say']))

# music bed: slow pad (Am – F – C – G), soft and warm
t = np.arange(N) / SR
chords = [[110.0, 130.81, 164.81, 220.0], [87.31, 110.0, 130.81, 174.61], [65.41, 98.0, 130.81, 164.81], [98.0, 123.47, 146.83, 196.0]]
bar = 6.0
music = np.zeros(N)
for k in range(int(total // bar) + 2):
    c = chords[k % 4]
    a0, a1 = int(k * bar * SR), min(N, int((k + 1) * bar * SR + 2 * SR))
    if a0 >= N:
        break
    seg = t[a0:a1] - k * bar
    env = np.clip(seg / 1.8, 0, 1) * np.clip((bar + 2 - seg) / 2.0, 0, 1)
    tone = sum(np.sin(2 * np.pi * f * seg) * 0.6 + np.sin(2 * np.pi * 2 * f * seg) * 0.12 + np.sin(2 * np.pi * f * 1.003 * seg) * 0.3 for f in c)
    music[a0:a1] += tone * env
# gentle shimmer
music += 0.08 * np.sin(2 * np.pi * 880 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * t / 7.0)) ** 4
music /= np.max(np.abs(music)) + 1e-9
# duck under the voice
win = int(0.35 * SR)
env = np.sqrt(np.convolve(voice**2, np.ones(win) / win, mode='same'))
duck = np.where(env > 0.01, 0.10, 0.22)
duck = np.convolve(duck, np.ones(int(0.4 * SR)) / int(0.4 * SR), mode='same')
fade = np.clip(t / 2.0, 0, 1) * np.clip((total - t) / 2.5, 0, 1)
mix = voice / (np.max(np.abs(voice)) + 1e-9) * 0.92 + music * duck * fade
mix /= max(1.0, np.max(np.abs(mix)) / 0.97)
sf.write(f'{M}/mix.wav', mix.astype(np.float32), SR)

# subtitles (WebVTT, sentence chunks)
def ts(x):
    h, r = divmod(x, 3600)
    m, s_ = divmod(r, 60)
    return f'{int(h):02d}:{int(m):02d}:{s_:06.3f}'

cues = []
for a, b, text in subs:
    parts = [p.strip() for p in text.replace('? ', '?|').replace('. ', '.|').split('|') if p.strip()]
    L = sum(len(p) for p in parts)
    cur = a
    for p in parts:
        dur = (b - a) * len(p) / L
        cues.append((cur, cur + dur, p))
        cur += dur
with open(f'{M}/overview.vtt', 'w') as f:
    f.write('WEBVTT\n\n')
    for i, (a, b, p) in enumerate(cues, 1):
        f.write(f'{i}\n{ts(a)} --> {ts(b)}\n{p}\n\n')

run(['ffmpeg', '-y', '-i', f'{M}/video_noaudio.mp4', '-i', f'{M}/mix.wav', '-c:v', 'libx264', '-preset', 'medium', '-crf', '27', '-maxrate', '4M', '-bufsize', '8M', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest', f'{M}/demand-response-overview.mp4'])
run(['ffmpeg', '-y', '-ss', '40', '-i', f'{M}/demand-response-overview.mp4', '-frames:v', '1', '-q:v', '3', f'{M}/poster.jpg'])
print('done', round(total, 1), 's', os.path.getsize(f'{M}/demand-response-overview.mp4') // 1024, 'KB')
