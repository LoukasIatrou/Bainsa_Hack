# Meta smart glasses: mapping our phone PoC to real hardware

Research for: could `Capture.tsx` (phone camera → `/extract`) and the `SpeechSynthesis`
narration in `Exploration.tsx` run on real Meta smart glasses instead of a phone?

## (a) Camera capture — replaces `Capture.tsx`

**Verdict: requires Developer Preview access, not public yet.**

Meta's **Wearables Device Access Toolkit (DAT)** is a mobile SDK (iOS/Android, GitHub repos
`facebook/meta-wearables-dat-ios` / `-android`) that lets a **companion phone app** pull a
POV video/photo stream from the glasses over Bluetooth. Architecturally this is a drop-in
replacement for our current step: the phone app still does the HTTP POST to `/extract`,
it just gets the image from the glasses' camera via DAT instead of `<input type="file">`/
`getUserMedia`. No backend or contract changes needed.

Supported hardware: Ray-Ban Meta (Gen 1/2), Ray-Ban Display, Oakley Meta HSTN/Vanguard.

## (b) Audio output — replaces phone `SpeechSynthesis` playback

**Verdict: same access tier as camera (Developer Preview).**

DAT explicitly covers "open-ear audio" output alongside camera and mic. Per-point spoken
readouts could be routed to the glasses' own speakers through the same companion-app SDK
call, so the user hears narration without holding/looking at a phone — closer to the real
non-visual use case than the hackathon demo.

## (c) Toolkit status as of Meta Connect 2026

- **Developer Preview only** — sign-up ("interest form") required, no public app store
  publishing yet. Builds only reach small audiences via release channels.
- Meta's original goal was public GA in 2026; as of Connect 2026 (this week) no GA date has
  been confirmed — at risk of slipping past 2026.
- **Not exposed to third parties at all:** Meta AI voice-assistant features (the assistant
  layer stays first-party). Irrelevant to us — we don't use Meta AI, we use our own
  extraction/reasoning backend.
- **Accessibility is an explicit flagship use case** Meta calls out for this toolkit: Be My
  Eyes (~1M blind/low-vision users), HumanWare, and Microsoft's Seeing AI are named launch
  partners building hands-free assistive tools on it. This is directly the same audience and
  camera→description pipeline shape as this project.

## Bottom line for the pitch

The mapping is architecturally clean — camera-in, speech-out both go through DAT with no
change to our `/extract` → `/reason` → exploration pipeline — but real hardware deployment
is gated behind Meta's Developer Preview, not something we could ship publicly today. Fair
claim: "the software pipeline is glasses-ready; the blocker is Meta's own access gate, not
our architecture."

Sources:
- https://developers.meta.com/blog/introducing-meta-wearables-device-access-toolkit/
- https://vr.org/articles/meta-glasses-three-tiers-wearables-toolkit-publishing-connect-2026
- https://developers.meta.com/wearables/faq/
