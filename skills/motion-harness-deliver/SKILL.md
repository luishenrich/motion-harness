---
name: motion-harness-deliver
description: Hand a finished motion film over with mh deliver: both formats rendered, stills as jpg, subtitles, per-platform loudness copies, burned captions, upload to S3 or R2, and a manifest with sizes, sha1 and chapters. Use when a film is approved and someone asks for the files, the YouTube upload, the CDN links, the thumbnails, the srt, or a delivery folder. Triggers: deliver, handover, export, upload, CDN, R2, YouTube, thumbnails, srt, subtitles, loudness, platform copies, manifest.
---

# Delivering a film with motion-harness

A delivery is one command once the film is approved. Everything in the folder is regenerated,
so never hand-edit a delivered file; change the source and deliver again.

```bash
mh render --format all --engine native          # both formats, size and bitrate in the log
mh still all --jpg --width 1280 --sheet          # thumbnails, covers, OG image, linted
mh audio                                         # loudness vs YouTube/TikTok/Instagram/LinkedIn
mh deliver --out docs/.../deliverables --stills all --platforms youtube,tiktok --captions --upload video/<name>
```

What lands in the folder:

- `<film>-<format>-<w>x<h>.mp4` per format, `-youtube.mp4` etc. normalised to that platform's
  loudness (-14 LUFS, -1 dBTP), `-captions.mp4` with the subtitles burned in
- every still as jpg at the requested width
- `<film>-<lang>.srt` from the timeline (scene `text`, or `caption` for scenes without copy)
- `README.md` (or `MANIFEST.md` when a hand-written README exists): files with size, length,
  bitrate, loudness, sha1 and public url, the chapter list for the description, every scene, the
  audio cues
- `.gitignore` keeping the mp4 out of the repo; the CDN copies are the source of truth

Upload reads `MH_S3_ENDPOINT`, `MH_S3_BUCKET`, `MH_S3_KEY`, `MH_S3_SECRET`, `MH_S3_PUBLIC_URL`
(or the `CLOUDFLARE_*` names a project may already carry). Never print those values. A web copy
older than its master is skipped and said so; render `--web` again if it is wanted.

Before delivering, the gates: `mh check --format all` passed, `mh lint --rendered --format all`
has no errors, `mh audio` shows no NOTHING AUDIBLE and the bed covers the film, `mh still all`
has no lint errors. If a gate fails, fix the source, not the delivery.

Publishing to YouTube, social accounts or a store is the human's call. Prepare titles,
descriptions and the chapter list (from `mh srt --chapters`), hand over the folder and the
links, and stop.
