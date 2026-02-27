const statusEl = document.getElementById("status");
const btnGrab = document.getElementById("btn-grab");
const btnSummarize = document.getElementById("btn-summarize");
const btnCopy = document.getElementById("btn-copy");
const btnDownload = document.getElementById("btn-download");
const transcriptBox = document.getElementById("transcript-box");
const summaryBox = document.getElementById("summary-box");
const tabBar = document.getElementById("tab-bar");
const promptRow = document.getElementById("prompt-row");
const promptInput = document.getElementById("prompt-input");

let currentVideoId = null;
let transcriptText = "";
let summaryText = "";
let activeTab = "transcript";

// --- Tab switching ---
tabBar.addEventListener("click", (e) => {
  const tab = e.target.dataset?.tab;
  if (!tab) return;
  activeTab = tab;
  tabBar.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  transcriptBox.classList.toggle("visible", tab === "transcript");
  summaryBox.classList.toggle("visible", tab === "summary");
});

// --- URL helpers ---
function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube.com" || u.hostname === "youtube.com") {
      return u.searchParams.get("v");
    }
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1);
    }
  } catch {
    return null;
  }
  return null;
}

// --- Check current tab on popup open ---
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab?.url) {
    statusEl.textContent = "Cannot access this page.";
    btnGrab.disabled = true;
    return;
  }
  currentVideoId = extractVideoId(tab.url);
  if (!currentVideoId) {
    statusEl.textContent =
      "Not a YouTube video page. Navigate to a video first.";
    btnGrab.disabled = true;
  } else {
    statusEl.textContent = `Video found: ${currentVideoId}`;
  }
});

// --- Grab transcript ---
btnGrab.addEventListener("click", async () => {
  if (!currentVideoId) return;
  btnGrab.disabled = true;
  statusEl.textContent = "Fetching transcript...";

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: fetchTranscriptFromPage,
      args: [currentVideoId],
    });

    const result = results[0]?.result;
    if (result?.error) throw new Error(result.error);

    transcriptText = result.text;
    transcriptBox.textContent = transcriptText;
    transcriptBox.classList.add("visible");
    tabBar.style.display = "flex";
    btnCopy.style.display = "inline-block";
    btnDownload.style.display = "inline-block";
    btnSummarize.style.display = "inline-block";
    promptRow.style.display = "block";
    statusEl.textContent = `Transcript loaded (${transcriptText.length} chars)`;
  } catch (err) {
    statusEl.innerHTML = `<span class="error">Error: ${err.message}</span>`;
    btnGrab.disabled = false;
  }
});

// --- Summarize with Claude ---
btnSummarize.addEventListener("click", async () => {
  if (!transcriptText) return;
  btnSummarize.disabled = true;
  btnSummarize.textContent = "Summarizing...";
  statusEl.textContent = "Calling Claude...";

  try {
    const data = await chrome.storage.local.get([
      "anthropicApiKey",
      "claudeModel",
    ]);
    const apiKey = data.anthropicApiKey;
    if (!apiKey) {
      throw new Error(
        'No API key set. Right-click the extension icon → Options to add your Anthropic key.'
      );
    }
    const model = data.claudeModel || "claude-haiku-4-5-20251001";

    // Truncate to ~100k chars to stay within context limits
    const truncated = transcriptText.slice(0, 100_000);

    const userFocus = promptInput.value.trim();
    let prompt;
    if (userFocus) {
      prompt = `Here is a YouTube video transcript. The user has a specific request about it:\n\n"${userFocus}"\n\nAnswer their request thoroughly based on the transcript. Use headings and bullet points for readability.\n\nTranscript:\n${truncated}`;
    } else {
      prompt = `Summarize this YouTube video transcript. Produce a clear, well-structured summary that captures all the key points, arguments, and conclusions. Use headings and bullet points for readability. The summary should be thorough enough that someone who hasn't watched the video understands the full content.\n\nTranscript:\n${truncated}`;
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(
        err?.error?.message || `API error ${resp.status}`
      );
    }

    const json = await resp.json();
    summaryText = json.content?.[0]?.text || "No summary returned.";

    summaryBox.textContent = summaryText;

    // Switch to summary tab
    activeTab = "summary";
    tabBar.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === "summary");
    });
    transcriptBox.classList.remove("visible");
    summaryBox.classList.add("visible");
    tabBar.style.display = "flex";

    statusEl.textContent = "Summary ready.";
  } catch (err) {
    statusEl.innerHTML = `<span class="error">${err.message}</span>`;
  } finally {
    btnSummarize.textContent = "Summarize";
    btnSummarize.disabled = false;
  }
});

