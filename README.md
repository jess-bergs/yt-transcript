# YouTube Transcript Grabber

Extract YouTube video transcripts as readable plain text, with optional AI-powered summaries via Claude.

Built for accessibility — clean text output suitable for screen readers and comfortable reading.

## Two interfaces

### CLI tool (`yt-transcript.py`)

Self-contained script using [uv](https://docs.astral.sh/uv/) inline dependencies. No install step needed.

```bash
# Just transcript (no API key needed)
./yt-transcript.py "https://www.youtube.com/watch?v=VIDEO_ID"

# Transcript + general summary
./yt-transcript.py "https://youtu.be/VIDEO_ID" --prompt ""

# Transcript + focused summary
./yt-transcript.py "https://youtu.be/VIDEO_ID" -p "what did the speaker say about AI safety?"

# Custom output folder
./yt-transcript.py "https://youtu.be/VIDEO_ID" -p "list action items" -o ~/summaries

# Summary only, pick a model
./yt-transcript.py "https://youtu.be/VIDEO_ID" -p "" --no-transcript -m claude-sonnet-4-6-20250514
```

Requires `ANTHROPIC_API_KEY` env var for summaries. Plain transcript grabs need no key.

### Chrome extension (`yt-transcript-extension/`)

1. Go to `chrome://extensions`, enable Developer mode
2. Click "Load unpacked" and select the `yt-transcript-extension` folder
3. Right-click the extension icon → Options → enter your Anthropic API key

Features:
- **Get Transcript** — pull subtitle text from any YouTube video
- **Summarize** — send to Claude for a structured summary
- **Prompt input** — steer the summary (e.g. "what did person X focus on?")
- **Copy / Download** — copy or save as `.txt`
- Tab switching between full transcript and summary views

## License

MIT
