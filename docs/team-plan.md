# Graph Accessibility Copilot

**Shared team brief | Four people | Six-hour hackathon | Approximately 90-second demonstration**

> Turn a captured graph into an understandable, explorable experience through structured data, spoken explanation, sonification and vibration-ring feedback.

**Person 4 is the Frontend and Demo Experience Lead, not a general-purpose integration developer.** Their responsibility is to turn the other three members' technical outputs into one coherent, accessible and reliable product demonstration.

## Contents

- [1. Project direction and success criterion](#1-project-direction-and-success-criterion)
- [2. Four-person team and responsibilities](#2-four-person-team-and-responsibilities)
- [3. Core user journey](#3-core-user-journey)
- [4. Interface structure and essential components](#4-interface-structure-and-essential-components)
- [5. Shared data contract and integration](#5-shared-data-contract-and-integration)
- [6. Speech, sonification and the haptic-ring simulator](#6-speech-sonification-and-the-haptic-ring-simulator)
- [7. Accessibility, uncertainty and privacy](#7-accessibility-uncertainty-and-privacy)
- [8. Three reliable execution modes](#8-three-reliable-execution-modes)
- [9. Six-hour execution plan](#9-six-hour-execution-plan)
- [10. Proposed 90-second demonstration](#10-proposed-90-second-demonstration)
- [11. Scope control and completion checklist](#11-scope-control-and-completion-checklist)
- [12. Source and implementation notes](#12-source-and-implementation-notes)
- [Appendix: Original accessibility research](#appendix-original-accessibility-research)

---

## 1. Project direction and success criterion

Build a focused graph-accessibility prototype for blind or low-vision users, demonstrated in a classroom-style context. A user captures a graph, checks the extraction, receives an overview, explores individual values and asks questions without needing to look at the reconstructed graph.

The judges can see the reconstructed graph and the haptic simulator. The user's experience must remain usable without those visual aids.

### Core pipeline

```text
Camera capture or uploaded graph image
    -> Structured graph extraction
    -> Confirmation and uncertainty handling
    -> Graph reasoning: summary, answers and numerical insights
    -> Accessible frontend
         -> Spoken overview and point values
         -> Sonification of graph shape
         -> Vibration ring and visual haptic simulator
```

The original research favours a modular accessibility copilot rather than generic image captioning. Apply that principle to this narrower graph demonstration: prioritise useful information, communicate uncertainty, protect private information, run locally where possible and evaluate a real task rather than only the model output.

### What success looks like

Within approximately ninety seconds, a judge should understand the problem, observe the transformation from image to accessible information, and experience the value of active graph exploration.

A technically strong pipeline hidden behind an incomplete interface is not the target. Prefer a narrower, polished demonstration over additional features that cannot be presented reliably.

The broader concepts and original component research remain in the appendix as background, not as additional workstreams for these six hours.

## 2. Four-person team and responsibilities

| Person | Role | Owns |
| --- | --- | --- |
| 1 | Vision and graph extraction | Camera image -> structured graph data |
| 2 | Graph reasoning and interaction | Structured graph -> summaries, answers and numerical insights |
| 3 | Audio and haptic systems | Sonification, speech coordination and vibration-ring behaviour |
| 4 | Frontend and demo experience | Accessible interface, integration, fallback modes and final demonstration |

The task-level breakdown for Persons 1-3 below is a proposed operational expansion of these ownership summaries and the user journey. It does not introduce additional product scope.

### Person 1 - Vision and Graph Extraction Lead

**Primary objective:** Convert a captured or uploaded graph image into the agreed structured representation.

Responsibilities:

- Extract the graph type, title, axes, units, series names and data values needed by the demonstration.
- Return the extraction through the shared data contract rather than a model-specific response that the frontend must repeatedly accommodate.
- Expose uncertainty instead of silently filling in unreadable labels or values.
- Support the capture-confirmation flow with information the user can review and correct.
- Work with Person 4 on live-image and known-image integration, including extraction failures and retake requests.

**Handoff:** Structured graph data and extraction status that Person 2 can reason over and Person 4 can display for confirmation.

**Boundary:** This person does not own frontend layout, speech playback or haptic algorithms.

### Person 2 - Graph Reasoning and Interaction Lead

**Primary objective:** Turn confirmed structured graph data into understandable summaries, answers and numerical insights.

Responsibilities:

- Produce a short overview covering graph type, variables, overall trend and the most important finding.
- Support the four preset questions: overall trend, maximum, trend changes and comparison between two series.
- Ground answers in the extracted or corrected data and preserve uncertainty when the available information is insufficient.
- Supply the values and insights needed by point-by-point exploration.
- Add free-form questions only when the reasoning pipeline is sufficiently stable.

**Handoff:** A summary, answers and numerical insights that the interface can present through text and speech.

**Boundary:** This person does not own image capture, frontend controls or vibration-ring implementation.

### Person 3 - Audio and Haptic Systems Lead

**Primary objective:** Make graph structure and exploration available through coordinated speech, sound and vibration.

Responsibilities:

- Implement sonification of the graph's shape.
- Coordinate spoken summaries, answers and point values.
- Define and implement the vibration-ring behaviour, including the supported pulse patterns.
- Expose playback and haptic behaviour that Person 4 can connect to accessible controls.
- Work with Person 4 so the visual simulator reflects the intended ring pattern and the demonstration remains usable when hardware is unavailable.

**Handoff:** Audio and haptic functionality, plus the pattern information needed by the simulator.

**Boundary:** This person owns the audio and haptic behaviour; Person 4 owns how the controls, status and simulator appear in the product.

### Person 4 - Frontend and Demo Experience Lead

**Primary objective:** Turn the other three members' technical outputs into one coherent, accessible product demonstration.

This person owns:

- the interface;
- the end-to-end user journey;
- integration between components;
- demo reliability;
- presentation choreography.

They should not spend the day developing vision, graph-reasoning or haptic algorithms. Building speech and haptic controls means integrating Person 3's behaviour, not taking over Person 3's work.

**Authority:** Person 4 can reject features that cannot be presented reliably. Their success criterion is not the number of components built; it is whether the complete experience communicates the problem, transformation and value within approximately ninety seconds.

**Handoff:** A repeatable, keyboard-usable demonstration with a clear journey, visible uncertainty, functioning exploration and deliberate recovery modes.

## 3. Core user journey

### Step 1 - Capture graph

Show a webcam feed or a simulated Meta-glasses view. The user points the camera at a graph and captures it using a clearly labelled button or keyboard shortcut. Provide image upload as the alternative capture route.

The webcam or simulated view is a valid prototype path; the supplied plan does not establish that a live Meta-glasses connection is available.

### Step 2 - Confirm extraction

Display the detected graph type, title, axes, series and confidence. Allow incorrect labels to be corrected. When a detected value is uncertain, ask the user to confirm it or retake the image.

Never silently present uncertain information as fact. Confirmation must be available through the accessible interface, not only through visual inspection of the reconstructed graph.

### Step 3 - Receive overview

Generate a short spoken summary that explains:

- the graph type;
- the variables;
- the overall trend;
- the most important finding.

Show the summary as text as well, with accessible audio controls.

### Step 4 - Explore

Let the user move through data points using arrow keys or large controls. Read the selected point's values aloud, trigger the corresponding simulated ring vibrations and allow the graph's shape to be sonified.

Read the value held in the confirmed data; do not imply that an uncertain extraction is a verified exact measurement.

### Step 5 - Ask questions

Provide reliable preset questions:

- "What is the overall trend?"
- "Where is the maximum?"
- "When does the trend change?"
- "Compare these two series."

Include free-form input only when the reasoning pipeline is sufficiently stable. The comparison question needs a graph with two series; the single-series JSON example below is not a comparison fixture.

### Step 6 - Recover from uncertainty

Show and announce low extraction confidence. Give the user a clear next action: retake the image, correct a label or confirm a detected value.

Recovery is part of the product journey, not an unlabelled error or a silent substitution of cached results.

## 4. Interface structure and essential components

Use **one screen with four states**, rather than several complex pages.

| State | Visible content | Judge takeaway |
| --- | --- | --- |
| Capture | Camera feed and graph frame | Works in a classroom context |
| Processing | Extraction progress | There is a real interpretation pipeline |
| Overview | Accessible summary and graph metadata | Visual information becomes understandable |
| Exploration | Question controls, audio playback and haptic simulator | The user can actively investigate the graph |

Use the Overview state for extraction review and correction before exploration. Present uncertainty and recovery within the relevant state rather than expanding the prototype into a multi-page application.

### Essential components owned by Person 4

- Camera or image-upload component.
- Processing-state indicator.
- Graph overview panel.
- Question interface.
- Audio controls.
- Point-by-point exploration controls.
- Haptic-ring visual simulator.
- Extraction-confidence warning.
- Reset button for repeating the demonstration.

Display a reconstructed graph for the judges, but ensure that the blind-user experience remains fully usable without looking at it.

## 5. Shared data contract and integration

Person 4 should define the interfaces that every other member must return. Agree the contract in the opening thirty minutes and build the interface with mocked data before waiting for the live pipeline.

The other members should conform to the agreed schema. The frontend lead should not repeatedly rewrite the interface around changing backend outputs.

### Shared graph object

The following is the supplied example. Its values and confidence are illustrative demo data, not sourced temperature observations or a measured accuracy result.

```json
{
  "graphType": "line",
  "title": "Average Temperature by Month",
  "xAxis": {
    "label": "Month",
    "values": ["January", "February", "March"]
  },
  "yAxis": {
    "label": "Temperature",
    "unit": "°C"
  },
  "series": [
    {
      "name": "Milan",
      "values": [4, 7, 12]
    }
  ],
  "summary": "Temperature rises across the displayed period.",
  "confidence": 0.91
}
```

### Ownership at each handoff

| Component | Responsibility |
| --- | --- |
| Extraction - Person 1 | Supply the graph structure, labels, series, values and extraction confidence. |
| Reasoning - Person 2 | Use the confirmed structure to supply the summary, answers and numerical insights. |
| Audio and haptics - Person 3 | Consume the graph data and interaction outputs to produce speech, sonification and ring behaviour. |
| Frontend - Person 4 | Coordinate the stages, render the result, collect corrections and provide exploration and recovery controls. |

### Decisions to settle at the start

The supplied graph schema does not specify question-response payloads, audio/haptic commands, partial-extraction errors or per-value uncertainty. Person 4 should agree those interfaces with the relevant owners during the opening half hour rather than discovering incompatible outputs during integration.

The following are proposed implementation conventions:

- Use the same graph representation for mocked data, live extraction, controlled uploads and cached fallback results.
- Keep each series aligned with the x-axis values.
- Apply confirmed corrections before generating the overview or answering questions.
- Agree how low confidence and missing information reach the interface; do not treat the example confidence score as a verified probability of correctness.
- Make interface changes jointly rather than changing a backend response without informing its consumers.

## 6. Speech, sonification and the haptic-ring simulator

### Division of responsibility

Person 3 develops speech coordination, sonification and vibration behaviour. Person 4 connects them to the journey, accessible controls and visible demonstration state.

The product should support a spoken overview, spoken answers, point-value readouts and sonification of the graph's shape. Provide pause and replay controls for speech and sonification.

### Haptic-ring simulator

If physical ring integration is unstable, the frontend should contain a visual haptic simulator supporting:

- short pulse;
- double pulse;
- long pulse;
- rising sequence;
- falling sequence.

During the demonstration, the simulator displays the pattern while the real ring performs it. If the hardware fails, the concept remains demonstrable through the simulator and the accessible audio/text experience.

The supplied brief names these patterns but does not assign a complete meaning or timing specification to each one. Persons 3 and 4 should agree the mapping once and use it consistently in the ring behaviour and simulator.

Keep the simulator labelled so it is clear what is simulated and whether the physical ring is active. The simulator is a visual explanation for judges, not a replacement for nonvisual access.

## 7. Accessibility, uncertainty and privacy

### Accessibility requirements

The product itself must demonstrate strong accessibility practice. Person 4 owns the final experience check, with each member responsible for the accessibility implications of their component.

- [ ] Complete keyboard navigation.
- [ ] Logical focus order.
- [ ] Visible focus indicators.
- [ ] Semantic HTML.
- [ ] Proper button and form labels.
- [ ] Live-region announcements for processing results.
- [ ] High contrast.
- [ ] Large interaction targets.
- [ ] No information communicated only through colour.
- [ ] No unlabelled icons.
- [ ] Pause and replay controls for speech and sonification.
- [ ] Core capture, confirmation, exploration and recovery checked without relying on the reconstructed graph.
- [ ] Keyboard and screen-reader checks completed before rehearsal.

Do not claim full accessibility compliance from an automated scan alone. The original research emphasises task completion, keyboard use and screen-reader behaviour.

### Uncertainty and privacy

Never silently invent or overstate a graph interpretation. Show uncertainty and make the next action understandable. Protect private information in captured material, favour local processing where feasible, and avoid continuous cloud streaming without explicit consent and a visible recording state.

For this demonstration, report what the prototype actually supports. A simulated glasses view, a cached extraction or an inactive physical ring must not be presented as live hardware or live inference.

## 8. Three reliable execution modes

Prepare all three modes before the final rehearsal.

| Mode | Input and execution | What remains demonstrable |
| --- | --- | --- |
| Live mode | Camera capture, model inference, audio and ring all operate live. | The complete end-to-end experience. |
| Controlled mode | A known graph is uploaded while the remaining pipeline operates live. | Interpretation and interaction without depending on an unpredictable capture. |
| Fallback mode | A cached extraction result is loaded and the exploration experience remains functional. | The accessible summary, point exploration, question controls and audio/haptic experience supported by the cached data. |

The fallback must look like an intentional **prototype mode**, not an emergency workaround. Label the active mode clearly and retain the same coherent interface.

The physical-ring/simulator choice is separate from the source of graph data: a ring failure should not force the whole exploration experience to stop. Be explicit when the visual simulator is operating without the ring.

Person 4 also owns the reset path so the demonstration can be repeated cleanly.

## 9. Six-hour execution plan

### Person 4's allocation

| Time | Frontend and Demo Experience Lead |
| --- | --- |
| 0:00-0:30 | Define the user journey, component states and shared data schema. |
| 0:30-2:00 | Build the complete interface using mocked data. |
| 2:00-3:00 | Add speech, keyboard interaction and the haptic simulator, integrating Person 3's outputs. |
| 3:00-4:00 | Connect the vision and reasoning APIs. |
| 4:00-4:45 | Add error handling and fallback data. |
| 4:45-5:15 | Complete accessibility checks. |
| 5:15-6:00 | Run repeated demonstrations and control presentation timing. |

### Proposed shared checkpoints

These checkpoints coordinate the four roles around the supplied frontend schedule.

| Checkpoint | Team outcome |
| --- | --- |
| 0:30 | The journey, graph contract, component interfaces and initial demo example are agreed. |
| 2:00 | Person 4 can walk through the whole interface using mocked data; the other leads continue work against the agreed interfaces. |
| 3:00 | Speech, keyboard exploration and the simulator can be exercised through the interface. |
| 4:00 | Vision and reasoning have been connected; the remaining effort shifts to reliability and recovery. |
| 4:45 | Controlled and fallback modes, error handling and reset are ready for testing. |
| 5:15 | Accessibility checks are complete; only demonstration-critical fixes should interrupt rehearsal. |
| 6:00 | The team can repeat the timed demonstration and explain exactly which components are live or simulated. |

## 10. Proposed 90-second demonstration

The choreography below is a suggested rehearsal script derived from the user journey, not an additional requirement from the original research.

| Time | Demonstration action | Message to the judges |
| --- | --- | --- |
| 0-10 seconds | Introduce the classroom graph and the task of understanding it without sight. | This is about access to information and independent exploration, not generic image captioning. |
| 10-25 seconds | Capture the graph or upload the known example. Identify the active execution mode. | The graph enters a defined interpretation pipeline. |
| 25-40 seconds | Show the extracted metadata, confirmation and confidence, then play the short overview. | Visual information becomes understandable, with uncertainty made explicit. |
| 40-65 seconds | Move through a few points using the keyboard, read values aloud and demonstrate sonification and the ring/simulator. | The user can explore rather than only receive a static description. |
| 65-80 seconds | Ask one reliable preset question, such as "Where is the maximum?" | The system supports an actual information task grounded in the graph. |
| 80-90 seconds | Point out the recovery/prototype-mode controls and close with the user benefit. | The experience is deliberate, repeatable and honest about its limits. |

Use one graph and one main question in the timed run. Demonstrate two-series comparison only with an appropriate two-series example. Test the uncertainty and fallback journeys during rehearsal even when they are not all exercised in the ninety-second presentation.

## 11. Scope control and completion checklist

Person 4 should reject additions that undermine the core journey or make the demonstration unreliable. Free-form questions remain conditional on stability. Physical-ring and glasses integration must not displace the accessible interface, simulator and fallback paths already in the brief.

### Definition of done

- [ ] The four ownership boundaries are clear.
- [ ] The graph data contract is shared and used consistently.
- [ ] Capture or upload reaches a clear processing state.
- [ ] The extraction can be reviewed, labels corrected and uncertainty handled.
- [ ] A short overview explains graph type, variables, trend and the key finding.
- [ ] Keyboard exploration reads point values and connects to the audio/haptic experience.
- [ ] The preset questions are implemented and tested on applicable examples.
- [ ] The reconstructed graph helps judges without being required by the user.
- [ ] The five haptic patterns can be demonstrated in the simulator.
- [ ] Pause and replay work for speech and sonification.
- [ ] The interface passes the team's keyboard and screen-reader checks.
- [ ] Live, controlled and fallback execution are clearly distinguished; unsupported hardware is not presented as live.
- [ ] Reset works and the demonstration can be repeated.
- [ ] The team has rehearsed the approximately ninety-second presentation.

**Final principle:** The judge should understand the problem, observe the transformation and experience the value. Person 4 owns the coherence of that experience; Persons 1-3 own the technical capabilities that make it possible.

## 12. Source and implementation notes

This document combines the supplied `Pasted markdown.md` research with the later graph-focused brief revising Person 4 to **Frontend and Demo Experience Lead**.

The original attachment explores several accessibility concepts and ends by recommending a multimodal accessibility event engine, initially demonstrated through sound awareness. The main plan above follows the later graph-focused brief instead. The original research is retained below so that the earlier recommendation and its context are not silently rewritten.

The detailed task breakdowns for Persons 1-3, integration conventions, shared checkpoints, rehearsal timing and completion checklist are proposed planning detail derived from the supplied ownership split and journey. They are not claims that implementation or validation has already happened.

For technology selection, the attachment lists React or a lightweight PWA, FastAPI with WebSockets, Florence-2/PaddleOCR, structured-JSON reasoning APIs and Piper TTS among its candidates. Its wider audio-recognition and other model lists belong to the broader research, not to a requirement to implement all those systems for the graph demo. The attachment does not establish graph-extraction accuracy, physical-ring compatibility or live glasses access.

The appendix preserves the original research text and links, with heading levels adjusted and the malformed diagram export replaced by a readable text rendering of its pipeline labels. Component, performance and licence statements are retained as supplied; they have not been independently rechecked for this compilation.

---

## Appendix: Original accessibility research

> Background reference only. The following is the earlier concept exploration, not an alternative set of tasks for the six-hour graph build. Its original recommendations, examples and cautions are retained.

### Best hackathon direction

Build a modular “accessibility copilot” rather than a generic image-captioning demo. The strongest architecture converts inaccessible information between three representations:

```text
Camera / microphone / screen
    -> Perception layer
    -> Structured events
    -> Context and priority engine
         -> Speech
         -> Captions / visual alerts
         -> Haptics
```

The competitive differentiator is not the underlying model. It is:

- prioritising information instead of continuously describing everything;
- communicating uncertainty;
- protecting private information;
- running locally where possible;
- providing equivalent output through speech, text and haptics;
- evaluating against real accessibility tasks.

### Concepts ranked for a one-day hackathon

| Rank | Concept                                       | User                                          | Technical risk | Demo strength |
| ---- | --------------------------------------------- | --------------------------------------------- | -------------- | ------------- |
| 1    | Context-aware sound awareness system          | Deaf or hard-of-hearing people                | Low–medium     | Excellent     |
| 2    | Camera guidance and visual question answering | Blind or low-vision people                    | Medium         | Excellent     |
| 3    | AI accessibility repair agent                 | Developers and users of inaccessible websites | Medium         | Strong        |
| 4    | Accessible emergency/insurance assistant      | Blind, low-vision or hearing-impaired users   | Medium         | Strong        |
| 5    | Conversation accessibility layer              | Deaf or hard-of-hearing people                | Low            | Good          |
| 6    | Sign-language translator                      | Sign-language users                           | Very high      | Risky         |

#### 1. Context-aware sound awareness system

A phone or laptop listens for meaningful sounds and converts them into captions, directional visual indicators and configurable vibration patterns.

Example output:

> Smoke alarm — repeated — high confidence — behind you\
> Someone called “Lucas” — left side\
> Vehicle horn — approaching — medium confidence

Components:

- Silero VAD separates speech from non-speech. Its model is about 2 MB, supports ONNX and is MIT-licensed. The project reports sub-millisecond processing for short chunks on a CPU thread. [Silero VAD](https://github.com/snakers4/silero-vad?utm_source=chatgpt.com)
- Whisper via `faster-whisper` provides speech transcription, timestamps and integrated voice-activity filtering. The implementation is MIT-licensed and supports CPU INT8 inference. [faster-whisper](https://github.com/SYSTRAN/faster-whisper?utm_source=chatgpt.com)
- Audio Spectrogram Transformer or a YAMNet/AudioSet model detects alarms, horns, knocks, glass breaking, dogs and other environmental events. AudioSet supplies a broad ontology and millions of human-labelled clips. [AudioSet](https://research.google.com/audioset/?utm_source=chatgpt.com)
- Stereo microphone energy differences can provide crude left/right localisation without another model.
- Web vibration, phone haptics or a smartwatch can encode urgency.

The AI layer should merge repeated detections, suppress irrelevant background events and classify urgency. Avoid claiming exact distance or safety guarantees.

#### 2. Guided visual assistant

A blind user asks a task-oriented question:

- “Which medicine box is the blue one?”
- “Where is the empty chair?”
- “Read this letter but warn me before exposing private information.”
- “Am I pointing the camera at the entire document?”

The system should first help the user capture a usable image, then answer with grounded evidence.

Recommended pipeline:

1. Detect blur, darkness, obstruction and framing problems.
2. Run OCR and object localisation.
3. Use a vision-language model to answer the specific question.
4. Return a concise answer with direction, confidence and optional detail.
5. Read the answer through local TTS.

Useful components:

- **Florence-2**: MIT-licensed compact vision model supporting captioning, OCR, region descriptions, object detection and phrase grounding. [Florence-2](https://huggingface.co/microsoft/Florence-2-large?utm_source=chatgpt.com)
- **Qwen2.5-VL 3B**: stronger general visual reasoning and spatial localisation, but heavier. [Qwen2.5-VL-3B](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct?utm_source=chatgpt.com)
- **PaddleOCR**: multilingual OCR and document parsing under Apache 2.0. [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR?utm_source=chatgpt.com)
- **Grounding DINO**: open-vocabulary detection—find objects described with arbitrary text rather than a fixed class list. [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO)
- **SAM 2**: image and video segmentation for tracking the selected object between frames. [SAM 2](https://github.com/facebookresearch/segment-anything-2)
- **Depth Anything V2 Small**: relative monocular depth, useful for “closer/farther” guidance but unsuitable for safety-critical distance claims. [Depth Anything V2](https://huggingface.co/depth-anything/Depth-Anything-V2-Small-hf?utm_source=chatgpt.com)
- **Piper**: fast local ONNX text-to-speech, including Italian and English voices. Voice files have separate licences that must be checked. [Piper](https://github.com/rhasspy/piper)

Evaluate it using **VizWiz**, whose datasets contain real images and questions produced by blind and low-vision users—not clean benchmark photography. VizWiz also provides privacy and image-quality tasks. [VizWiz datasets](https://vizwiz.org/?utm_source=chatgpt.com)

A better demo than general scene description:

> “Move the camera slightly upward. Document edges detected. The expiry date is 14 March 2027. Confidence: high.”

#### 3. AI accessibility repair agent

A browser extension or developer tool that analyses a web page, explains the user impact, generates a patch and verifies the result.

Pipeline:

1. Playwright loads the page and records the DOM, accessibility tree and screenshot.
2. `axe-core` detects deterministic WCAG violations.
3. OmniParser identifies visually apparent controls and icons not adequately represented in the DOM.
4. A multimodal model compares visual intent with semantic markup.
5. An LLM proposes HTML, CSS and ARIA changes.
6. Run `axe-core` again and show before/after keyboard and screen-reader behaviour.

Core tools:

- **axe-core**: open-source WCAG testing engine supporting WCAG 2.0–2.2 rules. Its maintainers state that automated checks find roughly 57% of WCAG issues, so the tool must identify cases requiring human review rather than claiming full compliance. [axe-core](https://github.com/dequelabs/axe-core?utm_source=chatgpt.com)
- **OmniParser**: converts UI screenshots into structured interactive regions and icon descriptions. Its current detector and caption weights have different licences, so use the documented MIT-compatible weights. [OmniParser](https://github.com/microsoft/OmniParser?utm_source=chatgpt.com)
- **Playwright**: browser automation, screenshots, keyboard-path testing and accessibility snapshots.
- **W3C WCAG 2.2**: use it as the normative rule source. Generated alt text must communicate the image’s purpose, not merely enumerate visual details. [WCAG 2.2](https://www.w3.org/TR/WCAG22/?utm_source=chatgpt.com), [W3C alt-text technique](https://www.w3.org/WAI/WCAG22/Techniques/html/H37?utm_source=chatgpt.com)

The winning presentation is not “AI finds missing alt text.” Show an inaccessible task—such as submitting a claim—then demonstrate keyboard navigation, screen-reader labels and task completion before and after repair.

#### 4. Accessible emergency or insurance assistant

This aligns naturally with Generali:

- read and simplify claim forms;
- guide the user while photographing damage;
- identify missing evidence;
- transcribe calls and separate speakers;
- convert emergency announcements into captions and haptic alerts;
- redact faces, addresses, policy numbers and documents before cloud processing.

A strong implementation combines Florence-2/PaddleOCR, Whisper, a reasoning model and deterministic form validation. Never infer damage values, medical conclusions or coverage eligibility. The system should organise evidence and make the workflow accessible.

#### 5. Conversation accessibility layer

A local meeting application providing:

- live captions;
- speaker-labelled transcript;
- translation between Italian and English;
- detection of interruptions and turn-taking;
- large-text “conversation cards”;
- speech synthesis for typed replies;
- summaries with unresolved questions and action items.

Use `faster-whisper`, Silero VAD, optional speaker diarisation and Piper. Speaker diarisation frequently introduces latency and identity errors; for the demo, let participants select their name or colour rather than presenting inferred identity as fact.

### Open-source component map

| Capability                      | Recommended tool                 | Licence/status                    | Hackathon use                           |
| ------------------------------- | -------------------------------- | --------------------------------- | --------------------------------------- |
| Local speech recognition        | `faster-whisper`                 | MIT code                          | Captions and commands                   |
| Lightweight speech detection    | Silero VAD                       | MIT                               | Streaming audio segmentation            |
| Full offline speech stack       | `sherpa-onnx`                    | Apache 2.0                        | ASR, TTS and related edge inference     |
| Environmental sound recognition | AST/YAMNet-style AudioSet models | Model-specific                    | Alarms and ambient events               |
| Local text-to-speech            | Piper                            | Code and voice licences differ    | Spoken output                           |
| Multitask vision                | Florence-2                       | MIT                               | OCR, captions, grounding                |
| General visual reasoning        | Qwen2.5-VL 3B                    | Open-weight; verify model licence | Visual question answering               |
| Multilingual OCR                | PaddleOCR                        | Apache 2.0                        | Documents and signage                   |
| Promptable object detection     | Grounding DINO                   | Apache 2.0 repository             | “Find the red door”                     |
| Segmentation/tracking           | SAM 2                            | Apache 2.0                        | Track selected objects                  |
| Relative depth                  | Depth Anything V2 Small          | Apache 2.0 model variant          | Camera guidance                         |
| Hand/pose tracking              | MediaPipe                        | Apache 2.0                        | Custom gestures and non-verbal controls |
| UI screenshot parsing           | OmniParser                       | Mixed by component                | Recover inaccessible UI structure       |
| Web accessibility testing       | axe-core                         | MPL 2.0                           | WCAG diagnostics                        |
| Model execution                 | ONNX Runtime                     | MIT                               | Portable local deployment               |
| Browser-side ML                 | Transformers.js                  | Apache 2.0                        | Privacy-preserving web demos            |

“Available on Hugging Face” does not mean “open source.” Check three layers separately:

1. repository code licence;
2. model-weight licence;
3. dataset and voice licence.

### Recommended stack

For the highest probability of completing a polished prototype:

- Front end: React or a lightweight PWA.
- Backend: FastAPI with WebSockets.
- Audio: Silero VAD → `faster-whisper` → AudioSet classifier.
- Vision: Florence-2 plus PaddleOCR.
- Reasoning: partner-provided Claude/OpenAI API, with structured JSON outputs.
- Local output: Piper TTS.
- Deployment: one laptop; avoid depending on mobile compilation.
- Accessibility: keyboard-only interface, high contrast, scalable type, ARIA live regions and screen-reader testing.

Keep inference components behind interchangeable interfaces:

```
class PerceptionEvent:
    modality: str
    label: str
    confidence: float
    location: str | None
    transcript: str | None
    timestamp: float
    urgency: int
```

This lets the application treat “smoke alarm,” “door detected,” “speaker said my name” and “form field missing a label” as structured accessibility events rather than model-specific outputs.

### What to avoid

- A generic “camera describes everything” application. It creates cognitive overload and already has mature commercial equivalents.
- Full sign-language translation in one day. Sign languages contain grammar, facial expression, body posture and regional variation; MediaPipe hand landmarks alone are not sign-language understanding.
- Autonomous navigation. Monocular depth and object detection are insufficient for safety-critical mobility.
- Emotion detection from faces or voices. It is unreliable and unnecessary.
- Continuous cloud streaming without explicit consent and visible recording state.
- Claims of WCAG compliance based solely on an automated scanner.
- Silent hallucinations. Every generated interpretation needs confidence, evidence or an explicit “I cannot determine this.”

### Evaluation criteria

Use a five-task test rather than model accuracy alone:

| Measure          | Example                                                 |
| ---------------- | ------------------------------------------------------- |
| Task success     | User identifies the correct medicine package            |
| Latency          | Alert appears within two seconds                        |
| False-alert rate | Background audio does not repeatedly trigger warnings   |
| Information load | No more than one high-priority message at a time        |
| Recovery         | System explains how to reframe the camera after failure |
| Privacy          | Sensitive regions remain local or are visibly redacted  |
| Accessibility    | Entire interface works with keyboard and screen reader  |

The strongest overall proposal is the **multimodal accessibility event engine**, demonstrated first as a sound-awareness system and extended with guided vision. It is feasible in one day, visually demonstrable, technically substantive, privacy-aware and reusable across whatever specific track is announced.