// --- Copy (copies whichever tab is active) ---
btnCopy.addEventListener("click", async () => {
  const text =
    activeTab === "summary" && summaryText ? summaryText : transcriptText;
  await navigator.clipboard.writeText(text);
  btnCopy.textContent = "Copied!";
  setTimeout(() => {
    btnCopy.textContent = "Copy";
  }, 1500);
});

// --- Download ---
btnDownload.addEventListener("click", () => {
  const isSummary = activeTab === "summary" && summaryText;
  const text = isSummary ? summaryText : transcriptText;
  const suffix = isSummary ? "-summary" : "";
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transcript-${currentVideoId}${suffix}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// =============================================
// Transcript fetcher — runs in the MAIN world
// of the YouTube page.
//
// Uses the same approach as youtube-transcript-api:
// 1. Extract INNERTUBE_API_KEY from the page
// 2. Call /youtubei/v1/player with Android client
//    to get clean caption URLs (no broken exp= param)
// 3. Fetch + parse the caption XML
// =============================================
async function fetchTranscriptFromPage(videoId) {
  try {
    // Step 1: Get the InnerTube API key from the page
    const scripts = document.querySelectorAll("script");
    let apiKey = null;
    for (const s of scripts) {
      const m = s.textContent.match(/"INNERTUBE_API_KEY":\s*"([a-zA-Z0-9_-]+)"/);
      if (m) { apiKey = m[1]; break; }
    }
    if (!apiKey) {
      return { error: "Could not find YouTube API key on page." };
    }

    // Step 2: Call InnerTube player API with Android client context
    const playerResp = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: { clientName: "ANDROID", clientVersion: "20.10.38" },
          },
          videoId: videoId,
        }),
      }
    );

    if (!playerResp.ok) {
      return { error: `YouTube API returned ${playerResp.status}` };
    }

    const playerData = await playerResp.json();
    const tracks =
      playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!tracks || tracks.length === 0) {
      return { error: "No captions/transcript available for this video." };
    }

    // Prefer English, fall back to first available
    const enTrack =
      tracks.find((t) => t.languageCode?.startsWith("en")) || tracks[0];

    // Step 3: Fetch the caption XML
    const captionResp = await fetch(enTrack.baseUrl);
    const captionXml = await captionResp.text();

    if (!captionXml || captionXml.length < 10) {
      return { error: "Caption URL returned empty response." };
    }

    // Step 4: Parse XML with regex (DOMParser blocked by Trusted Types)
    // Handles both formats:
    //   Format A (srv1): <text start="..." dur="...">content</text>
    //   Format B (srv3): <p t="..." d="..."><s>word</s></p> or <p>plain text</p>
    const decode = (s) =>
      s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const lines = [];

    if (captionXml.includes("<text")) {
      const re = /<text[^>]*>([\s\S]*?)<\/text>/g;
      let m;
      while ((m = re.exec(captionXml)) !== null) {
        const raw = decode(m[1]).replace(/\n/g, " ").trim();
        if (raw) lines.push(raw);
      }
    } else {
      const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
      let m;
      while ((m = re.exec(captionXml)) !== null) {
        const inner = m[1];
        const parts = [];
        const sRe = /<s[^>]*>([\s\S]*?)<\/s>/g;
        let sm;
        while ((sm = sRe.exec(inner)) !== null) {
          parts.push(sm[1]);
        }
        const line = decode(
          parts.length > 0 ? parts.join("") : inner.replace(/<[^>]*>/g, "")
        ).trim();
        if (line) lines.push(line);
      }
    }

    if (lines.length === 0) {
      return { error: "Transcript was empty." };
    }

    return { text: lines.join("\n") };
  } catch (err) {
    return { error: err.message || "Failed to fetch transcript." };
  }
}
