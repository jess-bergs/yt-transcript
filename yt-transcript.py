#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["youtube-transcript-api>=1.0.0", "anthropic>=0.40.0"]
# ///
"""
YouTube Transcript Extractor + Summarizer

Pulls the transcript from a YouTube video and optionally summarizes it
with Claude. Outputs clean, readable text files.

Usage:
    ./yt-transcript.py <youtube-url> [options]

Options:
    -p, --prompt TEXT     Summarize with this prompt (e.g. "what were the key points?")
                          Use --prompt "" for a default general summary.
    -o, --output-dir DIR  Save files to this directory (default: current dir)
    -m, --model MODEL     Claude model to use (default: claude-haiku-4-5-20251001)
    --no-transcript       Only output the summary, skip the raw transcript file

Examples:
    # Just transcript
    ./yt-transcript.py "https://www.youtube.com/watch?v=abc123def45"

    # Transcript + default summary
    ./yt-transcript.py "https://youtu.be/abc123def45" --prompt ""

    # Transcript + focused summary to a specific folder
    ./yt-transcript.py "https://youtu.be/abc123def45" -p "what did the speaker say about AI safety?" -o ~/summaries

    # Summary only, opus model
    ./yt-transcript.py "https://youtu.be/abc123def45" -p "list all action items" --no-transcript -m claude-opus-4-6-20250610
"""

import argparse
import os
import re
import sys
from pathlib import Path

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter


def extract_video_id(url: str) -> str:
    patterns = [
        r"(?:v=|/v/)([a-zA-Z0-9_-]{11})",
        r"(?:youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"(?:shorts/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{11}", url):
        return url
    raise ValueError(f"Could not extract a YouTube video ID from: {url}")


def fetch_transcript(video_id: str) -> str:
    ytt_api = YouTubeTranscriptApi()
    transcript = ytt_api.fetch(video_id)
    formatter = TextFormatter()
    return formatter.format_transcript(transcript)


def summarize(transcript: str, prompt: str, model: str) -> str:
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.", file=sys.stderr)
        print("Set it with: export ANTHROPIC_API_KEY='sk-ant-...'", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)

    # Truncate to ~100k chars for context limits
    truncated = transcript[:100_000]

    if prompt:
        user_msg = (
            f'Here is a YouTube video transcript. The user has a specific request:\n\n'
            f'"{prompt}"\n\n'
            f'Answer their request thoroughly based on the transcript. '
            f'Use headings and bullet points for readability.\n\n'
            f'Transcript:\n{truncated}'
        )
    else:
        user_msg = (
            f'Summarize this YouTube video transcript. Produce a clear, '
            f'well-structured summary that captures all the key points, '
            f'arguments, and conclusions. Use headings and bullet points '
            f'for readability. The summary should be thorough enough that '
            f'someone who hasn\'t watched the video understands the full content.\n\n'
            f'Transcript:\n{truncated}'
        )

    message = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": user_msg}],
    )
    return message.content[0].text


def main() -> None:
    parser = argparse.ArgumentParser(
        description="YouTube Transcript Extractor + Summarizer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("url", help="YouTube video URL or video ID")
    parser.add_argument(
        "-p", "--prompt",
        default=None,
        help='Summarize the transcript. Pass a focus prompt, or "" for a general summary.',
    )
    parser.add_argument(
        "-o", "--output-dir",
        default=".",
        help="Directory to save output files (default: current dir)",
    )
    parser.add_argument(
        "-m", "--model",
        default="claude-haiku-4-5-20251001",
        help="Claude model for summarization (default: claude-haiku-4-5-20251001)",
    )
    parser.add_argument(
        "--no-transcript",
        action="store_true",
        help="Skip saving the raw transcript file (summary only)",
    )
    args = parser.parse_args()

    video_id = extract_video_id(args.url)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Fetching transcript for video: {video_id} ...")
    transcript = fetch_transcript(video_id)

    if not args.no_transcript:
        transcript_path = out_dir / f"transcript-{video_id}.txt"
        transcript_path.write_text(transcript, encoding="utf-8")
        print(f"Transcript saved: {transcript_path}  ({len(transcript)} chars)")

    if args.prompt is not None:
        print(f"Summarizing with {args.model} ...")
        summary = summarize(transcript, args.prompt, args.model)
        summary_path = out_dir / f"summary-{video_id}.txt"
        summary_path.write_text(summary, encoding="utf-8")
        print(f"Summary saved:    {summary_path}  ({len(summary)} chars)")


if __name__ == "__main__":
    main()
