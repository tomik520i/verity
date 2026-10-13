"""Spočítá časovou osu úderů podkresu pro tanec smajlíka.
Použití:  python tools/beats.py public/podkres.mp3  → public/podkres.beats.json
Závislosti: librosa, numpy.
"""
import json, sys
import librosa, numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else 'public/podkres.mp3'
y, sr = librosa.load(path, sr=22050, mono=True)
tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units='time', tightness=100)
env = librosa.onset.onset_strength(y=y, sr=sr)
times = librosa.times_like(env, sr=sr)
strength = [float(env[max(0, np.searchsorted(times, b) - 2): np.searchsorted(times, b) + 3].max()) for b in beats]
mx = max(strength) or 1
out = path.rsplit('.', 1)[0] + '.beats.json'
json.dump({'duration': round(len(y) / sr, 3), 'tempo': round(float(np.atleast_1d(tempo)[0]), 1),
           'beats': [[round(float(b), 3), round(s / mx, 2)] for b, s in zip(beats, strength)]}, open(out, 'w'))
print(out, len(beats), 'úderů')
